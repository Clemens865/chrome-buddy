import { describe, it, expect } from 'vitest';
import { pageItemsToText, assemblePdfText } from './pdfText';

describe('pageItemsToText', () => {
  it('spaces adjacent runs and breaks lines at EOL items', () => {
    const text = pageItemsToText([
      { str: 'Hello' }, { str: 'world', hasEOL: true }, { str: 'next line', hasEOL: true },
    ]);
    expect(text).toBe('Hello world\nnext line');
  });
  it('does not double-space runs that already end in a space', () => {
    expect(pageItemsToText([{ str: 'a ' }, { str: 'b' }])).toBe('a b');
  });
  it('tolerates empty / malformed items', () => {
    expect(pageItemsToText([{ str: '' }, { str: 'x', hasEOL: true }])).toBe('x');
  });
});

describe('assemblePdfText', () => {
  it('joins non-empty pages with blank lines', () => {
    expect(assemblePdfText(['page one', '', '  ', 'page two'])).toBe('page one\n\npage two');
  });
  it('returns empty for an all-blank document', () => {
    expect(assemblePdfText(['', '   '])).toBe('');
  });
});
