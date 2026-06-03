import { describe, it, expect } from 'vitest';
import { encodeWavPcm16, concatFloat32 } from './wav';

function str(view: DataView, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe('encodeWavPcm16', () => {
  it('writes a valid 44-byte WAV header with the right sizes + rate', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const wav = encodeWavPcm16(samples, 16000);
    const view = new DataView(wav.buffer);
    expect(str(view, 0, 4)).toBe('RIFF');
    expect(str(view, 8, 4)).toBe('WAVE');
    expect(str(view, 12, 4)).toBe('fmt ');
    expect(str(view, 36, 4)).toBe('data');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits/sample
    // data length = 5 samples * 2 bytes; file = 44 + 10.
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getUint32(4, true)).toBe(36 + 10);
    expect(wav.length).toBe(54);
  });

  it('encodes samples as little-endian PCM16, clamping out-of-range values', () => {
    const wav = encodeWavPcm16(new Float32Array([0, 1, -1, 2]), 16000);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(0x7fff); // +1 → max
    expect(view.getInt16(48, true)).toBe(-0x8000); // -1 → min
    expect(view.getInt16(50, true)).toBe(0x7fff); // +2 clamped to +1
  });
});

describe('concatFloat32', () => {
  it('flattens chunks in order', () => {
    const out = concatFloat32([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });
  it('returns an empty buffer for no chunks', () => {
    expect(concatFloat32([]).length).toBe(0);
  });
});

import { pcm16ToWav } from './wav';
describe('pcm16ToWav', () => {
  it('prepends a valid 44-byte WAV header to raw PCM at the given rate', () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6]); // 6 PCM bytes
    const wav = pcm16ToWav(pcm, 24000);
    const v = new DataView(wav.buffer);
    const s = (o: number, n: number) => { let r=''; for (let i=0;i<n;i++) r+=String.fromCharCode(v.getUint8(o+i)); return r; };
    expect(s(0, 4)).toBe('RIFF');
    expect(s(8, 4)).toBe('WAVE');
    expect(s(36, 4)).toBe('data');
    expect(v.getUint32(24, true)).toBe(24000);   // sample rate
    expect(v.getUint16(34, true)).toBe(16);       // bits/sample
    expect(v.getUint32(40, true)).toBe(6);        // data length
    expect(wav.length).toBe(44 + 6);
    // The original PCM bytes are preserved after the header.
    expect(Array.from(wav.subarray(44))).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
