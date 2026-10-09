import mongoose from 'mongoose';
import { Session } from '../../models/Session.js';
import { Message } from '../../models/Message.js';
import { logger } from '../../lib/logger.js';

// In-memory fallback cache if MongoDB is offline or disconnected
const memorySessions = new Map();
const memoryMessages = new Map(); // sessionId -> Message[]

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

export class SessionController {
  /**
   * Get or initialize session
   * @param {string} sessionId
   * @returns {Promise<Object>}
   */
  static async getOrCreateSession(sessionId) {
    if (!sessionId) {
      sessionId = 'default_session';
    }

    if (isMongoConnected()) {
      try {
        let session = await Session.findOne({ sessionId });
        if (!session) {
          session = await Session.create({ sessionId, status: 'IDLE' });
        }
        return session;
      } catch (err) {
        logger.error(`Error querying MongoDB session ${sessionId}`, err);
      }
    }

    // Fallback to in-memory
    if (!memorySessions.has(sessionId)) {
      memorySessions.set(sessionId, {
        sessionId,
        status: 'IDLE',
        pausedResponse: null,
        metadata: new Map(),
      });
    }
    return memorySessions.get(sessionId);
  }

  /**
   * Get full session payload formatted for frontend apiClient / UI restore
   * @param {string} sessionId
   * @returns {Promise<Object|null>}
   */
  static async getSessionData(sessionId) {
    if (!sessionId) return null;

    if (isMongoConnected()) {
      try {
        const session = await Session.findOne({ sessionId });
        if (!session) {
          return null;
        }

        const rawMessages = await Message.find({ sessionId }).sort({ timestamp: 1 }).lean();
        const messages = rawMessages.map((m) => ({
          id: m.messageId || m._id?.toString(),
          sender: m.sender,
          text: m.text,
          turnId: m.turnId,
          status: m.status,
          lastSpokenSegmentIndex: m.lastSpokenSegmentIndex,
          timestamp: m.timestamp,
        }));

        return {
          id: session.sessionId,
          status: session.status,
          messages,
          pausedResponse: session.pausedResponse
            ? {
                sourceTurnId: session.pausedResponse.sourceTurnId,
                generatedText: session.pausedResponse.generatedText,
                lastSpokenSegmentIndex: session.pausedResponse.lastSpokenSegmentIndex,
                generationComplete: session.pausedResponse.generationComplete,
                segments: session.pausedResponse.segments || [],
                timestamp: session.pausedResponse.timestamp,
              }
            : null,
        };
      } catch (err) {
        logger.error(`Error loading session data from Mongo for ${sessionId}`, err);
      }
    }

    // Fallback to in-memory
    if (!memorySessions.has(sessionId)) {
      return null;
    }
    const memSession = memorySessions.get(sessionId);
    const memMsgs = memoryMessages.get(sessionId) || [];

    return {
      id: memSession.sessionId,
      status: memSession.status,
      messages: [...memMsgs],
      pausedResponse: memSession.pausedResponse ? { ...memSession.pausedResponse } : null,
    };
  }

  /**
   * Update session state machine status
   * @param {string} sessionId
   * @param {string} status
   */
  static async updateStatus(sessionId, status) {
    if (isMongoConnected()) {
      try {
        await Session.updateOne({ sessionId }, { $set: { status } }, { upsert: true });
      } catch (err) {
        logger.error(`Error updating status for session ${sessionId}`, err);
      }
    }
    const mem = memorySessions.get(sessionId);
    if (mem) {
      mem.status = status;
    } else {
      memorySessions.set(sessionId, { sessionId, status, pausedResponse: null, metadata: new Map() });
    }
  }

  /**
   * Save incoming user message
   * @param {string} sessionId
   * @param {string} turnId
   * @param {string} text
   * @returns {Promise<Object>}
   */
  static async saveUserMessage(sessionId, turnId, text) {
    const messageId = 'msg_' + Math.random().toString(36).substring(2, 9);
    const timestamp = Date.now();

    const msgObj = {
      sessionId,
      messageId,
      turnId,
      sender: 'user',
      text,
      status: 'completed',
      lastSpokenSegmentIndex: -1,
      timestamp,
    };

    if (isMongoConnected()) {
      try {
        await Message.create(msgObj);
      } catch (err) {
        logger.error('Error saving user message to Mongo', err);
      }
    }

    if (!memoryMessages.has(sessionId)) {
      memoryMessages.set(sessionId, []);
    }
    memoryMessages.get(sessionId).push({
      id: messageId,
      ...msgObj,
    });

    return msgObj;
  }

  /**
   * Upsert or update assistant message
   * @param {string} sessionId
   * @param {string} turnId
   * @param {string} text
   * @param {'streaming'|'completed'|'interrupted'|'resumed'} status
   * @param {number} [lastSpokenSegmentIndex=-1]
   */
  static async saveAssistantMessage(sessionId, turnId, text, status = 'completed', lastSpokenSegmentIndex = -1) {
    const timestamp = Date.now();

    if (isMongoConnected()) {
      try {
        await Message.findOneAndUpdate(
          { sessionId, turnId, sender: 'assistant' },
          {
            $set: {
              text,
              status,
              lastSpokenSegmentIndex,
              timestamp,
            },
            $setOnInsert: {
              sessionId,
              messageId: 'msg_' + Math.random().toString(36).substring(2, 9),
              turnId,
              sender: 'assistant',
            },
          },
          { upsert: true, returnDocument: 'after' }
        );
      } catch (err) {
        logger.error('Error saving assistant message to Mongo', err);
      }
    }

    const list = memoryMessages.get(sessionId) || [];
    const existing = list.find((m) => m.turnId === turnId && m.sender === 'assistant');
    if (existing) {
      existing.text = text;
      existing.status = status;
      existing.lastSpokenSegmentIndex = lastSpokenSegmentIndex;
    } else {
      list.push({
        id: 'msg_' + Math.random().toString(36).substring(2, 9),
        sessionId,
        turnId,
        sender: 'assistant',
        text,
        status,
        lastSpokenSegmentIndex,
        timestamp,
      });
      memoryMessages.set(sessionId, list);
    }
  }

  /**
   * Save paused response checkpoint for barge-in resume
   * @param {string} sessionId
   * @param {Object} pausedResponse
   */
  static async updatePausedResponse(sessionId, pausedResponse) {
    if (isMongoConnected()) {
      try {
        await Session.updateOne({ sessionId }, { $set: { pausedResponse } }, { upsert: true });
      } catch (err) {
        logger.error('Error updating pausedResponse in Mongo', err);
      }
    }

    const mem = memorySessions.get(sessionId);
    if (mem) {
      mem.pausedResponse = pausedResponse;
    } else {
      memorySessions.set(sessionId, { sessionId, status: 'INTERRUPTED', pausedResponse, metadata: new Map() });
    }
  }

  /**
   * Clear session history and paused response
   * @param {string} sessionId
   */
  static async clearSession(sessionId) {
    if (isMongoConnected()) {
      try {
        await Message.deleteMany({ sessionId });
        await Session.updateOne(
          { sessionId },
          {
            $set: {
              status: 'IDLE',
              pausedResponse: null,
            },
          }
        );
      } catch (err) {
        logger.error('Error clearing session in Mongo', err);
      }
    }

    memoryMessages.set(sessionId, []);
    const mem = memorySessions.get(sessionId);
    if (mem) {
      mem.status = 'IDLE';
      mem.pausedResponse = null;
    }
  }

  /**
   * Get recent conversation turns for LLM chat context
   * @param {string} sessionId
   * @param {number} [limit=10]
   * @returns {Promise<Array<{ role: string, content: string }>>}
   */
  static async getConversationHistory(sessionId, limit = 10) {
    let messages = [];

    if (isMongoConnected()) {
      try {
        messages = await Message.find({ sessionId })
          .sort({ timestamp: -1 })
          .limit(limit)
          .lean();
        messages.reverse();
      } catch (err) {
        logger.error('Error retrieving conversation history from Mongo', err);
      }
    }

    if (messages.length === 0 && memoryMessages.has(sessionId)) {
      const all = memoryMessages.get(sessionId);
      messages = all.slice(-limit);
    }

    return messages
      .filter((m) => m.text && m.text.trim())
      .map((m) => ({
        role: m.sender === 'assistant' ? 'assistant' : 'user',
        content: m.text.trim(),
      }));
  }
}
