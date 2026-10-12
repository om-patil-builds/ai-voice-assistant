/**
 * WebSocket client for Real-Time AI Voice Assistant.
 * Handles bidirectional streaming and event routing as defined in spec.md:
 *
 * Client Inputs:
 * - start_turn: { type: 'start_turn', turnId, seq, inputType, text }
 * - interrupt: { type: 'interrupt', turnId }
 * - continue: { type: 'continue', sourceTurnId, lastSpokenSegmentIndex }
 * - stop: { type: 'stop', turnId }
 *
 * Server Outputs:
 * - status: { type: 'status', state }
 * - user_transcript: { type: 'user_transcript', turnId, text, isFinal }
 * - assistant_delta: { type: 'assistant_delta', turnId, seq, delta }
 * - assistant_segment: { type: 'assistant_segment', turnId, segmentIndex, text }
 * - turn_complete: { type: 'turn_complete', turnId }
 * - error: { type: 'error', message, code }
 */

const DEFAULT_WS_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_URL) ||
  (typeof window !== 'undefined' && window.location?.protocol === 'https:' ? 'wss://localhost:5000' : 'ws://localhost:5000');

export class SocketClient {
  constructor(url = DEFAULT_WS_URL) {
    this.baseUrl = url;
    this.url = url;
    this.sessionId = null;
    this.socket = null;
    this.listeners = new Map(); // eventType -> Set of callbacks
    this.statusListeners = new Set(); // connection status callbacks

    this.reconnectAttempts = 0;
    this.maxReconnectDelayMs = 8000;
    this.reconnectTimer = null;
    this.isManuallyClosed = false;

    this.connectionState = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'error'
  }

  /**
   * Set the session ID before connecting — embeds it in the WebSocket URL
   * @param {string} sessionId
   */
  setSessionId(sessionId) {
    this.sessionId = sessionId;
    if (sessionId) {
      this.url = `${this.baseUrl}?sessionId=${encodeURIComponent(sessionId)}`;
    } else {
      this.url = this.baseUrl;
    }
  }

  /**
   * Subscribe to connection state changes
   * @param {function(string): void} callback
   * @returns {function(): void} unsubscribe
   */
  onConnectionChange(callback) {
    this.statusListeners.add(callback);
    callback(this.connectionState);
    return () => this.statusListeners.delete(callback);
  }

  _setConnectionState(state) {
    if (this.connectionState !== state) {
      this.connectionState = state;
      for (const cb of this.statusListeners) {
        try {
          cb(state);
        } catch (e) {
          console.error('Error in connection listener:', e);
        }
      }
    }
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isManuallyClosed = false;
    this._setConnectionState('connecting');

    try {
      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        this.reconnectAttempts = 0;
        this._setConnectionState('connected');
      };

      this.socket.onmessage = (event) => {
        this._handleMessage(event.data);
      };

      this.socket.onerror = (err) => {
        this._setConnectionState('error');
        this._emit('error', { message: 'WebSocket connection encountered an error.', error: err });
      };

      this.socket.onclose = () => {
        this._setConnectionState('disconnected');
        if (!this.isManuallyClosed) {
          this._scheduleReconnect();
        }
      };
    } catch {
      this._setConnectionState('error');
      this._scheduleReconnect();
    }
  }

  /**
   * Disconnect manually
   */
  disconnect() {
    this.isManuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      const sock = this.socket;
      this.socket = null;
      if (sock.readyState === WebSocket.CONNECTING) {
        sock.onopen = () => {
          try {
            sock.close();
          } catch {
            // ignore
          }
        };
      } else if (sock.readyState === WebSocket.OPEN) {
        sock.close();
      }
    }
    this._setConnectionState('disconnected');
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.isManuallyClosed) return;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelayMs);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Parse and dispatch incoming message
   * @param {string} rawData
   */
  _handleMessage(rawData) {
    try {
      const data = JSON.parse(rawData);
      const eventType = data.type;
      if (eventType) {
        this._emit(eventType, data);
      }
    } catch (err) {
      console.warn('Failed to parse WebSocket message:', rawData, err);
    }
  }

  /**
   * Subscribe to specific event types
   * @param {string} eventType
   * @param {function(Object): void} callback
   * @returns {function(): void} unsubscribe
   */
  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType).add(callback);
    return () => {
      const set = this.listeners.get(eventType);
      if (set) {
        set.delete(callback);
      }
    };
  }

  /**
   * Emit internal event to subscribers
   */
  _emit(eventType, data) {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(data);
        } catch (e) {
          console.error(`Error in listener for ${eventType}:`, e);
        }
      }
    }
  }

  /**
   * Send JSON payload through WebSocket
   * @param {Object} payload
   * @returns {boolean} whether message was sent
   */
  send(payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
      return true;
    }
    console.warn('WebSocket not open. Unable to send:', payload);
    return false;
  }

  /**
   * Convenience sender for start_turn
   * @param {Object} params
   * @param {string} params.turnId
   * @param {number} params.seq
   * @param {'text'|'audio'} params.inputType
   * @param {string} [params.text]
   */
  startTurn({ turnId, seq = 0, inputType = 'text', text = '', language }) {
    const payload = {
      type: 'start_turn',
      turnId,
      seq,
      inputType,
      text,
    };
    if (language) {
      payload.language = language;
    }
    return this.send(payload);
  }

  /**
   * Convenience sender for interrupt
   * @param {string} turnId
   * @param {number} lastSpokenSegmentIndex
   */
  interrupt(turnId, lastSpokenSegmentIndex) {
    const payload = {
      type: 'interrupt',
      turnId,
    };
    if (typeof lastSpokenSegmentIndex === 'number') {
      payload.lastSpokenSegmentIndex = lastSpokenSegmentIndex;
    }
    console.log(
      `[SocketClient Trace] Emitting "interrupt" event | turnId=${turnId} | lastSpokenIndex=${lastSpokenSegmentIndex}`
    );
    return this.send(payload);
  }

  /**
   * Convenience sender for continue
   * @param {Object} params
   * @param {string} [params.turnId]
   * @param {string} params.sourceTurnId
   * @param {number} params.lastSpokenSegmentIndex
   */
  continueTurn({ turnId, sourceTurnId, lastSpokenSegmentIndex }) {
    const payload = {
      type: 'continue',
      sourceTurnId,
      lastSpokenSegmentIndex,
    };
    if (turnId) {
      payload.turnId = turnId;
    }
    return this.send(payload);
  }

  /**
   * Convenience sender for stop
   * @param {string} turnId
   */
  stop(turnId) {
    return this.send({
      type: 'stop',
      turnId,
    });
  }
}

export const socketClient = new SocketClient();
