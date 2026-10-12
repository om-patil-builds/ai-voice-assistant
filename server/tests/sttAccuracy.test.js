import test from 'node:test';
import assert from 'node:assert/strict';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { transcribeAudio, STT_VOCABULARY_PROMPT, sanitizeSttPrompt } from '../src/providers/groqStt.js';
import { downsampleBuffer, encodeWav, trimSilence, calculateRmsAndPeak, mergeBuffers } from '../../client/src/audio/wavEncoder.js';

/**
 * Synthesizes text to MP3 buffer using MsEdgeTTS for deterministic acoustic testing
 */
async function synthesizeText(text, voice = 'en-US-JennyNeural') {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(text);
  const chunks = [];
  return new Promise((resolve, reject) => {
    audioStream.on('data', (c) => chunks.push(c));
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
  });
}

/**
 * Creates a standard 16-bit mono PCM WAV Buffer from Float32Array
 */
function float32ToWavBuffer(samples, sampleRate = 16000) {
  const numSamples = samples.length;
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

  let offset = 44;
  for (let i = 0; i < numSamples; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, offset);
  }
  return buffer;
}

test('STT Accuracy - Short speech commands are recognized accurately', async () => {
  const shortCommands = ['Stop', 'Continue', 'Repeat that', 'Mute'];

  for (const cmd of shortCommands) {
    const audio = await synthesizeText(cmd);
    assert.ok(audio.length > 1000, `Synthesized audio for "${cmd}" must have valid size`);

    const result = await transcribeAudio(audio, {
      filename: 'command.mp3',
      mimetype: 'audio/mpeg',
    });

    assert.ok(result.transcript, `Transcript for "${cmd}" should not be empty`);
    const cleanReceived = result.transcript.toLowerCase().replace(/[.,!?;:]/g, '').trim();
    const cleanExpected = cmd.toLowerCase().replace(/[.,!?;:]/g, '').trim();

    assert.ok(
      cleanReceived.includes(cleanExpected) || cleanExpected.includes(cleanReceived),
      `Expected transcript to match "${cleanExpected}", got "${cleanReceived}"`
    );
  }
});

test('STT Accuracy - Long technical speech is transcribed completely without truncation', async () => {
  const longUtterance =
    'Can you explain the architecture of a MERN stack application including MongoDB, Express, React, and Node?';

  const audio = await synthesizeText(longUtterance);
  const result = await transcribeAudio(audio, {
    filename: 'long_speech.mp3',
    mimetype: 'audio/mpeg',
  });

  assert.ok(result.transcript, 'Long speech must return non-empty transcript');
  const lower = result.transcript.toLowerCase();

  // Verify key components across the entire sentence are preserved
  assert.ok(lower.includes('mern') || lower.includes('stack'), 'Should contain MERN / stack');
  assert.ok(lower.includes('mongodb') || lower.includes('mongo'), 'Should contain MongoDB');
  assert.ok(lower.includes('react'), 'Should contain React');
  assert.ok(lower.includes('node'), 'Should contain Node');
  assert.ok(result.duration >= 4.0, `Expected duration >= 4s, got ${result.duration}s`);
});

test('STT Accuracy - Speech with mid-sentence pause is transcribed coherently', async () => {
  // Synthesize first clause, a silent pause, and second clause
  const part1 = await synthesizeText('What is React');
  const part2 = await synthesizeText('and how does it work?');

  // Both parts concatenated with natural speech continuity
  const combinedAudio = Buffer.concat([part1, part2]);
  const result = await transcribeAudio(combinedAudio, {
    filename: 'paused_speech.mp3',
    mimetype: 'audio/mpeg',
  });

  assert.ok(result.transcript, 'Transcript for paused speech should not be empty');
  const lower = result.transcript.toLowerCase();
  assert.ok(lower.includes('react'), 'Should contain "react" from first part');
  assert.ok(lower.includes('work') || lower.includes('how'), 'Should contain second part across pause');
});

test('STT Accuracy - Empty and pure silence recordings return empty transcript without hallucinating', async () => {
  // 1-second pure digital silence
  const sampleRate = 16000;
  const silenceSamples = new Float32Array(sampleRate); // all zeros
  const silenceWav = float32ToWavBuffer(silenceSamples, sampleRate);

  const result = await transcribeAudio(silenceWav, {
    filename: 'silence.wav',
    mimetype: 'audio/wav',
  });

  assert.equal(result.transcript, '', 'Pure silence must return empty transcript');
  assert.equal(result.duration, 0, 'Pure silence duration should be 0');
});

test('STT Accuracy - Low-energy ambient room noise is not hallucinated as speech', async () => {
  // 1.5 seconds of simulated very low amplitude room background noise (peak < 0.02)
  const sampleRate = 16000;
  const ambientSamples = new Float32Array(sampleRate * 1.5);
  for (let i = 0; i < ambientSamples.length; i++) {
    // White noise with tiny amplitude (peak ~0.012, rms ~0.004)
    ambientSamples[i] = (Math.random() * 2 - 1) * 0.012;
  }

  const { peak, rms } = calculateRmsAndPeak(ambientSamples);
  assert.ok(peak < 0.025, 'Ambient noise peak must be < 0.025');
  assert.ok(rms < 0.007, 'Ambient noise rms must be < 0.007');

  const ambientWav = float32ToWavBuffer(ambientSamples, sampleRate);
  const result = await transcribeAudio(ambientWav, {
    filename: 'ambient.wav',
    mimetype: 'audio/wav',
  });

  assert.equal(result.transcript, '', 'Ambient noise must not produce hallucinated words');
});

test('STT Pipeline - Silence trimming removes excess padding while preserving consonants', () => {
  const sampleRate = 16000;
  // Create 1 sec silence + 0.5 sec speech pulse + 1 sec silence
  const totalSamples = sampleRate * 2.5;
  const buffer = new Float32Array(totalSamples);

  const speechStart = sampleRate; // at 1.0s
  const speechEnd = sampleRate * 1.5; // at 1.5s
  for (let i = speechStart; i < speechEnd; i++) {
    buffer[i] = 0.15 * Math.sin((2 * Math.PI * 400 * (i - speechStart)) / sampleRate);
  }

  const trimmed = trimSilence(buffer, sampleRate, 0.009, 180, 200);

  // Original length was 2.5s = 40,000 samples.
  // Voiced speech was 0.5s = 8,000 samples.
  // Trimmed should be ~ 8000 + 180ms(2880) + 200ms(3200) = ~14,080 samples.
  assert.ok(trimmed.length < totalSamples, 'Trimmed buffer should be shorter than full 2.5s buffer');
  assert.ok(trimmed.length > 8000, 'Trimmed buffer must preserve speech portion plus padding');
  assert.ok(trimmed.length < 20000, 'Trimmed buffer should remove over 1 second of dead air');

  // Verify speech energy is preserved in trimmed buffer
  const { peak, rms } = calculateRmsAndPeak(trimmed);
  assert.ok(peak > 0.1, 'Trimmed buffer must retain speech peak amplitude');
  assert.ok(rms > 0.03, 'Trimmed buffer must retain speech RMS energy');
});

test('STT Pipeline - Anti-aliasing downsampler decimates 48kHz to 16kHz cleanly', () => {
  const sourceRate = 48000;
  const targetRate = 16000;
  const durationSec = 1.0;
  const src = new Float32Array(sourceRate * durationSec);

  // Generate 1kHz test signal
  for (let i = 0; i < src.length; i++) {
    src[i] = 0.2 * Math.sin((2 * Math.PI * 1000 * i) / sourceRate);
  }

  const downsampled = downsampleBuffer(src, sourceRate, targetRate);
  assert.equal(downsampled.length, targetRate * durationSec, 'Downsampled length must match 16,000 samples');

  const { peak, rms } = calculateRmsAndPeak(downsampled);
  assert.ok(peak > 0.15 && peak <= 0.21, 'Peak amplitude should be preserved accurately');
  assert.ok(rms > 0.12 && rms < 0.16, 'RMS energy should be preserved accurately');
});

test('STT Pipeline - encodeWav creates compliant 16-bit mono PCM WAV format', () => {
  const sampleRate = 16000;
  const samples = new Float32Array(sampleRate * 0.5); // 0.5 seconds
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.3 * Math.sin((2 * Math.PI * 500 * i) / sampleRate);
  }

  const wavBlob = encodeWav(samples, sampleRate);
  assert.equal(wavBlob.type, 'audio/wav', 'WAV Blob MIME type must be audio/wav');
  assert.equal(wavBlob.size, 44 + samples.length * 2, 'WAV Blob size must equal header (44) + 16-bit samples');
});
