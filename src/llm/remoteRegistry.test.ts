import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { verifyAndValidate, validateRegistryShape, type SignedRegistry } from './remoteRegistry';
import type { ModelRegistry } from './types';

// Ensure globalThis.crypto.subtle (Ed25519) is available for the module + signing.
beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    (globalThis as { crypto?: unknown }).crypto = webcrypto;
  }
});

const subtle = webcrypto.subtle;

const validRegistry: ModelRegistry = {
  schemaVersion: '1.1',
  defaultModel: 'gemini-2.5-flash',
  providers: { 'google-gemini': { id: 'google-gemini', displayName: 'G', adapter: 'openai-compatible', baseUrl: 'https://x', auth: { method: 'bearer', keyRef: 'secret:g' } } },
  models: {},
};

async function sign(reg: ModelRegistry): Promise<{ payload: SignedRegistry; publicKeyB64: string }> {
  const kp = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const data = new TextEncoder().encode(JSON.stringify(reg));
  const sig = await subtle.sign('Ed25519', kp.privateKey, data);
  const pub = await subtle.exportKey('raw', kp.publicKey);
  return {
    payload: { registry: reg, signature: Buffer.from(sig).toString('base64') },
    publicKeyB64: Buffer.from(pub).toString('base64'),
  };
}

describe('validateRegistryShape', () => {
  it('accepts a well-formed, compatible registry', () => {
    expect(validateRegistryShape(validRegistry)).toBe(true);
  });
  it('rejects missing models/providers and incompatible major version', () => {
    expect(validateRegistryShape({ providers: {}, schemaVersion: '1.0' })).toBe(false);
    expect(validateRegistryShape({ ...validRegistry, schemaVersion: '2.0' })).toBe(false);
  });
});

describe('verifyAndValidate (Ed25519)', () => {
  it('accepts a correctly-signed registry', async () => {
    const { payload, publicKeyB64 } = await sign(validRegistry);
    expect(await verifyAndValidate(payload, publicKeyB64)).toEqual(validRegistry);
  });

  it('rejects a tampered signature', async () => {
    const { payload, publicKeyB64 } = await sign(validRegistry);
    const tampered = { ...payload, signature: payload.signature.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) };
    expect(await verifyAndValidate(tampered, publicKeyB64)).toBeNull();
  });

  it('rejects a payload signed by a different key', async () => {
    const { payload } = await sign(validRegistry);
    const other = await sign(validRegistry); // different keypair
    expect(await verifyAndValidate(payload, other.publicKeyB64)).toBeNull();
  });

  it('rejects a validly-signed but malformed registry', async () => {
    const bad = { schemaVersion: '1.1', providers: {} } as unknown as ModelRegistry; // no models
    const { payload, publicKeyB64 } = await sign(bad);
    expect(await verifyAndValidate(payload, publicKeyB64)).toBeNull();
  });
});
