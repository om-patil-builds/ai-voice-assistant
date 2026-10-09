import { WebSocketServer, WebSocket } from 'ws';
import { TurnManager } from '../modules/voice/turnManager.js';
import { latestActiveSessionId } from '../routes/sessions.js';
import { logger } from '../lib/logger.js';

export function initVoiceGateway(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });
  const turnManager = new TurnManager();

  wss.on('error', (err) => {
    logger.error('WebSocket gateway error', { error: err.message });
  });

  // Track active connection sessions
  const connectionSessionMap = new WeakMap();

  wss.on('connection', (ws, req) => {
    logger.info('New WebSocket connection established', {
      remoteAddress: req.socket.remoteAddress,
      url: req.url,
    });

    // Parse session ID from query params or headers
    let sessionId = null;
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      sessionId = parsedUrl.searchParams.get('sessionId');
    } catch {
      // ignore
    }

    if (!sessionId) {
      sessionId = req.headers['x-session-id'] || latestActiveSessionId || 'default_session';
    }

    connectionSessionMap.set(ws, sessionId);

    // Heartbeat setup
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Send helper
    const sendEvent = (payload) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(payload));
        } catch (err) {
          logger.error('Failed to send WebSocket payload', err);
        }
      }
    };

    // Emit initial status IDLE
    sendEvent({ type: 'status', state: 'IDLE' });

    // Handle incoming messages
    ws.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        const { type } = data;

        // Allow message to specify or update session ID
        if (data.sessionId) {
          sessionId = data.sessionId;
          connectionSessionMap.set(ws, sessionId);
        }

        logger.debug(`Received WS message: ${type}`, { sessionId, turnId: data.turnId });

        switch (type) {
          case 'start_turn': {
            const { turnId, text, inputType = 'text', seq = 0 } = data;
            if (!turnId || !text) {
              sendEvent({
                type: 'error',
                code: 'INVALID_TURN_PAYLOAD',
                message: 'turnId and text are required for start_turn.',
              });
              return;
            }

            await turnManager.startTurn({
              sessionId,
              turnId,
              seq,
              text,
              inputType,
              sendEvent,
            });
            break;
          }

          case 'interrupt': {
            const { turnId } = data;
            await turnManager.handleInterrupt({
              sessionId,
              turnId,
              sendEvent,
            });
            break;
          }

          case 'continue': {
            const { sourceTurnId, lastSpokenSegmentIndex = -1, turnId } = data;
            await turnManager.handleContinue({
              sessionId,
              turnId,
              sourceTurnId,
              lastSpokenSegmentIndex,
              sendEvent,
            });
            break;
          }

          case 'stop': {
            const { turnId } = data;
            await turnManager.handleStop({
              sessionId,
              turnId,
              sendEvent,
            });
            break;
          }

          case 'ping': {
            sendEvent({ type: 'pong' });
            break;
          }

          default:
            logger.warn(`Unknown WebSocket message type received: ${type}`);
            break;
        }
      } catch (err) {
        logger.error('Error handling WebSocket message', err);
        sendEvent({
          type: 'error',
          code: 'MESSAGE_PARSE_ERROR',
          message: 'Malformed JSON payload.',
        });
      }
    });

    ws.on('error', (err) => {
      logger.error('WebSocket connection error', err);
    });

    ws.on('close', () => {
      logger.info('WebSocket connection closed', { sessionId });
      // Clean up any in-flight generation on disconnect
      turnManager.abortActiveTurn(sessionId);
    });
  });

  // Ping interval for connection health check
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  interval.unref();

  wss.on('close', () => {
    clearInterval(interval);
  });

  return { wss, turnManager };
}
