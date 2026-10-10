import { mergeBuffers, downsampleBuffer, calculateRmsAndPeak, encodeWav } from './wavEncoder.js';

/**
 * Voice Activity Detection (VAD) and Continuous Pre-Roll Audio Recorder.
 * Analyzes microphone audio stream in real-time, detecting speech onset and silence.
 *
 * Key Architecture Highlights:
 * 1. Continuous Pre-Roll Buffer (~450ms): Captures audio *before* speech onset is confirmed,
 *    preventing the initial consonants ("H" in "Hey", "P", "T", "S", etc.) from being clipped.
 * 2. Post-Roll Padding (~250ms): Extends recording during silence hangover to preserve trailing sounds.
 * 3. 16kHz Mono Lossless WAV Generation: Direct, pristine audio feed for Whisper STT without
 *    WebM container or chunk corruption.
 * 4. Acoustic Ducking: Protects against self-interruption from speaker playback.
 */

export class VoiceActivityDetector {
  /**
   * @param {Object} options
   * @param {number} [options.speechThreshold=0.022] - RMS threshold to detect speech start
   * @param {number} [options.silenceThreshold=0.012] - RMS threshold to consider silence
   * @param {number} [options.silenceTimeoutMs=550] - Silence duration before speech end (400-700ms)
   * @param {number} [options.minSpeechDurationMs=100] - Minimum speech duration to filter clicks/pops
   * @param {function} [options.onSpeechStart] - Callback when speech starts (immediate barge-in)
   * @param {function(number, Blob): void} [options.onSpeechEnd] - (durationMs, wavBlob) => void
   * @param {function(number): void} [options.onAudioLevel] - Normalized level (0.0 to 1.0) for visualizer
   * @param {function(Error): void} [options.onError] - Error callback
   */
  constructor(options = {}) {
    this.speechThreshold = options.speechThreshold ?? 0.022;
    this.silenceThreshold = options.silenceThreshold ?? 0.012;
    this.silenceTimeoutMs = options.silenceTimeoutMs ?? 550;
    this.minSpeechDurationMs = options.minSpeechDurationMs ?? 100;

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
    this.isPlaybackActive = Boolean(active);
    if (active) {
      this.playbackStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }
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

    // If AI voice playback started within last 300ms, duck to prevent startup echo pop
    if (this.isPlaybackActive && now - this.playbackStartTime < 300) {
      return;
    }

    // Dynamic thresholds with ducking when assistant audio is speaking
    const effectiveSpeechThreshold = this.isPlaybackActive
      ? Math.max(this.speechThreshold * 2.2, 0.065)
      : this.speechThreshold;

    const effectiveMinDuration = this.isPlaybackActive
      ? Math.max(this.minSpeechDurationMs, 200)
      : this.minSpeechDurationMs;

    // Update rolling pre-roll buffer (keeps last ~450ms)
    this.preRollChunks.push(frameCopy);
    if (this.preRollChunks.length > this.maxPreRollFrames) {
      this.preRollChunks.shift();
    }

    if (rms >= effectiveSpeechThreshold) {
      // Speech energy detected
      this.silenceStartTime = 0;

      if (!this.isSpeaking) {
        if (!this.candidateSpeechStart) {
          this.candidateSpeechStart = now;
        } else if (now - this.candidateSpeechStart >= effectiveMinDuration) {
          // Sustained speech confirmed!
          this.isSpeaking = true;
          this.speechStartTime = this.candidateSpeechStart;
          this.candidateSpeechStart = 0;

          // Barge-in: Notify caller immediately to stop AI playback and cancel LLM stream!
          this.onSpeechStart();

          // Initialize speech recording with ALL pre-roll frames!
          // This guarantees that initial sounds ("H" in "Hey", consonants) are preserved!
          this.recordedSpeechChunks = [...this.preRollChunks];
        }
      } else {
        // Continue recording speech
        this.recordedSpeechChunks.push(frameCopy);
      }
    } else if (rms < this.silenceThreshold) {
      // Audio level below silence threshold
      this.candidateSpeechStart = 0;

      if (this.isSpeaking) {
        // Still append silence frames (provides natural post-roll padding)
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
      }
    } else {
      // In hysteresis band between silenceThreshold and speechThreshold
      if (this.isSpeaking) {
        this.recordedSpeechChunks.push(frameCopy);
      }
    }
  }

  /**
   * Complete utterance processing: merge, downsample to 16kHz, validate energy, and emit WAV
   * @param {number} durationMs
   */
  _finishUtterance(durationMs) {
    if (this.recordedSpeechChunks.length === 0) return;

    try {
      // Merge all recorded Float32Array PCM chunks (pre-roll + speech + post-roll)
      const mergedPcm = mergeBuffers(this.recordedSpeechChunks);
      this.recordedSpeechChunks = [];

      // Validate that utterance contains actual voiced speech, not just empty ambient noise
      const { rms, peak } = calculateRmsAndPeak(mergedPcm);
      if (peak < 0.028 && rms < 0.008) {
        // Discard low-energy clicks, breaths, or pure ambient silence
        return;
      }

      // Downsample from AudioContext sample rate (typically 48kHz or 44.1kHz) to 16,000 Hz
      const sourceSampleRate = this.audioContext?.sampleRate || 48000;
      const downsampledPcm = downsampleBuffer(mergedPcm, sourceSampleRate, 16000);

      // Encode into pristine 16-bit mono WAV Blob
      const wavBlob = encodeWav(downsampledPcm, 16000);

      // Minimum duration filter (filter out tiny < 180ms pops)
      if (durationMs > 180 && wavBlob.size > 2000) {
        this.onSpeechEnd(durationMs, wavBlob);
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
