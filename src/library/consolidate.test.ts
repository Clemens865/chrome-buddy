import { describe, it, expect } from 'vitest';
import {
  decideBySimilarity,
  parseConsolidationDecision,
  consolidatePrompt,
  REPLACE_THRESHOLD,
  CONSIDER_THRESHOLD,
} from './consolidate';

describe('decideBySimilarity', () => {
  it('REPLACEs an obvious near-duplicate without an LLM', () => {
    expect(decideBySimilarity(REPLACE_THRESHOLD)?.action).toBe('replace');
    expect(decideBySimilarity(0.99)?.action).toBe('replace');
  });
  it('KEEPs a clearly distinct doc without an LLM', () => {
    expect(decideBySimilarity(CONSIDER_THRESHOLD - 0.01)?.action).toBe('keep_separate');
    expect(decideBySimilarity(0.1)?.action).toBe('keep_separate');
  });
  it('returns null in the ambiguous band (worth one LLM call)', () => {
    expect(decideBySimilarity(0.85)).toBeNull();
    expect(decideBySimilarity(CONSIDER_THRESHOLD)).toBeNull();
  });
});

describe('parseConsolidationDecision', () => {
  it('parses each valid action', () => {
    expect(parseConsolidationDecision('{"action":"replace","reason":"fresher"}')).toMatchObject({ action: 'replace' });
    expect(parseConsolidationDecision('{"action":"skip"}').action).toBe('skip');
    expect(parseConsolidationDecision('{"action":"keep_separate"}').action).toBe('keep_separate');
  });
  it('keeps mergedContent for a merge', () => {
    const d = parseConsolidationDecision('{"action":"merge","mergedContent":"combined facts"}');
    expect(d).toMatchObject({ action: 'merge', mergedContent: 'combined facts' });
  });
  it('a merge with no content falls back to keep_separate (never drops data)', () => {
    expect(parseConsolidationDecision('{"action":"merge","mergedContent":"  "}').action).toBe('keep_separate');
    expect(parseConsolidationDecision('{"action":"merge"}').action).toBe('keep_separate');
  });
  it('an unknown action or junk falls back to keep_separate', () => {
    expect(parseConsolidationDecision('{"action":"delete"}').action).toBe('keep_separate');
    expect(parseConsolidationDecision('not json').action).toBe('keep_separate');
    expect(parseConsolidationDecision('').action).toBe('keep_separate');
  });
  it('tolerates a ```json fence + prose', () => {
    expect(parseConsolidationDecision('```json\n{"action":"skip"}\n```').action).toBe('skip');
    expect(parseConsolidationDecision('Sure: {"action":"replace"} done').action).toBe('replace');
  });
  it('lowercases the action', () => {
    expect(parseConsolidationDecision('{"action":"SKIP"}').action).toBe('skip');
  });
});

describe('consolidatePrompt', () => {
  it('pairs both docs and truncates very long content', () => {
    const out = consolidatePrompt({ title: 'A', content: 'x'.repeat(5000) }, { title: 'B', content: 'short' });
    expect(out).toContain('NEW note — "A"');
    expect(out).toContain('EXISTING note — "B"');
    expect(out).toContain('truncated');
    expect(out).toContain('short');
  });
});
