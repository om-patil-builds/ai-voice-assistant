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

test('TurnManager - multilingual Marathi and Hindi command parsing and language detection', async () => {
  const turnManager = new TurnManager();
  const sessionId = 'test_multi_turn_' + Date.now();
  await SessionController.getOrCreateSession(sessionId);

  // 1. Marathi stop command
  const marathiEvents = [];
  await turnManager.startTurn({
    sessionId,
    turnId: 'turn_mr_stop',
    text: 'थांबा',
    inputType: 'audio',
    sendEvent: (ev) => marathiEvents.push(ev),
  });

  const mrTranscript = marathiEvents.find((e) => e.type === 'user_transcript');
  assert.ok(mrTranscript, 'Should emit user_transcript for Marathi turn');
  assert.equal(mrTranscript.language, 'mr');
  assert.equal(mrTranscript.text, 'थांबा');

  const mrStopStatus = marathiEvents.find((e) => e.type === 'status' && e.state === 'IDLE');
  assert.ok(mrStopStatus, 'Should transition to IDLE on Marathi stop command (थांबा)');

  // 2. Hindi stop command
  const hindiEvents = [];
  await turnManager.startTurn({
    sessionId,
    turnId: 'turn_hi_stop',
    text: 'रुको',
    inputType: 'audio',
    sendEvent: (ev) => hindiEvents.push(ev),
  });

  const hiTranscript = hindiEvents.find((e) => e.type === 'user_transcript');
  assert.ok(hiTranscript, 'Should emit user_transcript for Hindi turn');
  assert.equal(hiTranscript.language, 'hi');
  assert.equal(hiTranscript.text, 'रुको');

  const hiStopStatus = hindiEvents.find((e) => e.type === 'status' && e.state === 'IDLE');
  assert.ok(hiStopStatus, 'Should transition to IDLE on Hindi stop command (रुको)');
});

test('TurnManager - preserves response state and saves playback position on barge-in interrupt', async () => {
  const turnManager = new TurnManager();
  const sessionId = 'test_checkpoint_pos_' + Date.now();
  await SessionController.getOrCreateSession(sessionId);
  const events = [];
  const sendEvent = (e) => events.push(e);

  // Active turn with 3 segments
  const abortController = new AbortController();
  turnManager.activeTurns.set(sessionId, {
    turnId: 'turn_cp_1',
    sessionId,
    inputType: 'text',
    text: 'What is Node.js?',
    abortController,
    seq: 3,
    nextSegmentIndex: 3,
    generatedText: 'Node.js is a runtime. It uses V8. It powers backend servers.',
    segments: [
      { index: 0, text: 'Node.js is a runtime.' },
      { index: 1, text: 'It uses V8.' },
      { index: 2, text: 'It powers backend servers.' },
    ],
    isAborted: false,
  });

  // User listened to sentence 0 and sentence 1 before barging in
  await turnManager.handleInterrupt({
    sessionId,
    turnId: 'turn_cp_1',
    lastSpokenSegmentIndex: 1,
    sendEvent,
  });

  // Verify checkpoint state
  const session = await SessionController.getSessionData(sessionId);
  assert.ok(session.pausedResponse, 'Paused response must be saved');
  assert.equal(session.pausedResponse.sourceTurnId, 'turn_cp_1');
  assert.equal(session.pausedResponse.lastSpokenSegmentIndex, 1, 'Confirmed spoken index must be 1');
  assert.equal(session.pausedResponse.segments.length, 3);
  assert.equal(session.pausedResponse.generatedText, 'Node.js is a runtime. It uses V8. It powers backend servers.');
  assert.equal(session.pausedResponse.generationComplete, false);

  // User says "continue"
  const continueEvents = [];
  await turnManager.handleContinue({
    sessionId,
    sourceTurnId: 'turn_cp_1',
    lastSpokenSegmentIndex: 1,
    sendEvent: (e) => continueEvents.push(e),
  });

  // Must emit unspoken segment 2 only (indices 0 and 1 were already confirmed spoken)
  const emittedSegments = continueEvents.filter((e) => e.type === 'assistant_segment');
  assert.ok(emittedSegments.some((s) => s.segmentIndex === 2 && s.text === 'It powers backend servers.'));
  assert.ok(!emittedSegments.some((s) => s.segmentIndex === 0), 'Completed segment 0 must not be repeated');
  assert.ok(!emittedSegments.some((s) => s.segmentIndex === 1), 'Completed segment 1 must not be repeated');
});

test('TurnManager - interruption during completed response playback preserves generated answer', async () => {
  const turnManager = new TurnManager();
  const sessionId = 'test_completed_barge_' + Date.now();
  await SessionController.getOrCreateSession(sessionId);
  const events = [];
  const sendEvent = (e) => events.push(e);

  // Turn finished LLM generation on server (activeTurn is no longer in activeTurns map)
  await SessionController.updatePausedResponse(sessionId, {
    sourceTurnId: 'turn_comp_1',
    generatedText: 'First part here. Second part here. Final part here.',
    language: 'en',
    lastSpokenSegmentIndex: -1,
    generationComplete: true,
    segments: [
      { index: 0, text: 'First part here.' },
      { index: 1, text: 'Second part here.' },
      { index: 2, text: 'Final part here.' },
    ],
    timestamp: Date.now(),
  });

  // Client was playing audio when user barged in after hearing first part (index 0)
  await turnManager.handleInterrupt({
    sessionId,
    turnId: 'turn_comp_1',
    lastSpokenSegmentIndex: 0,
    sendEvent,
  });

  // State must NOT be blanked out!
  const session = await SessionController.getSessionData(sessionId);
  assert.ok(session.pausedResponse);
  assert.equal(session.pausedResponse.sourceTurnId, 'turn_comp_1');
  assert.equal(session.pausedResponse.generatedText, 'First part here. Second part here. Final part here.');
  assert.equal(session.pausedResponse.generationComplete, true);
  assert.equal(session.pausedResponse.lastSpokenSegmentIndex, 0);
  assert.equal(session.pausedResponse.segments.length, 3);

  // User says continue
  const continueEvents = [];
  await turnManager.handleContinue({
    sessionId,
    sourceTurnId: 'turn_comp_1',
    lastSpokenSegmentIndex: 0,
    sendEvent: (e) => continueEvents.push(e),
  });

  // Should play unspoken segments 1 and 2
  const segments = continueEvents.filter((e) => e.type === 'assistant_segment');
  assert.equal(segments.length, 2, 'Should emit exactly the 2 remaining segments');
  assert.equal(segments[0].segmentIndex, 1);
  assert.equal(segments[0].text, 'Second part here.');
  assert.equal(segments[1].segmentIndex, 2);
  assert.equal(segments[1].text, 'Final part here.');

  const turnComplete = continueEvents.find((e) => e.type === 'turn_complete');
  assert.ok(turnComplete, 'Should emit turn_complete');
});


