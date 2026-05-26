import { describe, it, expect } from 'vitest';
import {
  floatToInt16,
  int16ToFloat,
  int16ToBase64,
  base64ToInt16,
  floatToBase64Pcm16,
  base64Pcm16ToFloat,
  resampleFloat,
} from './livePcm';

describe('floatToInt16 / int16ToFloat', () => {
  it('clamps ±1.0 to the full Int16 range', () => {
    const out = floatToInt16(new Float32Array([1, -1]));
    expect(out[0]).toBe(0x7fff);
    expect(out[1]).toBe(-0x8000);
  });

  it('round-trips small values within 1 LSB', () => {
    const floats = new Float32Array([0, 0.25, -0.25, 0.5, -0.5]);
    const back = int16ToFloat(floatToInt16(floats));
    for (let i = 0; i < floats.length; i++) {
      expect(Math.abs(back[i] - floats[i])).toBeLessThan(2 / 0x10000);
    }
  });

  it('clamps out-of-range float input', () => {
    const out = floatToInt16(new Float32Array([2, -2, 1.5]));
    expect(out[0]).toBe(0x7fff);
    expect(out[1]).toBe(-0x8000);
    expect(out[2]).toBe(0x7fff);
  });
});

describe('base64 round-trip (explicit little-endian)', () => {
  it('round-trips arbitrary Int16 sequences', () => {
    const input = new Int16Array([0, 1, -1, 0x7fff, -0x8000, 1234, -5678]);
    const out = base64ToInt16(int16ToBase64(input));
    expect(Array.from(out)).toEqual(Array.from(input));
  });

  it('produces standard base64 (matches a known fixed payload)', () => {
    // Two samples: 0x0001 and 0x0002 → LE bytes 01 00 02 00 → b64 'AQACAA=='
    const b64 = int16ToBase64(new Int16Array([1, 2]));
    expect(b64).toBe('AQACAA==');
  });

  it('floatToBase64Pcm16 + base64Pcm16ToFloat round-trip floats', () => {
    const input = new Float32Array([0, 0.5, -0.5, 0.999, -0.999]);
    const out = base64Pcm16ToFloat(floatToBase64Pcm16(input));
    for (let i = 0; i < input.length; i++) {
      expect(Math.abs(out[i] - input[i])).toBeLessThan(2 / 0x10000);
    }
  });
});

describe('resampleFloat', () => {
  it('returns input untouched when rates match', () => {
    const samples = new Float32Array([0, 0.5, 1, 0.5, 0]);
    const out = resampleFloat(samples, 16000, 16000);
    expect(out).toBe(samples);
  });

  it('downsamples 48k → 16k to roughly 1/3 the length', () => {
    const samples = new Float32Array(48_000 / 100); // 10 ms at 48 kHz = 480 samples
    samples.fill(0.5);
    const out = resampleFloat(samples, 48_000, 16_000);
    expect(out.length).toBe(Math.floor(samples.length / 3));
    // Constant input → constant output.
    for (const v of out) expect(v).toBeCloseTo(0.5, 5);
  });

  it('preserves the peak of a linear ramp under linear interpolation', () => {
    const samples = new Float32Array(96);
    for (let i = 0; i < samples.length; i++) samples[i] = i / samples.length;
    const out = resampleFloat(samples, 48_000, 16_000);
    // Last output sample ≈ last input sample (within interpolation step).
    expect(out[out.length - 1]).toBeCloseTo(samples[samples.length - 1], 1);
  });

  it('returns an empty array for empty input', () => {
    const out = resampleFloat(new Float32Array(0), 48_000, 16_000);
    expect(out.length).toBe(0);
  });
});
