// Folder import — walk a FileSystemDirectoryHandle recursively and yield every
// markdown / text file we can read. The picker is invoked from the panel
// (a window context where FSA works); the indexing happens after we already
// have the file contents in memory, so no FSA permission needs to outlive
// the import gesture.
//
// Pure-ish: the walker only uses the structural FileSystemDirectoryHandle
// surface (values() / kind / name / getFile), so tests can drive it with an
// in-memory stand-in.

/** Structural shape of the FSA directory handle we depend on. Matches the
 * subset used by Chrome's File System Access API. */
export interface FsdHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FsHandle>;
}

export interface FsFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<{ text(): Promise<string>; size: number }>;
}

export type FsHandle = FsdHandle | FsFileHandle;

export interface WalkedFile {
  /** Slash-joined path relative to the picked root. */
  path: string;
  /** Full file contents as UTF-8 text. */
  content: string;
  /** Byte size of the source file (from File.size). */
  size: number;
}

/** Extensions we accept as RAG-friendly content. Anything else is skipped. */
const TEXT_EXTS = ['.md', '.markdown', '.txt', '.mdx'];

/** Hard cap on file size to keep one runaway document from blowing the index.
 * 1 MB of text comfortably fits the largest README; bigger and we skip. */
const MAX_FILE_BYTES = 1_000_000;

/**
 * Recursively walk `root`, yielding every readable text file. Files that fail
 * to read (permission, race, binary) are skipped with a console.warn rather
 * than aborting the whole import.
 */
export async function* walkFolder(root: FsdHandle, prefix = ''): AsyncGenerator<WalkedFile> {
  for await (const entry of root.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      yield* walkFolder(entry, path);
    } else if (isTextFile(entry.name)) {
      try {
        const file = await entry.getFile();
        if (file.size > MAX_FILE_BYTES) continue;
        const content = await file.text();
        if (content.trim()) yield { path, content, size: file.size };
      } catch {
        // Could be a permission glitch on a hidden / locked file; skip.
      }
    }
  }
}

/** Test-friendly synchronous list collector — drains the async iterator. */
export async function collectFolder(root: FsdHandle): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  for await (const f of walkFolder(root)) out.push(f);
  return out;
}

/** Lowercased-extension check for the allow-list above. */
export function isTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  return TEXT_EXTS.some((ext) => lower.endsWith(ext));
}

/** Build a stable per-folder doc id (folder-name + relative path). The library
 * pipeline's contentHash check then makes re-imports idempotent. */
export function importDocRef(rootName: string, path: string): string {
  return `${rootName}/${path}`;
}
