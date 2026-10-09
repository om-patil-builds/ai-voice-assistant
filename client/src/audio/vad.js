/**
 * Voice Activity Detection (VAD) using Web Audio API.
 * Analyzes microphone audio stream in real-time, detecting speech onset and silence.
 * Configured for low-latency barge-in (sub-250ms) and configurable end-of-speech timeout.
 */

export class VoiceActivityDetector {
  /**
   * @param {Object} options
   * @param {number} [options.speechThreshold=0.025] - RMS threshold to detect speech start
   * @param {number} [options.silenceThreshold=0.015] - RMS threshold to consider silence
   * @param {number} [options.silenceTimeoutMs=600] - Silence duration before speech end (400-700ms)
   * @param {number} [options.minSpeechDurationMs=120] - Minimum speech duration to filter clicks/pops
   * @param {function} [options.onSpeechStart] - Callback when speech starts
   * @param {function} [options.onSpeechEnd] - Callback when speech ends (passes duration in ms)
   * @param {function} [options.onAudioLevel] - Callback with normalized level (0.0 to 1.0)
   * @param {function} [options.onError] - Error callback
   */
  constructor(options = {}) {
    this.speechThreshold = options.speechThreshold ?? 0.025;
    this.silenceThreshold = options.silenceThreshold ?? 0.015;
    this.silenceTimeoutMs = options.silenceTimeoutMs ?? 600;
    this.minSpeechDurationMs = options.minSpeechDurationMs ?? 120;

    this.onSpeechStart = options.onSpeechStart || (() => {});
    this.onSpeechEnd = options.onSpeechEnd || (() => {});
    this.onAudioLevel = options.onAudioLevel || (() => {});
    this.onError = options.onError || (() => {});

    this.audioContext = null;
    this.mediaStreamSource = null;
    this.analyser = null;
    this.animationFrameId = null;

    this.isListening = false;
    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.silenceStartTime = 0;
    this.candidateSpeechStart = 0;

    // Buffer for time-domain audio data
    this.timeDomainBuffer = null;
  }

  /**
   * Set silence timeout dynamically (400ms - 1500ms)
   * @param {number} ms
   */
  setSilenceTimeout(ms) {
    if (typeof ms === 'number' && ms >= 300 && ms <= 2000) {
      this.silenceTimeoutMs = ms;
    }
  }

  /**
   * Set speech detection threshold dynamically
   * @param {number} threshold
   */
  setSpeechThreshold(threshold) {
    if (typeof threshold === 'number' && threshold > 0 && threshold < 1) {
      this.speechThreshold = threshold;
    }
  }

  /**
   * Start VAD monitoring on a MediaStream
   * @param {MediaStream} mediaStream
   */
  start(mediaStream) {
    if (this.isListening) {
      this.stop();
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('Web Audio API is not supported in this browser.');
      }

      this.audioContext = new AudioCtx();
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      this.mediaStreamSource = this.audioContext.createMediaStreamSource(mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.2;

      this.mediaStreamSource.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      this.timeDomainBuffer = new Float32Array(bufferLength);

      this.isListening = true;
      this.isSpeaking = false;
      this.candidateSpeechStart = 0;
      this.silenceStartTime = 0;

      this._analyzeLoop();
    } catch (err) {
      this.onError(err);
    }
  }

  /**
   * Internal loop analyzing audio frames
   */
  _analyzeLoop() {
    if (!this.isListening || !this.analyser) return;

    this.analyser.getFloatTimeDomainData(this.timeDomainBuffer);

    // Compute Root Mean Square (RMS) energy
    let sumSquares = 0;
    const len = this.timeDomainBuffer.length;
    for (let i = 0; i < len; i++) {
      const val = this.timeDomainBuffer[i];
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / len);

    // Normalize level for UI visualizer (scale ~0.0 to 1.0)
    const normalizedLevel = Math.min(1.0, rms * 12);
    this.onAudioLevel(normalizedLevel);

    const now = performance.now();

    if (rms >= this.speechThreshold) {
      // Audio level above speech threshold
      this.silenceStartTime = 0;

      if (!this.isSpeaking) {
        if (!this.candidateSpeechStart) {
          this.candidateSpeechStart = now;
        } else if (now - this.candidateSpeechStart >= this.minSpeechDurationMs) {
          // Sustained speech detected
          this.isSpeaking = true;
          this.speechStartTime = this.candidateSpeechStart;
          this.candidateSpeechStart = 0;
          this.onSpeechStart();
        }
      }
    } else if (rms < this.silenceThreshold) {
      // Audio level is below silence threshold
      this.candidateSpeechStart = 0;

      if (this.isSpeaking) {
        if (!this.silenceStartTime) {
          this.silenceStartTime = now;
        } else if (now - this.silenceStartTime >= this.silenceTimeoutMs) {
          // Silence duration exceeded end-of-speech timeout
          const duration = now - this.speechStartTime;
          this.isSpeaking = false;
          this.silenceStartTime = 0;
          this.onSpeechEnd(duration);
        }
      }
    }

    this.animationFrameId = requestAnimationFrame(() => this._analyzeLoop());
  }

  /**
   * Stop VAD monitoring
   */
  stop() {
    this.isListening = false;
    this.isSpeaking = false;
    this.candidateSpeechStart = 0;
    this.silenceStartTime = 0;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.mediaStreamSource) {
      try {
        this.mediaStreamSource.disconnect();
      } catch {
        // ignore
      }
      this.mediaStreamSource = null;
    }

    if (this.analyser) {
      this.analyser = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {
        // ignore
      }
      this.audioContext = null;
    }

    this.onAudioLevel(0);
  }

  /**
   * Destroy and clean up resources
   */
  destroy() {
    this.stop();
    this.onSpeechStart = () => {};
    this.onSpeechEnd = () => {};
    this.onAudioLevel = () => {};
    this.onError = () => {};
  }
}
