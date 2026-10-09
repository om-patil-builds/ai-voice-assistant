import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVoiceCommand, COMMANDS } from '../src/modules/voice/commandParser.js';

test('CommandParser - standalone voice commands recognition', () => {
  // STOP commands
  assert.equal(parseVoiceCommand('stop'), COMMANDS.STOP);
  assert.equal(parseVoiceCommand('Stop!'), COMMANDS.STOP);
  assert.equal(parseVoiceCommand('stop talking'), COMMANDS.STOP);
  assert.equal(parseVoiceCommand('please stop'), COMMANDS.STOP);
  assert.equal(parseVoiceCommand('cancel'), COMMANDS.STOP);
  assert.equal(parseVoiceCommand('halt'), COMMANDS.STOP);

  // CONTINUE commands
  assert.equal(parseVoiceCommand('continue'), COMMANDS.CONTINUE);
  assert.equal(parseVoiceCommand('continue last response'), COMMANDS.CONTINUE);
  assert.equal(parseVoiceCommand('keep going'), COMMANDS.CONTINUE);
  assert.equal(parseVoiceCommand('go on'), COMMANDS.CONTINUE);
  assert.equal(parseVoiceCommand('resume please'), COMMANDS.CONTINUE);
  assert.equal(parseVoiceCommand('please continue'), COMMANDS.CONTINUE);

  // REPEAT commands
  assert.equal(parseVoiceCommand('repeat that'), COMMANDS.REPEAT);
  assert.equal(parseVoiceCommand('say that again'), COMMANDS.REPEAT);
  assert.equal(parseVoiceCommand('repeat last response'), COMMANDS.REPEAT);
  assert.equal(parseVoiceCommand('repeat last answer'), COMMANDS.REPEAT);
  assert.equal(parseVoiceCommand('repeat'), COMMANDS.REPEAT);

  // MUTE / UNMUTE
  assert.equal(parseVoiceCommand('mute'), COMMANDS.MUTE);
  assert.equal(parseVoiceCommand('mute audio'), COMMANDS.MUTE);
  assert.equal(parseVoiceCommand('unmute'), COMMANDS.UNMUTE);
  assert.equal(parseVoiceCommand('unmute voice'), COMMANDS.UNMUTE);

  // CLEAR_CHAT
  assert.equal(parseVoiceCommand('clear chat'), COMMANDS.CLEAR_CHAT);
  assert.equal(parseVoiceCommand('clear history'), COMMANDS.CLEAR_CHAT);
  assert.equal(parseVoiceCommand('delete chat'), COMMANDS.CLEAR_CHAT);
  assert.equal(parseVoiceCommand('clear conversation'), COMMANDS.CLEAR_CHAT);
});

test('CommandParser - avoids misclassifying commands inside ordinary questions', () => {
  assert.equal(parseVoiceCommand('Can you continue explaining quantum physics?'), null);
  assert.equal(parseVoiceCommand('What should I stop doing in life?'), null);
  assert.equal(parseVoiceCommand('If I continue reading this book, what happens?'), null);
  assert.equal(parseVoiceCommand('Why did you repeat that word?'), null);
  assert.equal(parseVoiceCommand('Please repeat after me: the quick brown fox'), null);
  assert.equal(parseVoiceCommand('How do I mute my microphone?'), null);
  assert.equal(parseVoiceCommand('Is it possible to clear my cache?'), null);
  assert.equal(parseVoiceCommand('Tell me a story about a nonstop train'), null);
  assert.equal(parseVoiceCommand(''), null);
  assert.equal(parseVoiceCommand(null), null);
});
