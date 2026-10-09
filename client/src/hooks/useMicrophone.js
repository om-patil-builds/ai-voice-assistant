import { useState, useRef, useCallback, useEffect } from 'react';
import { VoiceActivityDetector } from '../audio/vad.js';

/**
 * Custom hook for microphone management, permission state,
 * Web Audio VAD monitoring, and audio recording.
 *
 * @param {Object} options
 * @param {number} [options.silenceTimeoutMs=600] - End-of-speech silence duration
 * @param {function} [options.onSpeechStart] - Immediate trigger for barge-in
 * @param {function} [options.onUtteranceRecorded] - (blob, durationMs) => void
 * @param {function} [options.onError] - (error) => void
 */
export function useMicrophone({
  silenceTimeoutMs = 600,
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
  const mediaRecorderRef = useRef(null);
  const vadRef = useRef(null);
  const recordedChunksRef = useRef([]);
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
    Boolean(window.MediaRecorder);

  /**
   * Start recording utterance when speech is detected
   */
  const handleVADSpeechStart = useCallback(() => {
    isSpeechActiveRef.current = true;
    setIsRecording(true);

    // Call speech start callback immediately for barge-in!
    if (onSpeechStartRef.current) {
      onSpeechStartRef.current();
    }

    if (!mediaStreamRef.current) return;

    try {
      recordedChunksRef.current = [];

      // Determine supported mimeType
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        '',
      ];
      const selectedMime = mimeTypes.find((type) => !type || MediaRecorder.isTypeSupported(type)) || '';

      const options = selectedMime ? { mimeType: selectedMime } : {};
      const recorder = new MediaRecorder(mediaStreamRef.current, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (e) => {
        console.error('MediaRecorder error:', e);
        if (onErrorRef.current) onErrorRef.current(e.error || new Error('Audio recording error'));
      };

      recorder.start(100); // collect in 100ms chunks
    } catch (err) {
      console.error('Failed to start MediaRecorder:', err);
      if (onErrorRef.current) onErrorRef.current(err);
    }
  }, []);

  /**
   * Stop recording utterance when silence is reached
   */
  const handleVADSpeechEnd = useCallback((durationMs) => {
    isSpeechActiveRef.current = false;
    setIsRecording(false);
    speechDurationRef.current = durationMs;

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        recordedChunksRef.current = [];

        // Filter out accidental clicks/pops with negligible duration
        if (durationMs > 200 && blob.size > 800) {
          if (onUtteranceRecordedRef.current) {
            onUtteranceRecordedRef.current(blob, durationMs);
          }
        }
      };

      recorder.stop();
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

      // Acoustic echo cancellation & noise suppression
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
      });

      mediaStreamRef.current = stream;
      setHasPermission(true);

      // Create or configure VAD
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
      } else if (err.name === 'NotReadableError') {
        message = 'Microphone is already in use by another application.';
      }
      setHasPermission(false);
      setPermissionError(message);
      if (onErrorRef.current) onErrorRef.current(new Error(message));
      return false;
    }
  }, [isSupported, silenceTimeoutMs, handleVADSpeechStart, handleVADSpeechEnd]);

  /**
   * Stop listening and release microphone tracks
   */
  const stopListening = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.stop();
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
      mediaRecorderRef.current = null;
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
   * Toggle listening state
   */
  const toggleListening = useCallback(async () => {
    if (isListening) {
      stopListening();
      return false;
    } else {
      return await startListening();
    }
  }, [isListening, startListening, stopListening]);

  /**
   * Update silence timeout dynamically (400ms - 1500ms)
   */
  const setSilenceTimeout = useCallback((ms) => {
    if (vadRef.current) {
      vadRef.current.setSilenceTimeout(ms);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
      if (vadRef.current) {
        vadRef.current.destroy();
        vadRef.current = null;
      }
    };
  }, [stopListening]);

  return {
    isSupported,
    isListening,
    isRecording,
    audioLevel,
    hasPermission,
    permissionError,
    startListening,
    stopListening,
    toggleListening,
    setSilenceTimeout,
  };
}
