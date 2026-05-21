import { describe, it, expect, vi, afterEach } from 'vitest';
import { sanitizeFilename, textDataUrl, executeFileWrite } from './fileWrite';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sanitizeFilename', () => {
  it('strips absolute paths and traversal', () => {
    expect(sanitizeFilename('/etc/passwd')).toBe('etc/passwd');
    expect(sanitizeFilename('../../secret.txt')).toBe('secret.txt');
    expect(sanitizeFilename('a\\b\\c.txt')).toBe('a/b/c.txt');
  });
  it('falls back for empty input', () => {
    expect(sanitizeFilename('')).toBe('buddy-file.txt');
  });
});

describe('textDataUrl', () => {
  it('encodes contents as a text data URL', () => {
    expect(textDataUrl('a b&c')).toBe('data:text/plain;charset=utf-8,a%20b%26c');
  });
});

describe('executeFileWrite', () => {
  it('downloads the file and returns its name + size', async () => {
    const download = vi.fn(async () => 42);
    vi.stubGlobal('chrome', { downloads: { download } });

    const res = await executeFileWrite({ path: 'out/notes.txt', contents: 'hello' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect((res.data as { filename: string }).filename).toBe('out/notes.txt');
      expect((res.data as { downloadId: number }).downloadId).toBe(42);
    }
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'out/notes.txt', saveAs: false, conflictAction: 'uniquify' }),
    );
  });

  it('errors without a path', async () => {
    vi.stubGlobal('chrome', { downloads: { download: vi.fn() } });
    const res = await executeFileWrite({ contents: 'x' });
    expect(res.ok).toBe(false);
  });
});
