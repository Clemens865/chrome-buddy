// File System Access root folder (PRD FR-FS-1..3, FR-TOOLS-10).
//
// The user picks a root folder ONCE (a gesture, in the panel — not the SW),
// granting read+write to that tree. We persist the handle in IndexedDB and
// re-verify permission per session. read_file/write_file resolve paths relative
// to this root. The picker + handle live in the window/panel context because
// FileSystemDirectoryHandle cannot cross into a service worker.
import { getDB } from '../db';

const STORE = 'fsroot';
const KEY = 'root';

/** Minimal structural types so the path logic is testable without the DOM API. */
export interface DirHandleLike {
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandleLike>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
}
export interface FileHandleLike {
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

/** Whether the File System Access API is available in this context. */
export function isFsSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** Sanitise + split a relative path into safe segments (no abs paths / `..`). */
export function splitPath(path: string): string[] {
  return String(path ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..');
}

/**
 * Drop a leading segment that just repeats the root folder's own name. Models
 * often echo the chosen folder into the path (e.g. root "Notes" + "Notes/x.md"),
 * which would otherwise nest a redundant subfolder. Keep the segment if it's the
 * whole path (a file named exactly like the folder at the root). Case-insensitive.
 */
export function stripRootName(segs: string[], rootName?: string): string[] {
  if (rootName && segs.length > 1 && segs[0].toLowerCase() === rootName.toLowerCase()) {
    return segs.slice(1);
  }
  return segs;
}

/** Read a file under `root` by relative path. Throws if it doesn't exist. */
export async function readFileAt(root: DirHandleLike, path: string): Promise<string> {
  const segs = stripRootName(splitPath(path), root.name);
  if (segs.length === 0) throw new Error('A file path is required.');
  let dir = root;
  for (let i = 0; i < segs.length - 1; i++) dir = await dir.getDirectoryHandle(segs[i]);
  const fileHandle = await dir.getFileHandle(segs[segs.length - 1]);
  const file = await fileHandle.getFile();
  return file.text();
}

/** Write (creating dirs as needed) a file under `root` by relative path. */
export async function writeFileAt(root: DirHandleLike, path: string, contents: string): Promise<string> {
  const segs = stripRootName(splitPath(path), root.name);
  if (segs.length === 0) throw new Error('A file path is required.');
  let dir = root;
  for (let i = 0; i < segs.length - 1; i++) dir = await dir.getDirectoryHandle(segs[i], { create: true });
  const fileHandle = await dir.getFileHandle(segs[segs.length - 1], { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(contents);
  await writable.close();
  return segs.join('/');
}

// ---- Browser-bound: picker + persistence + permission --------------------

type FsdHandle = FileSystemDirectoryHandle & {
  queryPermission?(d: { mode: string }): Promise<PermissionState>;
  requestPermission?(d: { mode: string }): Promise<PermissionState>;
};

/** Show the directory picker (needs a user gesture) and persist the handle. */
export async function pickRootFolder(): Promise<string | null> {
  if (!isFsSupported()) return null;
  const picker = (window as unknown as { showDirectoryPicker(o?: unknown): Promise<FsdHandle> }).showDirectoryPicker;
  const handle = await picker({ mode: 'readwrite' });
  const db = await getDB();
  await db.put(STORE, handle, KEY);
  return handle.name;
}

/** The persisted root handle, or null if none has been picked. */
export async function getRootHandle(): Promise<FsdHandle | null> {
  const db = await getDB();
  return ((await db.get(STORE, KEY)) as FsdHandle | undefined) ?? null;
}

/** Forget the root folder. */
export async function forgetRootFolder(): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, KEY);
}

/** Name of the chosen root folder, or null. */
export async function rootFolderName(): Promise<string | null> {
  const h = await getRootHandle();
  return h?.name ?? null;
}

/** Ensure read (or readwrite) permission on the handle; may need a gesture.
 *
 * File System Access permissions reset to "prompt" each browser session and
 * `requestPermission` needs a transient user gesture. We bound the request with
 * a timeout so a stuck/unanswerable prompt (a known side-panel quirk) fails
 * cleanly instead of freezing the run. Re-granting happens at the Approve click
 * (a real gesture) — see ChatView; by the time a write runs, this is "granted". */
interface PermissionHandle {
  queryPermission?(d: { mode: string }): Promise<PermissionState>;
  requestPermission?(d: { mode: string }): Promise<PermissionState>;
}
export async function ensureHandlePermission(
  handle: PermissionHandle,
  mode: 'read' | 'readwrite',
  timeoutMs = 15_000,
): Promise<boolean> {
  if ((await handle.queryPermission?.({ mode })) === 'granted') return true;
  if (!handle.requestPermission) return false;
  const timeout = new Promise<PermissionState>((r) => setTimeout(() => r('prompt'), timeoutMs));
  const granted = await Promise.race([handle.requestPermission({ mode }), timeout]).catch(() => 'prompt');
  return granted === 'granted';
}

/** Re-acquire permission on the chosen root folder. MUST be called from within a
 * user gesture (e.g. an Approve click) so `requestPermission` is allowed. */
export async function ensureRootPermission(mode: 'read' | 'readwrite' = 'readwrite'): Promise<boolean> {
  const root = await getRootHandle();
  if (!root) return false;
  return ensureHandlePermission(root, mode);
}

/** Read a file from the root folder (resolves the handle + permission first). */
export async function readFromRoot(path: string): Promise<string> {
  const root = await getRootHandle();
  if (!root) throw new Error('No root folder set. Choose one in Settings.');
  if (!(await ensureHandlePermission(root, 'read')))
    throw new Error('Folder access expired. Open Settings and reconnect the root folder, or re-approve the read.');
  return readFileAt(root as unknown as DirHandleLike, path);
}

/** Write a file to the root folder. Returns the relative path written. */
export async function writeToRoot(path: string, contents: string): Promise<string> {
  const root = await getRootHandle();
  if (!root) throw new Error('No root folder set. Choose one in Settings.');
  if (!(await ensureHandlePermission(root, 'readwrite')))
    throw new Error('Folder access expired. Open Settings and reconnect the root folder, or re-approve the write.');
  return writeFileAt(root as unknown as DirHandleLike, path, contents);
}
