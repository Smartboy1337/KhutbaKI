export interface AudioMetricsResult {
  rms: number;
  peak: number;
  dbFs: number;
  meterPercent: number;
  isClipping: boolean;
  isAboveThreshold: boolean;
}

export function analyzeTimeDomainSamples(
  samples: Float32Array,
  thresholdDb: number
): AudioMetricsResult {
  if (samples.length === 0) {
    return {
      rms: 0,
      peak: 0,
      dbFs: -60,
      meterPercent: 0,
      isClipping: false,
      isAboveThreshold: false
    };
  }

  let sumSquares = 0;
  let peak = 0;

  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
    sumSquares += samples[i] * samples[i];
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  const rawDb = rms > 0 ? 20 * Math.log10(rms) : -60;
  const dbFs = Math.max(-60, Math.min(0, Number(rawDb.toFixed(1))));
  const meterPercent = Math.round(((dbFs + 60) / 60) * 100);
  const isClipping = peak >= 0.985;
  const isAboveThreshold = dbFs >= thresholdDb;

  return {
    rms,
    peak,
    dbFs,
    meterPercent,
    isClipping,
    isAboveThreshold
  };
}

export function encodeFloat32To16kWav(
  chunks: Float32Array[],
  inputSampleRate: number,
  options?: { autoNormalize?: boolean; targetPeak?: number }
): ArrayBuffer {
  let totalLength = 0;
  for (const c of chunks) totalLength += c.length;

  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }

  let maxPeak = 0;
  for (let i = 0; i < merged.length; i++) {
    const abs = Math.abs(merged[i]);
    if (abs > maxPeak) maxPeak = abs;
  }

  // Automatische Pegel-Anpassung für leise Headsets (max. 4x Boost, ignoriert Grundrauschen)
  let postGain = 1.0;
  if (options?.autoNormalize && maxPeak > 0.006) {
    const target = options.targetPeak ?? 0.78;
    if (maxPeak < target) {
      postGain = Math.min(4.0, target / maxPeak);
    }
  }

  const targetRate = 16000;
  const ratio = inputSampleRate / targetRate;
  const newLength = Math.max(1, Math.floor(merged.length / ratio));
  const downsampled = new Int16Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(merged.length, Math.floor((i + 1) * ratio));
    let acc = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      acc += merged[j];
      count++;
    }
    const rawSample = (count > 0 ? acc / count : merged[start] ?? 0) * postGain;
    // Soft-Knee Limiter verhindert hartes Knacken bei lautem Sprechen
    const limited = Math.abs(rawSample) > 0.92 ? Math.tanh(rawSample) : rawSample;
    const clamped = Math.max(-1, Math.min(1, limited));
    downsampled[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const dataByteLength = downsampled.length * 2;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  const writeString = (pos: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(pos + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataByteLength, true);

  let byteOffset = 44;
  for (let i = 0; i < downsampled.length; i++, byteOffset += 2) {
    view.setInt16(byteOffset, downsampled[i], true);
  }

  return buffer;
}
