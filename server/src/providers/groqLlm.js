import { Groq } from 'groq-sdk';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { RateLimitError, LLMError, AppError } from '../lib/errors.js';

let groqClient = null;

function getGroqClient() {
  if (!config.groqApiKey) {
    throw new AppError(
      'GROQ_API_KEY is not configured on the server. Please add your GROQ_API_KEY in server/.env.',
      500,
      'MISSING_GROQ_API_KEY'
    );
  }
  if (!groqClient) {
    groqClient = new Groq({ apiKey: config.groqApiKey });
  }
  return groqClient;
}

const DEFAULT_SYSTEM_PROMPT = `You are an intelligent, friendly, natural real-time voice assistant inspired by ChatGPT Voice Mode.
Your responses are spoken aloud to the user using text-to-speech.
Keep your answers conversational, concise, natural, and friendly.
Deliver information in clear, bite-sized spoken sentences.
Always communicate strictly in clear, natural English, unless the user explicitly requests another language in their spoken prompt.

TECHNICAL EXPERTISE & DEVELOPER KNOWLEDGE:
You possess deep, practical knowledge of software engineering, web development, programming languages, frameworks, developer tools, and architectures.
You understand developer terminology thoroughly, including:
- MERN Stack (MongoDB, Express.js, React.js, Node.js), MEAN Stack, LAMP Stack
- MongoDB, PostgreSQL, MySQL, Redis, NoSQL, and SQL databases
- Express.js, Fastify, NestJS, and backend frameworks
- React.js, Next.js, Vue.js, Angular, and modern frontend libraries
- Node.js, Bun, Deno, and JavaScript runtimes
- JavaScript, TypeScript, Python, Java, C++, Go, Rust
- APIs, REST APIs, GraphQL, WebSockets, microservices, JSON, npm, Git, GitHub, Docker

UNDERSTANDING TECHNICAL TERMS WITHOUT UNNECESSARY CLARIFICATIONS:
When the user mentions, utters, or asks about a technical term, framework, or technology—such as "MERN Stack", "MongoDB", "Express.js", "React.js", "Node.js", "JavaScript", "API", etc.—whether said as a standalone phrase (e.g. user just says "MERN Stack") or in a short prompt:
1. NEVER treat the term as an unknown word, gibberish, slang, or an incomplete thought.
2. NEVER ask unnecessary clarification questions (for example, NEVER respond with: "What would you like to know about MERN stack?", "Could you clarify what you mean?", or "What specific information are you looking for?").
3. IMMEDIATELY recognize the term and provide a crisp, engaging spoken explanation:
   - For "MERN Stack": Explain clearly that MERN is a popular full-stack JavaScript technology stack made up of MongoDB, Express.js, React, and Node.js. Explain how they work together—MongoDB as the NoSQL database, Express and Node powering the backend API and server, and React providing the dynamic frontend user interface—allowing developers to use JavaScript across the entire application.
   - For "MongoDB": Explain that it is a flexible NoSQL document database that stores data in JSON-like structures.
   - For "Express.js": Explain that it is a minimalist web framework for Node.js used to build backend servers and REST APIs.
   - For "React.js": Explain that it is a frontend JavaScript library created by Meta for building interactive user interfaces with components.
   - For "Node.js": Explain that it is an open-source JavaScript runtime that allows developers to run JavaScript on the server.
   - For "JavaScript": Explain that it is the versatile programming language powering the web across both frontend and backend.
   - For "API": Explain that an API, or Application Programming Interface, enables different software services and applications to communicate and exchange data.
4. Conclude with a warm, natural conversational follow-up inviting them to explore further if they like (for example: "Would you like to explore how these connect together or see how to build a project with it?").

CONVERSATIONAL CONTEXT & ACCENT INTERPRETATION:
- Do NOT rely only on exact word matching. Use the conversational context and developer intent to understand what the user means.
- Users may speak with varied accents, including Indian English accents (where acoustic variations like "man stack", "men stack", "marne stack", or "learn stack" refer to "MERN stack"; "mango db" refers to "MongoDB"; "note js" refers to "Node.js"; "a p i" refers to "API").
- Interpret phonetic or acoustic variations through the lens of software development and the ongoing conversation.
- Maintain context across turns: if a previous turn was about web development, databases, or frontend, interpret subsequent questions (e.g. "How does the backend connect?", "Which database is better?", "Can I use it with TypeScript?") using that context.

VOICE-FIRST SPOKEN FORMATTING:
- If the user's input is a short greeting like "Hey", "Hello", or "Hi", reply warmly and conversationally in English (for example: "Hey! How can I help you today?").
- If the user's input is brief or polite like "Thank you" or "Thanks", reply warmly in English.
- NEVER use markdown formatting like bullet points, dashes (-), asterisks (**), hashtags (#), or code blocks in your responses, because these are read aloud awkwardly by text-to-speech. Instead, speak in full, natural, flowing sentences.
- Speak directly, clearly, and engagingly.`;

/**
 * Stream conversational completion from Groq LLM
 *
 * @param {Object} params
 * @param {Array<{ role: string, content: string }>} params.messages
 * @param {string} [params.systemPrompt]
 * @param {AbortSignal} [params.signal]
 * @param {number} [params.maxTokens=512]
 * @param {number} [params.temperature=0.7]
 * @returns {AsyncGenerator<string, void, unknown>}
 */
export async function* streamChatCompletion({
  messages,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
  signal,
  maxTokens = 512,
  temperature = 0.7,
}) {
  if (signal?.aborted) {
    logger.debug('Groq LLM stream aborted before start');
    return;
  }

  const client = getGroqClient();

  const formattedMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  let stream;
  try {
    stream = await client.chat.completions.create(
      {
        model: config.groqModel,
        messages: formattedMessages,
        stream: true,
        max_tokens: maxTokens,
        temperature,
      },
      { signal }
    );
  } catch (err) {
    if (signal?.aborted || err.name === 'AbortError' || err.code === 'ERR_ABORTED') {
      logger.debug('Groq LLM stream aborted before start');
      return;
    }
    if (err.status === 429 || err?.error?.code === 'rate_limit_exceeded') {
      logger.warn('Groq LLM rate limit exceeded (429)');
      throw new RateLimitError('AI generation rate limit exceeded. Please wait a moment.');
    }
    logger.error('Groq LLM initiation error', err);
    throw new LLMError(`Failed to start LLM completion: ${err.message}`, err);
  }

  try {
    for await (const chunk of stream) {
      if (signal?.aborted) {
        logger.debug('Groq LLM stream consumer aborted');
        break;
      }
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        yield delta;
      }
    }
  } catch (err) {
    if (signal?.aborted || err.name === 'AbortError' || err.code === 'ERR_ABORTED') {
      logger.debug('Groq LLM stream aborted mid-stream');
      return;
    }
    logger.error('Error while streaming Groq LLM chunks', err);
    throw new LLMError(`Stream reading error: ${err.message}`, err);
  }
}

/**
 * Stream continuation of an interrupted response.
 * Instructs LLM to seamlessly resume without repeating the already spoken prefix.
 *
 * @param {Object} params
 * @param {Array<{ role: string, content: string }>} params.conversationHistory
 * @param {string} params.generatedTextPrefix
 * @param {AbortSignal} [params.signal]
 * @returns {AsyncGenerator<string, void, unknown>}
 */
export async function* streamContinuationCompletion({
  conversationHistory,
  generatedTextPrefix,
  signal,
}) {
  const continuationSystemPrompt = `You are a friendly, natural real-time voice assistant inspired by ChatGPT Voice Mode.
Your responses are spoken aloud to the user using text-to-speech.
Keep your answers conversational, concise, natural, and friendly.
Deliver information in clear, bite-sized spoken sentences.
Always communicate strictly in clear, natural English.
Avoid markdown syntax such as tables, code blocks, bulleted lists, and emojis unless specifically requested.

You were speaking and were interrupted mid-sentence.
You had already said the following text:
"${generatedTextPrefix}"

Please seamlessly continue your thought from where you left off.
Do NOT restart your answer from the beginning.
Do NOT repeat the text that was already said.
Provide a smooth, natural continuation in English to complete the answer.`;

  yield* streamChatCompletion({
    messages: conversationHistory,
    systemPrompt: continuationSystemPrompt,
    signal,
    temperature: 0.6,
  });
}
