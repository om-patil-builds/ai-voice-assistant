import { useState, useRef, useEffect, useCallback } from 'react';
import { socketClient } from '../services/socketClient.js';
import { apiClient } from '../services/apiClient.js';
import { TTSPlayer } from '../audio/ttsPlayer.js';
import { PlaybackCursor } from '../audio/playbackCursor.js';
import { useMicrophone } from './useMicrophone.js';

// State Machine States
export const SESSION_STATES = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  TRANSCRIBING: 'TRANSCRIBING',
  THINKING: 'THINKING',
  SPEAKING: 'SPEAKING',
  INTERRUPTED: 'INTERRUPTED',
  PAUSED: 'PAUSED',
  ERROR: 'ERROR',
};

// Recognized standalone voice commands
const COMMAND_REGEXES = {
  STOP: /^(?:please\s+)?(?:stop|stop\s+talking|shut\s+up|cancel|halt)$/i,
  CONTINUE: /^(?:please\s+)?(?:continue|continue\s+last\s+response|keep\s+going|go\s+on|resume)(?:\s+please)?$/i,
  REPEAT: /^(?:please\s+)?(?:repeat\s+that|repeat\s+last\s+(?:response|answer)|say\s+that\s+again|repeat)(?:\s+please)?$/i,
  MUTE: /^(?:please\s+)?(?:mute|mute\s+audio|mute\s+voice)(?:\s+please)?$/i,
  UNMUTE: /^(?:please\s+)?(?:unmute|unmute\s+audio|unmute\s+voice)(?:\s+please)?$/i,
  CLEAR_CHAT: /^(?:please\s+)?(?:clear\s+chat|clear\s+history|delete\s+chat|clear\s+conversation)(?:\s+please)?$/i,
};

export function parseVoiceCommand(rawText) {
  if (!rawText) return null;
  const cleaned = rawText
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:]+$/g, '')
    .trim();

  if (COMMAND_REGEXES.STOP.test(cleaned)) return 'STOP';
  if (COMMAND_REGEXES.CONTINUE.test(cleaned)) return 'CONTINUE';
  if (COMMAND_REGEXES.REPEAT.test(cleaned)) return 'REPEAT';
  if (COMMAND_REGEXES.MUTE.test(cleaned)) return 'MUTE';
  if (COMMAND_REGEXES.UNMUTE.test(cleaned)) return 'UNMUTE';
  if (COMMAND_REGEXES.CLEAR_CHAT.test(cleaned)) return 'CLEAR_CHAT';

  return null;
}

export function useVoiceSession() {
  const [status, setStatus] = useState(SESSION_STATES.IDLE);
  const [messages, setMessages] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [silenceTimeoutMs, setSilenceTimeoutMs] = useState(600);
  const [pausedResponse, setPausedResponse] = useState(null);
  const [telemetry, setTelemetry] = useState({
    sttLatencyMs: null,
    firstTokenLatencyMs: null,
    ttsLatencyMs: null,
  });

  const activeTurnIdRef = useRef(null);
  const activeTurnSeqRef = useRef(0);
  const lastReceivedSeqRef = useRef(-1);
  const abortControllerRef = useRef(null);
  const currentStreamingTextRef = useRef('');
  const turnStartTimeRef = useRef(0);
  const sttStartTimeRef = useRef(0);

  const ttsPlayerRef = useRef(null);
  if (ttsPlayerRef.current == null) {
    ttsPlayerRef.current = new TTSPlayer();
  }

  const playbackCursorRef = useRef(null);
  if (playbackCursorRef.current == null) {
    playbackCursorRef.current = new PlaybackCursor();
  }

  const sessionIdRef = useRef(null);

  /**
   * Session ID management & persistence restore
   */
  useEffect(() => {
    let sid = localStorage.getItem('ai_voice_assistant_session_id');
    if (!sid) {
      sid = 'session_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem('ai_voice_assistant_session_id', sid);
    }
    sessionIdRef.current = sid;

    // Restore session from MongoDB via API
    apiClient
      .getSession(sid)
      .then((sessionData) => {
        if (sessionData) {
          if (Array.isArray(sessionData.messages)) {
            setMessages(sessionData.messages);
          }
          if (sessionData.pausedResponse) {
            playbackCursorRef.current.restoreState(sessionData);
            setPausedResponse(playbackCursorRef.current.getPausedResponse());
          }
        }
      })
      .catch((err) => {
        console.warn('Session restore deferred:', err.message);
      });
  }, []);

  /**
   * Barge-in Interruption:
   * Called immediately when user speech onset is detected.
   */
  const handleBargeIn = useCallback(() => {
    // Abort any in-flight HTTP STT requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const isPlayingAudio = ttsPlayerRef.current && (ttsPlayerRef.current.isSpeaking || status === SESSION_STATES.SPEAKING);

    if (isPlayingAudio || status === SESSION_STATES.THINKING || status === SESSION_STATES.TRANSCRIBING) {
      const turnId = activeTurnIdRef.current;

      // 1. Instantly stop browser TTS audio playback
      const cancelResult = ttsPlayerRef.current.cancel();

      // 2. Save paused checkpoint state
      const savedPaused = playbackCursorRef.current.savePausedState(
        turnId,
        currentStreamingTextRef.current,
        cancelResult.lastSpokenSegmentIndex,
        false
      );
      setPausedResponse({ ...savedPaused });

      // 3. Mark last message as interrupted in UI
      if (turnId) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.turnId === turnId
              ? {
                  ...msg,
                  status: 'interrupted',
                  lastSpokenSegmentIndex: cancelResult.lastSpokenSegmentIndex,
                }
              : msg
          )
        );
      }

      // 4. Notify backend WebSocket to abort LLM generation
      if (turnId) {
        socketClient.interrupt(turnId);
      }

      // 5. Invalidate active turn so any late server tokens are rejected
      activeTurnIdRef.current = null;

      // 6. Transition state
      setStatus(SESSION_STATES.INTERRUPTED);
    }
  }, [status]);

  /**
   * Setup TTS callbacks
   */
  useEffect(() => {
    const player = ttsPlayerRef.current;
    if (!player) return;

    player.onSegmentStart = ({ turnId }) => {
      if (turnId !== activeTurnIdRef.current && turnId !== 'repeat') return;
      setStatus(SESSION_STATES.SPEAKING);
    };

    player.onSegmentEnd = ({ segmentIndex }) => {
      // Confirmed spoken segment!
      playbackCursorRef.current.confirmSegment(segmentIndex);
      setPausedResponse(playbackCursorRef.current.getPausedResponse());
    };

    player.onQueueEmpty = ({ turnId }) => {
      if (turnId === activeTurnIdRef.current || turnId === 'repeat') {
        setStatus((prev) => (prev === SESSION_STATES.SPEAKING ? SESSION_STATES.LISTENING : prev));
      }
    };

    player.onError = (err) => {
      console.error('TTS error:', err);
    };
  }, []);

  /**
   * Clear Chat
   */
  /**
   * Stop current voice/audio session and generation
   */
  const stopSession = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    ttsPlayerRef.current.cancel();
    if (activeTurnIdRef.current) {
      socketClient.stop(activeTurnIdRef.current);
      activeTurnIdRef.current = null;
    }
    setStatus(SESSION_STATES.IDLE);
  };

  /**
   * Clear Chat
   */
  const clearChat = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    ttsPlayerRef.current.cancel();
    playbackCursorRef.current.clearPausedState();
    setPausedResponse(null);
    setMessages([]);
    activeTurnIdRef.current = null;
    currentStreamingTextRef.current = '';
    setStatus(SESSION_STATES.IDLE);
    setErrorMessage(null);
  };

  /**
   * Repeat last assistant response
   */
  const handleRepeatLastResponse = () => {
    const assistantMessages = messages.filter((m) => m.sender === 'assistant' && m.text);
    if (assistantMessages.length === 0) return;

    const last = assistantMessages[assistantMessages.length - 1];
    ttsPlayerRef.current.resetForTurn('repeat');
    setStatus(SESSION_STATES.SPEAKING);
    ttsPlayerRef.current.enqueueSegment(last.text, 0, 'repeat');
  };

  /**
   * Continue / Resume Interrupted Response
   */
  const handleContinueResponse = () => {
    const paused = playbackCursorRef.current.getPausedResponse();
    if (!paused) {
      setErrorMessage('No interrupted response to continue.');
      return;
    }

    const { sourceTurnId, lastSpokenSegmentIndex, generationComplete, segments } = paused;

    // Remaining unspoken segments
    const remainingSegments = segments.filter((s) => s.index > lastSpokenSegmentIndex);

    if (generationComplete && remainingSegments.length > 0) {
      // Full LLM response was already received! Play unspoken segments immediately.
      setStatus(SESSION_STATES.SPEAKING);
      ttsPlayerRef.current.resetForTurn(sourceTurnId);

      remainingSegments.forEach((seg) => {
        ttsPlayerRef.current.enqueueSegment(seg.text, seg.index, sourceTurnId);
      });

      // Update message status in transcript
      setMessages((prev) =>
        prev.map((msg) =>
          msg.turnId === sourceTurnId ? { ...msg, status: 'resumed' } : msg
        )
      );

      // Notify backend of resume
      socketClient.continueTurn({
        sourceTurnId,
        lastSpokenSegmentIndex,
      });
    } else {
      // Generation was interrupted before complete; request continuation from backend
      const newTurnId = 'turn_' + Math.random().toString(36).substring(2, 10);
      activeTurnIdRef.current = newTurnId;
      lastReceivedSeqRef.current = -1;
      setStatus(SESSION_STATES.THINKING);

      socketClient.continueTurn({
        sourceTurnId,
        lastSpokenSegmentIndex,
      });

      // If backend is offline or fallback, speak whatever unplayed segments exist
      if (remainingSegments.length > 0) {
        remainingSegments.forEach((seg) => {
          ttsPlayerRef.current.enqueueSegment(seg.text, seg.index, sourceTurnId);
        });
      }
    }
  };

  /**
   * Start a new turn (from transcribed voice or typed text fallback)
   */
  const startTurnWithText = (text, inputType = 'text') => {
    if (!text || !text.trim()) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const trimmedText = text.trim();
    const newTurnId = 'turn_' + Math.random().toString(36).substring(2, 10);
    activeTurnIdRef.current = newTurnId;
    activeTurnSeqRef.current = 0;
    lastReceivedSeqRef.current = -1;
    currentStreamingTextRef.current = '';
    turnStartTimeRef.current = performance.now();

    // Reset cursor and TTS for this turn
    playbackCursorRef.current.initTurn(newTurnId);
    ttsPlayerRef.current.resetForTurn(newTurnId);

    // Append user message
    const userMessage = {
      id: 'msg_' + Math.random().toString(36).substring(2, 9),
      sender: 'user',
      text: trimmedText,
      turnId: newTurnId,
      timestamp: Date.now(),
    };

    // Create placeholder assistant message
    const assistantMessage = {
      id: 'msg_' + Math.random().toString(36).substring(2, 9),
      sender: 'assistant',
      text: '',
      turnId: newTurnId,
      status: 'streaming',
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setStatus(SESSION_STATES.THINKING);
    setErrorMessage(null);

    // Send start_turn event to server over WebSocket
    socketClient.startTurn({
      turnId: newTurnId,
      seq: 0,
      inputType,
      text: trimmedText,
    });
  };

  /**
   * Execute parsed voice commands
   */
  const handleVoiceCommand = (command) => {
    switch (command) {
      case 'STOP': {
        stopSession();
        break;
      }

      case 'CONTINUE': {
        handleContinueResponse();
        break;
      }

      case 'REPEAT': {
        handleRepeatLastResponse();
        break;
      }

      case 'MUTE': {
        setIsMuted(true);
        ttsPlayerRef.current.setMute(true);
        break;
      }

      case 'UNMUTE': {
        setIsMuted(false);
        ttsPlayerRef.current.setMute(false);
        break;
      }

      case 'CLEAR_CHAT': {
        clearChat();
        break;
      }

      default:
        break;
    }
  };

  /**
   * Handle recorded audio utterance from useMicrophone
   */
  const handleUtteranceRecorded = useCallback(
    async (blob) => {
      setStatus(SESSION_STATES.TRANSCRIBING);
      sttStartTimeRef.current = performance.now();

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const result = await apiClient.uploadAudio(blob, 'speech.webm', {
          signal: controller.signal,
        });
        const transcript = result?.transcript?.trim();

        const sttLatency = Math.round(performance.now() - sttStartTimeRef.current);
        setTelemetry((prev) => ({ ...prev, sttLatencyMs: sttLatency }));

        if (!transcript) {
          // Silence or empty utterance
          setStatus(SESSION_STATES.LISTENING);
          return;
        }

        // Voice Command Parsing
        const command = parseVoiceCommand(transcript);
        if (command) {
          handleVoiceCommand(command);
          return;
        }

        // Ordinary speech utterance -> Start new turn
        startTurnWithText(transcript, 'audio');
      } catch (err) {
        if (err.name === 'AbortError') {
          // Interrupted by barge-in or user stop; do not transition to ERROR
          return;
        }
        console.error('Audio transcription failed:', err);
        setErrorMessage(err.message || 'Speech recognition failed.');
        setStatus(SESSION_STATES.ERROR);
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages]
  );

  /**
   * Hook up microphone
   */
  const microphone = useMicrophone({
    silenceTimeoutMs,
    onSpeechStart: handleBargeIn,
    onUtteranceRecorded: handleUtteranceRecorded,
    onError: (err) => {
      setErrorMessage(err.message);
      setStatus(SESSION_STATES.ERROR);
    },
  });

  /**
   * Toggle Mute
   */
  const toggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      ttsPlayerRef.current.setMute(next);
      return next;
    });
  };

  /**
   * Connect WebSocket and register event handlers
   */
  useEffect(() => {
    socketClient.connect();

    const unsubConnection = socketClient.onConnectionChange((state) => {
      setConnectionStatus(state);
    });

    // Handle assistant text deltas
    const unsubDelta = socketClient.on('assistant_delta', (data) => {
      const { turnId, delta, seq } = data;
      // Stale event rejection: ignore if turnId doesn't match active turn
      if (turnId !== activeTurnIdRef.current) return;

      // Strictly increasing seq validation
      if (typeof seq === 'number') {
        if (seq <= lastReceivedSeqRef.current) {
          return;
        }
        lastReceivedSeqRef.current = seq;
      }

      if (!currentStreamingTextRef.current) {
        const firstTokenTime = Math.round(performance.now() - turnStartTimeRef.current);
        setTelemetry((prev) => ({ ...prev, firstTokenLatencyMs: firstTokenTime }));
      }

      currentStreamingTextRef.current += delta;
      playbackCursorRef.current.setGeneratedText(currentStreamingTextRef.current);

      // Feed delta to TTS player for sentence chunking
      ttsPlayerRef.current.feedDelta(delta, turnId, false);

      // Update message bubble in UI
      setMessages((prev) =>
        prev.map((msg) =>
          msg.turnId === turnId ? { ...msg, text: currentStreamingTextRef.current } : msg
        )
      );
    });

    // Handle discrete assistant segments
    const unsubSegment = socketClient.on('assistant_segment', (data) => {
      const { turnId, segmentIndex, text } = data;
      if (turnId !== activeTurnIdRef.current) return;
      playbackCursorRef.current.addSegment(segmentIndex, text);
    });

    // Handle live user transcript updates
    const unsubUserTranscript = socketClient.on('user_transcript', (data) => {
      const { turnId, text } = data;
      if (!turnId || !text) return;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.turnId === turnId && msg.sender === 'user' ? { ...msg, text } : msg
        )
      );
    });

    // Handle turn complete
    const unsubTurnComplete = socketClient.on('turn_complete', (data) => {
      const { turnId } = data;
      if (turnId !== activeTurnIdRef.current) return;

      ttsPlayerRef.current.feedDelta('', turnId, true);
      playbackCursorRef.current.markGenerationComplete();

      setMessages((prev) =>
        prev.map((msg) =>
          msg.turnId === turnId ? { ...msg, status: 'completed' } : msg
        )
      );
    });

    // Handle server status updates
    const unsubStatus = socketClient.on('status', (data) => {
      if (data.state && SESSION_STATES[data.state]) {
        setStatus(data.state);
      }
    });

    // Handle server error events
    const unsubError = socketClient.on('error', (data) => {
      setErrorMessage(data.message || 'An error occurred during voice session.');
      setStatus(SESSION_STATES.ERROR);
    });

    return () => {
      unsubConnection();
      unsubDelta();
      unsubSegment();
      unsubUserTranscript();
      unsubTurnComplete();
      unsubStatus();
      unsubError();
      socketClient.disconnect();
    };
  }, []);

  /**
   * Toggle microphone listening
   */
  const handleToggleListening = async () => {
    if (microphone.isListening) {
      microphone.stopListening();
      setStatus(SESSION_STATES.IDLE);
    } else {
      const ok = await microphone.startListening();
      if (ok) {
        setStatus(SESSION_STATES.LISTENING);
        setErrorMessage(null);
      }
    }
  };

  /**
   * Set silence timeout and sync with VAD
   */
  const handleSetSilenceTimeout = (ms) => {
    setSilenceTimeoutMs(ms);
    microphone.setSilenceTimeout(ms);
  };

  return {
    status,
    messages,
    isMuted,
    errorMessage,
    connectionStatus,
    silenceTimeoutMs,
    pausedResponse,
    telemetry,
    audioLevel: microphone.audioLevel,
    isListening: microphone.isListening,
    isRecording: microphone.isRecording,
    hasPermission: microphone.hasPermission,
    permissionError: microphone.permissionError,
    toggleListening: handleToggleListening,
    startTurnWithText,
    handleContinueResponse,
    handleRepeatLastResponse,
    toggleMute,
    clearChat,
    stopSession,
    setSilenceTimeout: handleSetSilenceTimeout,
    dismissError: () => setErrorMessage(null),
  };
}
