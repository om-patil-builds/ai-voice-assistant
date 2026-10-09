import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env relative to server root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config(); // fallback to current working directory

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-voice-assistant',
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
  groqSttModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
  groqSttLanguage: process.env.GROQ_STT_LANGUAGE || 'en',
  maxAudioSizeMb: parseInt(process.env.MAX_AUDIO_SIZE_MB || '25', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '60', 10),
};
