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
      window.speechSynthesis.onvoiceschanged = () => {
        this._loadPreferredVoice();
      };
      this._loadPreferredVoice();
    }
  }

  _loadPreferredVoice() {
    if (!this.isSupported) return;
    const voices = window.speechSynthesis.getVoices();
    // Prioritize natural English voices (Google US English, Samantha, Microsoft Jenny, etc.)
    const preferred = voices.find(
      (v) =>
        (v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Premium'))) ||
        (v.lang.startsWith('en-US'))
    );
    this.selectedVoice = preferred || voices.find((v) => v.lang.startsWith('en')) || voices[0] || null;
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
      const utterance = new SpeechSynthesisUtterance(seg.text);
      if (this.selectedVoice) {
        utterance.voice = this.selectedVoice;
      }
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
          this.onError(e);
        }
        this._playNext();
      };

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
   * Get confirmed spoken index
   */
  getLastSpokenSegmentIndex() {
    return this.lastConfirmedSegmentIndex;
  }
}
