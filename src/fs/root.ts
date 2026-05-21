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

/** Read a file under `root` by relative path. Throws if it doesn't exist. */
export async function readFileAt(root: DirHandleLike, path: string): Promise<string> {
  const segs = splitPath(path);
  if (segs.length === 0) throw new Error('A file path is required.');
  let dir = root;
  for (let i = 0; i < segs.length - 1; i++) dir = await dir.getDirectoryHandle(segs[i]);
  const fileHandle = await dir.getFileHandle(segs[segs.length - 1]);
  const file = await fileHandle.getFile();
  return file.text();
}

/** Write (creating dirs as needed) a file under `root` by relative path. */
export async function writeFileAt(root: DirHandleLike, path: string, contents: string): Promise<string> {
  const segs = splitPath(path);
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

/** Ensure read (or readwrite) permission on the handle; may need a gesture. */
async function ensurePermission(handle: FsdHandle, mode: 'read' | 'readwrite'): Promise<boolean> {
  if (await handle.queryPermission?.({ mode }) === 'granted') return true;
  return (await handle.requestPermission?.({ mode })) === 'granted';
}

/** Read a file from the root folder (resolves the handle + permission first). */
export async function readFromRoot(path: string): Promise<string> {
  const root = await getRootHandle();
  if (!root) throw new Error('No root folder set. Choose one in Settings.');
  if (!(await ensurePermission(root, 'read'))) throw new Error('Read permission denied for the root folder.');
  return readFileAt(root as unknown as DirHandleLike, path);
}

/** Write a file to the root folder. Returns the relative path written. */
export async function writeToRoot(path: string, contents: string): Promise<string> {
  const root = await getRootHandle();
  if (!root) throw new Error('No root folder set. Choose one in Settings.');
  if (!(await ensurePermission(root, 'readwrite'))) throw new Error('Write permission denied for the root folder.');
  return writeFileAt(root as unknown as DirHandleLike, path, contents);
}
