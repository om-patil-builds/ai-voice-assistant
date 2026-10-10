import { detectLanguage, normalizeLanguageCode } from '../services/languageDetector.js';

export class TTSPlayer {
  /**
   * @param {Object} options
   * @param {string} [options.apiBaseUrl] - Base URL for Marathi Neural TTS API
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

    const apiBase =
      options.apiBaseUrl ||
      (typeof window !== 'undefined' && window.__API_BASE_URL__) ||
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
      'http://localhost:5000';
    this.apiBaseUrl = apiBase;

    this.queue = [];
    this.activeUtterance = null;
    this.currentAudio = null;
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
    this.preferredMarathiVoice = 'mr-IN-AarohiNeural';

    // Stream buffer for feeding LLM tokens
    this.streamBuffer = '';
    this.nextSegmentIndex = 0;

    // Check browser speech synthesis support
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
   * Get available voices including natural Marathi neural voices
   * @returns {Array}
   */
  getVoices() {
    const browserVoices = (this.isSupported && window.speechSynthesis.getVoices()) || [];
    const neuralVoices = [
      {
        voiceURI: 'mr-IN-AarohiNeural',
        name: 'Marathi (Aarohi Neural - mr-IN)',
        lang: 'mr-IN',
        default: true,
      },
      {
        voiceURI: 'mr-IN-ManoharNeural',
        name: 'Marathi (Manohar Neural - mr-IN)',
        lang: 'mr-IN',
        default: false,
      },
    ];

    const result = [...neuralVoices];
    for (const v of browserVoices) {
      if (!result.some((r) => r.voiceURI === v.voiceURI)) {
        result.push(v);
      }
    }
    return result;
  }

  /**
   * Set specific voice by URI or Name
   * @param {string} voiceURI
   */
  setVoice(voiceURI) {
    if (!voiceURI) return;
    if (voiceURI === 'mr-IN-AarohiNeural' || voiceURI === 'mr-IN-ManoharNeural') {
      this.preferredMarathiVoice = voiceURI;
      return;
    }
    if (!this.isSupported) return;
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
    if (this.currentAudio) {
      this.currentAudio.muted = this.isMuted;
    }
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
    if (this.currentAudio) {
      this.currentAudio.volume = this.volume;
    }
  }

  /**
   * Set speech rate (0.5 to 2.0)
   * @param {number} rate
   */
  setRate(rate) {
    this.rate = Math.max(0.5, Math.min(2.0, rate));
    if (this.currentAudio) {
      this.currentAudio.playbackRate = this.rate;
    }
  }

  /**
   * Reset player for a new turn
   * @param {string} turnId
   * @param {number} [startIndex=0]
   */
  resetForTurn(turnId, startIndex = 0) {
    this.cancel();
    this.currentTurnId = turnId;
    this.lastConfirmedSegmentIndex = startIndex - 1;
    this.streamBuffer = '';
    this.nextSegmentIndex = startIndex;
    this.cancelled = false;
  }

  /**
   * Resolve best matching SpeechSynthesisVoice and BCP-47 lang tag for a segment
   * @param {Object} seg
   * @returns {{ voice: SpeechSynthesisVoice|null, lang: string }}
   */
  resolveVoiceAndLang(seg) {
    if (!this.isSupported) return { voice: null, lang: 'en-US' };
    const voices = window.speechSynthesis.getVoices() || [];
    const targetLang = seg.language ? normalizeLanguageCode(seg.language) : detectLanguage(seg.text);

    if (targetLang === 'mr') {
      // 1. Look for genuine Marathi voice
      const mrVoice = voices.find(
        (v) => (v.lang && (v.lang === 'mr-IN' || v.lang.startsWith('mr'))) || v.name.toLowerCase().includes('marathi')
      );
      if (mrVoice) {
        return { voice: mrVoice, lang: 'mr-IN' };
      }
      // 2. Fallback to Hindi voice if available
      const hiVoice = voices.find(
        (v) => (v.lang && (v.lang === 'hi-IN' || v.lang.startsWith('hi'))) || v.name.toLowerCase().includes('hindi')
      );
      if (hiVoice) {
        return { voice: hiVoice, lang: 'mr-IN' };
      }
      // 3. Fallback to Indian English or default
      const inVoice = voices.find((v) => v.lang && v.lang.includes('-IN'));
      return { voice: inVoice || this.selectedVoice || voices[0] || null, lang: 'mr-IN' };
    }

    if (targetLang === 'hi') {
      // Look for Hindi voice
      const hiVoice = voices.find(
        (v) => (v.lang && (v.lang === 'hi-IN' || v.lang.startsWith('hi'))) || v.name.toLowerCase().includes('hindi')
      );
      if (hiVoice) {
        return { voice: hiVoice, lang: hiVoice.lang || 'hi-IN' };
      }
      // Fallback to Indian English or default
      const inVoice = voices.find((v) => v.lang && v.lang.includes('-IN'));
      return { voice: inVoice || this.selectedVoice || voices[0] || null, lang: 'hi-IN' };
    }

    // Default English
    return {
      voice: this.selectedVoice || voices.find((v) => v.lang.startsWith('en')) || voices[0] || null,
      lang: this.selectedVoice?.lang || 'en-US',
    };
  }

  /**
   * Enqueue a discrete sentence segment to be spoken
   * @param {string} text
   * @param {number} segmentIndex
   * @param {string} turnId
   * @param {string} [language]
   */
  enqueueSegment(text, segmentIndex, turnId, language = null) {
    if (this.cancelled && this.currentTurnId === turnId) return;
    const cleanText = text.trim();
    if (!cleanText) return;

    this.queue.push({
      text: cleanText,
      segmentIndex,
      turnId,
      language,
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
   * @param {string} [language]
   */
  feedDelta(delta, turnId, isFinal = false, language = null) {
    if (this.currentTurnId !== turnId) {
      this.resetForTurn(turnId);
    }

    this.streamBuffer += delta;

    // Sentence delimiters: period, exclamation mark, question mark, newline followed by whitespace,
    // plus Devanagari Purna Viram (।) and double Purna Viram (॥)
    const sentenceEndRegex = /([.!?\n\u0964\u0965]+)\s+/g;
    let match;
    let lastIndex = 0;

    while ((match = sentenceEndRegex.exec(this.streamBuffer)) !== null) {
      const sentenceText = this.streamBuffer.slice(lastIndex, match.index + match[1].length).trim();
      lastIndex = match.index + match[0].length;

      if (sentenceText) {
        this.enqueueSegment(sentenceText, this.nextSegmentIndex++, turnId, language);
      }
    }

    if (lastIndex > 0) {
      this.streamBuffer = this.streamBuffer.slice(lastIndex);
    }

    if (isFinal && this.streamBuffer.trim()) {
      // Speak any remaining text in buffer
      this.enqueueSegment(this.streamBuffer.trim(), this.nextSegmentIndex++, turnId, language);
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

    // If neither Web Speech API nor HTML5 Audio is available (e.g. Node tests), advance queue smoothly
    if (!this.isSupported && typeof Audio === 'undefined') {
      const seg = this.queue.shift();
      this.lastConfirmedSegmentIndex = seg.segmentIndex;
      this.onSegmentStart(seg);
      this.onSegmentEnd(seg);
      this._playNext();
      return;
    }

    const seg = this.queue.shift();
    this.currentSegment = seg;
    this.isSpeaking = true;
    this.cancelled = false;

    const targetLang = seg.language ? normalizeLanguageCode(seg.language) : detectLanguage(seg.text);

    // Use dedicated Neural Marathi TTS when target language is Marathi
    if (targetLang === 'mr' && typeof Audio !== 'undefined') {
      this._playMarathiAudio(seg);
    } else if (this.isSupported) {
      this._playSpeechSynthesis(seg);
    } else {
      this.lastConfirmedSegmentIndex = seg.segmentIndex;
      this.onSegmentStart(seg);
      this.onSegmentEnd(seg);
      this._playNext();
    }
  }

  /**
   * Synthesize and stream authentic Marathi speech using high-fidelity neural voice
   * @param {Object} seg
   */
  _playMarathiAudio(seg) {
    const voice = this.preferredMarathiVoice || 'mr-IN-AarohiNeural';
    const rate = this.rate || 1.0;
    const url = `${this.apiBaseUrl.replace(/\/$/, '')}/api/tts?text=${encodeURIComponent(seg.text)}&voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(rate)}`;

    const audio = new Audio(url);
    audio.volume = this.volume;
    audio.playbackRate = this.rate;
    this.currentAudio = audio;

    audio.onplay = () => {
      if (this.cancelled) {
        audio.pause();
        return;
      }
      this.onSegmentStart(seg);
      this._preloadNextIfMarathi();
    };

    audio.onended = () => {
      this.currentAudio = null;
      if (this.cancelled) return;
      this.lastConfirmedSegmentIndex = seg.segmentIndex;
      this.onSegmentEnd(seg);
      this._playNext();
    };

    audio.onerror = (e) => {
      this.currentAudio = null;
      if (this.cancelled) return;
      console.warn('Marathi Neural TTS audio error, falling back to speech synthesis:', e);
      if (this.isSupported) {
        this._playSpeechSynthesis(seg);
      } else {
        this._playNext();
      }
    };

    audio.play().catch((err) => {
      this.currentAudio = null;
      if (this.cancelled) return;
      console.warn('Audio play() failed, falling back to speech synthesis:', err);
      if (this.isSupported) {
        this._playSpeechSynthesis(seg);
      } else {
        this._playNext();
      }
    });
  }

  /**
   * Preload audio for next Marathi segment to eliminate inter-sentence gap
   */
  _preloadNextIfMarathi() {
    if (this.queue.length > 0 && typeof Audio !== 'undefined') {
      const nextSeg = this.queue[0];
      const nextLang = nextSeg.language ? normalizeLanguageCode(nextSeg.language) : detectLanguage(nextSeg.text);
      if (nextLang === 'mr') {
        const voice = this.preferredMarathiVoice || 'mr-IN-AarohiNeural';
        const rate = this.rate || 1.0;
        const preUrl = `${this.apiBaseUrl.replace(/\/$/, '')}/api/tts?text=${encodeURIComponent(nextSeg.text)}&voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(rate)}`;
        const preAudio = new Audio(preUrl);
        preAudio.preload = 'auto';
      }
    }
  }

  /**
   * Speak via browser Web Speech API (used for English, Hindi, and Marathi offline fallback)
   * @param {Object} seg
   */
  _playSpeechSynthesis(seg) {
    try {
      if (!this.selectedVoice) {
        this._loadPreferredVoice();
      }

      const { voice, lang } = this.resolveVoiceAndLang(seg);
      const utterance = new SpeechSynthesisUtterance(seg.text);
      if (voice) {
        utterance.voice = voice;
      }
      utterance.lang = lang;
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
   * @returns {{ sourceTurnId: string|null, lastSpokenSegmentIndex: number, interruptedSegment: Object|null }}
   */
  cancel() {
    this.cancelled = true;
    this.isSpeaking = false;
    this.queue = [];
    this.streamBuffer = '';

    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {
        // ignore
      }
      this.currentAudio = null;
    }

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
    this.cancel();
    const targetLang = detectLanguage(text);

    if (targetLang === 'mr' && typeof Audio !== 'undefined') {
      const voice = this.preferredMarathiVoice || 'mr-IN-AarohiNeural';
      const rate = this.rate || 1.0;
      const url = `${this.apiBaseUrl.replace(/\/$/, '')}/api/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(rate)}`;
      const audio = new Audio(url);
      audio.volume = this.volume;
      audio.playbackRate = this.rate;
      this.currentAudio = audio;
      audio.onended = () => { this.currentAudio = null; };
      audio.onerror = () => { this.currentAudio = null; };
      audio.play().catch(() => {});
      return true;
    }

    if (!this.isSupported) return false;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    if (!this.selectedVoice) {
      this._loadPreferredVoice();
    }
    const { voice, lang } = this.resolveVoiceAndLang({ text });
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) {
      utterance.voice = voice;
    }
    utterance.lang = lang;
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
