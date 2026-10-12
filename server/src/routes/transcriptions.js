import express from 'express';
import multer from 'multer';
import { transcribeAudio } from '../providers/groqStt.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { ValidationError, RateLimitError } from '../lib/errors.js';

const router = express.Router();

// Memory storage to satisfy spec: "no raw-audio persistence"
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxAudioSizeMb * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    // Check audio mimetype
    if (file.mimetype.startsWith('audio/') || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new ValidationError(`Unsupported file type: ${file.mimetype}. Expected audio file.`));
    }
  },
});

// Simple sliding window rate limiter for STT requests
const requestCounts = new Map(); // IP -> { count, resetTime }

function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = config.rateLimitWindowMs;
  const maxRequests = config.rateLimitMaxRequests;

  let record = requestCounts.get(ip);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + windowMs };
    requestCounts.set(ip, record);
    return next();
  }

  record.count++;
  if (record.count > maxRequests) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'STT rate limit exceeded. Please wait before speaking again.',
      retryAfter,
    });
  }

  next();
}

/**
 * POST /api/transcriptions
 * Upload audio file for Groq Whisper transcription
 */
router.post('/', rateLimitMiddleware, upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Audio data is empty or invalid.',
      });
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 25000);

    // Only abort if client disconnected before response was finished
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    logger.info(
      `[REST /api/transcriptions] Incoming upload: filename=${req.file.originalname}, mimetype=${req.file.mimetype}, size=${req.file.buffer.length} bytes`
    );

    const routeStart = Date.now();
    const result = await transcribeAudio(req.file.buffer, {
      filename: req.file.originalname || 'speech.webm',
      mimetype: req.file.mimetype || 'audio/webm',
      signal: abortController.signal,
    });

    clearTimeout(timeout);
    logger.info(
      `[REST /api/transcriptions] Handled in ${Date.now() - routeStart}ms | Transcript: "${result.transcript}"`
    );
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: err.message,
      });
    }
    if (err instanceof ValidationError) {
      return res.status(400).json({
        error: 'Bad Request',
        message: err.message,
      });
    }
    if (err.name === 'AbortError') {
      return res.status(499).json({
        error: 'Client Closed Request',
        message: 'Request was cancelled by client.',
      });
    }

    logger.error('Transcription route error', err);
    return res.status(err.statusCode || 500).json({
      error: err.name || 'TranscriptionError',
      message: err.message || 'Speech-to-text processing failed.',
    });
  }
});

export default router;
