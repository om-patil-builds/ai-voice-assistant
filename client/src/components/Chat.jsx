import { useEffect, useRef } from 'react';

/**
 * Chat component displaying the conversation transcript,
 * live user streaming transcript, streaming assistant deltas,
 * interruption markers, and playback checkpoints.
 */
export function Chat({
  messages = [],
  status,
  onRepeat,
  onSuggestionClick,
}) {
  const messagesEndRef = useRef(null);

  // Auto-scroll on new message content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  const suggestions = [
    'MERN Stack',
    'Explain MERN Stack and how its technologies work together',
    'How do Express.js and Node.js handle REST APIs?',
    'What are the advantages of MongoDB compared to SQL databases?',
  ];

  return (
    <div id="chat-container" className="chat-container">
      {messages.length === 0 ? (
        <div id="chat-empty-state" className="chat-empty-state">
          <div className="empty-state-icon">🎙️</div>
          <h2>Real-Time AI Voice Assistant</h2>
          <p>
            Experience lightning-fast conversational voice with instant barge-in.
            Speak naturally, interrupt anytime, and say <em>"continue"</em> to resume.
          </p>

          <div className="suggestions-grid">
            <span className="suggestions-title">Try asking:</span>
            <div className="suggestions-list">
              {suggestions.map((prompt, idx) => (
                <button
                  key={idx}
                  id={`suggestion-btn-${idx}`}
                  type="button"
                  className="suggestion-pill"
                  onClick={() => onSuggestionClick && onSuggestionClick(prompt)}
                >
                  "{prompt}"
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div id="messages-list" className="messages-list">
          {messages.map((msg) => {
            const isUser = msg.sender === 'user';
            const isInterrupted = msg.status === 'interrupted';
            const isStreaming = msg.status === 'streaming';

            return (
              <div
                key={msg.id}
                id={`message-${msg.id}`}
                className={`message-row ${isUser ? 'message-user' : 'message-assistant'}`}
              >
                <div className="message-avatar" aria-hidden="true">
                  {isUser ? '👤' : '🤖'}
                </div>

                <div className="message-bubble-wrapper">
                  <div className="message-header">
                    <span className="sender-name">{isUser ? 'You' : 'Assistant'}</span>
                    {msg.timestamp && (
                      <span className="message-time">
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                  </div>

                  <div className="message-bubble">
                    <p className="message-text">
                      {msg.text || (isStreaming ? '...' : '')}
                    </p>

                    {/* Streaming typing cursor */}
                    {isStreaming && (
                      <span className="streaming-cursor" aria-hidden="true">
                        ▌
                      </span>
                    )}

                    {/* Interrupted Checkpoint Badge */}
                    {isInterrupted && (
                      <div className="checkpoint-badge" title="Response was interrupted mid-speech">
                        <span className="badge-icon">⚡</span>
                        <span>
                          Interrupted
                          {typeof msg.lastSpokenSegmentIndex === 'number' && msg.lastSpokenSegmentIndex >= 0
                            ? ` (spoken up to sentence ${msg.lastSpokenSegmentIndex + 1})`
                            : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions for Assistant Messages */}
                  {!isUser && msg.text && !isStreaming && (
                    <div className="message-actions">
                      <button
                        type="button"
                        className="btn-msg-action"
                        onClick={() => onRepeat && onRepeat(msg.text)}
                        title="Replay this answer"
                      >
                        🔊 Replay
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  );
}

export default Chat;
