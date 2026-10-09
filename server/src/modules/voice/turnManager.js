import { SessionController } from './sessionController.js';
import { parseVoiceCommand, COMMANDS } from './commandParser.js';
import { normalizeTechTerms } from './techTermNormalizer.js';
import { streamChatCompletion, streamContinuationCompletion } from '../../providers/groqLlm.js';
import { logger } from '../../lib/logger.js';

export class TurnManager {
  constructor() {
    // Map of sessionId/connectionId -> activeTurnState
    this.activeTurns = new Map();
  }

  /**
   * Get active turn for a session
   * @param {string} sessionId
   */
  getActiveTurn(sessionId) {
    return this.activeTurns.get(sessionId);
  }

  /**
   * Cancel and clear any active turn for a session
   * @param {string} sessionId
   */
  abortActiveTurn(sessionId) {
    const turn = this.activeTurns.get(sessionId);
    if (turn) {
      if (turn.abortController && !turn.abortController.signal.aborted) {
        turn.abortController.abort();
      }
      this.activeTurns.delete(sessionId);
      return turn;
    }
    return null;
  }

  /**
   * Start a new turn
   *
   * @param {Object} params
   * @param {string} params.sessionId
   * @param {string} params.turnId
   * @param {number} [params.seq=0]
   * @param {string} params.text
   * @param {'text'|'audio'} [params.inputType='text']
   * @param {function(Object): void} params.sendEvent
   */
  async startTurn({ sessionId, turnId, text, inputType = 'text', sendEvent }) {
    if (!text || !text.trim()) return;
    const cleanText = normalizeTechTerms(text.trim());

    // 1. Abort any previous active turn
    this.abortActiveTurn(sessionId);

    // 2. Initialize new turn state
    const abortController = new AbortController();
    const turnState = {
      turnId,
      sessionId,
      inputType,
      text: cleanText,
      abortController,
      seq: 0,
      nextSegmentIndex: 0,
      generatedText: '',
      segments: [],
      isAborted: false,
    };
    this.activeTurns.set(sessionId, turnState);

    // 3. Save user message to database
    await SessionController.saveUserMessage(sessionId, turnId, cleanText);

    // Emit user_transcript confirmation event for this turn
    sendEvent({
      type: 'user_transcript',
      turnId,
      text: cleanText,
      isFinal: true,
    });

    // 4. Check for standalone voice command
    const command = parseVoiceCommand(cleanText);
    if (command) {
      await this.handleCommand({ command, sessionId, turnId, sendEvent });
      return;
    }

    // 5. Send server status: THINKING
    await SessionController.updateStatus(sessionId, 'THINKING');
    sendEvent({ type: 'status', state: 'THINKING' });

    // 6. Retrieve recent chat history for Groq context
    const history = await SessionController.getConversationHistory(sessionId, 8);
    // Exclude the current user prompt from history since we append it freshly
    const contextMessages = history.slice(0, -1);
    contextMessages.push({ role: 'user', content: cleanText });

    // 7. Stream LLM text response
    try {
      const tokenStream = streamChatCompletion({
        messages: contextMessages,
        signal: abortController.signal,
      });

      let streamBuffer = '';
      const sentenceRegex = /([.!?\n]+)\s+/g;

      for await (const delta of tokenStream) {
        if (abortController.signal.aborted || turnState.isAborted) {
          logger.debug(`Turn ${turnId} aborted during token streaming`);
          return;
        }

        turnState.generatedText += delta;
        streamBuffer += delta;

        // Emit streaming delta to client
        sendEvent({
          type: 'assistant_delta',
          turnId,
          seq: turnState.seq++,
          delta,
        });

        // Sentence chunking for TTS segment queue
        let match;
        let lastIndex = 0;
        sentenceRegex.lastIndex = 0;

        while ((match = sentenceRegex.exec(streamBuffer)) !== null) {
          const sentence = streamBuffer.slice(lastIndex, match.index + match[1].length).trim();
          lastIndex = match.index + match[0].length;

          if (sentence) {
            const segment = { index: turnState.nextSegmentIndex++, text: sentence };
            turnState.segments.push(segment);
            sendEvent({
              type: 'assistant_segment',
              turnId,
              segmentIndex: segment.index,
              text: segment.text,
            });
          }
        }

        if (lastIndex > 0) {
          streamBuffer = streamBuffer.slice(lastIndex);
        }
      }

      // Check if aborted before finalization
      if (abortController.signal.aborted || turnState.isAborted) {
        return;
      }

      // Emit any remaining tail in buffer as last segment
      if (streamBuffer.trim()) {
        const finalSegment = { index: turnState.nextSegmentIndex++, text: streamBuffer.trim() };
        turnState.segments.push(finalSegment);
        sendEvent({
          type: 'assistant_segment',
          turnId,
          segmentIndex: finalSegment.index,
          text: finalSegment.text,
        });
      }

      // 8. Turn Completed
      sendEvent({
        type: 'turn_complete',
        turnId,
      });

      await SessionController.saveAssistantMessage(
        sessionId,
        turnId,
        turnState.generatedText,
        'completed',
        turnState.nextSegmentIndex - 1
      );

      // Checkpoint full response
      await SessionController.updatePausedResponse(sessionId, {
        sourceTurnId: turnId,
        generatedText: turnState.generatedText,
        lastSpokenSegmentIndex: turnState.nextSegmentIndex - 1,
        generationComplete: true,
        segments: turnState.segments,
        timestamp: Date.now(),
      });

      await SessionController.updateStatus(sessionId, 'LISTENING');
      sendEvent({ type: 'status', state: 'LISTENING' });
    } catch (err) {
      if (abortController.signal.aborted || turnState.isAborted) {
        logger.debug(`Turn ${turnId} aborted cleanly`);
        return;
      }

      logger.error(`Error generating completion for turn ${turnId}`, err);
      sendEvent({
        type: 'error',
        code: err.code || 'GENERATION_ERROR',
        message: err.message || 'Failed to generate voice assistant response.',
      });
      await SessionController.updateStatus(sessionId, 'ERROR');
      sendEvent({ type: 'status', state: 'ERROR' });
    } finally {
      if (this.activeTurns.get(sessionId)?.turnId === turnId) {
        this.activeTurns.delete(sessionId);
      }
    }
  }

  /**
   * Handle barge-in interruption
   *
   * @param {Object} params
   * @param {string} params.sessionId
   * @param {string} params.turnId
   * @param {function(Object): void} params.sendEvent
   */
  async handleInterrupt({ sessionId, turnId, sendEvent }) {
    const activeTurn = this.activeTurns.get(sessionId);

    let interruptedText = '';
    let segments = [];
    const sourceId = turnId || activeTurn?.turnId || null;

    if (activeTurn && (!turnId || activeTurn.turnId === turnId)) {
      activeTurn.isAborted = true;
      if (activeTurn.abortController && !activeTurn.abortController.signal.aborted) {
        activeTurn.abortController.abort();
      }
      interruptedText = activeTurn.generatedText;
      segments = activeTurn.segments;
      this.activeTurns.delete(sessionId);
    }

    logger.info(`Turn ${sourceId} interrupted by user barge-in`);

    // Checkpoint interrupted state for subsequent "continue"
    const pausedState = {
      sourceTurnId: sourceId,
      generatedText: interruptedText,
      lastSpokenSegmentIndex: -1,
      generationComplete: false,
      segments,
      timestamp: Date.now(),
    };

    await SessionController.updatePausedResponse(sessionId, pausedState);

    if (sourceId && interruptedText) {
      await SessionController.saveAssistantMessage(
        sessionId,
        sourceId,
        interruptedText,
        'interrupted',
        -1
      );
    }

    await SessionController.updateStatus(sessionId, 'INTERRUPTED');
    sendEvent({ type: 'status', state: 'INTERRUPTED' });
  }

  /**
   * Handle continue / resume request
   *
   * @param {Object} params
   * @param {string} params.sessionId
   * @param {Object} params
   * @param {string} params.sessionId
   * @param {string} [params.turnId]
   * @param {string} params.sourceTurnId
   * @param {number} params.lastSpokenSegmentIndex
   * @param {function(Object): void} params.sendEvent
   */
  async handleContinue({ sessionId, turnId, sourceTurnId, lastSpokenSegmentIndex = -1, sendEvent }) {
    this.abortActiveTurn(sessionId);

    const sessionData = await SessionController.getSessionData(sessionId);
    const paused = sessionData?.pausedResponse;

    if (!paused || (!paused.generatedText && (!paused.segments || paused.segments.length === 0))) {
      sendEvent({
        type: 'error',
        code: 'NO_PAUSED_RESPONSE',
        message: 'No interrupted response found to continue.',
      });
      return;
    }

    // Update confirmed spoken index
    paused.lastSpokenSegmentIndex = lastSpokenSegmentIndex;

    const remainingSegments = (paused.segments || []).filter(
      (s) => s.index > lastSpokenSegmentIndex
    );

    // If the generation was already finished, play out remaining segments
    if (paused.generationComplete && remainingSegments.length > 0) {
      sendEvent({ type: 'status', state: 'SPEAKING' });

      for (const seg of remainingSegments) {
        sendEvent({
          type: 'assistant_segment',
          turnId: paused.sourceTurnId || sourceTurnId,
          segmentIndex: seg.index,
          text: seg.text,
        });
      }

      sendEvent({
        type: 'turn_complete',
        turnId: paused.sourceTurnId || sourceTurnId,
      });

      await SessionController.updateStatus(sessionId, 'LISTENING');
      sendEvent({ type: 'status', state: 'LISTENING' });
      return;
    }

    // If generation was interrupted mid-stream, request continuation from LLM
    const continuationTurnId = turnId || ('turn_' + Math.random().toString(36).substring(2, 10));
    const abortController = new AbortController();
    const turnState = {
      turnId: continuationTurnId,
      sessionId,
      inputType: 'text',
      text: 'continue',
      abortController,
      seq: 0,
      nextSegmentIndex: Math.max(0, lastSpokenSegmentIndex + 1),
      generatedText: '',
      segments: [],
      isAborted: false,
    };
    this.activeTurns.set(sessionId, turnState);

    sendEvent({ type: 'status', state: 'THINKING' });

    try {
      const history = await SessionController.getConversationHistory(sessionId, 6);
      const tokenStream = streamContinuationCompletion({
        conversationHistory: history,
        generatedTextPrefix: paused.generatedText,
        signal: abortController.signal,
      });

      let streamBuffer = '';
      const sentenceRegex = /([.!?\n]+)\s+/g;

      for await (const delta of tokenStream) {
        if (abortController.signal.aborted || turnState.isAborted) {
          logger.debug(`Continuation turn ${continuationTurnId} aborted`);
          return;
        }

        turnState.generatedText += delta;
        streamBuffer += delta;

        sendEvent({
          type: 'assistant_delta',
          turnId: continuationTurnId,
          seq: turnState.seq++,
          delta,
        });

        let match;
        let lastIndex = 0;
        sentenceRegex.lastIndex = 0;

        while ((match = sentenceRegex.exec(streamBuffer)) !== null) {
          const sentence = streamBuffer.slice(lastIndex, match.index + match[1].length).trim();
          lastIndex = match.index + match[0].length;

          if (sentence) {
            const segment = { index: turnState.nextSegmentIndex++, text: sentence };
            turnState.segments.push(segment);
            sendEvent({
              type: 'assistant_segment',
              turnId: continuationTurnId,
              segmentIndex: segment.index,
              text: segment.text,
            });
          }
        }

        if (lastIndex > 0) {
          streamBuffer = streamBuffer.slice(lastIndex);
        }
      }

      if (abortController.signal.aborted || turnState.isAborted) return;

      if (streamBuffer.trim()) {
        const finalSegment = { index: turnState.nextSegmentIndex++, text: streamBuffer.trim() };
        turnState.segments.push(finalSegment);
        sendEvent({
          type: 'assistant_segment',
          turnId: continuationTurnId,
          segmentIndex: finalSegment.index,
          text: finalSegment.text,
        });
      }

      sendEvent({
        type: 'turn_complete',
        turnId: continuationTurnId,
      });

      const fullCombinedText = paused.generatedText
        ? `${paused.generatedText} ${turnState.generatedText}`
        : turnState.generatedText;

      await SessionController.saveAssistantMessage(
        sessionId,
        continuationTurnId,
        fullCombinedText,
        'completed',
        turnState.nextSegmentIndex - 1
      );

      // Checkpoint updated response
      await SessionController.updatePausedResponse(sessionId, {
        sourceTurnId: continuationTurnId,
        generatedText: fullCombinedText,
        lastSpokenSegmentIndex: turnState.nextSegmentIndex - 1,
        generationComplete: true,
        segments: [...(paused.segments || []), ...turnState.segments],
        timestamp: Date.now(),
      });

      await SessionController.updateStatus(sessionId, 'LISTENING');
      sendEvent({ type: 'status', state: 'LISTENING' });
    } catch (err) {
      if (abortController.signal.aborted || turnState.isAborted) return;

      logger.error('Error during continuation generation', err);
      sendEvent({
        type: 'error',
        code: 'CONTINUATION_ERROR',
        message: err.message || 'Failed to continue response.',
      });
      await SessionController.updateStatus(sessionId, 'ERROR');
      sendEvent({ type: 'status', state: 'ERROR' });
    } finally {
      if (this.activeTurns.get(sessionId)?.turnId === continuationTurnId) {
        this.activeTurns.delete(sessionId);
      }
    }
  }

  /**
   * Handle stop request
   *
   * @param {Object} params
   * @param {string} params.sessionId
   * @param {string} params.turnId
   * @param {function(Object): void} params.sendEvent
   */
  async handleStop({ sessionId, turnId, sendEvent }) {
    this.abortActiveTurn(sessionId);
    await SessionController.updateStatus(sessionId, 'IDLE');
    sendEvent({ type: 'status', state: 'IDLE' });
  }

  /**
   * Handle parsed standalone commands
   */
  async handleCommand({ command, sessionId, turnId, sendEvent }) {
    switch (command) {
      case COMMANDS.STOP: {
        await this.handleStop({ sessionId, turnId, sendEvent });
        break;
      }

      case COMMANDS.CONTINUE: {
        const sessionData = await SessionController.getSessionData(sessionId);
        const lastSpoken = sessionData?.pausedResponse?.lastSpokenSegmentIndex ?? -1;
        await this.handleContinue({
          sessionId,
          turnId,
          sourceTurnId: sessionData?.pausedResponse?.sourceTurnId,
          lastSpokenSegmentIndex: lastSpoken,
          sendEvent,
        });
        break;
      }

      case COMMANDS.REPEAT: {
        const sessionData = await SessionController.getSessionData(sessionId);
        const lastAssistantMsg = [...(sessionData?.messages || [])]
          .reverse()
          .find((m) => m.sender === 'assistant' && m.text);

        if (lastAssistantMsg) {
          sendEvent({ type: 'status', state: 'SPEAKING' });
          sendEvent({
            type: 'assistant_segment',
            turnId: 'repeat',
            segmentIndex: 0,
            text: lastAssistantMsg.text,
          });
          sendEvent({ type: 'turn_complete', turnId: 'repeat' });
          sendEvent({ type: 'status', state: 'LISTENING' });
        } else {
          sendEvent({
            type: 'error',
            code: 'NOTHING_TO_REPEAT',
            message: 'No previous response to repeat.',
          });
        }
        break;
      }

      case COMMANDS.CLEAR_CHAT: {
        this.abortActiveTurn(sessionId);
        await SessionController.clearSession(sessionId);
        sendEvent({ type: 'status', state: 'IDLE' });
        break;
      }

      case COMMANDS.MUTE:
      case COMMANDS.UNMUTE: {
        // Acknowledge mute command
        break;
      }

      default:
        break;
    }
  }
}
