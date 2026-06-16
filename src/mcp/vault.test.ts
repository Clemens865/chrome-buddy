// Vault tests — AES-GCM seal/open round-trips. The pure core (sealWith/openWith)
// runs against a freshly generated key; the persisted path (seal/open +
// getOrCreateKey) uses fake-indexeddb to prove the non-extractable key survives
// an IDB store/load and decrypts what it sealed.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { sealWith, openWith, seal, open, getOrCreateKey, isSealed } from './vault';

async function freshKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

describe('vault crypto core', () => {
  it('seals then opens back to the original plaintext', async () => {
    const key = await freshKey();
    const sealed = await sealWith(key, 'refresh-token-xyz');
    expect(sealed.v).toBe(1);
    expect(sealed.ct).not.toContain('refresh-token-xyz'); // not stored in clear
    expect(await openWith(key, sealed)).toBe('refresh-token-xyz');
  });

  it('uses a fresh IV each call (different ciphertext for the same plaintext)', async () => {
    const key = await freshKey();
    const a = await sealWith(key, 'same');
    const b = await sealWith(key, 'same');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(await openWith(key, a)).toBe('same');
    expect(await openWith(key, b)).toBe('same');
  });

  it('fails to decrypt with the wrong key (AES-GCM auth tag)', async () => {
    const sealed = await sealWith(await freshKey(), 'secret');
    await expect(openWith(await freshKey(), sealed)).rejects.toThrow();
  });

  it('round-trips unicode', async () => {
    const key = await freshKey();
    const s = 'rt_üñ✓_🔐';
    expect(await openWith(key, await sealWith(key, s))).toBe(s);
  });
});

describe('vault persisted key', () => {
  it('getOrCreateKey returns a stable non-extractable key across calls', async () => {
    const k1 = await getOrCreateKey();
    const k2 = await getOrCreateKey();
    expect(k1.extractable).toBe(false);
    // Sealed by one fetch, opened by another → same underlying key.
    const sealed = await sealWith(k1, 'persisted');
    expect(await openWith(k2, sealed)).toBe('persisted');
  });

  it('seal/open use the persisted vault key end-to-end', async () => {
    const sealed = await seal('end-to-end');
    expect(isSealed(sealed)).toBe(true);
    expect(await open(sealed)).toBe('end-to-end');
  });
});

describe('isSealed', () => {
  it('accepts a well-formed envelope and rejects junk', () => {
    expect(isSealed({ v: 1, iv: 'a', ct: 'b' })).toBe(true);
    expect(isSealed({ v: 2, iv: 'a', ct: 'b' })).toBe(false);
    expect(isSealed({ iv: 'a' })).toBe(false);
    expect(isSealed(null)).toBe(false);
    expect(isSealed('nope')).toBe(false);
  });
});
