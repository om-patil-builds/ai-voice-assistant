import { useState } from 'react';

/**
 * VoiceControls component provides microphone toggle, text input fallback,
 * mute, clear chat, quick voice commands, configurable silence timeout,
 * voice volume, and speech rate controls (spec requirements).
 */
export function VoiceControls({
  isListening,
  isRecording,
  audioLevel = 0,
  isMuted,
  permissionError,
  silenceTimeoutMs = 600,
  ttsVolume = 1.0,
  ttsRate = 1.0,
  voices = [],
  selectedVoiceURI = '',
  onToggleListening,
  onSendText,
  onToggleMute,
  onClearChat,
  onSetSilenceTimeout,
  onSetVolume,
  onSetRate,
  onSetVoice,
  onQuickCommand,
  onTestAudio,
}) {
  const [inputText, setInputText] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const handleTextSubmit = (e) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    const trimmed = inputText.trim();
    if (!trimmed) return;
    setInputText('');
    onSendText(trimmed);
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
          title="Configure voice settings"
        >
          ⚙️ Settings
        </button>
      </div>

      {/* Settings Drawer (silence timeout, volume, speech rate) */}
      {showSettings && (
        <div id="vad-settings-panel" className="settings-panel">
          {/* Silence Timeout */}
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

          {/* Voice Volume */}
          <div className="settings-row" style={{ marginTop: '0.65rem' }}>
            <label htmlFor="volume-slider" className="settings-label">
              Voice Volume: <strong>{Math.round(ttsVolume * 100)}%</strong>
            </label>
            <div className="slider-wrapper">
              <span>0%</span>
              <input
                id="volume-slider"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={ttsVolume}
                onChange={(e) => onSetVolume && onSetVolume(Number(e.target.value))}
                className="range-slider"
                aria-label="Voice output volume"
              />
              <span>100%</span>
            </div>
          </div>

          {/* Speech Rate */}
          <div className="settings-row" style={{ marginTop: '0.65rem' }}>
            <label htmlFor="rate-slider" className="settings-label">
              Speech Rate: <strong>{Number(ttsRate).toFixed(1)}×</strong>
            </label>
            <div className="slider-wrapper">
              <span>0.5×</span>
              <input
                id="rate-slider"
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={ttsRate}
                onChange={(e) => onSetRate && onSetRate(Number(e.target.value))}
                className="range-slider"
                aria-label="Speech rate"
              />
              <span>2.0×</span>
            </div>
            <span className="settings-hint">
              Adjust how fast the assistant speaks. 1.0× is normal speed.
            </span>
          </div>

          {/* Natural Voice Selection */}
          {voices && voices.length > 0 && (
            <div className="settings-row" style={{ marginTop: '0.65rem' }}>
              <label htmlFor="voice-select" className="settings-label">
                Natural Voice: <strong>{voices.find((v) => v.voiceURI === selectedVoiceURI)?.name || 'Default'}</strong>
              </label>
              <select
                id="voice-select"
                className="settings-select"
                value={selectedVoiceURI || ''}
                onChange={(e) => onSetVoice && onSetVoice(e.target.value)}
                aria-label="Select Assistant Voice"
              >
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              <span className="settings-hint">
                Select from system and browser natural neural voices.
              </span>
            </div>
          )}

          {/* Test Audio Output */}
          {onTestAudio && (
            <div style={{ marginTop: '0.65rem' }}>
              <button
                id="test-audio-btn"
                type="button"
                className="cmd-pill"
                onClick={onTestAudio}
                title="Play a test phrase to verify audio output"
              >
                🔈 Test Audio Output
              </button>
            </div>
          )}
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

        {/* Auxiliary Controls (Clear Chat) */}
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
