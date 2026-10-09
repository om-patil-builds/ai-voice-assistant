/**
 * PlaybackCursor tracks confirmed spoken segments and manages paused response states
 * for interruption recovery and "continue" command resumption.
 */

export class PlaybackCursor {
  constructor() {
    this.currentTurnId = null;
    this.segments = []; // [{ index: number, text: string }]
    this.lastSpokenSegmentIndex = -1;
    this.generatedText = '';
    this.generationComplete = false;

    // Stored paused response when interrupted
    this.pausedResponse = null;
  }

  /**
   * Reset for a new active turn
   * @param {string} turnId
   */
  initTurn(turnId) {
    this.currentTurnId = turnId;
    this.segments = [];
    this.lastSpokenSegmentIndex = -1;
    this.generatedText = '';
    this.generationComplete = false;
  }

  /**
   * Register a segment for the current turn
   * @param {number} index
   * @param {string} text
   */
  addSegment(index, text) {
    const existing = this.segments.find((s) => s.index === index);
    if (!existing) {
      this.segments.push({ index, text });
      this.segments.sort((a, b) => a.index - b.index);
    }
  }

  /**
   * Confirm that a segment has finished playback
   * @param {number} segmentIndex
   */
  confirmSegment(segmentIndex) {
    if (segmentIndex > this.lastSpokenSegmentIndex) {
      this.lastSpokenSegmentIndex = segmentIndex;
    }
    // Also update pausedResponse if currently stored for this turn
    if (this.pausedResponse && this.pausedResponse.sourceTurnId === this.currentTurnId) {
      this.pausedResponse.lastSpokenSegmentIndex = this.lastSpokenSegmentIndex;
    }
  }

  /**
   * Update the accumulated generated text for current turn
   * @param {string} text
   */
  setGeneratedText(text) {
    this.generatedText = text;
  }

  /**
   * Mark LLM generation as complete for this turn
   */
  markGenerationComplete() {
    this.generationComplete = true;
    if (this.pausedResponse && this.pausedResponse.sourceTurnId === this.currentTurnId) {
      this.pausedResponse.generationComplete = true;
    }
  }

  /**
   * Save interrupted state
   * @param {string} turnId
   * @param {string} generatedText
   * @param {number} lastSpokenIndex
   * @param {boolean} [generationComplete=false]
   * @returns {Object} pausedResponse
   */
  savePausedState(turnId, generatedText, lastSpokenIndex, generationComplete = false) {
    this.pausedResponse = {
      sourceTurnId: turnId || this.currentTurnId,
      generatedText: generatedText || this.generatedText,
      lastSpokenSegmentIndex: typeof lastSpokenIndex === 'number' ? lastSpokenIndex : this.lastSpokenSegmentIndex,
      generationComplete: Boolean(generationComplete || this.generationComplete),
      segments: [...this.segments],
      timestamp: Date.now(),
    };
    return this.pausedResponse;
  }

  /**
   * Retrieve the active paused response
   * @returns {Object|null}
   */
  getPausedResponse() {
    return this.pausedResponse;
  }

  /**
   * Check if there is an interrupted response available to resume
   * @returns {boolean}
   */
  hasPausedResponse() {
    if (!this.pausedResponse) return false;
    // Check if there are remaining unspoken segments
    const remaining = this.getRemainingSegments();
    return remaining.length > 0 || !this.pausedResponse.generationComplete;
  }

  /**
   * Get unspoken segments from the paused response
   * @returns {Array<{ index: number, text: string }>}
   */
  getRemainingSegments() {
    if (!this.pausedResponse) return [];
    const lastSpoken = this.pausedResponse.lastSpokenSegmentIndex;
    return this.pausedResponse.segments.filter((s) => s.index > lastSpoken);
  }

  /**
   * Get remaining unspoken text
   * @returns {string}
   */
  getRemainingText() {
    const remainingSegments = this.getRemainingSegments();
    if (remainingSegments.length > 0) {
      return remainingSegments.map((s) => s.text).join(' ');
    }
    return '';
  }

  /**
   * Clear paused state once resumed or overwritten
   */
  clearPausedState() {
    this.pausedResponse = null;
  }

  /**
   * Restore state from backend session (GET /api/sessions/:id)
   * @param {Object} data
   */
  restoreState(data) {
    if (!data) return;
    if (data.pausedResponse) {
      this.pausedResponse = {
        sourceTurnId: data.pausedResponse.sourceTurnId || null,
        generatedText: data.pausedResponse.generatedText || '',
        lastSpokenSegmentIndex: data.pausedResponse.lastSpokenSegmentIndex ?? -1,
        generationComplete: Boolean(data.pausedResponse.generationComplete),
        segments: data.pausedResponse.segments || [],
        timestamp: data.pausedResponse.timestamp || Date.now(),
      };
      this.lastSpokenSegmentIndex = this.pausedResponse.lastSpokenSegmentIndex;
      this.currentTurnId = this.pausedResponse.sourceTurnId;
      this.segments = this.pausedResponse.segments;
    }
  }
}
