import http from 'http';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { config } from './src/lib/config.js';
import { logger } from './src/lib/logger.js';
import transcriptionsRouter from './src/routes/transcriptions.js';
import sessionsRouter from './src/routes/sessions.js';
import ttsRouter from './src/routes/tts.js';
import { initVoiceGateway } from './src/ws/voiceGateway.js';

const app = express();
const server = http.createServer(app);

// Cross-Origin Resource Sharing
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow browser client and tools without origin (like curl/mobile)
      if (!origin || origin === config.clientOrigin || origin.startsWith('http://localhost:')) {
        callback(null, true);
      } else {
        callback(null, true); // Permissive in dev, can restrict in production
      }
    },
    credentials: true,
  })
);

app.use(express.json());

// Root and Favicon Handlers
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'AI Voice Assistant API',
    status: 'running',
    health: '/health',
  });
});
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Health Check Endpoint
app.get('/health', (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.status(200).json({
    status: 'ok',
    message: 'AI Voice Assistant backend is running',
    services: {
      mongo: mongoStatus,
      groqConfigured: Boolean(config.groqApiKey),
      groqModel: config.groqModel,
      groqSttModel: config.groqSttModel,
    },
    timestamp: new Date().toISOString(),
  });
});

// REST API Routes
app.use('/api/transcriptions', transcriptionsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/tts', ttsRouter);

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error('Unhandled express error', err);
  const status = err.statusCode || 500;
  res.status(status).json({
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred.',
  });
});

// Initialize WebSocket Voice Gateway
const { wss, turnManager } = initVoiceGateway(server);

// Connect to MongoDB
async function connectDatabase() {
  try {
    await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 3000,
    });
    logger.info('Connected to MongoDB database', { uri: config.mongodbUri });
  } catch (err) {
    logger.warn('MongoDB connection failed; running with in-memory persistence fallback', {
      error: err.message,
    });
  }
}

import { fileURLToPath } from 'url';

// Start Server if run directly
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  await connectDatabase();

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${config.port} is already in use by another process.`, {
        port: config.port,
        message: 'A previous server instance or another application is occupying this port.',
      });
    } else {
      logger.error('Server encountered an error', { error: err.message });
    }
    process.exit(1);
  });

  server.listen(config.port, () => {
    logger.info(`Server running at http://localhost:${config.port}`);
    logger.info(`WebSocket Gateway listening on ws://localhost:${config.port}`);
  });
}

export { app, server, wss, turnManager, connectDatabase };