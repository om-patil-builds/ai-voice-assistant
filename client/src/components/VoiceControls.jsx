import { useState } from 'react';

/**
 * VoiceControls component provides microphone toggle, text input fallback,
 * mute, clear chat, quick voice commands, and configurable silence timeout.
 */
export function VoiceControls({
  isListening,
  isRecording,
  audioLevel = 0,
  isMuted,
  permissionError,
  silenceTimeoutMs = 600,
  onToggleListening,
  onSendText,
  onToggleMute,
  onClearChat,
  onSetSilenceTimeout,
  onQuickCommand,
}) {
  const [inputText, setInputText] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendText(inputText.trim());
    setInputText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit(e);
    }
  };

  return (
    <div id="voice-controls-panel" className="voice-controls-panel">
      {/* Permission Warning Notice */}
      {permissionError && (
        <div id="permission-warning" className="permission-alert">
          <span>🔒 {permissionError}</span>
        </div>
      )}

      {/* Quick Voice Command Pills */}
      <div className="quick-commands-bar">
        <span className="quick-commands-label">Voice shortcuts:</span>
        <button
          type="button"
          id="cmd-continue"
          className="cmd-pill"
          onClick={() => onQuickCommand && onQuickCommand('CONTINUE')}
        >
          ▶ Continue
        </button>
        <button
          type="button"
          id="cmd-repeat"
          className="cmd-pill"
          onClick={() => onQuickCommand && onQuickCommand('REPEAT')}
        >
          🔁 Repeat that
        </button>
        <button
          type="button"
          id="cmd-stop"
          className="cmd-pill"
          onClick={() => onQuickCommand && onQuickCommand('STOP')}
        >
          ⏹ Stop
        </button>
        <button
          type="button"
          id="cmd-mute"
          className={`cmd-pill ${isMuted ? 'active' : ''}`}
          onClick={onToggleMute}
        >
          {isMuted ? '🔊 Unmute' : '🔇 Mute'}
        </button>
        <button
          type="button"
          id="cmd-settings"
          className="cmd-pill btn-settings-toggle"
          onClick={() => setShowSettings(!showSettings)}
          title="Configure VAD settings"
        >
          ⚙️ Settings
        </button>
      </div>

      {/* Settings Drawer (Configurable silence timeout 400-700ms) */}
      {showSettings && (
        <div id="vad-settings-panel" className="settings-panel">
          <div className="settings-row">
            <label htmlFor="silence-timeout-slider" className="settings-label">
              End-of-Speech Silence Timeout: <strong>{silenceTimeoutMs}ms</strong>
            </label>
            <div className="slider-wrapper">
              <span>400ms</span>
              <input
                id="silence-timeout-slider"
                type="range"
                min="400"
                max="800"
                step="50"
                value={silenceTimeoutMs}
                onChange={(e) => onSetSilenceTimeout(Number(e.target.value))}
                className="range-slider"
              />
              <span>800ms</span>
            </div>
            <span className="settings-hint">
              Spec target: 400–700ms. Shorter values respond faster; longer values prevent interruptions during pauses.
            </span>
          </div>
        </div>
      )}

      {/* Primary Interaction Area */}
      <div className="controls-main">
        {/* Microphone Primary Action Button */}
        <div className="mic-action-container">
          <button
            id="mic-toggle-btn"
            type="button"
            className={`mic-button ${isListening ? 'listening' : ''} ${isRecording ? 'recording' : ''}`}
            onClick={onToggleListening}
            aria-label={isListening ? 'Stop microphone' : 'Start microphone'}
            title={isListening ? 'Stop listening' : 'Start voice mode'}
          >
            {/* Visualizer ripple ring */}
            {isListening && (
              <span
                className="mic-pulse-ring"
                style={{
                  transform: `scale(${1 + Math.min(0.6, audioLevel * 1.2)})`,
                  opacity: Math.max(0.3, audioLevel),
                }}
              />
            )}
            <span className="mic-icon">
              {isListening ? (isRecording ? '🎙️' : '🎧') : '🎤'}
            </span>
          </button>
          <span className="mic-button-label">
            {isListening ? (isRecording ? 'Speaking...' : 'Listening...') : 'Click to Speak'}
          </span>
        </div>

        {/* Text Input Fallback Bar */}
        <form onSubmit={handleTextSubmit} className="text-input-form" id="text-input-form">
          <input
            id="text-input-fallback"
            type="text"
            className="text-input-field"
            placeholder="Type your message or query here..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Type message fallback"
          />
          <button
            id="send-text-btn"
            type="submit"
            className="btn-send-text"
            disabled={!inputText.trim()}
            title="Send text"
          >
            Send ➔
          </button>
        </form>

        {/* Auxiliary Controls (Clear Chat & Mute) */}
        <div className="aux-controls">
          <button
            id="clear-chat-btn"
            type="button"
            className="btn-aux"
            onClick={onClearChat}
            title="Clear conversation"
          >
            🗑️ Clear
          </button>
        </div>
      </div>
    </div>
  );
}

export default VoiceControls;
