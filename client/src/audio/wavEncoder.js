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
 * Downsample Float32Array from sourceSampleRate to targetSampleRate (e.g., 48000 -> 16000).
 * Implements an anti-aliased area-averaging filter to eliminate high-frequency aliasing
 * that occurs when decimating from 48kHz or 44.1kHz down to 16kHz.
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
  const newLength = Math.floor(buffer.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const startPos = i * ratio;
    const endPos = (i + 1) * ratio;

    let sum = 0;
    let weightSum = 0;

    const startIdx = Math.floor(startPos);
    const endIdx = Math.min(buffer.length - 1, Math.ceil(endPos));

    for (let j = startIdx; j <= endIdx; j++) {
      const sampleStart = j;
      const sampleEnd = j + 1;
      const overlapStart = Math.max(startPos, sampleStart);
      const overlapEnd = Math.min(endPos, sampleEnd);

      if (overlapEnd > overlapStart) {
        const weight = overlapEnd - overlapStart;
        sum += buffer[j] * weight;
        weightSum += weight;
      }
    }

    result[i] = weightSum > 0 ? sum / weightSum : buffer[startIdx];
  }

  return result;
}

/**
 * Trims excess silence from the start and end of a Float32Array speech buffer
 * while preserving natural pre-roll and post-roll acoustic padding.
 *
 * @param {Float32Array} buffer - Audio samples
 * @param {number} [sampleRate=16000] - Sample rate in Hz
 * @param {number} [threshold=0.009] - RMS silence threshold
 * @param {number} [leadingPadMs=180] - Leading silence padding (ms) to protect consonants
 * @param {number} [trailingPadMs=200] - Trailing silence padding (ms) to protect vowels
 * @returns {Float32Array} Trimmed audio buffer
 */
export function trimSilence(buffer, sampleRate = 16000, threshold = 0.009, leadingPadMs = 180, trailingPadMs = 200) {
  if (!buffer || buffer.length === 0) return new Float32Array(0);

  const windowSize = Math.max(128, Math.round(sampleRate * 0.015)); // ~15ms window
  const totalSamples = buffer.length;

  let firstVoicedIdx = -1;
  let lastVoicedIdx = -1;

  for (let i = 0; i <= totalSamples - windowSize; i += windowSize) {
    let sumSq = 0;
    for (let j = 0; j < windowSize; j++) {
      const s = buffer[i + j];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / windowSize);

    if (rms >= threshold) {
      if (firstVoicedIdx === -1) {
        firstVoicedIdx = i;
      }
      lastVoicedIdx = i + windowSize;
    }
  }

  // If no speech found, return buffer as-is (let downstream silence analyzer handle)
  if (firstVoicedIdx === -1) {
    return buffer;
  }

  const leadingPadSamples = Math.round((leadingPadMs / 1000) * sampleRate);
  const trailingPadSamples = Math.round((trailingPadMs / 1000) * sampleRate);

  const startIdx = Math.max(0, firstVoicedIdx - leadingPadSamples);
  const endIdx = Math.min(totalSamples, lastVoicedIdx + trailingPadSamples);

  return buffer.subarray(startIdx, endIdx);
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
