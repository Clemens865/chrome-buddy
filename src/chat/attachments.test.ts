// Pure tests for the composer's attachment helpers. No DOM, no FileReader —
// the UI hands these helpers already-decoded text or data URLs.
import { describe, it, expect } from 'vitest';
import {
  classifyFile,
  formatBytes,
  formatTextAttachments,
  imageAttachments,
  totalBytes,
  MAX_TOTAL_BYTES,
  MAX_TEXT_CHARS,
  type ChatAttachment,
} from './attachments';

describe('classifyFile', () => {
  it('routes supported image mimes to kind=image', () => {
    expect(classifyFile({ name: 'a.png', type: 'image/png', size: 1000 })).toEqual({ kind: 'image' });
    expect(classifyFile({ name: 'a.jpg', type: 'image/jpeg', size: 1000 })).toEqual({ kind: 'image' });
    expect(classifyFile({ name: 'a.webp', type: 'image/webp', size: 1000 })).toEqual({ kind: 'image' });
  });

  it('routes plain-text files to kind=text by mime', () => {
    expect(classifyFile({ name: 'notes.txt', type: 'text/plain', size: 100 })).toEqual({ kind: 'text' });
    expect(classifyFile({ name: 'page.html', type: 'text/html', size: 100 })).toEqual({ kind: 'text' });
  });

  it('routes by extension when mime is unknown', () => {
    expect(classifyFile({ name: 'notes.md', type: '', size: 100 })).toEqual({ kind: 'text' });
    expect(classifyFile({ name: 'config.toml', type: 'application/octet-stream', size: 100 })).toEqual({ kind: 'text' });
    expect(classifyFile({ name: 'data.json', type: '', size: 100 })).toEqual({ kind: 'text' });
  });

  it('rejects PDFs with a friendly reason', () => {
    const r = classifyFile({ name: 'paper.pdf', type: 'application/pdf', size: 10_000 });
    expect(r.kind).toBe('reject');
    if (r.kind === 'reject') expect(r.reason).toMatch(/PDF/i);
  });

  it('rejects empty files', () => {
    const r = classifyFile({ name: 'a.txt', type: 'text/plain', size: 0 });
    expect(r.kind).toBe('reject');
    if (r.kind === 'reject') expect(r.reason).toMatch(/empty/i);
  });

  it('rejects files over MAX_TOTAL_BYTES', () => {
    const r = classifyFile({ name: 'huge.png', type: 'image/png', size: MAX_TOTAL_BYTES + 1 });
    expect(r.kind).toBe('reject');
    if (r.kind === 'reject') expect(r.reason).toMatch(/max is/i);
  });

  it('rejects unsupported image formats with a concrete reason', () => {
    const r = classifyFile({ name: 'a.bmp', type: 'image/bmp', size: 100 });
    expect(r.kind).toBe('reject');
    if (r.kind === 'reject') expect(r.reason).toMatch(/PNG|JPEG|WebP/i);
  });

  it('rejects unknown binary files', () => {
    const r = classifyFile({ name: 'archive.zip', type: 'application/zip', size: 100 });
    expect(r.kind).toBe('reject');
  });
});

describe('formatBytes', () => {
  it('renders B/KB/MB with one decimal', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1_500_000)).toBe('1.4 MB');
  });
});

describe('totalBytes', () => {
  it('sums byte sizes across kinds', () => {
    const xs: ChatAttachment[] = [
      { kind: 'image', name: 'a.png', mime: 'image/png', dataUrl: '', size: 1000 },
      { kind: 'text', name: 'b.txt', mime: 'text/plain', text: '', size: 200 },
    ];
    expect(totalBytes(xs)).toBe(1200);
  });
});

describe('formatTextAttachments', () => {
  it('emits one fenced section per text attachment with a file-name header', () => {
    const out = formatTextAttachments([
      { kind: 'text', name: 'a.md', mime: 'text/markdown', text: 'hello', size: 5 },
      { kind: 'image', name: 'x.png', mime: 'image/png', dataUrl: '', size: 100 },
      { kind: 'text', name: 'b.txt', mime: 'text/plain', text: 'world', size: 5 },
    ]);
    expect(out).toContain('# Attached file: a.md');
    expect(out).toContain('# Attached file: b.txt');
    expect(out).not.toContain('x.png'); // image is filtered out of the text block
    expect(out).toContain('hello');
    expect(out).toContain('world');
    // Each body is fenced.
    expect(out.match(/```/g)?.length).toBe(4); // open + close per attachment
  });

  it('truncates oversized text bodies and notes it', () => {
    const long = 'x'.repeat(MAX_TEXT_CHARS + 100);
    const out = formatTextAttachments([
      { kind: 'text', name: 'big.txt', mime: 'text/plain', text: long, size: long.length },
    ]);
    expect(out).toContain('TRUNCATED');
    // The fence body should never exceed MAX_TEXT_CHARS.
    const fenceBody = out.split('```')[1] ?? '';
    expect(fenceBody.length).toBeLessThanOrEqual(MAX_TEXT_CHARS + 5); // + the \n padding
  });

  it('returns an empty string when there are no text attachments', () => {
    expect(formatTextAttachments([
      { kind: 'image', name: 'a.png', mime: 'image/png', dataUrl: '', size: 100 },
    ])).toBe('');
    expect(formatTextAttachments([])).toBe('');
  });
});

describe('imageAttachments', () => {
  it('returns only image-kind entries, preserving order', () => {
    const xs: ChatAttachment[] = [
      { kind: 'text', name: 'a', mime: '', text: '', size: 1 },
      { kind: 'image', name: 'b', mime: 'image/png', dataUrl: 'data:image/png;base64,b', size: 1 },
      { kind: 'image', name: 'c', mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,c', size: 1 },
    ];
    const imgs = imageAttachments(xs);
    expect(imgs).toHaveLength(2);
    expect(imgs[0].name).toBe('b');
    expect(imgs[1].name).toBe('c');
  });
});
