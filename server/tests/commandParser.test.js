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
  // Marathi STOP commands
  assert.equal(parseVoiceCommand('थांबा'), COMMANDS.STOP);
  assert.equal(parseVoiceCommand('थांब'), COMMANDS.STOP);
  assert.equal(parseVoiceCommand('बंद करा'), COMMANDS.STOP);
  assert.equal(parseVoiceCommand('thamba'), COMMANDS.STOP);

  // Hindi STOP commands
  assert.equal(parseVoiceCommand('रुको'), COMMANDS.STOP);
  assert.equal(parseVoiceCommand('रुकिए'), COMMANDS.STOP);
  assert.equal(parseVoiceCommand('बंद करो'), COMMANDS.STOP);
  assert.equal(parseVoiceCommand('ruko'), COMMANDS.STOP);

  // Marathi CONTINUE commands
  assert.equal(parseVoiceCommand('पुढे बोला'), COMMANDS.CONTINUE);
  assert.equal(parseVoiceCommand('सुरू ठेवा'), COMMANDS.CONTINUE);
  assert.equal(parseVoiceCommand('pudhe bola'), COMMANDS.CONTINUE);

  // Hindi CONTINUE commands
  assert.equal(parseVoiceCommand('आगे बोलो'), COMMANDS.CONTINUE);
  assert.equal(parseVoiceCommand('जारी रखो'), COMMANDS.CONTINUE);
  assert.equal(parseVoiceCommand('aage bolo'), COMMANDS.CONTINUE);

  // Marathi REPEAT commands
  assert.equal(parseVoiceCommand('पुन्हा सांगा'), COMMANDS.REPEAT);
  assert.equal(parseVoiceCommand('परत सांगा'), COMMANDS.REPEAT);
  assert.equal(parseVoiceCommand('punha sanga'), COMMANDS.REPEAT);

  // Hindi REPEAT commands
  assert.equal(parseVoiceCommand('फिर से बोलो'), COMMANDS.REPEAT);
  assert.equal(parseVoiceCommand('दोहराओ'), COMMANDS.REPEAT);
  assert.equal(parseVoiceCommand('phir se bolo'), COMMANDS.REPEAT);

  // Marathi & Hindi MUTE / UNMUTE
  assert.equal(parseVoiceCommand('म्यूट करा'), COMMANDS.MUTE);
  assert.equal(parseVoiceCommand('आवाज बंद करा'), COMMANDS.MUTE);
  assert.equal(parseVoiceCommand('म्यूट करो'), COMMANDS.MUTE);
  assert.equal(parseVoiceCommand('आवाज बंद करो'), COMMANDS.MUTE);
  assert.equal(parseVoiceCommand('अनम्यूट करा'), COMMANDS.UNMUTE);
  assert.equal(parseVoiceCommand('आवाज चालू करा'), COMMANDS.UNMUTE);
  assert.equal(parseVoiceCommand('अनम्यूट करो'), COMMANDS.UNMUTE);
  assert.equal(parseVoiceCommand('आवाज चालू करो'), COMMANDS.UNMUTE);

  // Marathi & Hindi CLEAR_CHAT
  assert.equal(parseVoiceCommand('चॅट साफ करा'), COMMANDS.CLEAR_CHAT);
  assert.equal(parseVoiceCommand('चॅट हटवा'), COMMANDS.CLEAR_CHAT);
  assert.equal(parseVoiceCommand('चैट साफ करो'), COMMANDS.CLEAR_CHAT);
  assert.equal(parseVoiceCommand('चैट हटाओ'), COMMANDS.CLEAR_CHAT);
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
  // Marathi & Hindi ordinary questions with command words
  assert.equal(parseVoiceCommand('MERN stack मध्ये continue statement कसे वापरायचे?'), null);
  assert.equal(parseVoiceCommand('थांबा, मला एक प्रश्न विचारायचा आहे'), null);
  assert.equal(parseVoiceCommand('रुकिए, क्या आप पायथन सिखा सकते हैं?'), null);
  assert.equal(parseVoiceCommand('क्या आप फिर से समझा सकते हैं?'), null);
  assert.equal(parseVoiceCommand(''), null);
  assert.equal(parseVoiceCommand(null), null);
});
