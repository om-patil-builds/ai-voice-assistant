import { mergeBuffers, downsampleBuffer, calculateRmsAndPeak, encodeWav, trimSilence } from './wavEncoder.js';

/**
 * Voice Activity Detection (VAD) and Continuous Pre-Roll Audio Recorder.
 * Analyzes microphone audio stream in real-time, detecting speech onset and silence.
 *
 * Key Architecture Highlights:
 * 1. Continuous Pre-Roll Buffer (~500ms): Captures audio before speech onset is confirmed,
 *    preventing initial consonants ("H" in "Hey", "P", "T", "S", etc.) from being clipped.
 * 2. Adaptive Silence Trimming: Trims excess silence down to clean ~180ms leading and ~220ms
 *    trailing padding to prevent Whisper silence hallucination and latency delays.
 * 3. 16kHz Mono Anti-Aliased Lossless WAV Generation: Direct, pristine audio feed for Whisper STT.
 * 4. Acoustic Ducking: Protects against self-interruption from speaker playback.
 */

export class VoiceActivityDetector {
  /**
   * @param {Object} options
   * @param {number} [options.speechThreshold=0.016] - RMS threshold to detect speech start (tuned for natural conversational volume)
   * @param {number} [options.silenceThreshold=0.009] - RMS threshold to consider silence
   * @param {number} [options.silenceTimeoutMs=700] - Silence duration before speech end (400-900ms)
   * @param {number} [options.minSpeechDurationMs=80] - Minimum speech duration to filter clicks/pops
   * @param {function} [options.onSpeechStart] - Callback when speech starts (immediate barge-in)
   * @param {function(number, Blob): void} [options.onSpeechEnd] - (durationMs, wavBlob) => void
   * @param {function(number): void} [options.onAudioLevel] - Normalized level (0.0 to 1.0) for visualizer
   * @param {function(Error): void} [options.onError] - Error callback
   */
  constructor(options = {}) {
    this.speechThreshold = options.speechThreshold ?? 0.020;
    this.silenceThreshold = options.silenceThreshold ?? 0.010;
    this.silenceTimeoutMs = options.silenceTimeoutMs ?? 700;
    this.minSpeechDurationMs = options.minSpeechDurationMs ?? 120;
    this.playbackSpeechThreshold = options.playbackSpeechThreshold ?? 0.035;
    this.playbackMinSpeechDurationMs = options.playbackMinSpeechDurationMs ?? 100;

    this.onSpeechStart = options.onSpeechStart || (() => {});
    this.onSpeechEnd = options.onSpeechEnd || (() => {});
    this.onAudioLevel = options.onAudioLevel || (() => {});
    this.onError = options.onError || (() => {});

    this.audioContext = null;
    this.mediaStreamSource = null;
    this.analyser = null;
    this.scriptProcessor = null;
    this.zeroGain = null;

    this.isListening = false;
    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.silenceStartTime = 0;
    this.candidateSpeechStart = 0;
    this._lastDebugLogTime = 0;

    // Rolling circular pre-roll buffer (~450ms of audio frames)
    this.preRollChunks = [];
    this.maxPreRollFrames = 6; // 6 frames of 4096 samples at 48kHz = ~512ms pre-roll

    // Active speech buffer accumulating Float32Array PCM frames
    this.recordedSpeechChunks = [];

    // Playback ducking to prevent AI voice from interrupting itself
    this.isPlaybackActive = false;
    this.playbackStartTime = 0;
  }

  /**
   * Notify VAD when AI audio is speaking through speakers
   * @param {boolean} active
   */
  setPlaybackActive(active) {
    const wasActive = this.isPlaybackActive;
    this.isPlaybackActive = Boolean(active);
    if (this.isPlaybackActive && !wasActive) {
      this.playbackStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }
    const currentThreshold = this.isPlaybackActive ? this.playbackSpeechThreshold : this.speechThreshold;
    const currentMinDuration = this.isPlaybackActive ? this.playbackMinSpeechDurationMs : this.minSpeechDurationMs;
    console.log(
      `[VAD Trace] setPlaybackActive(${active}) | wasActive=${wasActive} | effectiveThreshold=${currentThreshold.toFixed(4)} | minDuration=${currentMinDuration}ms`
    );
  }

  /**
   * Set silence timeout dynamically (300ms - 2000ms)
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
   * Set playback speech detection threshold dynamically
   * @param {number} threshold
   */
  setPlaybackSpeechThreshold(threshold) {
    if (typeof threshold === 'number' && threshold > 0 && threshold < 1) {
      this.playbackSpeechThreshold = threshold;
    }
  }

  /**
   * Set playback minimum speech duration dynamically
   * @param {number} ms
   */
  setPlaybackMinSpeechDuration(ms) {
    if (typeof ms === 'number' && ms >= 50 && ms <= 1000) {
      this.playbackMinSpeechDurationMs = ms;
    }
  }

  /**
   * Start VAD monitoring and continuous pre-roll recording on a MediaStream
   * @param {MediaStream} mediaStream
   */
  start(mediaStream) {
    if (this.isListening) {
      this.stop();
    }

    try {
      const AudioCtx =
        (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;

      if (!AudioCtx) {
        throw new Error('Web Audio API is not supported in this environment.');
      }

      this.audioContext = new AudioCtx();
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      this.mediaStreamSource = this.audioContext.createMediaStreamSource(mediaStream);

      // Create AnalyserNode for fast visualizer rendering
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.2;
      this.mediaStreamSource.connect(this.analyser);

      const workletCode = `
class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.pointer = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    
    const channelData = input[0];
    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.pointer++] = channelData[i];
      if (this.pointer >= this.bufferSize) {
        this.port.postMessage(this.buffer.slice());
        this.pointer = 0;
      }
    }
    return true;
  }
}
registerProcessor('vad-processor', VadProcessor);
      `;

      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);

      this.preRollChunks = [];
      this.recordedSpeechChunks = [];
      this.isListening = true;
      this.isSpeaking = false;
      this.candidateSpeechStart = 0;
      this.silenceStartTime = 0;

      this.audioContext.audioWorklet.addModule(workletUrl).then(() => {
        this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'vad-processor');
        
        this.audioWorkletNode.port.onmessage = (event) => {
          this._processAudioFrame(event.data);
        };

        this.mediaStreamSource.connect(this.audioWorkletNode);

        // Zero-gain node keeps the audio graph alive without playing mic into speakers
        this.zeroGain = this.audioContext.createGain();
        this.zeroGain.gain.value = 0;
        
        this.audioWorkletNode.connect(this.zeroGain);
        this.zeroGain.connect(this.audioContext.destination);
      }).catch(err => {
        console.error('Failed to load AudioWorklet:', err);
        this.onError(err);
      });
    } catch (err) {
      console.error('Failed to start VoiceActivityDetector:', err);
      this.onError(err);
    }
  }

  /**
   * Process incoming PCM audio frame
   * @param {Float32Array} inputData
   */
  _processAudioFrame(inputData) {
    if (!this.isListening) return;

    if (!inputData || inputData.length === 0) return;

    // Fast copy of current frame for recording buffer
    const frameCopy = new Float32Array(inputData);

    // Compute RMS and peak energy
    const { rms } = calculateRmsAndPeak(frameCopy);

    // Report normalized level to UI visualizer (scale ~0.0 to 1.0)
    const normalizedLevel = Math.min(1.0, rms * 14);
    this.onAudioLevel(normalizedLevel);

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Update rolling pre-roll buffer (keeps last ~450ms)
    this.preRollChunks.push(frameCopy);
    if (this.preRollChunks.length > this.maxPreRollFrames) {
      this.preRollChunks.shift();
    }

    // Startup echo ducking window: prevent initial speaker burst from triggering speech onset
    if (this.isPlaybackActive && now - this.playbackStartTime < 200) {
      this.candidateSpeechStart = 0;
      return;
    }

    // Dynamic thresholds with ducking when assistant audio is speaking
    const effectiveSpeechThreshold = this.isPlaybackActive
      ? this.playbackSpeechThreshold
      : this.speechThreshold;

    const effectiveMinDuration = this.isPlaybackActive
      ? this.playbackMinSpeechDurationMs
      : this.minSpeechDurationMs;

    // Periodic heartbeat debug log (throttled to every 1000ms)
    if (now - this._lastDebugLogTime > 1000) {
      this._lastDebugLogTime = now;
      console.log(`[VAD Heartbeat] rms=${rms.toFixed(4)} | speechThreshold=${effectiveSpeechThreshold.toFixed(4)} | playbackActive=${this.isPlaybackActive} | isSpeaking=${this.isSpeaking}`);
    }

    if (rms >= effectiveSpeechThreshold) {
      // Speech energy detected
      this.silenceStartTime = 0;

      if (!this.isSpeaking) {
        if (!this.candidateSpeechStart) {
          this.candidateSpeechStart = now;
          console.log(
            `[VAD Trace] Candidate speech onset | rms=${rms.toFixed(4)} >= threshold=${effectiveSpeechThreshold.toFixed(4)} | playbackActive=${this.isPlaybackActive} | minDuration=${effectiveMinDuration}ms`
          );
        } else if (now - this.candidateSpeechStart >= effectiveMinDuration) {
          // Sustained speech confirmed!
          this.isSpeaking = true;
          this.speechStartTime = this.candidateSpeechStart;
          this.candidateSpeechStart = 0;

          console.log(
            `[VAD Trace] Speech confirmed (Barge-in)! | rms=${rms.toFixed(4)} | duration=${Math.round(now - this.speechStartTime)}ms >= required=${effectiveMinDuration}ms | playbackActive=${this.isPlaybackActive}`
          );

          // Barge-in: Notify caller immediately to stop AI playback and cancel LLM stream!
          this.onSpeechStart();

          // Initialize speech recording with ALL pre-roll frames!
          // This guarantees that initial sounds ("H" in "Hey", consonants) are preserved!
          this.recordedSpeechChunks = [...this.preRollChunks];
        } else {
          console.log(
            `[VAD Trace] Candidate speech sustaining | rms=${rms.toFixed(4)} | elapsed=${Math.round(now - this.candidateSpeechStart)}ms / required=${effectiveMinDuration}ms | playbackActive=${this.isPlaybackActive}`
          );
        }
      } else {
        // Continue recording speech
        this.recordedSpeechChunks.push(frameCopy);
      }
    } else {
      // Audio level is below effective speech threshold
      // Crucial: If speech was NOT yet confirmed, any drop below speech threshold immediately resets candidate onset.
      // This prevents momentary clicks, isolated pops, or speaker echo syllables from accumulating across frames.
      if (!this.isSpeaking) {
        if (this.candidateSpeechStart) {
          console.log(
            `[VAD Trace] Candidate speech reset | rms=${rms.toFixed(4)} < threshold=${effectiveSpeechThreshold.toFixed(4)} | candidateDuration=${Math.round(now - this.candidateSpeechStart)}ms < required=${effectiveMinDuration}ms | playbackActive=${this.isPlaybackActive}`
          );
        }
        this.candidateSpeechStart = 0;
      } else {
        // Speech is already confirmed (isSpeaking === true)
        if (rms < this.silenceThreshold) {
          // Audio level below silence threshold
          this.recordedSpeechChunks.push(frameCopy);

          if (!this.silenceStartTime) {
            this.silenceStartTime = now;
          } else if (now - this.silenceStartTime >= this.silenceTimeoutMs) {
            // Silence timeout exceeded -> End of utterance!
            const duration = now - this.speechStartTime;
            this.isSpeaking = false;
            this.silenceStartTime = 0;

            this._finishUtterance(duration);
          }
        } else {
          // In hysteresis band between silenceThreshold and effectiveSpeechThreshold
          // Keep recording speech (speech is already confirmed)
          this.silenceStartTime = 0;
          this.recordedSpeechChunks.push(frameCopy);
        }
      }
    }
  }

  /**
   * Complete utterance processing: merge, trim excess silence, downsample to 16kHz, validate energy, and emit WAV
   * @param {number} durationMs
   */
  _finishUtterance(durationMs) {
    if (this.recordedSpeechChunks.length === 0) return;

    try {
      // Merge all recorded Float32Array PCM chunks (pre-roll + speech + post-roll)
      const mergedPcm = mergeBuffers(this.recordedSpeechChunks);
      this.recordedSpeechChunks = [];

      const sourceSampleRate = this.audioContext?.sampleRate || 48000;

      // Trim excess silence: keep ~180ms leading padding and ~200ms trailing padding
      // This prevents Whisper from hallucinating on long trailing silence and removes dead air
      const trimmedPcm = trimSilence(mergedPcm, sourceSampleRate, this.silenceThreshold, 180, 200);

      // Validate that utterance contains actual voiced speech, not just empty ambient room noise
      const { rms, peak } = calculateRmsAndPeak(trimmedPcm);
      if (peak < 0.020 && rms < 0.005) {
        // Discard low-energy clicks, breaths, or pure ambient silence
        console.log(`[VAD] Discarded ambient noise/click | peak=${peak.toFixed(4)} | rms=${rms.toFixed(4)}`);
        return;
      }

      // Anti-aliased downsample from AudioContext sample rate (48kHz/44.1kHz) to 16,000 Hz
      const downsampledPcm = downsampleBuffer(trimmedPcm, sourceSampleRate, 16000);

      // Encode into pristine 16-bit mono WAV Blob
      const wavBlob = encodeWav(downsampledPcm, 16000);
      const effectiveDuration = Math.round((downsampledPcm.length / 16000) * 1000);

      // Development logging showing recording duration and audio size (no sensitive info)
      console.log(
        `[VAD Recording] Duration: ${effectiveDuration}ms (raw: ${Math.round(durationMs)}ms) | Audio Size: ${wavBlob.size} bytes | Peak: ${peak.toFixed(4)} | RMS: ${rms.toFixed(4)}`
      );

      // Minimum duration filter (filter out tiny < 150ms pops)
      if (effectiveDuration > 150 && wavBlob.size > 2000) {
        this.onSpeechEnd(effectiveDuration, wavBlob);
      }
    } catch (err) {
      console.error('Error finishing utterance WAV:', err);
      this.onError(err);
    }
  }

  /**
   * Stop VAD monitoring
   */
  stop() {
    this.isListening = false;
    this.isSpeaking = false;
    this.candidateSpeechStart = 0;
    this.silenceStartTime = 0;
    this.preRollChunks = [];
    this.recordedSpeechChunks = [];

    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.onmessage = null;
      try {
        this.audioWorkletNode.disconnect();
      } catch {
        // ignore
      }
      this.audioWorkletNode = null;
    }

    if (this.zeroGain) {
      try {
        this.zeroGain.disconnect();
      } catch {
        // ignore
      }
      this.zeroGain = null;
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
      try {
        this.analyser.disconnect();
      } catch {
        // ignore
      }
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
