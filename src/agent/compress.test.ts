import { describe, it, expect } from 'vitest';
import { compressEvidence, oneLine } from './compress';

describe('oneLine', () => {
  it('collapses whitespace and clips with an ellipsis', () => {
    expect(oneLine('a\n\n  b   c', 100)).toBe('a b c');
    expect(oneLine('abcdef', 3)).toBe('abc…');
  });
});

describe('compressEvidence', () => {
  it('keeps recent results in full and summarizes older ones', () => {
    const items = [
      { toolName: 'read_dom', text: 'OLD PAGE '.repeat(2000) }, // huge, older
      { toolName: 'list_files', text: 'france.md, notes.txt' },
      { toolName: 'read_file', text: 'Paris is the capital of France.' },
    ];
    const out = compressEvidence(items, { keepRecent: 2, perActionChars: 1000, summaryChars: 50 });
    // Older read_dom is summarized (marked + short), recent two are full.
    expect(out).toContain('read_dom (earlier — summary)');
    expect(out).toContain('Paris is the capital of France.');
    expect(out).toContain('france.md, notes.txt');
    // The old dump is not included in full.
    expect(out).not.toContain('OLD PAGE '.repeat(50));
  });

  it('enforces a hard global cap, keeping the freshest evidence', () => {
    const items = [
      { toolName: 'a', text: 'X'.repeat(5000) },
      { toolName: 'b', text: 'FRESH-ANSWER' },
    ];
    const out = compressEvidence(items, { keepRecent: 2, perActionChars: 5000, totalChars: 200 });
    expect(out.length).toBeLessThanOrEqual(202); // 200 + leading "…\n"
    expect(out).toContain('FRESH-ANSWER');
  });
});
