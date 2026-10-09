import { useState, useRef, useCallback, useEffect } from 'react';
import { VoiceActivityDetector } from '../audio/vad.js';

/**
 * Custom hook for microphone management, permission state,
 * Web Audio VAD monitoring, and continuous pre-roll WAV recording.
 *
 * @param {Object} options
 * @param {number} [options.silenceTimeoutMs=550] - End-of-speech silence duration
 * @param {function} [options.onSpeechStart] - Immediate trigger for barge-in
 * @param {function(Blob, number): void} [options.onUtteranceRecorded] - (wavBlob, durationMs) => void
 * @param {function(Error): void} [options.onError] - (error) => void
 */
export function useMicrophone({
  silenceTimeoutMs = 550,
  onSpeechStart,
  onUtteranceRecorded,
  onError,
} = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [hasPermission, setHasPermission] = useState(null);
  const [permissionError, setPermissionError] = useState(null);

  const mediaStreamRef = useRef(null);
  const vadRef = useRef(null);
  const speechDurationRef = useRef(0);
  const isSpeechActiveRef = useRef(false);

  // Keep latest callbacks in refs
  const onSpeechStartRef = useRef(onSpeechStart);
  const onUtteranceRecordedRef = useRef(onUtteranceRecorded);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onSpeechStartRef.current = onSpeechStart;
    onUtteranceRecordedRef.current = onUtteranceRecorded;
    onErrorRef.current = onError;
  }, [onSpeechStart, onUtteranceRecorded, onError]);

  // Check browser capability
  const isSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window !== 'undefined' &&
    Boolean(window.AudioContext || window.webkitAudioContext);

  /**
   * Handle speech start from VAD (immediate barge-in)
   */
  const handleVADSpeechStart = useCallback(() => {
    isSpeechActiveRef.current = true;
    setIsRecording(true);

    if (onSpeechStartRef.current) {
      onSpeechStartRef.current();
    }
  }, []);

  /**
   * Handle complete recorded utterance from VAD
   */
  const handleVADSpeechEnd = useCallback((durationMs, wavBlob) => {
    isSpeechActiveRef.current = false;
    setIsRecording(false);
    speechDurationRef.current = durationMs;

    if (wavBlob && wavBlob.size > 2000) {
      if (onUtteranceRecordedRef.current) {
        onUtteranceRecordedRef.current(wavBlob, durationMs);
      }
    }
  }, []);

  /**
   * Start listening to the microphone
   */
  const startListening = useCallback(async () => {
    if (!isSupported) {
      const err = new Error('Microphone audio recording is not supported in this browser.');
      setPermissionError(err.message);
      if (onErrorRef.current) onErrorRef.current(err);
      return false;
    }

    try {
      setPermissionError(null);

      // Acoustic echo cancellation, noise suppression, and auto-gain
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      mediaStreamRef.current = stream;
      setHasPermission(true);

      // Create or configure VAD with pre-roll WAV capture
      if (!vadRef.current) {
        vadRef.current = new VoiceActivityDetector({
          silenceTimeoutMs,
          onSpeechStart: handleVADSpeechStart,
          onSpeechEnd: handleVADSpeechEnd,
          onAudioLevel: (lvl) => setAudioLevel(lvl),
          onError: (err) => {
            console.error('VAD error:', err);
            if (onErrorRef.current) onErrorRef.current(err);
          },
        });
      } else {
        vadRef.current.setSilenceTimeout(silenceTimeoutMs);
      }

      vadRef.current.start(stream);
      setIsListening(true);
      return true;
    } catch (err) {
      console.error('Microphone access denied or error:', err);
      let message = 'Unable to access microphone.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        message = 'Microphone permission was denied. Please allow microphone access in browser settings.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        message = 'No microphone device was detected on your system.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        message = 'Microphone is already in use by another application.';
      }

      setPermissionError(message);
      setHasPermission(false);
      setIsListening(false);
      if (onErrorRef.current) onErrorRef.current(new Error(message));
      return false;
    }
  }, [isSupported, silenceTimeoutMs, handleVADSpeechStart, handleVADSpeechEnd]);

  /**
   * Stop listening to the microphone
   */
  const stopListening = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.stop();
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    setIsListening(false);
    setIsRecording(false);
    setAudioLevel(0);
  }, []);

  /**
   * Notify VAD when assistant is speaking through speakers (echo ducking)
   */
  const setPlaybackActive = useCallback((active) => {
    if (vadRef.current) {
      vadRef.current.setPlaybackActive(active);
    }
  }, []);

  /**
   * Dynamically adjust silence timeout (ms)
   */
  const updateSilenceTimeout = useCallback((ms) => {
    if (vadRef.current) {
      vadRef.current.setSilenceTimeout(ms);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (vadRef.current) {
        vadRef.current.destroy();
        vadRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

  return {
    isListening,
    isRecording,
    audioLevel,
    hasPermission,
    permissionError,
    startListening,
    stopListening,
    setPlaybackActive,
    updateSilenceTimeout,
  };
}
