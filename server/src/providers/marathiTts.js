import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { logger } from '../lib/logger.js';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Dedicated Marathi Text-to-Speech Provider using Microsoft Edge Neural Voices.
 * Voices:
 * - 'mr-IN-AarohiNeural' (Female, Natural Marathi India) - Default
 * - 'mr-IN-ManoharNeural' (Male, Natural Marathi India)
 */

export const MARATHI_VOICES = {
  AAROHI: 'mr-IN-AarohiNeural',
  MANOHAR: 'mr-IN-ManoharNeural',
};

export const DEFAULT_MARATHI_VOICE = MARATHI_VOICES.AAROHI;

// In-memory cache for synthesized audio to ensure instant replay
const audioCache = new Map();
const MAX_CACHE_ENTRIES = 100;

/**
 * Clean and format text for optimal Marathi prosody
 * @param {string} text
 * @returns {string}
 */
export function formatMarathiTextForTTS(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .trim()
    // Replace multiple spaces or newlines with a single space
    .replace(/\s+/g, ' ')
    // Ensure Devanagari purna viram (।) has trailing space for natural pause
    .replace(/([\u0964\u0965])([^\s])/g, '$1 $2')
    // Ensure comma and question marks have natural pause
    .replace(/([?,!])([^\s])/g, '$1 $2');
}

/**
 * Convert playback rate (0.5 - 2.0) to Edge TTS prosody rate string (e.g. '+10%', '-20%')
 * @param {number} rate
 * @returns {string}
 */
export function rateToProsody(rate = 1.0) {
  const clamped = Math.max(0.5, Math.min(2.0, Number(rate) || 1.0));
  const percent = Math.round((clamped - 1.0) * 100);
  return percent >= 0 ? `+${percent}%` : `${percent}%`;
}

/**
 * Synthesizes Marathi speech using Node msedge-tts
 * @param {string} text
 * @param {Object} [options]
 * @param {string} [options.voice='mr-IN-AarohiNeural']
 * @param {number} [options.rate=1.0]
 * @returns {Promise<Buffer>}
 */
async function synthesizeWithMsEdgeTts(text, options = {}) {
  const voice = options.voice || DEFAULT_MARATHI_VOICE;
  const rate = options.rate || 1.0;
  const prosodyRate = rateToProsody(rate);

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = await tts.toStream(text, { rate: prosodyRate });

    return await new Promise((resolve, reject) => {
      const chunks = [];
      audioStream.on('data', (chunk) => chunks.push(chunk));
      audioStream.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      audioStream.on('error', (err) => reject(err));
    });
  } finally {
    try {
      tts.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Subprocess fallback using python edge-tts if Node socket encounters network issues
 * @param {string} text
 * @param {Object} [options]
 * @returns {Promise<Buffer>}
 */
async function synthesizeWithPythonFallback(text, options = {}) {
  const voice = options.voice || DEFAULT_MARATHI_VOICE;
  const rate = options.rate || 1.0;
  const prosodyRate = rateToProsody(rate);

  const tempFile = path.join(os.tmpdir(), `mr_tts_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.mp3`);

  return new Promise((resolve, reject) => {
    const pythonScript = `
import asyncio, edge_tts
async def run():
    comm = edge_tts.Communicate(${JSON.stringify(text)}, ${JSON.stringify(voice)}, rate=${JSON.stringify(prosodyRate)})
    await comm.save(${JSON.stringify(tempFile)})
asyncio.run(run())
`;
    const proc = spawn('python', ['-c', pythonScript]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(tempFile)) {
        try {
          const buffer = fs.readFileSync(tempFile);
          fs.unlinkSync(tempFile);
          resolve(buffer);
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`Python edge-tts fallback failed (code ${code}): ${stderr}`));
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Primary Marathi synthesis function with caching and dual-layer reliability
 * @param {string} text
 * @param {Object} [options]
 * @param {string} [options.voice='mr-IN-AarohiNeural']
 * @param {number} [options.rate=1.0]
 * @returns {Promise<Buffer>}
 */
export async function synthesizeMarathiAudio(text, options = {}) {
  const formattedText = formatMarathiTextForTTS(text);
  if (!formattedText) {
    throw new Error('Text to synthesize is empty');
  }

  const voice = options.voice || DEFAULT_MARATHI_VOICE;
  const rate = Number(options.rate) || 1.0;
  const cacheKey = `${voice}:${rate.toFixed(1)}:${formattedText}`;

  // Check cache
  if (audioCache.has(cacheKey)) {
    return audioCache.get(cacheKey);
  }

  let audioBuffer;
  try {
    audioBuffer = await synthesizeWithMsEdgeTts(formattedText, { voice, rate });
  } catch (primaryErr) {
    logger.warn('Primary msedge-tts failed, trying Python fallback:', primaryErr?.message);
    try {
      audioBuffer = await synthesizeWithPythonFallback(formattedText, { voice, rate });
    } catch (fallbackErr) {
      logger.error('Both msedge-tts and python fallback failed for Marathi TTS:', fallbackErr);
      throw primaryErr;
    }
  }

  // Save to cache
  if (audioBuffer && audioBuffer.length > 0) {
    if (audioCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = audioCache.keys().next().value;
      audioCache.delete(firstKey);
    }
    audioCache.set(cacheKey, audioBuffer);
  }

  return audioBuffer;
}
