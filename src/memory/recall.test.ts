import { describe, it, expect } from 'vitest';
import { tokenize, jaccard, findSimilarRun } from './recall';
import type { RunRecord } from './types';

const run = (id: string, task: string, answer = 'done'): RunRecord => ({
  id,
  kind: 'agent',
  task,
  answer,
  outcome: 'completed',
  toolCount: 1,
  tools: [],
  provenance: [],
  model: 'm',
  startedAt: 1,
  durationMs: 1,
});

describe('tokenize', () => {
  it('drops stopwords and short tokens', () => {
    expect([...tokenize('Summarize the page for me')]).toEqual(['summarize', 'page']);
  });
});

describe('jaccard', () => {
  it('is 1 for identical sets and 0 for disjoint', () => {
    expect(jaccard(tokenize('extract headlines'), tokenize('extract headlines'))).toBe(1);
    expect(jaccard(tokenize('extract headlines'), tokenize('cook dinner'))).toBe(0);
  });
});

describe('findSimilarRun', () => {
  const runs = [
    run('1', 'Extract the top headlines from this news page'),
    run('2', 'Translate this paragraph to German'),
  ];

  it('finds a similar past run', () => {
    const m = findSimilarRun('Extract the headlines from the page', runs);
    expect(m?.run.id).toBe('1');
  });

  it('returns null for an unrelated or too-vague task', () => {
    expect(findSimilarRun('book a flight to Tokyo', runs)).toBeNull();
    expect(findSimilarRun('hi', runs)).toBeNull();
  });

  it('ignores runs with no answer', () => {
    const empty = [run('3', 'Extract the top headlines from this news page', '')];
    expect(findSimilarRun('extract the headlines from the page', empty)).toBeNull();
  });
});
