import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackCursor } from '../src/audio/playbackCursor.js';
import { parseVoiceCommand, SESSION_STATES } from '../src/hooks/useVoiceSession.js';
import { SocketClient } from '../src/services/socketClient.js';
import { ApiClient } from '../src/services/apiClient.js';
import { TTSPlayer } from '../src/audio/ttsPlayer.js';
import { encodeWav, downsampleBuffer, mergeBuffers, calculateRmsAndPeak } from '../src/audio/wavEncoder.js';

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

test('Message Transcript Handling - User transcript and Assistant stream separation', () => {
  const turnId = 'turn_test_voice_1';
  const spokenText = 'My name is Om Patil.';
  const assistantDeltaChunks = ['Nice', ' to', ' meet', ' you,', ' Om!'];

  // Initialize turn with user message and streaming assistant placeholder
  let messages = [
    {
      id: 'msg_user_1',
      sender: 'user',
      text: spokenText,
      turnId,
      timestamp: Date.now(),
    },
    {
      id: 'msg_assistant_1',
      sender: 'assistant',
      text: '',
      turnId,
      status: 'streaming',
      timestamp: Date.now(),
    },
  ];

  // Verify initial state
  assert.equal(messages[0].sender, 'user');
  assert.equal(messages[0].text, 'My name is Om Patil.');
  assert.equal(messages[1].sender, 'assistant');
  assert.equal(messages[1].text, '');
  assert.notEqual(messages[0].id, messages[1].id);

  // Simulate streaming assistant deltas arriving
  let accumulatedAssistantText = '';
  for (const delta of assistantDeltaChunks) {
    accumulatedAssistantText += delta;
    // Apply update logic: only assistant messages for the turn are updated
    messages = messages.map((msg) =>
      msg.turnId === turnId && msg.sender === 'assistant'
        ? { ...msg, text: accumulatedAssistantText }
        : msg
    );
  }

  // CRITICAL CHECK: User message MUST NEVER be overwritten by assistant deltas!
  assert.equal(messages[0].sender, 'user');
  assert.equal(messages[0].text, 'My name is Om Patil.', 'User message must preserve spoken words');
  assert.equal(messages[1].sender, 'assistant');
  assert.equal(messages[1].text, 'Nice to meet you, Om!', 'Assistant message contains full streamed answer');

  // Simulate turn completion
  messages = messages.map((msg) =>
    msg.turnId === turnId && msg.sender === 'assistant'
      ? { ...msg, status: 'completed' }
      : msg
  );
  assert.equal(messages[0].status, undefined);
  assert.equal(messages[1].status, 'completed');

  // Simulate barge-in interruption on a second turn
  const turn2Id = 'turn_test_voice_2';
  const turn2SpokenText = 'What is the weather today?';
  messages = [
    ...messages,
    {
      id: 'msg_user_2',
      sender: 'user',
      text: turn2SpokenText,
      turnId: turn2Id,
      timestamp: Date.now(),
    },
    {
      id: 'msg_assistant_2',
      sender: 'assistant',
      text: 'It is sunny and 75 degrees.',
      turnId: turn2Id,
      status: 'streaming',
      timestamp: Date.now(),
    },
  ];

  // Interruption occurs during turn 2 playback
  messages = messages.map((msg) =>
    msg.turnId === turn2Id && msg.sender === 'assistant'
      ? { ...msg, status: 'interrupted', lastSpokenSegmentIndex: 0 }
      : msg
  );

  // Check that turn 1 user, turn 1 assistant, and turn 2 user remain completely untouched
  assert.equal(messages[0].text, 'My name is Om Patil.');
  assert.equal(messages[1].text, 'Nice to meet you, Om!');
  assert.equal(messages[2].text, 'What is the weather today?');
  assert.equal(messages[3].status, 'interrupted');
});

test('TTSPlayer - sentence chunking, queue management, and volume/rate controls', () => {
  const player = new TTSPlayer();

  // Test volume clamping (0.0 to 1.0)
  player.setVolume(0.75);
  assert.equal(player.volume, 0.75);
  player.setVolume(2.5);
  assert.equal(player.volume, 1.0, 'Volume must clamp to 1.0');
  player.setVolume(-0.5);
  assert.equal(player.volume, 0.0, 'Volume must clamp to 0.0');

  // Test rate clamping (0.5 to 2.0)
  player.setRate(1.2);
  assert.equal(player.rate, 1.2);
  player.setRate(3.0);
  assert.equal(player.rate, 2.0, 'Rate must clamp to 2.0');
  player.setRate(0.1);
  assert.equal(player.rate, 0.5, 'Rate must clamp to 0.5');

  // Test sentence chunking via feedDelta
  player.resetForTurn('turn_delta_test');
  player.feedDelta('Hello there! ', 'turn_delta_test', false);
  player.feedDelta('How can I help you today? ', 'turn_delta_test', false);

  // In Node environment without window.speechSynthesis, queue items are pushed
  // (or shifted if non-browser fallback plays immediately)
  assert.ok(player.nextSegmentIndex >= 2, 'Should extract at least 2 completed sentence segments');

  // Test cancel
  const cancelResult = player.cancel();
  assert.equal(cancelResult.sourceTurnId, 'turn_delta_test');
  assert.equal(player.isSpeaking, false);
  assert.equal(player.queue.length, 0);
});

test('WAV Encoder - lossless PCM generation, downsampling, and energy detection', async () => {
  // Test mergeBuffers
  const chunk1 = new Float32Array([1.0, 2.0]);
  const chunk2 = new Float32Array([3.0, 4.0, 5.0]);
  const merged = mergeBuffers([chunk1, chunk2]);
  assert.equal(merged.length, 5);
  assert.deepEqual(Array.from(merged), [1.0, 2.0, 3.0, 4.0, 5.0]);

  // Test downsampleBuffer (48kHz -> 16kHz, ratio 3:1)
  const input48k = new Float32Array(48000); // 1 second at 48kHz
  for (let i = 0; i < input48k.length; i++) {
    input48k[i] = Math.sin((2 * Math.PI * 440 * i) / 48000); // 440Hz sine wave
  }
  const downsampled = downsampleBuffer(input48k, 48000, 16000);
  assert.equal(downsampled.length, 16000, 'Downsampled length must be 16,000 for 1 second at 16kHz');

  // Test calculateRmsAndPeak
  const { rms, peak } = calculateRmsAndPeak(downsampled);
  assert.ok(peak > 0.95 && peak <= 1.0, `Peak should be near 1.0, got ${peak}`);
  assert.ok(rms > 0.65 && rms < 0.75, `Sine wave RMS should be ~0.707, got ${rms}`);

  // Test encodeWav produces valid RIFF WAV header
  const wavBlob = encodeWav(downsampled, 16000);
  assert.equal(wavBlob.type, 'audio/wav');
  assert.equal(wavBlob.size, 44 + 16000 * 2, 'WAV size must be 44-byte header + 32,000 bytes PCM');

  // Inspect binary header bytes
  const arrayBuffer = await wavBlob.arrayBuffer();
  const view = new DataView(arrayBuffer);
  const textDecoder = new TextDecoder();

  const riff = textDecoder.decode(new Uint8Array(arrayBuffer, 0, 4));
  const wave = textDecoder.decode(new Uint8Array(arrayBuffer, 8, 4));
  const fmt = textDecoder.decode(new Uint8Array(arrayBuffer, 12, 4));
  const data = textDecoder.decode(new Uint8Array(arrayBuffer, 36, 4));

  assert.equal(riff, 'RIFF');
  assert.equal(wave, 'WAVE');
  assert.equal(fmt, 'fmt ');
  assert.equal(data, 'data');

  assert.equal(view.getUint16(20, true), 1, 'AudioFormat must be 1 (PCM)');
  assert.equal(view.getUint16(22, true), 1, 'NumChannels must be 1 (Mono)');
  assert.equal(view.getUint32(24, true), 16000, 'SampleRate must be 16000');
  assert.equal(view.getUint16(34, true), 16, 'BitsPerSample must be 16');
});
