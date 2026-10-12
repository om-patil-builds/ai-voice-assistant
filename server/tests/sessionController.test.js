import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionController } from '../src/modules/voice/sessionController.js';

test('SessionController - session creation, message persistence, and state retrieval', async () => {
  const sessionId = 'test_session_' + Date.now();

  // 1. Initially no session exists
  const initial = await SessionController.getSessionData(sessionId);
  assert.equal(initial, null);

  // 2. Initialize session
  const session = await SessionController.getOrCreateSession(sessionId);
  assert.equal(session.sessionId, sessionId);

  // 3. Save user message
  await SessionController.saveUserMessage(sessionId, 'turn_1', 'Hello assistant');

  // 4. Save assistant message
  await SessionController.saveAssistantMessage(sessionId, 'turn_1', 'Hello user! How can I help?', 'completed', 0);

  // 5. Update paused response
  await SessionController.updatePausedResponse(sessionId, {
    sourceTurnId: 'turn_1',
    generatedText: 'Hello user! How can I help?',
    lastSpokenSegmentIndex: 0,
    generationComplete: true,
    segments: [{ index: 0, text: 'Hello user! How can I help?' }],
    timestamp: Date.now(),
  });

  // 6. Verify full restored session structure
  const restored = await SessionController.getSessionData(sessionId);
  assert.ok(restored);
  assert.equal(restored.id, sessionId);
  assert.equal(restored.messages.length, 2);
  assert.equal(restored.messages[0].sender, 'user');
  assert.equal(restored.messages[0].text, 'Hello assistant');
  assert.equal(restored.messages[1].sender, 'assistant');
  assert.equal(restored.messages[1].text, 'Hello user! How can I help?');
  assert.ok(restored.pausedResponse);
  assert.equal(restored.pausedResponse.sourceTurnId, 'turn_1');

  // 7. Verify conversation history extraction
  const history = await SessionController.getConversationHistory(sessionId);
  assert.equal(history.length, 2);
  assert.equal(history[0].role, 'user');
  assert.equal(history[1].role, 'assistant');

  // 8. Clear session
  await SessionController.clearSession(sessionId);
  const cleared = await SessionController.getSessionData(sessionId);
  assert.equal(cleared.messages.length, 0);
  assert.equal(cleared.pausedResponse, null);
});
