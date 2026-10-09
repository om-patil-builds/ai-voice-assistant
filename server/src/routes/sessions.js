import express from 'express';
import { SessionController } from '../modules/voice/sessionController.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// Memory tracking of the latest active session ID accessed by clients
export let latestActiveSessionId = null;

/**
 * GET /api/sessions/:id
 * Retrieve session state and pausedResponse for page restore.
 * Initializes fresh session if not yet existing, returning 200 OK with empty messages.
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Session ID is required.' });
    }

    latestActiveSessionId = id;

    let sessionData = await SessionController.getSessionData(id);
    if (!sessionData) {
      // Initialize fresh session record in DB and memory
      await SessionController.getOrCreateSession(id);
      sessionData = {
        id,
        status: 'IDLE',
        messages: [],
        pausedResponse: null,
      };
    }

    return res.status(200).json(sessionData);
  } catch (err) {
    logger.error('Error fetching session', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve session.',
    });
  }
});

/**
 * DELETE /api/sessions/:id
 * Clear messages and reset paused state for a session
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await SessionController.clearSession(id);
    return res.status(200).json({
      success: true,
      message: `Session ${id} cleared successfully.`,
    });
  } catch (err) {
    logger.error('Error clearing session', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to clear session.',
    });
  }
});

export default router;
