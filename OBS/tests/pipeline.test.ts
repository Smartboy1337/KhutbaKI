import { describe, it, expect } from 'vitest';
import { analyzeTimeDomainSamples, encodeFloat32To16kWav } from '../src/renderer/src/audio/audioMetrics';
import { applyIslamicTerminology } from '../src/main/glossary';

describe('Khutbah AI – Echtzeit-Stream & Mehrzeilen-Pipeline', () => {
  it('erkennt Stille als -60 dBFS', () => {
    const silence = new Float32Array(1024).fill(0);
    const res = analyzeTimeDomainSamples(silence, -45);
    expect(res.dbFs).toBe(-60);
    expect(res.isAboveThreshold).toBe(false);
  });

  it('kodiert 48kHz Audio korrekt in 16kHz Mono RIFF-WAV', () => {
    const chunk = new Float32Array(4800).fill(0.25);
    const wav = encodeFloat32To16kWav([chunk], 48000);
    const view = new DataView(wav);
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    const sampleRate = view.getUint32(24, true);
    expect(riff).toBe('RIFF');
    expect(sampleRate).toBe(16000);
    expect(wav.byteLength).toBe(44 + 1600 * 2);
  });

  it('normalisiert islamische Begriffe im deutschen Zieltext', () => {
    const out = applyIslamicTerminology('Heute halten wir eine Freitagspredigt über Gottesfurcht.', 'خطبة التقوى');
    expect(out).toContain('Khutbah (Freitagspredigt)');
    expect(out).toContain('Taqwa (Gottesfurcht)');
  });

  it('hebt leise Headset-Signale per Auto-Gain sauber an ohne Clipping', () => {
    const quiet = new Float32Array(4800).fill(0.05);
    const wav = encodeFloat32To16kWav([quiet], 48000, { autoNormalize: true });
    const view = new DataView(wav);
    const firstSample = view.getInt16(44, true);
    expect(firstSample).toBeGreaterThan(6000);
    expect(firstSample).toBeLessThan(32767);
  });
});
