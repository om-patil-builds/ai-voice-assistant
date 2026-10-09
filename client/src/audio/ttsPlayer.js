/**
 * Browser SpeechSynthesis TTS Player with sentence-level streaming queue,
 * instant barge-in cancellation, and confirmed playback tracking.
 */

export class TTSPlayer {
  /**
   * @param {Object} options
   * @param {function} [options.onSegmentStart] - Callback ({ segmentIndex, text, turnId })
   * @param {function} [options.onSegmentEnd] - Callback ({ segmentIndex, text, turnId })
   * @param {function} [options.onQueueEmpty] - Callback ({ turnId })
   * @param {function} [options.onError] - Callback (error)
   */
  constructor(options = {}) {
    this.onSegmentStart = options.onSegmentStart || (() => {});
    this.onSegmentEnd = options.onSegmentEnd || (() => {});
    this.onQueueEmpty = options.onQueueEmpty || (() => {});
    this.onError = options.onError || (() => {});

    this.queue = [];
    this.activeUtterance = null;
    this.currentSegment = null;
    this.currentTurnId = null;
    this.lastConfirmedSegmentIndex = -1;

    this.isSpeaking = false;
    this.isMuted = false;
    this.cancelled = false;

    this.rate = 1.0;
    this.pitch = 1.0;
    this.volume = 1.0;
    this.selectedVoice = null;

    // Stream buffer for feeding LLM tokens
    this.streamBuffer = '';
    this.nextSegmentIndex = 0;

    // Check browser support
    this.isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

    // Workaround for Chrome garbage collection bug
    this._retainedUtterance = null;

    if (this.isSupported) {
      // Warm up voices
      if (typeof window.speechSynthesis.addEventListener === 'function') {
        window.speechSynthesis.addEventListener('voiceschanged', () => {
          this._loadPreferredVoice();
        });
      } else {
        window.speechSynthesis.onvoiceschanged = () => {
          this._loadPreferredVoice();
        };
      }
      this._loadPreferredVoice();
    }
  }

  _loadPreferredVoice() {
    if (!this.isSupported) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;

    // If user already chose a valid voice, keep it
    if (this.selectedVoice && voices.some((v) => v.voiceURI === this.selectedVoice.voiceURI)) {
      return;
    }

    // Prioritize natural/neural English voices
    const preferred =
      voices.find(
        (v) =>
          v.lang.startsWith('en') &&
          (v.name.includes('Natural') ||
            v.name.includes('Online') ||
            v.name.includes('Google') ||
            v.name.includes('Jenny') ||
            v.name.includes('David') ||
            v.name.includes('Zira') ||
            v.name.includes('Premium'))
      ) ||
      voices.find((v) => v.lang.startsWith('en-US')) ||
      voices.find((v) => v.lang.startsWith('en')) ||
      voices[0];

    if (preferred) {
      this.selectedVoice = preferred;
    }
  }

  /**
   * Get available voices from browser
   * @returns {SpeechSynthesisVoice[]}
   */
  getVoices() {
    if (!this.isSupported) return [];
    return window.speechSynthesis.getVoices() || [];
  }

  /**
   * Set specific voice by URI or Name
   * @param {string} voiceURI
   */
  setVoice(voiceURI) {
    if (!this.isSupported || !voiceURI) return;
    const voices = window.speechSynthesis.getVoices() || [];
    const match = voices.find((v) => v.voiceURI === voiceURI || v.name === voiceURI);
    if (match) {
      this.selectedVoice = match;
    }
  }

  /**
   * Set mute state
   * @param {boolean} muted
   */
  setMute(muted) {
    this.isMuted = Boolean(muted);
    if (this.isMuted && this.isSpeaking) {
      this.cancel();
    }
  }

  /**
   * Set speech volume (0.0 to 1.0)
   * @param {number} vol
   */
  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  /**
   * Set speech rate (0.5 to 2.0)
   * @param {number} rate
   */
  setRate(rate) {
    this.rate = Math.max(0.5, Math.min(2.0, rate));
  }

  /**
   * Reset player for a new turn
   * @param {string} turnId
   */
  resetForTurn(turnId) {
    this.cancel();
    this.currentTurnId = turnId;
    this.lastConfirmedSegmentIndex = -1;
    this.streamBuffer = '';
    this.nextSegmentIndex = 0;
    this.cancelled = false;
  }

  /**
   * Enqueue a discrete sentence segment to be spoken
   * @param {string} text
   * @param {number} segmentIndex
   * @param {string} turnId
   */
  enqueueSegment(text, segmentIndex, turnId) {
    if (this.cancelled && this.currentTurnId === turnId) return;
    const cleanText = text.trim();
    if (!cleanText) return;

    this.queue.push({
      text: cleanText,
      segmentIndex,
      turnId,
    });

    if (!this.isSpeaking) {
      this._playNext();
    }
  }

  /**
   * Feed streaming token delta from LLM.
   * Extracts completed sentences and enqueues them immediately.
   * @param {string} delta
   * @param {string} turnId
   * @param {boolean} [isFinal=false]
   */
  feedDelta(delta, turnId, isFinal = false) {
    if (this.currentTurnId !== turnId) {
      this.resetForTurn(turnId);
    }

    this.streamBuffer += delta;

    // Sentence delimiters: period, exclamation mark, question mark, newline followed by whitespace
    // Avoid splitting on common abbreviations like e.g., i.e., Dr., etc. if preceded by word characters
    const sentenceEndRegex = /([.!?\n]+)\s+/g;
    let match;
    let lastIndex = 0;

    while ((match = sentenceEndRegex.exec(this.streamBuffer)) !== null) {
      const sentenceText = this.streamBuffer.slice(lastIndex, match.index + match[1].length).trim();
      lastIndex = match.index + match[0].length;

      if (sentenceText) {
        this.enqueueSegment(sentenceText, this.nextSegmentIndex++, turnId);
      }
    }

    if (lastIndex > 0) {
      this.streamBuffer = this.streamBuffer.slice(lastIndex);
    }

    if (isFinal && this.streamBuffer.trim()) {
      // Speak any remaining text in buffer
      this.enqueueSegment(this.streamBuffer.trim(), this.nextSegmentIndex++, turnId);
      this.streamBuffer = '';
    }
  }

  /**
   * Play the next segment in the queue
   */
  _playNext() {
    if (this.queue.length === 0) {
      this.isSpeaking = false;
      this.currentSegment = null;
      if (this.currentTurnId) {
        this.onQueueEmpty({ turnId: this.currentTurnId });
      }
      return;
    }

    if (this.isMuted) {
      // If muted, advance segments without audio playback while still marking progress
      const seg = this.queue.shift();
      this.lastConfirmedSegmentIndex = seg.segmentIndex;
      this.onSegmentStart(seg);
      this.onSegmentEnd(seg);
      this._playNext();
      return;
    }

    if (!this.isSupported) {
      const seg = this.queue.shift();
      this.onSegmentStart(seg);
      this.onSegmentEnd(seg);
      this._playNext();
      return;
    }

    const seg = this.queue.shift();
    this.currentSegment = seg;
    this.isSpeaking = true;
    this.cancelled = false;

    try {
      if (!this.selectedVoice) {
        this._loadPreferredVoice();
      }

      const utterance = new SpeechSynthesisUtterance(seg.text);
      if (this.selectedVoice) {
        utterance.voice = this.selectedVoice;
        utterance.lang = this.selectedVoice.lang || 'en-US';
      } else {
        utterance.lang = 'en-US';
      }
      utterance.volume = this.volume;
      utterance.rate = this.rate;
      utterance.pitch = this.pitch;

      // Chrome GC bug guard: keep reference on instance
      this._retainedUtterance = utterance;

      utterance.onstart = () => {
        if (this.cancelled) return;
        this.onSegmentStart(seg);
      };

      utterance.onend = () => {
        this._retainedUtterance = null;
        if (this.cancelled) return;
        // Crucial requirement: only confirmed when playback completes!
        this.lastConfirmedSegmentIndex = seg.segmentIndex;
        this.onSegmentEnd(seg);
        this._playNext();
      };

      utterance.onerror = (e) => {
        this._retainedUtterance = null;
        if (this.cancelled) return;
        // 'interrupted' or 'canceled' are standard when cancel() is called
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          console.warn('TTS utterance error:', e.error);
          this.onError(e);
        }
        this._playNext();
      };

      // Chrome Windows Bug: speechSynthesis can get paused/stuck
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      this.onError(err);
      this._playNext();
    }
  }

  /**
   * Barge-in cancellation:
   * Immediately stops current speech and drops all queued audio.
   * Returns playback status for checkpointing.
   * @returns {{ sourceTurnId: string|null, lastSpokenSegmentIndex: number }}
   */
  cancel() {
    this.cancelled = true;
    this.isSpeaking = false;
    this.queue = [];
    this.streamBuffer = '';

    if (this.isSupported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }

    this._retainedUtterance = null;
    const current = this.currentSegment;
    this.currentSegment = null;

    return {
      sourceTurnId: this.currentTurnId,
      lastSpokenSegmentIndex: this.lastConfirmedSegmentIndex,
      interruptedSegment: current,
    };
  }

  /**
   * Speak a test phrase directly to verify audio output
   * @param {string} text
   * @returns {boolean}
   */
  testVoice(text = 'Hello! Your voice assistant audio is working loud and clear.') {
    if (!this.isSupported) return false;
    this.cancel();
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    if (!this.selectedVoice) {
      this._loadPreferredVoice();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    if (this.selectedVoice) {
      utterance.voice = this.selectedVoice;
      utterance.lang = this.selectedVoice.lang || 'en-US';
    } else {
      utterance.lang = 'en-US';
    }
    utterance.volume = this.volume;
    utterance.rate = this.rate;
    utterance.pitch = this.pitch;
    this._retainedUtterance = utterance;
    utterance.onend = () => {
      this._retainedUtterance = null;
    };
    utterance.onerror = (e) => {
      this._retainedUtterance = null;
      console.warn('testVoice error:', e);
    };
    window.speechSynthesis.speak(utterance);
    return true;
  }
}
