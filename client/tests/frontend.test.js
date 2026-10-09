import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackCursor } from '../src/audio/playbackCursor.js';
import { parseVoiceCommand, SESSION_STATES } from '../src/hooks/useVoiceSession.js';
import { SocketClient } from '../src/services/socketClient.js';
import { ApiClient } from '../src/services/apiClient.js';

test('PlaybackCursor - segment tracking and interruption checkpoints', () => {
  const cursor = new PlaybackCursor();
  cursor.initTurn('turn_123');

  cursor.addSegment(0, 'First sentence.');
  cursor.addSegment(1, 'Second sentence.');
  cursor.addSegment(2, 'Third sentence.');

  // Confirmed playback of first sentence
  cursor.confirmSegment(0);
  assert.equal(cursor.lastSpokenSegmentIndex, 0);

  // User interrupts mid-response
  const paused = cursor.savePausedState('turn_123', 'First sentence. Second sentence. Third sentence.', 0, false);
  assert.equal(paused.sourceTurnId, 'turn_123');
  assert.equal(paused.lastSpokenSegmentIndex, 0);
  assert.equal(paused.generationComplete, false);

  // Check remaining unspoken segments
  const remaining = cursor.getRemainingSegments();
  assert.equal(remaining.length, 2);
  assert.equal(remaining[0].text, 'Second sentence.');
  assert.equal(remaining[1].text, 'Third sentence.');
  assert.equal(cursor.getRemainingText(), 'Second sentence. Third sentence.');

  // Resuming: confirm sentence 1 and sentence 2
  cursor.confirmSegment(1);
  cursor.confirmSegment(2);
  cursor.markGenerationComplete();
  assert.equal(cursor.getRemainingSegments().length, 0);
});

test('PlaybackCursor - state restoration from session API', () => {
  const cursor = new PlaybackCursor();
  const sessionData = {
    pausedResponse: {
      sourceTurnId: 'turn_456',
      generatedText: 'Sentence one. Sentence two.',
      lastSpokenSegmentIndex: 0,
      generationComplete: true,
      segments: [
        { index: 0, text: 'Sentence one.' },
        { index: 1, text: 'Sentence two.' },
      ],
    },
  };

  cursor.restoreState(sessionData);
  assert.equal(cursor.currentTurnId, 'turn_456');
  assert.equal(cursor.lastSpokenSegmentIndex, 0);
  assert.equal(cursor.getRemainingSegments().length, 1);
  assert.equal(cursor.getRemainingSegments()[0].text, 'Sentence two.');
});

test('CommandParser - standalone voice commands recognition', () => {
  // Positive matches for STOP
  assert.equal(parseVoiceCommand('stop'), 'STOP');
  assert.equal(parseVoiceCommand('Stop!'), 'STOP');
  assert.equal(parseVoiceCommand('stop talking'), 'STOP');
  assert.equal(parseVoiceCommand('please stop'), 'STOP');
  assert.equal(parseVoiceCommand('cancel'), 'STOP');

  // Positive matches for CONTINUE
  assert.equal(parseVoiceCommand('continue'), 'CONTINUE');
  assert.equal(parseVoiceCommand('continue last response'), 'CONTINUE');
  assert.equal(parseVoiceCommand('keep going'), 'CONTINUE');
  assert.equal(parseVoiceCommand('go on'), 'CONTINUE');
  assert.equal(parseVoiceCommand('resume please'), 'CONTINUE');

  // Positive matches for REPEAT
  assert.equal(parseVoiceCommand('repeat that'), 'REPEAT');
  assert.equal(parseVoiceCommand('say that again'), 'REPEAT');
  assert.equal(parseVoiceCommand('repeat last response'), 'REPEAT');
  assert.equal(parseVoiceCommand('repeat'), 'REPEAT');

  // Positive matches for MUTE / UNMUTE
  assert.equal(parseVoiceCommand('mute'), 'MUTE');
  assert.equal(parseVoiceCommand('mute audio'), 'MUTE');
  assert.equal(parseVoiceCommand('unmute'), 'UNMUTE');

  // Positive matches for CLEAR_CHAT
  assert.equal(parseVoiceCommand('clear chat'), 'CLEAR_CHAT');
  assert.equal(parseVoiceCommand('clear history'), 'CLEAR_CHAT');
});

test('CommandParser - avoids misclassifying commands inside ordinary questions', () => {
  // Should NOT trigger commands when embedded in ordinary sentences
  assert.equal(parseVoiceCommand('Can you continue explaining quantum physics?'), null);
  assert.equal(parseVoiceCommand('What should I stop doing in life?'), null);
  assert.equal(parseVoiceCommand('If I continue reading this book, what happens?'), null);
  assert.equal(parseVoiceCommand('Why did you repeat that word?'), null);
  assert.equal(parseVoiceCommand('Please repeat after me: the quick brown fox'), null);
  assert.equal(parseVoiceCommand('How do I mute my microphone?'), null);
  assert.equal(parseVoiceCommand('Is it possible to clear my cache?'), null);
  assert.equal(parseVoiceCommand('Tell me a story about a nonstop train'), null);
});

test('SocketClient - message schema validation', () => {
  const socket = new SocketClient('ws://localhost:5000');
  let sentPayload = null;
  socket.socket = {
    readyState: 1, // OPEN
    send: (msg) => {
      sentPayload = JSON.parse(msg);
    },
  };

  // start_turn
  socket.startTurn({ turnId: 'turn_abc', seq: 0, inputType: 'text', text: 'Hello AI' });
  assert.deepEqual(sentPayload, {
    type: 'start_turn',
    turnId: 'turn_abc',
    seq: 0,
    inputType: 'text',
    text: 'Hello AI',
  });

  // interrupt
  socket.interrupt('turn_abc');
  assert.deepEqual(sentPayload, {
    type: 'interrupt',
    turnId: 'turn_abc',
  });

  // continue
  socket.continueTurn({ sourceTurnId: 'turn_abc', lastSpokenSegmentIndex: 2 });
  assert.deepEqual(sentPayload, {
    type: 'continue',
    sourceTurnId: 'turn_abc',
    lastSpokenSegmentIndex: 2,
  });

  // stop
  socket.stop('turn_abc');
  assert.deepEqual(sentPayload, {
    type: 'stop',
    turnId: 'turn_abc',
  });
});

test('ApiClient - endpoint URL structure and abort handling', async () => {
  const client = new ApiClient('http://localhost:5000/');
  assert.equal(client.baseUrl, 'http://localhost:5000');

  // Verify empty blob validation
  await assert.rejects(
    async () => client.uploadAudio(null),
    { message: 'Audio data is empty or invalid.' }
  );

  // Verify AbortController signal handling
  const controller = new AbortController();
  controller.abort();
  const fakeBlob = new Blob(['mock audio'], { type: 'audio/webm' });

  await assert.rejects(
    async () => client.uploadAudio(fakeBlob, 'test.webm', { signal: controller.signal }),
    (err) => err.name === 'AbortError'
  );
});

test('State Machine - states enum definition', () => {
  assert.equal(SESSION_STATES.IDLE, 'IDLE');
  assert.equal(SESSION_STATES.LISTENING, 'LISTENING');
  assert.equal(SESSION_STATES.TRANSCRIBING, 'TRANSCRIBING');
  assert.equal(SESSION_STATES.THINKING, 'THINKING');
  assert.equal(SESSION_STATES.SPEAKING, 'SPEAKING');
  assert.equal(SESSION_STATES.INTERRUPTED, 'INTERRUPTED');
  assert.equal(SESSION_STATES.PAUSED, 'PAUSED');
  assert.equal(SESSION_STATES.ERROR, 'ERROR');
});
