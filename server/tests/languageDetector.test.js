import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, normalizeLanguageCode } from '../src/modules/voice/languageDetector.js';

test('LanguageDetector - normalizeLanguageCode handles valid and fallback codes', () => {
  assert.equal(normalizeLanguageCode('en'), 'en');
  assert.equal(normalizeLanguageCode('english'), 'en');
  assert.equal(normalizeLanguageCode('hi'), 'hi');
  assert.equal(normalizeLanguageCode('hindi'), 'hi');
  assert.equal(normalizeLanguageCode('mr'), 'mr');
  assert.equal(normalizeLanguageCode('marathi'), 'mr');
  assert.equal(normalizeLanguageCode(''), 'en');
  assert.equal(normalizeLanguageCode(null), 'en');
  assert.equal(normalizeLanguageCode(undefined), 'en');
});

test('LanguageDetector - accurately identifies English inputs', () => {
  assert.equal(detectLanguage('What is MERN stack?'), 'en');
  assert.equal(detectLanguage('Explain React components and hooks in detail'), 'en');
  assert.equal(detectLanguage('How does Node.js handle asynchronous I/O?'), 'en');
  assert.equal(detectLanguage('Hello, how can I build a web app?'), 'en');
  assert.equal(detectLanguage('Good morning, how are you today?'), 'en');
  assert.equal(detectLanguage('Can you repeat that please?'), 'en');
});

test('LanguageDetector - accurately identifies Marathi inputs in Devanagari', () => {
  assert.equal(detectLanguage('नमस्कार! कसे आहात?'), 'mr');
  assert.equal(detectLanguage('MERN stack म्हणजे काय?'), 'mr');
  assert.equal(detectLanguage('React.js बद्दल सांगा'), 'mr');
  assert.equal(detectLanguage('MongoDB चा वापर काय आहे?'), 'mr');
  assert.equal(detectLanguage('Node.js कसं शिकायचं?'), 'mr');
  assert.equal(detectLanguage('मला वेब डेव्हलपमेंट शिकायचे आहे'), 'mr');
  assert.equal(detectLanguage('पुढे बोला'), 'mr');
  assert.equal(detectLanguage('पुन्हा सांगा'), 'mr');
  assert.equal(detectLanguage('थांबा'), 'mr');
});

test('LanguageDetector - accurately identifies Hindi inputs in Devanagari', () => {
  assert.equal(detectLanguage('नमस्ते! आप कैसे हैं?'), 'hi');
  assert.equal(detectLanguage('MERN stack क्या है?'), 'hi');
  assert.equal(detectLanguage('React.js के बारे में बताओ'), 'hi');
  assert.equal(detectLanguage('MongoDB का उपयोग क्या है?'), 'hi');
  assert.equal(detectLanguage('Node.js कैसे सीखें?'), 'hi');
  assert.equal(detectLanguage('मुझे वेब डेवलपमेंट सीखना है'), 'hi');
  assert.equal(detectLanguage('आगे बोलो'), 'hi');
  assert.equal(detectLanguage('फिर से बोलो'), 'hi');
  assert.equal(detectLanguage('रुको'), 'hi');
});

test('LanguageDetector - accurately handles code-mixed speech (Maranglish & Hinglish)', () => {
  // Marathi Romanized / Maranglish
  assert.equal(detectLanguage('MERN stack mhanje kay?'), 'mr');
  assert.equal(detectLanguage('React baddal sanga'), 'mr');
  assert.equal(detectLanguage('kasa aahes'), 'mr');
  assert.equal(detectLanguage('mala mahiti havi aahe'), 'mr');
  assert.equal(detectLanguage('pudhe bola'), 'mr');

  // Hindi Romanized / Hinglish
  assert.equal(detectLanguage('MERN stack kya hai?'), 'hi');
  assert.equal(detectLanguage('React ke baare me batao'), 'hi');
  assert.equal(detectLanguage('kaise ho aap'), 'hi');
  assert.equal(detectLanguage('mujhe Node.js sikhna hai'), 'hi');
  assert.equal(detectLanguage('aage bolo'), 'hi');
});

test('LanguageDetector - integrates STT hints and handles edge cases', () => {
  // STT hint resolution on standalone technical terms
  assert.equal(detectLanguage('MERN Stack', 'mr'), 'mr');
  assert.equal(detectLanguage('MERN Stack', 'hi'), 'hi');
  assert.equal(detectLanguage('MERN Stack', 'en'), 'en');

  // Clear English sentence overrides non-matching STT hint
  assert.equal(detectLanguage('What is an API?', 'hi'), 'en');
  assert.equal(detectLanguage('Explain MongoDB database', 'mr'), 'en');

  // Empty and falsy values
  assert.equal(detectLanguage(''), 'en');
  assert.equal(detectLanguage(null), 'en');
  assert.equal(detectLanguage(undefined), 'en');
  assert.equal(detectLanguage('', 'hi'), 'hi');
  assert.equal(detectLanguage('', 'mr'), 'mr');
});
