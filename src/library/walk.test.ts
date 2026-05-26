import { describe, it, expect } from 'vitest';
import { collectFolder, isTextFile, importDocRef, type FsdHandle, type FsFileHandle } from './walk';

// In-memory FSA stand-ins — match the structural surface walkFolder consumes.
function file(name: string, content: string): FsFileHandle {
  return {
    kind: 'file',
    name,
    async getFile() {
      return {
        size: new TextEncoder().encode(content).byteLength,
        async text() {
          return content;
        },
      };
    },
  };
}
function dir(name: string, ...children: Array<FsFileHandle | FsdHandle>): FsdHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const c of children) yield c;
    },
  };
}

describe('isTextFile', () => {
  it('accepts the markdown family', () => {
    for (const n of ['notes.md', 'a.MARKDOWN', 'doc.mdx', 'readme.txt']) {
      expect(isTextFile(n)).toBe(true);
    }
  });
  it('rejects binaries / unrelated formats', () => {
    for (const n of ['photo.png', 'archive.zip', 'app.exe', 'script.js', 'no-extension']) {
      expect(isTextFile(n)).toBe(false);
    }
  });
});

describe('walkFolder', () => {
  it('yields every text file across nested directories', async () => {
    const tree = dir(
      'notes',
      file('a.md', '# A'),
      dir(
        'inbox',
        file('b.md', '# B'),
        file('photo.jpg', 'binary-data'), // skipped
        dir('archive', file('c.txt', 'C content')),
      ),
      file('LICENSE', 'no extension is fine to skip'),
    );
    const got = await collectFolder(tree);
    expect(got.map((f) => f.path).sort()).toEqual([
      'a.md',
      'inbox/archive/c.txt',
      'inbox/b.md',
    ]);
  });

  it('reads UTF-8 content faithfully', async () => {
    const tree = dir('x', file('greet.md', '# Hi — émojis 🚀'));
    const got = await collectFolder(tree);
    expect(got[0].content).toBe('# Hi — émojis 🚀');
  });

  it('skips empty / whitespace-only files', async () => {
    const tree = dir('x', file('empty.md', '   \n\n'), file('real.md', '# real'));
    const got = await collectFolder(tree);
    expect(got.map((f) => f.path)).toEqual(['real.md']);
  });

  it('does not break when one file throws (permission glitch)', async () => {
    const broken: FsFileHandle = {
      kind: 'file',
      name: 'sealed.md',
      async getFile() {
        throw new Error('NotAllowed');
      },
    };
    const tree = dir('x', broken, file('ok.md', '# ok'));
    const got = await collectFolder(tree);
    expect(got.map((f) => f.path)).toEqual(['ok.md']);
  });

  it('skips oversized files (>1 MB) without aborting the walk', async () => {
    const huge = file('huge.md', 'x'.repeat(2_000_000));
    const tree = dir('x', huge, file('small.md', '# small'));
    const got = await collectFolder(tree);
    expect(got.map((f) => f.path)).toEqual(['small.md']);
  });
});

describe('importDocRef', () => {
  it('joins root name + path with a slash', () => {
    expect(importDocRef('notes', 'inbox/a.md')).toBe('notes/inbox/a.md');
    expect(importDocRef('notes', 'top.md')).toBe('notes/top.md');
  });
});
