import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnManager } from '../src/modules/voice/turnManager.js';
import { SessionController } from '../src/modules/voice/sessionController.js';

test('TurnManager - turn creation, cancellation, and barge-in interruption', async () => {
  const turnManager = new TurnManager();
  const sessionId = 'test_turn_session_' + Date.now();
  await SessionController.getOrCreateSession(sessionId);
  const emittedEvents = [];

  const sendEvent = (event) => {
    emittedEvents.push(event);
  };

  // 1. User says "stop" command
  await turnManager.startTurn({
    sessionId,
    turnId: 'turn_cmd_1',
    text: 'stop',
    inputType: 'text',
    sendEvent,
  });

  const stopStatus = emittedEvents.find((e) => e.type === 'status' && e.state === 'IDLE');
  assert.ok(stopStatus, 'Should transition to IDLE on stop command');

  // 2. Interruption on an active turn
  // Mock turn state in activeTurns
  const abortController = new AbortController();
  turnManager.activeTurns.set(sessionId, {
    turnId: 'turn_active_1',
    sessionId,
    inputType: 'text',
    text: 'Explain quantum physics',
    abortController,
    seq: 5,
    nextSegmentIndex: 2,
    generatedText: 'Quantum mechanics is a fundamental theory. It describes nature at atomic scales.',
    segments: [
      { index: 0, text: 'Quantum mechanics is a fundamental theory.' },
      { index: 1, text: 'It describes nature at atomic scales.' },
    ],
    isAborted: false,
  });

  // Barge-in occurs
  await turnManager.handleInterrupt({
    sessionId,
    turnId: 'turn_active_1',
    sendEvent,
  });

  // Controller must be aborted
  assert.ok(abortController.signal.aborted, 'AbortController should be aborted on interruption');

  // INTERRUPTED status emitted
  const interruptedStatus = emittedEvents.find((e) => e.type === 'status' && e.state === 'INTERRUPTED');
  assert.ok(interruptedStatus, 'Should emit INTERRUPTED status');

  // Session must contain paused checkpoint
  const sessionData = await SessionController.getSessionData(sessionId);
  assert.ok(sessionData.pausedResponse);
  assert.equal(sessionData.pausedResponse.sourceTurnId, 'turn_active_1');
  assert.equal(sessionData.pausedResponse.generationComplete, false);
  assert.equal(sessionData.pausedResponse.segments.length, 2);

  // 3. User says "continue"
  // Simulate client confirmed sentence 0 was spoken, sentence 1 is unspoken
  sessionData.pausedResponse.lastSpokenSegmentIndex = 0;
  sessionData.pausedResponse.generationComplete = true; // test completed response playback branch
  await SessionController.updatePausedResponse(sessionId, sessionData.pausedResponse);

  const continueEvents = [];
  await turnManager.handleContinue({
    sessionId,
    sourceTurnId: 'turn_active_1',
    lastSpokenSegmentIndex: 0,
    sendEvent: (ev) => continueEvents.push(ev),
  });

  // Should emit unspoken segment (index 1) and turn_complete
  const segment1Event = continueEvents.find(
    (e) => e.type === 'assistant_segment' && e.segmentIndex === 1
  );
  assert.ok(segment1Event, 'Should emit remaining unspoken segment');
  assert.equal(segment1Event.text, 'It describes nature at atomic scales.');

  const completeEvent = continueEvents.find((e) => e.type === 'turn_complete');
  assert.ok(completeEvent, 'Should emit turn_complete');
});

test('TurnManager - startTurn emits user_transcript event with correct payload', async () => {
  const turnManager = new TurnManager();
  const sessionId = 'test_transcript_session_' + Date.now();
  await SessionController.getOrCreateSession(sessionId);

  const emitted = [];
  const sendEvent = (event) => emitted.push(event);

  await turnManager.startTurn({
    sessionId,
    turnId: 'turn_transcript_1',
    text: 'My name is Om Patil.',
    inputType: 'audio',
    sendEvent,
  });

  // Verify user_transcript event was emitted
  const transcriptEvent = emitted.find((e) => e.type === 'user_transcript');
  assert.ok(transcriptEvent, 'Should emit user_transcript event on turn start');
  assert.equal(transcriptEvent.turnId, 'turn_transcript_1');
  assert.equal(transcriptEvent.text, 'My name is Om Patil.');
  assert.equal(transcriptEvent.isFinal, true);

  // Verify saved user message in session
  const session = await SessionController.getSessionData(sessionId);
  assert.ok(session.messages.length > 0);
  const userMsg = session.messages.find((m) => m.turnId === 'turn_transcript_1' && m.sender === 'user');
  assert.ok(userMsg, 'Should persist user message in session');
  assert.equal(userMsg.text, 'My name is Om Patil.');
  assert.equal(userMsg.sender, 'user');
});
