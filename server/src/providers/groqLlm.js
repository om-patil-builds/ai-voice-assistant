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
    groqClient = new Groq({ apiKey: config.groqApiKey, maxRetries: 0 });
  }
  return groqClient;
}

export const FALLBACK_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];
export const PRIMARY_MODEL = config.groqModel || 'openai/gpt-oss-20b';

export const DEFAULT_SYSTEM_PROMPT = `You are a real-time voice assistant inspired by ChatGPT Voice Mode. Responses are spoken aloud via TTS. Keep answers conversational, concise, natural, and in bite-sized spoken sentences.

LANGUAGES:
- Fluently support English, Marathi (मराठी), and Hindi (हिंदी). Always respond in the EXACT SAME language the user uses:
  * Marathi: Respond in fluent Marathi (मराठी) using Devanagari script.
  * Hindi: Respond in fluent Hindi (हिंदी) using Devanagari script.
  * English: Respond in fluent English.
- Code-mixing (Maranglish / Hinglish): When the user speaks Marathi or Hindi with English technical terms (e.g. "MERN stack म्हणजे काय?", "API kaise kaam karta hai?"), retain technical terms naturally within Devanagari sentence grammar. Do not switch entirely to English.

TECH EXPERTISE:
- Full expertise in software engineering, MERN Stack (MongoDB, Express.js, React, Node.js), APIs, JavaScript, TypeScript, and developer tools.
- When the user asks about any technical term, immediately provide a crisp, engaging spoken explanation in their language. Do not ask "What would you like to know?".
- Handle acoustic variations naturally (e.g. "man stack" -> MERN Stack, "mango db" -> MongoDB).

SPOKEN STYLE:
- Greetings: Reply warmly in user's language (Marathi: "नमस्कार! मी तुम्हाला कशी मदत करू शकतो?", Hindi: "नमस्ते! मैं आपकी क्या सहायता कर सकता हूँ?", English: "Hey! How can I help you today?").
- NEVER use markdown (bullet points, asterisks, hashtags, code blocks). Speak in natural flowing sentences.`;

/**
 * Stream conversational completion from Groq LLM
 *
 * @param {Object} params
 * @param {Array<{ role: string, content: string }>} params.messages
 * @param {string} [params.systemPrompt]
 * @param {AbortSignal} [params.signal]
 * @param {number} [params.maxTokens=256]
 * @param {number} [params.temperature=0.7]
 * @returns {AsyncGenerator<string, void, unknown>}
 */
export async function* streamChatCompletion({
  messages,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
  signal,
  maxTokens = 256,
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
      logger.warn('Groq LLM rate limit exceeded (429) on primary model', { model: config.groqModel });

      // Fallback model support: try available alternative models if primary model is rate-limited
      const fallbackModels = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'].filter((m) => m !== config.groqModel);
      for (const fallbackModel of fallbackModels) {
        if (signal?.aborted) return;
        try {
          logger.info(`Attempting fallback LLM model: ${fallbackModel}`);
          stream = await client.chat.completions.create(
            {
              model: fallbackModel,
              messages: formattedMessages,
              stream: true,
              max_tokens: maxTokens,
              temperature,
            },
            { signal }
          );
          if (stream) break;
        } catch (fallbackErr) {
          logger.warn(`Fallback model ${fallbackModel} also failed: ${fallbackErr.message}`);
        }
      }

      if (!stream) {
        throw new RateLimitError('AI generation rate limit exceeded. Please wait a moment.');
      }
    } else {
      logger.error('Groq LLM initiation error', err);
      throw new LLMError(`Failed to start LLM completion: ${err.message}`, err);
    }
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
 * @param {'en'|'hi'|'mr'} [params.language='en']
 * @param {AbortSignal} [params.signal]
 * @returns {AsyncGenerator<string, void, unknown>}
 */
export async function* streamContinuationCompletion({
  conversationHistory,
  generatedTextPrefix,
  language = 'en',
  signal,
}) {
  const langInstruction =
    language === 'mr'
      ? 'Provide a smooth, natural continuation in Marathi (मराठी) to complete the answer.'
      : language === 'hi'
      ? 'Provide a smooth, natural continuation in Hindi (हिंदी) to complete the answer.'
      : 'Provide a smooth, natural continuation in English to complete the answer.';

  const continuationSystemPrompt = `You are a friendly, natural real-time voice assistant inspired by ChatGPT Voice Mode.
Your responses are spoken aloud to the user using text-to-speech.
Keep your answers conversational, concise, natural, and friendly.
Deliver information in clear, bite-sized spoken sentences.
Avoid markdown syntax such as tables, code blocks, bulleted lists, and emojis unless specifically requested.

You were speaking and were interrupted mid-sentence.
You had already said the following text:
"${generatedTextPrefix}"

Please seamlessly continue your thought from where you left off.
Do NOT restart your answer from the beginning.
Do NOT repeat the text that was already said.
${langInstruction}`;

  yield* streamChatCompletion({
    messages: conversationHistory,
    systemPrompt: continuationSystemPrompt,
    signal,
    temperature: 0.6,
  });
}
