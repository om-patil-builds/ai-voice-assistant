import { SessionController } from './sessionController.js';
import { parseVoiceCommand, COMMANDS } from './commandParser.js';
import { normalizeTechTerms } from './techTermNormalizer.js';
import { detectLanguage } from './languageDetector.js';
import { streamChatCompletion, streamContinuationCompletion } from '../../providers/groqLlm.js';
import { logger } from '../../lib/logger.js';

export class TurnManager {
  constructor() {
    // Map of sessionId/connectionId -> activeTurnState
    this.activeTurns = new Map();
    // Cache of recently processed turns to prevent duplicate LLM calls
    this.processedTurns = new Map();
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
   * @param {string} [params.language]
   * @param {'text'|'audio'} [params.inputType='text']
   * @param {function(Object): void} params.sendEvent
   */
  async startTurn({ sessionId, turnId, text, inputType = 'text', language, sendEvent }) {
    if (!text || !text.trim()) return;

    // Deduplicate rapid duplicate turn requests for the same turnId
    const now = Date.now();
    const turnKey = `${sessionId}:${turnId}`;
    if (this.processedTurns.has(turnKey) && now - this.processedTurns.get(turnKey) < 2000) {
      logger.warn(`Ignoring duplicate startTurn request for turnId ${turnId}`);
      return;
    }
    this.processedTurns.set(turnKey, now);

    // Prune stale entries
    if (this.processedTurns.size > 100) {
      for (const [k, ts] of this.processedTurns.entries()) {
        if (now - ts > 30000) this.processedTurns.delete(k);
      }
    }

    const cleanText = normalizeTechTerms(text.trim());
    const detectedLang = detectLanguage(cleanText, language);

    // 1. Abort any previous active turn
    this.abortActiveTurn(sessionId);

    // 2. Initialize new turn state
    const abortController = new AbortController();
    const turnState = {
      turnId,
      sessionId,
      inputType,
      text: cleanText,
      language: detectedLang,
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
      language: detectedLang,
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

    // Check if turn was aborted or superseded before starting LLM stream
    if (abortController.signal.aborted || turnState.isAborted || this.activeTurns.get(sessionId)?.turnId !== turnId) {
      logger.debug(`Turn ${turnId} was superseded or aborted before LLM start`);
      return;
    }

    // 7. Stream LLM text response
    try {
      const tokenStream = streamChatCompletion({
        messages: contextMessages,
        signal: abortController.signal,
      });

      let streamBuffer = '';
      // Support standard punctuation as well as Devanagari Purna Viram (\u0964, \u0965)
      const sentenceRegex = /([.!?\n\u0964\u0965]+)\s+/g;

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
          language: detectedLang,
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
              language: detectedLang,
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
          language: detectedLang,
        });
      }

      // 8. Turn Completed
      sendEvent({
        type: 'turn_complete',
        turnId,
        language: detectedLang,
      });

      await SessionController.saveAssistantMessage(
        sessionId,
        turnId,
        turnState.generatedText,
        'completed',
        -1
      );

      // Checkpoint full response
      await SessionController.updatePausedResponse(sessionId, {
        sourceTurnId: turnId,
        generatedText: turnState.generatedText,
        language: detectedLang,
        lastSpokenSegmentIndex: -1,
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
   * @param {string} [params.turnId]
   * @param {number} [params.lastSpokenSegmentIndex]
   * @param {function(Object): void} params.sendEvent
   */
  async handleInterrupt({ sessionId, turnId, lastSpokenSegmentIndex, sendEvent }) {
    const activeTurn = this.activeTurns.get(sessionId);

    let interruptedText = '';
    let segments = [];
    let isComplete = false;
    let language = 'en';
    const sourceId = turnId || activeTurn?.turnId || null;

    if (activeTurn && (!turnId || activeTurn.turnId === turnId)) {
      activeTurn.isAborted = true;
      if (activeTurn.abortController && !activeTurn.abortController.signal.aborted) {
        activeTurn.abortController.abort();
      }
      if (activeTurn.previousGeneratedText) {
        interruptedText = activeTurn.generatedText
          ? `${activeTurn.previousGeneratedText} ${activeTurn.generatedText}`.trim()
          : activeTurn.previousGeneratedText;
      } else {
        interruptedText = activeTurn.generatedText || '';
      }
      segments = [...(activeTurn.previousSegments || []), ...(activeTurn.segments || [])];
      language = activeTurn.language || detectLanguage(interruptedText);
      isComplete = false;
      this.activeTurns.delete(sessionId);
    } else {
      // LLM generation had already completed on the server, but was interrupted during client playback
      const sessionData = await SessionController.getSessionData(sessionId);
      const existingPaused = sessionData?.pausedResponse;
      if (existingPaused && (!sourceId || existingPaused.sourceTurnId === sourceId || !turnId)) {
        interruptedText = existingPaused.generatedText || '';
        segments = existingPaused.segments || [];
        language = existingPaused.language || detectLanguage(interruptedText);
        isComplete = Boolean(existingPaused.generationComplete);
      }
    }

    logger.info(`Turn ${sourceId} interrupted by user barge-in`);

    // Determine accurate confirmed last spoken segment index
    let resolvedLastSpoken = -1;
    if (typeof lastSpokenSegmentIndex === 'number') {
      resolvedLastSpoken = lastSpokenSegmentIndex;
    } else {
      const sessionData = await SessionController.getSessionData(sessionId);
      resolvedLastSpoken = sessionData?.pausedResponse?.lastSpokenSegmentIndex ?? -1;
    }

    // Checkpoint interrupted state for subsequent "continue"
    const pausedState = {
      sourceTurnId: sourceId,
      generatedText: interruptedText,
      language,
      lastSpokenSegmentIndex: resolvedLastSpoken,
      generationComplete: isComplete,
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
        resolvedLastSpoken
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
   * @param {string} [params.turnId]
   * @param {string} [params.sourceTurnId]
   * @param {number} [params.lastSpokenSegmentIndex=-1]
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

    // Determine accurate confirmed spoken index
    let confirmedSpokenIndex = -1;
    if (typeof lastSpokenSegmentIndex === 'number' && lastSpokenSegmentIndex >= 0) {
      confirmedSpokenIndex = lastSpokenSegmentIndex;
    } else if (typeof paused.lastSpokenSegmentIndex === 'number' && paused.lastSpokenSegmentIndex >= 0) {
      confirmedSpokenIndex = paused.lastSpokenSegmentIndex;
    }
    paused.lastSpokenSegmentIndex = confirmedSpokenIndex;

    const continuationLanguage = paused.language || detectLanguage(paused.generatedText) || 'en';
    const effectiveSourceId = sourceTurnId || paused.sourceTurnId;

    const remainingSegments = (paused.segments || []).filter(
      (s) => s.index > confirmedSpokenIndex
    );

    // If the generation was already finished, play out remaining unspoken segments
    if (paused.generationComplete) {
      if (remainingSegments.length === 0) {
        sendEvent({
          type: 'error',
          code: 'ALREADY_COMPLETED',
          message: 'The response was already completed.',
        });
        return;
      }

      sendEvent({ type: 'status', state: 'SPEAKING' });

      for (const seg of remainingSegments) {
        sendEvent({
          type: 'assistant_segment',
          turnId: effectiveSourceId,
          segmentIndex: seg.index,
          text: seg.text,
          language: continuationLanguage,
        });
      }

      sendEvent({
        type: 'turn_complete',
        turnId: effectiveSourceId,
        language: continuationLanguage,
      });

      await SessionController.saveAssistantMessage(
        sessionId,
        effectiveSourceId,
        paused.generatedText,
        'completed',
        confirmedSpokenIndex
      );

      return;
    }

    // If generation was interrupted mid-stream, request continuation from LLM
    const continuationTurnId = turnId || ('turn_' + Math.random().toString(36).substring(2, 10));
    const abortController = new AbortController();

    const maxExistingSegmentIndex =
      paused.segments && paused.segments.length > 0
        ? Math.max(...paused.segments.map((s) => s.index))
        : -1;
    const nextSegmentIndex = Math.max(confirmedSpokenIndex + 1, maxExistingSegmentIndex + 1);

    const turnState = {
      turnId: continuationTurnId,
      sessionId,
      inputType: 'text',
      text: 'continue',
      language: continuationLanguage,
      abortController,
      seq: 0,
      nextSegmentIndex,
      generatedText: '',
      segments: [],
      previousGeneratedText: paused.generatedText || '',
      previousSegments: paused.segments || [],
      isAborted: false,
    };
    this.activeTurns.set(sessionId, turnState);

    // If there were unspoken segments already generated before the cutoff, emit them first
    if (remainingSegments.length > 0) {
      sendEvent({ type: 'status', state: 'SPEAKING' });
      for (const seg of remainingSegments) {
        sendEvent({
          type: 'assistant_segment',
          turnId: continuationTurnId,
          segmentIndex: seg.index,
          text: seg.text,
          language: continuationLanguage,
        });
      }
    } else {
      sendEvent({ type: 'status', state: 'THINKING' });
    }

    try {
      const history = await SessionController.getConversationHistory(sessionId, 6);
      if (abortController.signal.aborted || turnState.isAborted || this.activeTurns.get(sessionId)?.turnId !== continuationTurnId) {
        logger.debug(`Continuation turn ${continuationTurnId} aborted or superseded before LLM start`);
        return;
      }
      const tokenStream = streamContinuationCompletion({
        conversationHistory: history,
        generatedTextPrefix: paused.generatedText,
        language: continuationLanguage,
        signal: abortController.signal,
      });

      let streamBuffer = '';
      const sentenceRegex = /([.!?\n\u0964\u0965]+)\s+/g;

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
          if (abortController.signal.aborted || turnState.isAborted) return;
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
              language: continuationLanguage,
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
          language: continuationLanguage,
        });
      }

      sendEvent({
        type: 'turn_complete',
        turnId: continuationTurnId,
        language: continuationLanguage,
      });

      const fullCombinedText = paused.generatedText
        ? `${paused.generatedText} ${turnState.generatedText}`.trim()
        : turnState.generatedText;

      const allSegments = [...(paused.segments || []), ...turnState.segments];

      await SessionController.saveAssistantMessage(
        sessionId,
        continuationTurnId,
        fullCombinedText,
        'completed',
        confirmedSpokenIndex,
        effectiveSourceId
      );

      // Checkpoint updated response
      await SessionController.updatePausedResponse(sessionId, {
        sourceTurnId: continuationTurnId,
        generatedText: fullCombinedText,
        language: continuationLanguage,
        lastSpokenSegmentIndex: confirmedSpokenIndex,
        generationComplete: true,
        segments: allSegments,
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
