import { Groq, toFile } from 'groq-sdk';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { ValidationError, RateLimitError, STTError, AppError } from '../lib/errors.js';
import { normalizeTechTerms } from '../modules/voice/techTermNormalizer.js';

import { normalizeLanguageCode } from '../modules/voice/languageDetector.js';

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

/**
 * Sanitizes prompt to ensure it strictly stays under Groq Whisper's 896-byte limit.
 * Multi-byte UTF-8 characters (like Devanagari) can expand beyond string length, so
 * we measure and clamp by UTF-8 byte length with a safety margin (800 bytes).
 *
 * @param {string} prompt
 * @param {number} maxBytes
 * @returns {string|undefined}
 */
export function sanitizeSttPrompt(prompt, maxBytes = 800) {
  if (!prompt || typeof prompt !== 'string') return undefined;
  if (Buffer.byteLength(prompt, 'utf8') <= maxBytes) return prompt;

  let truncated = prompt;
  while (Buffer.byteLength(truncated, 'utf8') > maxBytes && truncated.length > 0) {
    truncated = truncated.slice(0, -5);
  }
  return truncated.trim();
}

/**
 * Contextual prompt for Whisper STT multilingual biasing.
 * Priming Whisper with English, Hindi, and Marathi vocabulary ensures high accuracy
 * across all three languages and mixed speech (Hinglish/Maranglish), and voice commands.
 * Kept well under Groq's 896 UTF-8 byte limit (~480 bytes).
 */
export const STT_VOCABULARY_PROMPT = sanitizeSttPrompt(
  'MERN stack, MongoDB, Express.js, React.js, Node.js, JavaScript, TypeScript, REST API, GraphQL, full-stack. हिंदी/मराठी: नमस्ते, नमस्कार, मर्न स्टॅक, मर्न स्टैक, क्या है, म्हणजे काय, रुको, थांबा, आगे बोलो, पुढे बोला, फिर से बोलो, पुन्हा सांगा. Commands: Stop, Continue, Repeat, Mute.'
);


/**
 * Check if a 16-bit PCM WAV buffer is pure silence or low-energy ambient noise
 * @param {Buffer} buffer
 * @returns {{ isSilence: boolean, rms: number, peak: number }}
 */
function analyzeWavEnergy(buffer) {
  // Standard WAV header is 44 bytes
  if (!buffer || buffer.length <= 44) {
    return { isSilence: true, rms: 0, peak: 0 };
  }

  // Check if buffer starts with 'RIFF' and has 'WAVE'
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { isSilence: false, rms: 0.1, peak: 0.5 };
  }

  let sumSquares = 0;
  let sampleCount = 0;
  let peak = 0;

  for (let i = 44; i < buffer.length - 1; i += 2) {
    const sample = buffer.readInt16LE(i) / 32768.0;
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
    sumSquares += sample * sample;
    sampleCount++;
  }

  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  // If peak amplitude < 0.025 and RMS < 0.007, audio is ambient room silence / breath
  const isSilence = peak < 0.025 && rms < 0.007;

  return { isSilence, rms, peak };
}

/**
 * Transcribe audio buffer using Groq Whisper STT (whisper-large-v3-turbo)
 * Supports automatic language detection for English, Marathi, and Hindi.
 *
 * @param {Buffer} audioBuffer
 * @param {Object} [options]
 * @param {string} [options.filename='speech.wav']
 * @param {string} [options.mimetype='audio/wav']
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ transcript: string, duration?: number, language?: string }>}
 */
export async function transcribeAudio(audioBuffer, options = {}) {
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new ValidationError('Audio data is empty or invalid.');
  }

  const maxBytes = config.maxAudioSizeMb * 1024 * 1024;
  if (audioBuffer.length > maxBytes) {
    throw new ValidationError(`Audio file exceeds maximum size limit of ${config.maxAudioSizeMb} MB.`);
  }

  const filename = options.filename || 'speech.wav';
  const mimetype = options.mimetype || 'audio/wav';

  // Fast pre-check: if audio is pure digital silence or low-energy room noise,
  // skip STT API call to avoid Whisper's known silence hallucinations ("Thank you.")
  const { isSilence, peak } = analyzeWavEnergy(audioBuffer);
  if (isSilence) {
    logger.debug('Skipping STT for silent audio buffer');
    return {
      transcript: '',
      duration: 0,
      language: config.groqSttLanguage ? normalizeLanguageCode(config.groqSttLanguage) : 'en',
    };
  }

  const client = getGroqClient();

  try {
    const file = await toFile(audioBuffer, filename, { type: mimetype });

    const startTime = Date.now();
    const transcriptionParams = {
      file,
      model: config.groqSttModel,
      prompt: sanitizeSttPrompt(options.prompt || STT_VOCABULARY_PROMPT),
      response_format: 'verbose_json',
      temperature: 0.0,
    };

    // If language is explicitly forced via config, use it; otherwise allow automatic language detection
    if (config.groqSttLanguage && config.groqSttLanguage !== 'auto') {
      transcriptionParams.language = config.groqSttLanguage;
    }

    const response = await client.audio.transcriptions.create(transcriptionParams, {
      signal: options.signal,
    });

    const elapsedMs = Date.now() - startTime;
    let rawText = (response.text || '').trim();

    // Filter known Whisper silence / YouTube outro artifacts
    const cleanLower = rawText.replace(/[.,!?;:]+/g, '').trim().toLowerCase();
    const isHallucination =
      ['thanks for watching', 'thank you for watching', 'subtitles by', 'viewers like you', 'subscribe to my channel', 'amara.org'].some((h) => cleanLower.includes(h)) ||
      (cleanLower === 'thank you' && peak < 0.045); // Whisper hallucinating "Thank you" on low-energy noise

    if (isHallucination) {
      logger.debug('Filtered Whisper silence hallucination:', rawText);
      rawText = '';
    }

    // Fix acoustic single-letter misclassification (e.g., "Y" -> "Hey")
    if (cleanLower === 'y') {
      rawText = 'Hey';
    }

    // Normalize technical terms, frameworks, and accent misrecognitions
    if (rawText) {
      rawText = normalizeTechTerms(rawText);
    }

    const detectedLang = normalizeLanguageCode(response.language || config.groqSttLanguage || 'en');

    logger.info(`STT transcription succeeded in ${elapsedMs}ms`, {
      duration: response.duration,
      transcript: rawText,
      language: detectedLang,
    });

    return {
      transcript: rawText,
      duration: response.duration,
      language: detectedLang,
    };
  } catch (err) {
    if (
      err.name === 'AbortError' ||
      err.name === 'APIUserAbortError' ||
      err.code === 'ERR_ABORTED' ||
      err.message?.toLowerCase().includes('aborted')
    ) {
      logger.debug('STT transcription aborted');
      const abortErr = new Error('Transcription aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    if (err.status === 429 || err?.error?.code === 'rate_limit_exceeded') {
      logger.warn('Groq STT rate limit exceeded (429)');
      throw new RateLimitError('Speech transcription rate limit exceeded. Please wait a moment.');
    }

    logger.error('Groq STT transcription error', err);
    throw new STTError(`Transcription failed: ${err.message}`, err);
  }
}
