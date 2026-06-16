// At-rest encryption for secrets we must persist across browser restarts
// (currently: MCP OAuth refresh tokens). The encryption KEY is a 256-bit
// AES-GCM CryptoKey generated with extractable:false and stored in a dedicated
// IndexedDB. WebCrypto guarantees the raw key bytes are never exposed to JS —
// even our own code can only USE the key to encrypt/decrypt, never read it. So
// the ciphertext written to chrome.storage.local is bound to this browser
// profile's keystore and is useless if the file is copied off the machine
// (backups, sync, offline forensics, local file scans).
//
// HONEST LIMIT: this does NOT defend against malicious code running in our own
// extension origin — that code holds the same decrypt capability we do. Beating
// that would need a user passphrase (key never persisted), at the cost of
// re-entry on every restart. We deliberately chose silent-restart UX here.
//
// The crypto core (sealWith/openWith) is pure given a CryptoKey, so it's
// unit-tested without touching IDB; seal/open wrap it with the persisted key.

import { openDB, type IDBPDatabase } from 'idb';

const VAULT_DB = 'chrome-buddy-vault';
const VAULT_STORE = 'crypto';
const KEY_ID = 'mcp-oauth-aes-gcm';
const IV_BYTES = 12; // 96-bit nonce, the AES-GCM standard.

/** Ciphertext envelope persisted to storage.local. iv + ct are base64. */
export interface Sealed {
  v: 1;
  iv: string;
  ct: string;
}

let vaultPromise: Promise<IDBPDatabase> | null = null;
function vaultDB(): Promise<IDBPDatabase> {
  if (!vaultPromise) {
    vaultPromise = openDB(VAULT_DB, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(VAULT_STORE)) d.createObjectStore(VAULT_STORE);
      },
    });
  }
  return vaultPromise;
}

/** Load the vault's AES-GCM key, generating + persisting it on first use. The
 *  key is non-extractable: it can be stored/loaded as a CryptoKey handle but its
 *  bytes can never be read back via exportKey. */
export async function getOrCreateKey(): Promise<CryptoKey> {
  const db = await vaultDB();
  const existing = (await db.get(VAULT_STORE, KEY_ID)) as CryptoKey | undefined;
  if (existing) return existing;
  const key = await globalThis.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // extractable: false — the whole point
    ['encrypt', 'decrypt'],
  );
  await db.put(VAULT_STORE, key, KEY_ID);
  return key;
}

// ----- base64 helpers (raw bytes ↔ string) ---------------------------------

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ----- Pure crypto core (testable with any CryptoKey) ----------------------

/** Encrypt a UTF-8 string with the given key + a fresh random IV. */
export async function sealWith(key: CryptoKey, plaintext: string): Promise<Sealed> {
  // Declare-then-fill so iv keeps its narrow Uint8Array<ArrayBuffer> type
  // (getRandomValues' return widens to ArrayBufferLike, which BufferSource
  // rejects under TS lib's strict typed-array generics).
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(iv);
  const data = new Uint8Array(new TextEncoder().encode(plaintext));
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { v: 1, iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
}

/** Decrypt a Sealed envelope back to the original string. Throws if the key is
 *  wrong or the ciphertext was tampered with (AES-GCM is authenticated). */
export async function openWith(key: CryptoKey, sealed: Sealed): Promise<string> {
  const iv = b64ToBytes(sealed.iv);
  const ct = b64ToBytes(sealed.ct);
  const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ----- Public API (uses the persisted vault key) ---------------------------

export async function seal(plaintext: string): Promise<Sealed> {
  return sealWith(await getOrCreateKey(), plaintext);
}

export async function open(sealed: Sealed): Promise<string> {
  return openWith(await getOrCreateKey(), sealed);
}

/** Narrowing guard for values read back from storage.local. */
export function isSealed(v: unknown): v is Sealed {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Sealed).v === 1 &&
    typeof (v as Sealed).iv === 'string' &&
    typeof (v as Sealed).ct === 'string'
  );
}
