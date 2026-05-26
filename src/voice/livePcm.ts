// Pure PCM + base64 helpers for the Gemini Live voice path.
//
// Wire format (per ai.google.dev/api/live):
//   - Input  audio: raw 16-bit PCM, 16 kHz, mono, little-endian, base64'd.
//   - Output audio: raw 16-bit PCM, 24 kHz, mono, little-endian, base64'd.
//
// All functions here are pure (no Audio APIs, no chrome) so they can be
// unit-tested without a browser audio runtime.

/**
 * Convert a Float32Array of audio samples (range −1..1) into a base64 string
 * of little-endian 16-bit signed PCM. Used on the panel side before sending
 * a capture chunk through the Port to the SW.
 */
export function floatToBase64Pcm16(samples: Float32Array): string {
  const i16 = floatToInt16(samples);
  return int16ToBase64(i16);
}

/**
 * Convert a base64 string of 16-bit signed little-endian PCM back into a
 * Float32Array (range −1..1). Used on the panel side when the SW forwards
 * an `audio.data` chunk from the model response.
 */
export function base64Pcm16ToFloat(b64: string): Float32Array {
  const i16 = base64ToInt16(b64);
  return int16ToFloat(i16);
}

/** Pure: Float32Array → Int16Array. Clamps to ±1.0 then scales to ±32767. */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Pure: Int16Array → Float32Array, normalized to ±1.0. */
export function int16ToFloat(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] < 0 ? samples[i] / 0x8000 : samples[i] / 0x7fff;
  }
  return out;
}

/**
 * Pure: serialize an Int16Array as base64 with explicit little-endian byte
 * order, regardless of the host CPU's endianness. We do not rely on the
 * Int16Array buffer view's native order because it may not be LE on every
 * platform.
 */
export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    bytes[i * 2] = v & 0xff;
    bytes[i * 2 + 1] = (v >> 8) & 0xff;
  }
  return uint8ToBase64(bytes);
}

/** Pure: base64 → Int16Array. Mirrors int16ToBase64 (explicit LE). */
export function base64ToInt16(b64: string): Int16Array {
  const bytes = base64ToUint8(b64);
  const out = new Int16Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = (bytes[i * 2 + 1] << 8) | bytes[i * 2];
    // Sign-extend manually — the shift above produces an unsigned 16-bit
    // pattern in a JS Number; re-interpret as signed.
    if (out[i] >= 0x8000) out[i] -= 0x10000;
  }
  return out;
}

/**
 * Linearly resample a Float32Array from `fromHz` to `toHz`. Good enough for
 * voice (we're not chasing audiophile fidelity — Gemini Live's docs only
 * require 16 kHz on the input side). Pure, no DSP libs needed.
 */
export function resampleFloat(samples: Float32Array, fromHz: number, toHz: number): Float32Array {
  if (fromHz === toHz || samples.length === 0) return samples;
  const ratio = fromHz / toHz;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const a = Math.floor(srcIdx);
    const b = Math.min(a + 1, samples.length - 1);
    const frac = srcIdx - a;
    out[i] = samples[a] * (1 - frac) + samples[b] * frac;
  }
  return out;
}

// --- base64 helpers (without atob/btoa global assumptions for tests) -------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    // Convert bytes → binary string → btoa. Chrome handles up to ~100KB
    // strings comfortably; our audio chunks are well under that.
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  // Manual fallback (used in node/test environments without btoa).
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = bytes[i + 1] ?? 0;
    const b3 = bytes[i + 2] ?? 0;
    out += B64[b1 >> 2];
    out += B64[((b1 & 3) << 4) | (b2 >> 4)];
    out += i + 1 < bytes.length ? B64[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b3 & 63] : '=';
  }
  return out;
}

function base64ToUint8(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Manual fallback.
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = B64.indexOf(clean[i]);
    const c2 = B64.indexOf(clean[i + 1]);
    const c3 = B64.indexOf(clean[i + 2] ?? '=');
    const c4 = B64.indexOf(clean[i + 3] ?? '=');
    bytes.push((c1 << 2) | (c2 >> 4));
    if (c3 !== -1) bytes.push(((c2 & 15) << 4) | (c3 >> 2));
    if (c4 !== -1) bytes.push(((c3 & 3) << 6) | c4);
  }
  return new Uint8Array(bytes);
}
