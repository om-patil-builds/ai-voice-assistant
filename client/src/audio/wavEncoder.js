/**
 * WAV audio encoding and resampling utilities for real-time speech processing.
 * Converts raw Float32Array PCM audio chunks to 16-bit mono PCM WAV at 16,000 Hz,
 * matching Whisper's native acoustic input format without lossy compression.
 */

/**
 * Merge an array of Float32Array chunks into a single Float32Array
 * @param {Float32Array[]} chunks
 * @returns {Float32Array}
 */
export function mergeBuffers(chunks) {
  if (!chunks || chunks.length === 0) return new Float32Array(0);
  let totalLength = 0;
  for (let i = 0; i < chunks.length; i++) {
    totalLength += chunks[i].length;
  }

  const result = new Float32Array(totalLength);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    result.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return result;
}

/**
 * Downsample Float32Array from sourceSampleRate to targetSampleRate (e.g., 48000 -> 16000)
 * Uses linear interpolation for clean acoustic frequency preservation.
 *
 * @param {Float32Array} buffer
 * @param {number} sourceSampleRate
 * @param {number} [targetSampleRate=16000]
 * @returns {Float32Array}
 */
export function downsampleBuffer(buffer, sourceSampleRate, targetSampleRate = 16000) {
  if (!buffer || buffer.length === 0) return new Float32Array(0);
  if (sourceSampleRate === targetSampleRate) return buffer;

  const ratio = sourceSampleRate / targetSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const originalPos = i * ratio;
    const leftIndex = Math.floor(originalPos);
    const rightIndex = Math.min(leftIndex + 1, buffer.length - 1);
    const fraction = originalPos - leftIndex;

    result[i] = buffer[leftIndex] * (1 - fraction) + buffer[rightIndex] * fraction;
  }

  return result;
}

/**
 * Compute RMS (Root Mean Square) energy and peak amplitude from a Float32Array
 * @param {Float32Array} buffer
 * @returns {{ rms: number, peak: number }}
 */
export function calculateRmsAndPeak(buffer) {
  if (!buffer || buffer.length === 0) return { rms: 0, peak: 0 };
  let sumSquares = 0;
  let peak = 0;
  const len = buffer.length;

  for (let i = 0; i < len; i++) {
    const val = buffer[i];
    const abs = Math.abs(val);
    if (abs > peak) peak = abs;
    sumSquares += val * val;
  }

  return {
    rms: Math.sqrt(sumSquares / len),
    peak,
  };
}

/**
 * Encode Float32Array PCM samples into a standard 16-bit mono PCM WAV Blob.
 *
 * @param {Float32Array} samples - Audio samples normalized between -1.0 and 1.0
 * @param {number} [sampleRate=16000] - Sample rate in Hz (default 16kHz for Whisper)
 * @returns {Blob} WAV Blob with mimetype 'audio/wav'
 */
export function encodeWav(samples, sampleRate = 16000) {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF Chunk Descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true); // ChunkSize
  writeString(8, 'WAVE');

  // "fmt " Sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true); // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample / 8)
  view.setUint16(32, 2, true); // BlockAlign (NumChannels * BitsPerSample / 8)
  view.setUint16(34, 16, true); // BitsPerSample (16-bit)

  // "data" Sub-chunk
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true); // Subchunk2Size

  // Write 16-bit PCM samples with [-1.0, 1.0] clamping
  let offset = 44;
  for (let i = 0; i < numSamples; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}
