import { describe, it, expect } from 'vitest';
import { chunkMarkdown, splitIntoSections } from './chunk';

describe('splitIntoSections', () => {
  it('returns the whole text as one section when there are no headings', () => {
    const out = splitIntoSections('Just a paragraph.\n\nAnother one.');
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Just a paragraph.\n\nAnother one.');
  });

  it('treats preamble + each heading-rooted block as its own section', () => {
    const md = `preamble line\n\n# H1\nbody one\n\n## H2a\nbody two`;
    const out = splitIntoSections(md);
    expect(out.map((s) => s.text)).toEqual([
      'preamble line',
      '# H1\nbody one',
      '## H2a\nbody two',
    ]);
  });

  it('skips empty preambles', () => {
    const out = splitIntoSections('# Heading\nbody');
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('# Heading\nbody');
  });
});

describe('chunkMarkdown', () => {
  it('returns no chunks for empty / whitespace input', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   \n\n  ')).toEqual([]);
  });

  it('emits ONE chunk for a short section', () => {
    const out = chunkMarkdown('# Title\nshort body');
    expect(out).toHaveLength(1);
    expect(out[0].text).toMatch(/Title/);
    expect(out[0].charStart).toBe(0);
  });

  it('keeps short sections whole even with multiple headings', () => {
    const md = `# A\nsmall A\n\n## B\nsmall B\n\n## C\nsmall C`;
    const out = chunkMarkdown(md);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.text)).toEqual([
      '# A\nsmall A',
      '## B\nsmall B',
      '## C\nsmall C',
    ]);
  });

  it('windows long sections with overlap', () => {
    const longBody = 'x'.repeat(2000);
    const out = chunkMarkdown(longBody, { target: 500, overlap: 50, hardMax: 600 });
    // 2000 chars / (500 - 50 overlap) ≈ 4-5 chunks
    expect(out.length).toBeGreaterThanOrEqual(3);
    // Adjacent chunks must overlap (last 50 chars of N ⊂ first chars of N+1).
    for (let i = 1; i < out.length; i++) {
      expect(out[i].charStart).toBeLessThan(out[i - 1].charEnd);
    }
  });

  it('preserves character offsets that map back into the source', () => {
    const md = `preamble\n\n# Section\nbody body body`;
    const out = chunkMarkdown(md);
    for (const c of out) {
      expect(md.slice(c.charStart, c.charEnd)).toContain(c.text.slice(0, 8) ?? '');
    }
  });

  it('renumbers chunkIdx in document order', () => {
    const out = chunkMarkdown(`# A\na\n\n# B\nb\n\n# C\nc`);
    expect(out.map((c) => c.chunkIdx)).toEqual([0, 1, 2]);
  });

  it('breaks long unbroken text at a sentence boundary when possible', () => {
    const md = 'aaa. ' + 'b'.repeat(600) + '. ccc';
    const out = chunkMarkdown(md, { target: 400, overlap: 40, hardMax: 700 });
    // The first chunk should end with the matched . boundary, not mid-b.
    expect(out[0].text).toMatch(/\.$/);
  });
});
