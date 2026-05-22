import { describe, it, expect } from 'vitest';
import { splitPath, stripRootName, readFileAt, writeFileAt, type DirHandleLike } from './root';

// A tiny in-memory FileSystemDirectoryHandle stand-in.
function fakeDir(name = 'root'): DirHandleLike & { files: Map<string, string>; dirs: Map<string, ReturnType<typeof fakeDir>> } {
  const files = new Map<string, string>();
  const dirs = new Map<string, ReturnType<typeof fakeDir>>();
  return {
    name,
    files,
    dirs,
    async getDirectoryHandle(n: string, opts?: { create?: boolean }) {
      let d = dirs.get(n);
      if (!d) {
        if (!opts?.create) throw new Error(`no dir ${n}`);
        d = fakeDir(n);
        dirs.set(n, d);
      }
      return d;
    },
    async getFileHandle(n: string, opts?: { create?: boolean }) {
      if (!files.has(n) && !opts?.create) throw new Error(`no file ${n}`);
      return {
        async getFile() {
          return { async text() { return files.get(n) ?? ''; } };
        },
        async createWritable() {
          return {
            async write(data: string) { files.set(n, data); },
            async close() {},
          };
        },
      };
    },
  };
}

describe('splitPath', () => {
  it('strips absolute paths, traversal, and backslashes', () => {
    expect(splitPath('/a/../b\\c.txt')).toEqual(['a', 'b', 'c.txt']);
    expect(splitPath('  ./notes.md ')).toEqual(['notes.md']);
  });
});

describe('stripRootName', () => {
  it('drops a leading segment that repeats the root folder name (case-insensitive)', () => {
    expect(stripRootName(['Chrome-Buddy_Files', 'Vienna.md'], 'Chrome-Buddy_Files')).toEqual(['Vienna.md']);
    expect(stripRootName(['notes', 'a.txt'], 'Notes')).toEqual(['a.txt']);
  });
  it('keeps the path when it does not start with the root name, or is just the name', () => {
    expect(stripRootName(['Vienna.md'], 'Chrome-Buddy_Files')).toEqual(['Vienna.md']);
    expect(stripRootName(['data', 'out.csv'], 'Notes')).toEqual(['data', 'out.csv']);
    expect(stripRootName(['Notes'], 'Notes')).toEqual(['Notes']); // a file named like the folder
  });
});

describe('writeFileAt / readFileAt', () => {
  it('writes (creating nested dirs) then reads back', async () => {
    const root = fakeDir();
    const written = await writeFileAt(root, 'reports/2026/q1.md', '# hello');
    expect(written).toBe('reports/2026/q1.md');
    expect(await readFileAt(root, 'reports/2026/q1.md')).toBe('# hello');
  });

  it('does not nest a redundant subfolder when the path repeats the root name', async () => {
    const root = fakeDir('Chrome-Buddy_Files');
    const written = await writeFileAt(root, 'Chrome-Buddy_Files/Vienna.md', '# Vienna');
    expect(written).toBe('Vienna.md'); // stripped, written at the root
    expect(root.dirs.has('Chrome-Buddy_Files')).toBe(false);
    expect(await readFileAt(root, 'Vienna.md')).toBe('# Vienna');
  });

  it('throws reading a missing file and on empty path', async () => {
    const root = fakeDir();
    await expect(readFileAt(root, 'nope.txt')).rejects.toThrow();
    await expect(writeFileAt(root, '', 'x')).rejects.toThrow();
  });
});
