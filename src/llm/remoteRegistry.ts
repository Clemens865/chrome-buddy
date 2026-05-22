// Signed remote registry updates (FR-MR-5/6, NFR-SEC-5). A CDN may publish an
// updated model/provider registry; we accept it ONLY if its Ed25519 signature
// verifies against the bundled public key and it passes schema validation. The
// verified registry is cached as "last-good" and merged BETWEEN the bundled
// floor and the user overlay (precedence: user > remote > bundled). A bad or
// unsigned payload is rejected and the last-good (or bundled) is retained.
import { DEFAULT_REGISTRY } from './registry.default';
import type { ModelRegistry } from './types';

/** Bundled Ed25519 public key (raw, base64). The publisher holds the private key. */
export const REGISTRY_PUBLIC_KEY = 'ZL7VtEcqaialYJU2yp3vaYcXOC5j1b1Dv+czsjr1gjg=';

/** Where signed registry updates are published (best-effort fetch). */
export const REMOTE_REGISTRY_URL = 'https://cdn.chrome-buddy.dev/registry.signed.json';

export const REMOTE_REGISTRY_KEY = 'remoteRegistry';

/** A published registry + a detached Ed25519 signature over JSON.stringify(registry). */
export interface SignedRegistry {
  registry: ModelRegistry;
  /** base64 Ed25519 signature of the UTF-8 bytes of JSON.stringify(registry). */
  signature: string;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function majorOf(version: string): string {
  return String(version ?? '').split('.')[0];
}

/** Shape + schema-version compatibility check (FR-MR-5). */
export function validateRegistryShape(reg: unknown): reg is ModelRegistry {
  if (!reg || typeof reg !== 'object') return false;
  const r = reg as Record<string, unknown>;
  if (typeof r.providers !== 'object' || r.providers === null) return false;
  if (typeof r.models !== 'object' || r.models === null) return false;
  // Major schema version must match the bundled one (forward-compat within major).
  if (typeof r.schemaVersion === 'string' && majorOf(r.schemaVersion) !== majorOf(DEFAULT_REGISTRY.schemaVersion)) {
    return false;
  }
  return true;
}

/**
 * Verify an Ed25519-signed registry against a public key and validate its shape.
 * Returns the registry on success, or null on bad signature / bad shape.
 */
export async function verifyAndValidate(payload: SignedRegistry, publicKeyB64: string): Promise<ModelRegistry | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || !payload || typeof payload.signature !== 'string') return null;
  try {
    const key = await subtle.importKey('raw', b64ToBytes(publicKeyB64) as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    const data = new TextEncoder().encode(JSON.stringify(payload.registry)) as BufferSource;
    const ok = await subtle.verify('Ed25519', key, b64ToBytes(payload.signature) as BufferSource, data);
    if (!ok) return null;
    return validateRegistryShape(payload.registry) ? payload.registry : null;
  } catch {
    return null;
  }
}

// ---- storage (last-good) -------------------------------------------------

function area() {
  return typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
}

export async function loadRemoteRegistry(): Promise<ModelRegistry | null> {
  const store = area();
  if (!store) return null;
  return ((await store.get(REMOTE_REGISTRY_KEY))[REMOTE_REGISTRY_KEY] as ModelRegistry | undefined) ?? null;
}

async function saveRemoteRegistry(reg: ModelRegistry): Promise<void> {
  await area()?.set({ [REMOTE_REGISTRY_KEY]: reg });
}

/**
 * Fetch + verify a signed registry update. On success the verified registry
 * becomes the new last-good; on ANY failure the last-good is retained (FR-MR-6).
 * Returns true only when a new verified registry was stored.
 */
export async function updateRemoteRegistry(
  url: string = REMOTE_REGISTRY_URL,
  publicKeyB64: string = REGISTRY_PUBLIC_KEY,
): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return false;
    const payload = (await res.json()) as SignedRegistry;
    const verified = await verifyAndValidate(payload, publicKeyB64);
    if (!verified) return false; // unsigned/tampered/incompatible → reject, keep last-good
    await saveRemoteRegistry(verified);
    return true;
  } catch {
    return false; // network/parse error → keep last-good
  }
}
