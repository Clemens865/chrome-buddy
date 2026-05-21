import { describe, it, expect } from 'vitest';
import { splitPath, readFileAt, writeFileAt, type DirHandleLike } from './root';

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

describe('writeFileAt / readFileAt', () => {
  it('writes (creating nested dirs) then reads back', async () => {
    const root = fakeDir();
    const written = await writeFileAt(root, 'reports/2026/q1.md', '# hello');
    expect(written).toBe('reports/2026/q1.md');
    expect(await readFileAt(root, 'reports/2026/q1.md')).toBe('# hello');
  });

  it('throws reading a missing file and on empty path', async () => {
    const root = fakeDir();
    await expect(readFileAt(root, 'nope.txt')).rejects.toThrow();
    await expect(writeFileAt(root, '', 'x')).rejects.toThrow();
  });
});
