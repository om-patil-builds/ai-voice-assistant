/**
 * Status component displaying current deterministic state machine status,
 * speaking wave animations, WebSocket connection indicator, and telemetry.
 */
export function Status({
  status,
  connectionStatus,
  audioLevel = 0,
  errorMessage,
  onDismissError,
  telemetry = {},
  hasPausedResponse = false,
  onContinue,
}) {
  const getStatusBadge = () => {
    switch (status) {
      case 'LISTENING':
        return {
          label: 'Listening',
          description: 'Speak now — speech detection active',
          className: 'state-listening',
        };
      case 'TRANSCRIBING':
        return {
          label: 'Transcribing',
          description: 'Processing speech with Groq Whisper...',
          className: 'state-transcribing',
        };
      case 'THINKING':
        return {
          label: 'Thinking',
          description: 'Streaming response from Groq LLM...',
          className: 'state-thinking',
        };
      case 'SPEAKING':
        return {
          label: 'Speaking',
          description: 'AI speaking (barge-in enabled — speak to interrupt)',
          className: 'state-speaking',
        };
      case 'INTERRUPTED':
      case 'PAUSED':
        return {
          label: 'Paused',
          description: 'Interrupted. Say "continue" or click below to resume.',
          className: 'state-paused',
        };
      case 'ERROR':
        return {
          label: 'Error',
          description: 'Encountered an issue',
          className: 'state-error',
        };
      case 'IDLE':
      default:
        return {
          label: 'Ready',
          description: 'Click microphone or type a question',
          className: 'state-idle',
        };
    }
  };

  const badge = getStatusBadge();

  return (
    <div id="status-container" className="status-container">
      <div className="status-header">
        <div className="status-badge-wrapper">
          <span className={`status-pill ${badge.className}`} id="status-badge">
            <span className="status-dot"></span>
            <span className="status-label">{badge.label}</span>
          </span>

          <span className="status-description">{badge.description}</span>
        </div>

        <div className="status-meta">
          {/* WebSocket Connection Indicator */}
          <div
            id="ws-status"
            className={`connection-indicator connection-${connectionStatus}`}
            title={`WebSocket: ${connectionStatus}`}
          >
            <span className="indicator-dot"></span>
            <span className="indicator-text">{connectionStatus}</span>
          </div>

          {/* Telemetry latency metrics */}
          {telemetry.sttLatencyMs && (
            <span className="telemetry-pill" title="Speech-to-text latency">
              STT: {telemetry.sttLatencyMs}ms
            </span>
          )}
          {telemetry.firstTokenLatencyMs && (
            <span className="telemetry-pill" title="Time to first LLM token">
              TTFT: {telemetry.firstTokenLatencyMs}ms
            </span>
          )}
        </div>
      </div>

      {/* Speaking Animation / Audio Wave */}
      {status === 'SPEAKING' && (
        <div id="speaking-visualizer" className="speaking-visualizer" aria-label="AI is speaking">
          <div className="wave-bar bar-1"></div>
          <div className="wave-bar bar-2"></div>
          <div className="wave-bar bar-3"></div>
          <div className="wave-bar bar-4"></div>
          <div className="wave-bar bar-5"></div>
          <div className="wave-bar bar-6"></div>
          <div className="wave-bar bar-7"></div>
        </div>
      )}

      {/* Listening Sound Level Visualizer */}
      {status === 'LISTENING' && (
        <div id="listening-visualizer" className="listening-visualizer" aria-label="Microphone active">
          <div
            className="level-meter-bar"
            style={{ width: `${Math.min(100, Math.max(8, audioLevel * 100))}%` }}
          ></div>
        </div>
      )}

      {/* Paused Checkpoint Banner */}
      {hasPausedResponse && status !== 'SPEAKING' && status !== 'THINKING' && (
        <div id="paused-checkpoint-banner" className="paused-banner">
          <div className="paused-content">
            <span className="paused-icon">⏸️</span>
            <span>Unspoken response available. Say <strong>"continue"</strong> or click resume:</span>
          </div>
          <button
            id="resume-btn"
            type="button"
            className="btn-resume"
            onClick={onContinue}
          >
            ▶ Continue Response
          </button>
        </div>
      )}

      {/* Error Message Alert */}
      {errorMessage && (
        <div id="error-banner" className="error-banner" role="alert">
          <span className="error-icon">⚠️</span>
          <span className="error-text">{errorMessage}</span>
          {onDismissError && (
            <button
              id="dismiss-error-btn"
              type="button"
              className="btn-dismiss-error"
              onClick={onDismissError}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default Status;
