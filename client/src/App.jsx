import { useVoiceSession } from './hooks/useVoiceSession.js';
import { Status } from './components/Status.jsx';
import { Chat } from './components/Chat.jsx';
import { VoiceControls } from './components/VoiceControls.jsx';
import './App.css';

export function App() {
  const {
    status,
    messages,
    isMuted,
    errorMessage,
    connectionStatus,
    silenceTimeoutMs,
    pausedResponse,
    telemetry,
    audioLevel,
    isListening,
    isRecording,
    hasPermission,
    permissionError,
    toggleListening,
    startTurnWithText,
    handleContinueResponse,
    handleRepeatLastResponse,
    toggleMute,
    clearChat,
    stopSession,
    setSilenceTimeout,
    dismissError,
  } = useVoiceSession();

  const handleQuickCommand = (cmd) => {
    switch (cmd) {
      case 'CONTINUE':
        handleContinueResponse();
        break;
      case 'REPEAT':
        handleRepeatLastResponse();
        break;
      case 'STOP':
        stopSession();
        break;
      default:
        break;
    }
  };

  const handleRepeatMessageText = (text) => {
    if (text) {
      window.speechSynthesis?.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis?.speak(utterance);
    }
  };

  return (
    <div className="voice-assistant-app" id="voice-assistant-app">
      {/* Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="logo-badge">🎙️</div>
          <div>
            <h1 className="app-title">Real-Time AI Voice Assistant</h1>
            <p className="app-subtitle">MERN • Groq Whisper • Fast Streaming LLM • Barge-In Ready</p>
          </div>
        </div>

        <div className="header-tags">
          <span className="tag-badge">Sub-250ms Barge-In</span>
          <span className="tag-badge">Sentence Streaming TTS</span>
        </div>
      </header>

      {/* Main Body */}
      <main className="app-main">
        {/* State and Telemetry Status Bar */}
        <Status
          status={status}
          connectionStatus={connectionStatus}
          audioLevel={audioLevel}
          errorMessage={errorMessage}
          onDismissError={dismissError}
          telemetry={telemetry}
          hasPausedResponse={Boolean(pausedResponse)}
          onContinue={handleContinueResponse}
        />

        {/* Conversation Transcript */}
        <Chat
          messages={messages}
          status={status}
          onRepeat={handleRepeatMessageText}
          onSuggestionClick={(prompt) => startTurnWithText(prompt, 'text')}
        />

        {/* Voice and Text Input Controls */}
        <VoiceControls
          isListening={isListening}
          isRecording={isRecording}
          audioLevel={audioLevel}
          isMuted={isMuted}
          hasPermission={hasPermission}
          permissionError={permissionError}
          silenceTimeoutMs={silenceTimeoutMs}
          onToggleListening={toggleListening}
          onSendText={(text) => startTurnWithText(text, 'text')}
          onToggleMute={toggleMute}
          onClearChat={clearChat}
          onSetSilenceTimeout={setSilenceTimeout}
          onQuickCommand={handleQuickCommand}
        />
      </main>
    </div>
  );
}

export default App;
