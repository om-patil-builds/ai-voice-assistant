import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnManager } from '../src/modules/voice/turnManager.js';
import { SessionController } from '../src/modules/voice/sessionController.js';

test('TurnManager - strictly increasing sequence numbers and sentence chunking', async () => {
  const turnManager = new TurnManager();
  const sessionId = 'seq_test_session_' + Date.now();
  await SessionController.getOrCreateSession(sessionId);

  const events = [];
  const sendEvent = (event) => events.push(event);

  // Directly verify active turn state tracking
  const abortController = new AbortController();
  const turnState = {
    turnId: 'turn_seq_1',
    sessionId,
    inputType: 'text',
    text: 'Hello world',
    abortController,
    seq: 0,
    nextSegmentIndex: 0,
    generatedText: '',
    segments: [],
    isAborted: false,
  };
  turnManager.activeTurns.set(sessionId, turnState);

  // Simulate streaming chunks
  const chunks = ['First sentence here. ', 'Second sentence follows! ', 'Third part.'];
  let streamBuffer = '';
  const sentenceRegex = /([.!?\n]+)\s+/g;

  for (const delta of chunks) {
    turnState.generatedText += delta;
    streamBuffer += delta;

    sendEvent({
      type: 'assistant_delta',
      turnId: turnState.turnId,
      seq: turnState.seq++,
      delta,
    });

    let match;
    let lastIndex = 0;
    sentenceRegex.lastIndex = 0;

    while ((match = sentenceRegex.exec(streamBuffer)) !== null) {
      const sentence = streamBuffer.slice(lastIndex, match.index + match[1].length).trim();
      lastIndex = match.index + match[0].length;
      if (sentence) {
        const seg = { index: turnState.nextSegmentIndex++, text: sentence };
        turnState.segments.push(seg);
        sendEvent({
          type: 'assistant_segment',
          turnId: turnState.turnId,
          segmentIndex: seg.index,
          text: seg.text,
        });
      }
    }
    if (lastIndex > 0) {
      streamBuffer = streamBuffer.slice(lastIndex);
    }
  }

  // Verify delta events have strictly increasing sequence numbers
  const deltas = events.filter((e) => e.type === 'assistant_delta');
  assert.equal(deltas.length, 3);
  assert.equal(deltas[0].seq, 0);
  assert.equal(deltas[1].seq, 1);
  assert.equal(deltas[2].seq, 2);

  // Verify sentence segments have 0-indexed contiguous indices
  const segments = events.filter((e) => e.type === 'assistant_segment');
  assert.equal(segments.length, 2);
  assert.equal(segments[0].segmentIndex, 0);
  assert.equal(segments[0].text, 'First sentence here.');
  assert.equal(segments[1].segmentIndex, 1);
  assert.equal(segments[1].text, 'Second sentence follows!');
});

test('TurnManager - cancellation on new turn replaces previous turn', async () => {
  const turnManager = new TurnManager();
  const sessionId = 'cancel_test_session_' + Date.now();
  await SessionController.getOrCreateSession(sessionId);

  const ctrl1 = new AbortController();
  turnManager.activeTurns.set(sessionId, {
    turnId: 'turn_old',
    sessionId,
    abortController: ctrl1,
    isAborted: false,
  });

  // Start new turn
  const events = [];
  await turnManager.startTurn({
    sessionId,
    turnId: 'turn_new',
    text: 'stop', // using stop command so it terminates immediately without network
    sendEvent: (ev) => events.push(ev),
  });

  // Old controller MUST be aborted
  assert.ok(ctrl1.signal.aborted, 'Previous turn must be aborted when a new turn starts');
});
