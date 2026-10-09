/**
 * REST API client for Real-Time AI Voice Assistant.
 * Implements endpoints specified in spec.md:
 * - POST /api/transcriptions (audio file upload for Groq Whisper STT)
 * - GET /api/sessions/:id (retrieve session transcript and pausedResponse)
 * - GET /health (backend health check)
 */

const API_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:5000';

export class ApiClient {
  constructor(baseUrl = API_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Health check endpoint
   * @returns {Promise<{ status: string, message?: string }>}
   */
  async getHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Health check failed with status ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      throw new Error(`Backend unavailable: ${err.message}`, { cause: err });
    }
  }

  /**
   * Upload audio blob for transcription (POST /api/transcriptions)
   * @param {Blob} audioBlob
   * @param {string} [filename='speech.webm']
   * @returns {Promise<{ transcript: string, duration?: number, language?: string }>}
   */
  async uploadAudio(audioBlob, filename = 'speech.webm', options = {}) {
    if (!audioBlob || audioBlob.size === 0) {
      throw new Error('Audio data is empty or invalid.');
    }

    const formData = new FormData();
    formData.append('audio', audioBlob, filename);

    try {
      const response = await fetch(`${this.baseUrl}/api/transcriptions`, {
        method: 'POST',
        body: formData,
        signal: options.signal,
      });

      if (response.status === 429) {
        throw new Error('Rate limit exceeded (429). Please wait a moment before speaking again.');
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.message || errorBody.error || `Transcription request failed with status ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw err;
      }
      if (err.message.includes('Rate limit')) {
        throw err;
      }
      throw new Error(`STT API Error: ${err.message}`, { cause: err });
    }
  }

  /**
   * Retrieve session state from database (GET /api/sessions/:id)
   * Restores transcript and pausedResponse across page refreshes.
   * @param {string} sessionId
   * @returns {Promise<{ id: string, messages: Array, pausedResponse?: Object }>}
   */
  async getSession(sessionId) {
    if (!sessionId) {
      throw new Error('Session ID is required to fetch session.');
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.message || `Failed to fetch session (${response.status})`);
      }

      return await response.json();
    } catch (err) {
      // Return null if server is not reachable or endpoint not ready yet
      console.warn(`Could not restore session from server: ${err.message}`);
      return null;
    }
  }
  /**
   * Clear session history on the server (DELETE /api/sessions/:id)
   * Called by clearChat to prevent old messages from reappearing on refresh.
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async clearSession(sessionId) {
    if (!sessionId) return;
    try {
      await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.warn(`Could not clear server session: ${err.message}`);
    }
  }
}

export const apiClient = new ApiClient();
