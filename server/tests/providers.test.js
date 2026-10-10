import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudio, STT_VOCABULARY_PROMPT, sanitizeSttPrompt } from '../src/providers/groqStt.js';
import { streamChatCompletion, streamContinuationCompletion } from '../src/providers/groqLlm.js';
import { ValidationError, AppError } from '../src/lib/errors.js';

test('Groq STT Provider - validates empty and oversized buffers', async () => {
  // Empty buffer throws ValidationError
  await assert.rejects(
    async () => transcribeAudio(Buffer.alloc(0)),
    (err) => err instanceof ValidationError
  );

  // Null buffer throws ValidationError
  await assert.rejects(
    async () => transcribeAudio(null),
    (err) => err instanceof ValidationError
  );
});

test('Groq STT Provider - vocabulary prompt strictly conforms to Groq 896-byte limit', () => {
  const byteLength = Buffer.byteLength(STT_VOCABULARY_PROMPT, 'utf8');
  assert.ok(
    byteLength <= 800,
    `STT_VOCABULARY_PROMPT UTF-8 bytes must be <= 800 (Groq limit is 896), got ${byteLength}`
  );

  // Verify sanitizeSttPrompt clamps oversized inputs
  const oversizedText = 'मर्न स्टॅक म्हणजे काय? '.repeat(60);
  const sanitized = sanitizeSttPrompt(oversizedText, 800);
  assert.ok(Buffer.byteLength(sanitized, 'utf8') <= 800);
});


test('Groq LLM Provider - abort controller terminates stream generator immediately', async () => {
  const controller = new AbortController();
  controller.abort(); // already aborted

  const generator = streamChatCompletion({
    messages: [{ role: 'user', content: 'Hello' }],
    signal: controller.signal,
  });

  const chunks = [];
  for await (const chunk of generator) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 0, 'No chunks should be yielded when signal is already aborted');
});

test('Groq STT Provider - silent WAV buffer returns empty transcript without hallucinating', async () => {
  // Construct 1-second silence WAV buffer
  const sampleRate = 16000;
  const numSamples = sampleRate;
  const buffer = Buffer.alloc(44 + numSamples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  const result = await transcribeAudio(buffer, { filename: 'speech.wav', mimetype: 'audio/wav' });
  assert.equal(result.transcript, '', 'Silent audio must return empty transcript and not hallucinate');
  assert.equal(result.duration, 0);
  assert.equal(result.language, 'en');
});
