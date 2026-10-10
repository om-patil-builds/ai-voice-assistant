import { useState, useRef, useEffect, useCallback } from 'react';
import { socketClient } from '../services/socketClient.js';
import { apiClient } from '../services/apiClient.js';
import { TTSPlayer } from '../audio/ttsPlayer.js';
import { PlaybackCursor } from '../audio/playbackCursor.js';
import { useMicrophone } from './useMicrophone.js';
import { normalizeTechTerms } from '../services/techTermNormalizer.js';

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

// Recognized standalone voice commands (English, Hindi, Marathi)
const COMMAND_REGEXES = {
  STOP: /^(?:(?:please|कृपया)\s+)?(?:stop|stop\s+talking|shut\s+up|cancel|halt|रुको|रुकिए|रुक\s+जाओ|बंद\s+करो|चुप\s+रहो|थांबा|थांब|बोलणे\s+थांबवा|बंद\s+करा|स्टॉप|ruko|ruk\s+jao|band\s+karo|thamba|thamb|band\s+kara)$/i,
  CONTINUE: /^(?:(?:please|कृपया)\s+)?(?:continue|continue\s+last\s+response|keep\s+going|go\s+on|resume|जारी\s+रखो|आगे\s+बोलो|आगे\s+बताओ|चालू\s+रखो|पुढे\s+बोला|पुढे\s+सांगा|सुरू\s+ठेवा|चालू\s+ठेवा|कंटिन्यू|aage\s+bolo|aage\s+batao|jaari\s+rakho|pudhe\s+bola|pudhe\s+sanga|suru\s+theva)(?:\s+(?:please|कृपया))?$/i,
  REPEAT: /^(?:(?:please|कृपया)\s+)?(?:repeat\s+that|repeat\s+last\s+(?:response|answer)|say\s+that\s+again|repeat|फिर\s+से\s+बोलो|दोहराओ|दोबारा\s+बोलो|फिर\s+से\s+बताओ|पुन्हा\s+सांगा|पुन्हा\s+बोला|परत\s+सांगा|परत\s+बोला|phir\s+se\s+bolo|dohrao|dobara\s+bolo|punha\s+sanga|punha\s+bola|parat\s+sanga)(?:\s+(?:please|कृपया))?$/i,
  MUTE: /^(?:(?:please|कृपया)\s+)?(?:mute|mute\s+audio|mute\s+voice|म्यूट|म्यूट\s+करो|म्यूट\s+करा|आवाज\s+बंद\s+करो|आवाज\s+बंद\s+करा)(?:\s+(?:please|कृपया))?$/i,
  UNMUTE: /^(?:(?:please|कृपया)\s+)?(?:unmute|unmute\s+audio|unmute\s+voice|अनम्यूट|अनम्यूट\s+करो|अनम्यूट\s+करा|आवाज\s+चालू\s+करो|आवाज\s+चालू\s+करा|आवाज\s+शुरू\s+करो|आवाज\s+सुरू\s+करा)(?:\s+(?:please|कृपया))?$/i,
  CLEAR_CHAT: /^(?:(?:please|कृपया)\s+)?(?:clear\s+chat|clear\s+history|delete\s+chat|clear\s+conversation|चैट\s+साफ\s+करो|चैट\s+हटाओ|चॅट\s+साफ\s+करा|चॅट\s+हटवा|संभाषण\s+साफ\s+करा)(?:\s+(?:please|कृपया))?$/i,
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
  const [ttsVolume, setTtsVolume] = useState(1.0);
  const [ttsRate, setTtsRate] = useState(1.0);
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState('');
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
   * Session ID management & persistence restore.
   * Session ID is set on socketClient BEFORE connecting to eliminate race condition.
   */
  useEffect(() => {
    let sid = localStorage.getItem('ai_voice_assistant_session_id');
    if (!sid) {
      sid = 'session_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem('ai_voice_assistant_session_id', sid);
    }
    sessionIdRef.current = sid;

    // Configure session ID on the socket client BEFORE connecting
    // so it's embedded in the WebSocket URL and no race condition can occur
    socketClient.setSessionId(sid);

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

    // Only barge in if the assistant is actively speaking audio!
    // Do NOT cancel during THINKING or TRANSCRIBING because normal user breaths or ambient noise would kill the generation.
    if (isPlayingAudio) {
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

      // 3. Mark last message as interrupted in UI (ONLY assistant message!)
      if (turnId) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.turnId === turnId && msg.sender === 'assistant'
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
        socketClient.interrupt(turnId, cancelResult.lastSpokenSegmentIndex);
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
        if (playbackCursorRef.current.generationComplete || turnId === 'repeat') {
          setStatus((prev) => (prev === SESSION_STATES.SPEAKING ? SESSION_STATES.LISTENING : prev));
        }
      }
    };

    player.onError = (err) => {
      console.error('TTS error:', err);
    };
  }, []);

  /**
   * Stop current voice/audio session and generation
   */
  const stopSession = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    ttsPlayerRef.current.cancel();
    socketClient.stop(activeTurnIdRef.current || 'generic_stop');
    activeTurnIdRef.current = null;
    setStatus(SESSION_STATES.IDLE);
  };

  /**
   * Clear Chat — clears UI state AND notifies backend to clear session history.
   * Without the backend call, messages would reappear on next page refresh.
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

    // Clear server-side session so refresh doesn't restore old messages
    const sid = sessionIdRef.current;
    if (sid) {
      apiClient.clearSession(sid).catch((err) =>
        console.warn('Failed to clear server session:', err.message)
      );
    }
  };

  /**
   * Repeat last assistant response or replay a specific message text
   * @param {string} [text] - Optional specific text to replay
   */
  const handleRepeatLastResponse = (text) => {
    if (text) {
      ttsPlayerRef.current.resetForTurn('repeat');
      setStatus(SESSION_STATES.SPEAKING);
      ttsPlayerRef.current.enqueueSegment(text, 0, 'repeat');
      return;
    }

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
      
      activeTurnIdRef.current = sourceTurnId;
      ttsPlayerRef.current.resetForTurn(sourceTurnId);

      remainingSegments.forEach((seg) => {
        ttsPlayerRef.current.enqueueSegment(seg.text, seg.index, sourceTurnId);
      });

      // Update message status in transcript (ONLY assistant message)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.turnId === sourceTurnId && msg.sender === 'assistant'
            ? { ...msg, status: 'resumed' }
            : msg
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
      currentStreamingTextRef.current = paused.generatedText ? paused.generatedText + (paused.generatedText.endsWith(' ') ? '' : ' ') : '';
      setStatus(SESSION_STATES.THINKING);

      playbackCursorRef.current.initTurn(newTurnId);
      paused.segments.forEach(s => playbackCursorRef.current.addSegment(s.index, s.text));
      playbackCursorRef.current.setGeneratedText(currentStreamingTextRef.current);
      playbackCursorRef.current.lastSpokenSegmentIndex = lastSpokenSegmentIndex;

      // Update the interrupted assistant message to resumed/streaming with the new turnId
      setMessages((prev) =>
        prev.map((msg) =>
          msg.turnId === sourceTurnId && msg.sender === 'assistant'
            ? { ...msg, turnId: newTurnId, status: 'streaming', text: currentStreamingTextRef.current }
            : msg
        )
      );

      socketClient.continueTurn({
        turnId: newTurnId,
        sourceTurnId,
        lastSpokenSegmentIndex,
      });

      const nextIndex = Math.max(0, lastSpokenSegmentIndex + 1);
      ttsPlayerRef.current.resetForTurn(newTurnId, nextIndex);
      setStatus(SESSION_STATES.SPEAKING);

      if (remainingSegments.length > 0) {
        remainingSegments.forEach((seg) => {
          ttsPlayerRef.current.enqueueSegment(seg.text, seg.index, newTurnId);
        });
        ttsPlayerRef.current.nextSegmentIndex = Math.max(...remainingSegments.map(s => s.index)) + 1;
      }
    }
  };

  /**
   * Start a new turn (from transcribed voice or typed text fallback)
   */
  const startTurnWithText = (text, inputType = 'text', language = null) => {
    if (!text || !text.trim()) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const trimmedText = normalizeTechTerms(text.trim());

    // Check for standalone voice command FIRST
    const command = parseVoiceCommand(trimmedText);
    if (command) {
      handleVoiceCommand(command);
      return;
    }

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

    // Mark any previous in-flight streaming assistant messages as interrupted
    setMessages((prev) => [
      ...prev.map((msg) =>
        msg.sender === 'assistant' && msg.status === 'streaming'
          ? { ...msg, status: 'interrupted' }
          : msg
      ),
      userMessage,
      assistantMessage,
    ]);
    setStatus(SESSION_STATES.THINKING);
    setErrorMessage(null);

    // Send start_turn event to server over WebSocket
    socketClient.startTurn({
      turnId: newTurnId,
      seq: 0,
      inputType,
      text: trimmedText,
      language,
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
        const result = await apiClient.uploadAudio(blob, 'speech.wav', {
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

        let normalizedTranscript = transcript.trim();
        const clean = normalizedTranscript.replace(/[.,!?;:]+/g, '').trim().toLowerCase();

        // Filter out Whisper hallucination artifacts from background noise or silence
        const isHallucination =
          ['thanks for watching', 'thank you for watching', 'subtitles by', 'viewers like you', 'subscribe to my channel', 'amara.org'].some((h) => clean.includes(h));

        if (!clean || isHallucination) {
          setStatus(SESSION_STATES.LISTENING);
          return;
        }

        // Fix Whisper acoustic misclassification: if lone 'y' or 'y.' is transcribed when saying "Hey"
        if (clean === 'y') {
          normalizedTranscript = 'Hey';
        }

        // Normalize developer terms, frameworks, and accent misrecognitions
        normalizedTranscript = normalizeTechTerms(normalizedTranscript);

        // Ordinary speech utterance -> Start new turn with detected language
        startTurnWithText(normalizedTranscript, 'audio', result?.language);
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

  // Keep VAD updated when assistant is actively speaking through speakers
  useEffect(() => {
    microphone.setPlaybackActive(status === SESSION_STATES.SPEAKING);
  }, [status, microphone]);

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
   * Set TTS volume (0.0 to 1.0)
   */
  const handleSetVolume = (vol) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setTtsVolume(clamped);
    ttsPlayerRef.current.setVolume(clamped);
  };

  /**
   * Set TTS speech rate (0.5 to 2.0)
   */
  const handleSetRate = (rate) => {
    const clamped = Math.max(0.5, Math.min(2.0, rate));
    setTtsRate(clamped);
    ttsPlayerRef.current.setRate(clamped);
  };

  /**
   * Synchronize browser speech synthesis voices
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const syncVoices = () => {
      const available = window.speechSynthesis.getVoices() || [];
      if (available.length > 0) {
        const voiceList = available.map((v) => ({
          name: v.name,
          lang: v.lang,
          voiceURI: v.voiceURI,
          default: v.default,
        }));
        setVoices(voiceList);

        const savedURI = localStorage.getItem('ai_voice_assistant_voice_uri');
        if (savedURI && available.some((v) => v.voiceURI === savedURI)) {
          setSelectedVoiceURI(savedURI);
          ttsPlayerRef.current?.setVoice(savedURI);
        } else if (ttsPlayerRef.current?.selectedVoice) {
          setSelectedVoiceURI(ttsPlayerRef.current.selectedVoice.voiceURI);
        }
      }
    };

    syncVoices();
    if (typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', syncVoices);
      return () => window.speechSynthesis.removeEventListener('voiceschanged', syncVoices);
    } else {
      window.speechSynthesis.onvoiceschanged = syncVoices;
      return () => {
        window.speechSynthesis.onvoiceschanged = null;
      };
    }
  }, []);

  /**
   * Select a specific natural voice by URI
   */
  const handleSetVoice = (voiceURI) => {
    setSelectedVoiceURI(voiceURI);
    localStorage.setItem('ai_voice_assistant_voice_uri', voiceURI);
    ttsPlayerRef.current?.setVoice(voiceURI);
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
      ttsPlayerRef.current.feedDelta(delta, turnId, false, data.language);

      // Update message bubble in UI (ONLY assistant message!)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.turnId === turnId && msg.sender === 'assistant'
            ? { ...msg, text: currentStreamingTextRef.current }
            : msg
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
      setMessages((prev) => {
        const hasUserMsg = prev.some((msg) => msg.turnId === turnId && msg.sender === 'user');
        if (hasUserMsg) {
          return prev.map((msg) =>
            msg.turnId === turnId && msg.sender === 'user' ? { ...msg, text } : msg
          );
        }
        const userMsg = {
          id: 'msg_' + Math.random().toString(36).substring(2, 9),
          sender: 'user',
          text,
          turnId,
          timestamp: Date.now(),
        };
        const assistantIdx = prev.findIndex((msg) => msg.turnId === turnId && msg.sender === 'assistant');
        if (assistantIdx !== -1) {
          const next = [...prev];
          next.splice(assistantIdx, 0, userMsg);
          return next;
        }
        return [...prev, userMsg];
      });
    });

    // Handle turn complete
    const unsubTurnComplete = socketClient.on('turn_complete', (data) => {
      const { turnId } = data;
      if (turnId !== activeTurnIdRef.current) return;

      ttsPlayerRef.current.feedDelta('', turnId, true, data.language);
      playbackCursorRef.current.markGenerationComplete();

      // Only mark assistant message as completed
      setMessages((prev) =>
        prev.map((msg) =>
          msg.turnId === turnId && msg.sender === 'assistant'
            ? { ...msg, status: 'completed' }
            : msg
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
      if (activeTurnIdRef.current) {
        const currentActiveId = activeTurnIdRef.current;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.turnId === currentActiveId && msg.sender === 'assistant'
              ? { ...msg, status: 'error' }
              : msg
          )
        );
      }
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

  /**
   * Directly test TTS audio playback
   */
  const testAudioOutput = () => {
    return ttsPlayerRef.current?.testVoice('Hello! Voice assistant audio is working properly.');
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
    ttsVolume,
    ttsRate,
    voices,
    selectedVoiceURI,
    audioLevel: microphone.audioLevel,
    isListening: microphone.isListening,
    isRecording: microphone.isRecording,
    hasPermission: microphone.hasPermission,
    permissionError: microphone.permissionError,
    toggleListening: handleToggleListening,
    startTurnWithText,
    handleContinueResponse,
    handleRepeatLastResponse,
    handleRepeatResponse: handleRepeatLastResponse,
    testAudioOutput,
    toggleMute,
    clearChat,
    stopSession,
    setSilenceTimeout: handleSetSilenceTimeout,
    setVolume: handleSetVolume,
    setRate: handleSetRate,
    setVoice: handleSetVoice,
    dismissError: () => setErrorMessage(null),
  };
}
