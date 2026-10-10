import express from 'express';
import { synthesizeMarathiAudio, MARATHI_VOICES, DEFAULT_MARATHI_VOICE } from '../providers/marathiTts.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

/**
 * GET /api/tts/voices
 * Lists available natural Marathi neural voices
 */
router.get('/voices', (req, res) => {
  res.json([
    {
      name: 'Marathi (Aarohi Neural - mr-IN)',
      voiceURI: MARATHI_VOICES.AAROHI,
      lang: 'mr-IN',
      gender: 'Female',
      isDefault: true,
    },
    {
      name: 'Marathi (Manohar Neural - mr-IN)',
      voiceURI: MARATHI_VOICES.MANOHAR,
      lang: 'mr-IN',
      gender: 'Male',
      isDefault: false,
    },
  ]);
});

/**
 * Handle TTS audio synthesis
 */
async function handleTtsRequest(req, res) {
  const text = (req.method === 'POST' ? req.body?.text : req.query?.text) || '';
  const voice = (req.method === 'POST' ? req.body?.voice : req.query?.voice) || DEFAULT_MARATHI_VOICE;
  const rate = Number(req.method === 'POST' ? req.body?.rate : req.query?.rate) || 1.0;

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Parameter "text" is required for speech synthesis.',
    });
  }

  try {
    const audioBuffer = await synthesizeMarathiAudio(text.trim(), { voice, rate });

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'public, max-age=86400',
      'Accept-Ranges': 'bytes',
    });

    return res.status(200).send(audioBuffer);
  } catch (err) {
    logger.error('Marathi TTS synthesis endpoint error:', err);
    return res.status(500).json({
      error: 'TTSSynthesisError',
      message: err.message || 'Failed to synthesize Marathi audio.',
    });
  }
}

router.get('/', handleTtsRequest);
router.post('/', handleTtsRequest);

export default router;
