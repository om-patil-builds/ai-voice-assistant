import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeMarathiAudio, MARATHI_VOICES, formatMarathiTextForTTS, rateToProsody } from '../src/providers/marathiTts.js';
import http from 'http';
import express from 'express';
import ttsRouter from '../src/routes/tts.js';

test('MarathiTTS - formatMarathiTextForTTS cleans spaces and formats pauses', () => {
  assert.equal(
    formatMarathiTextForTTS('  नमस्कार!   मी   येथे   आहे।काळजी घ्या.  '),
    'नमस्कार! मी येथे आहे। काळजी घ्या.'
  );
  assert.equal(formatMarathiTextForTTS(''), '');
  assert.equal(formatMarathiTextForTTS(null), '');
});

test('MarathiTTS - rateToProsody converts rate factor to SSML prosody percentage', () => {
  assert.equal(rateToProsody(1.0), '+0%');
  assert.equal(rateToProsody(1.2), '+20%');
  assert.equal(rateToProsody(0.8), '-20%');
  assert.equal(rateToProsody(2.5), '+100%'); // Clamped to 2.0 max (+100%)
  assert.equal(rateToProsody(0.2), '-50%'); // Clamped to 0.5 min (-50%)
});

test('MarathiTTS - synthesizes actual audio output for greeting in Marathi (Aarohi voice)', async () => {
  const text = 'नमस्कार! मी तुमचा व्हॉइस असिस्टंट आहे.';
  const buffer = await synthesizeMarathiAudio(text, {
    voice: MARATHI_VOICES.AAROHI,
    rate: 1.0,
  });

  assert.ok(buffer instanceof Buffer, 'Output must be a Node.js Buffer');
  assert.ok(buffer.length > 5000, `Audio buffer should contain valid audio data, got ${buffer.length} bytes`);

  // Verify MP3 header (either ID3 tag or MPEG sync frame 0xFF)
  const isId3 = buffer.subarray(0, 3).toString('ascii') === 'ID3';
  const isMpegSync = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
  assert.ok(isId3 || isMpegSync, 'Audio output must have valid MP3 binary header');
});

test('MarathiTTS - synthesizes actual audio output for technical sentence (Manohar voice)', async () => {
  const text = 'मर्न स्टॅकमध्ये मोंगोडीबी, एक्सप्रेस, रिअॅक्ट आणि नोड जेएस यांचा समावेश होतो.';
  const buffer = await synthesizeMarathiAudio(text, {
    voice: MARATHI_VOICES.MANOHAR,
    rate: 1.1,
  });

  assert.ok(buffer instanceof Buffer);
  assert.ok(buffer.length > 10000, `Audio buffer length must be significant, got ${buffer.length} bytes`);
});

test('MarathiTTS - synthesizes actual audio with Marathi retroflex letter ळ and conjuncts', async () => {
  const text = 'वेळेवर काळजीपूर्वक काम केले तर यश नक्कीच मिळते.';
  const buffer = await synthesizeMarathiAudio(text, {
    voice: MARATHI_VOICES.AAROHI,
    rate: 1.0,
  });

  assert.ok(buffer instanceof Buffer);
  assert.ok(buffer.length > 8000, `Audio buffer length must be substantial, got ${buffer.length} bytes`);
});

test('MarathiTTS - REST API /api/tts endpoint streams valid audio/mpeg', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/tts', ttsRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. GET /api/tts/voices
    const voicesRes = await fetch(`http://localhost:${port}/api/tts/voices`);
    assert.equal(voicesRes.status, 200);
    const voices = await voicesRes.json();
    assert.ok(Array.isArray(voices));
    assert.ok(voices.some((v) => v.voiceURI === 'mr-IN-AarohiNeural'));
    assert.ok(voices.some((v) => v.voiceURI === 'mr-IN-ManoharNeural'));

    // 2. GET /api/tts with query params
    const audioRes = await fetch(
      `http://localhost:${port}/api/tts?text=${encodeURIComponent('मी तुम्हाला कशी मदत करू शकतो?')}&voice=mr-IN-AarohiNeural`
    );
    assert.equal(audioRes.status, 200);
    assert.equal(audioRes.headers.get('content-type'), 'audio/mpeg');

    const audioArrayBuffer = await audioRes.arrayBuffer();
    const audioBuf = Buffer.from(audioArrayBuffer);
    assert.ok(audioBuf.length > 5000, `API response should contain at least 5000 bytes, got ${audioBuf.length}`);

    // 3. Validation: Missing text returns 400
    const emptyRes = await fetch(`http://localhost:${port}/api/tts?text=`);
    assert.equal(emptyRes.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
