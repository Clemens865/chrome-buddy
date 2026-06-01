import { describe, it, expect } from 'vitest';
import {
  decideBySimilarity,
  parseConsolidationDecision,
  consolidatePrompt,
  consolidateAndIndex,
  REPLACE_THRESHOLD,
  CONSIDER_THRESHOLD,
  type SimilarDoc,
  type ConsolidateDeps,
} from './consolidate';

function makeDeps(similar: SimilarDoc[], judgeReply = '{"action":"keep_separate"}') {
  const calls = { index: [] as { content: string }[], remove: [] as string[], judge: 0 };
  const deps: ConsolidateDeps = {
    findSimilar: async () => similar,
    judge: async () => {
      calls.judge += 1;
      return judgeReply;
    },
    index: async (i) => {
      calls.index.push({ content: i.content });
    },
    remove: async (id) => {
      calls.remove.push(id);
    },
  };
  return { deps, calls };
}

const doc = (id: string, score: number): SimilarDoc => ({ id, title: id, content: `body ${id}`, score });
const input = { source: 'manual', sourceRef: 'new', title: 'New', content: 'new content' };

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

describe('consolidateAndIndex', () => {
  it('no similar doc → indexes as-is, no judge call', async () => {
    const { deps, calls } = makeDeps([]);
    const r = await consolidateAndIndex(input, deps);
    expect(r).toMatchObject({ action: 'keep_separate', indexed: true });
    expect(calls.index).toHaveLength(1);
    expect(calls.judge).toBe(0);
  });

  it('obvious near-duplicate → REPLACE without an LLM (remove old + index new)', async () => {
    const { deps, calls } = makeDeps([doc('old', 0.95)]);
    const r = await consolidateAndIndex(input, deps);
    expect(r.action).toBe('replace');
    expect(calls.judge).toBe(0); // threshold fast-path
    expect(calls.remove).toEqual(['old']);
    expect(calls.index).toHaveLength(1);
  });

  it('clearly distinct → KEEP_SEPARATE without an LLM', async () => {
    const { deps, calls } = makeDeps([doc('old', 0.4)]);
    const r = await consolidateAndIndex(input, deps);
    expect(r.action).toBe('keep_separate');
    expect(calls.judge).toBe(0);
    expect(calls.remove).toHaveLength(0);
    expect(calls.index).toHaveLength(1);
  });

  it('ambiguous + judge says SKIP → indexes nothing', async () => {
    const { deps, calls } = makeDeps([doc('old', 0.85)], '{"action":"skip","reason":"redundant"}');
    const r = await consolidateAndIndex(input, deps);
    expect(r).toMatchObject({ action: 'skip', indexed: false, matched: { id: 'old' } });
    expect(calls.judge).toBe(1);
    expect(calls.index).toHaveLength(0);
    expect(calls.remove).toHaveLength(0);
  });

  it('ambiguous + judge says MERGE → removes old, indexes the merged content', async () => {
    const { deps, calls } = makeDeps([doc('old', 0.85)], '{"action":"merge","mergedContent":"combined body"}');
    const r = await consolidateAndIndex(input, deps);
    expect(r.action).toBe('merge');
    expect(calls.remove).toEqual(['old']);
    expect(calls.index).toEqual([{ content: 'combined body' }]);
  });
});
