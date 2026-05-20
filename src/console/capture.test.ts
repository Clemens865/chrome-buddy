// Unit tests for the PURE Console Buddy helpers — no chrome, no network.
import { describe, it, expect } from 'vitest';
import {
  dedupeEntries,
  countByLevel,
  mostFrequentError,
  normalizeLevel,
  type RawLogEntry,
} from './capture';
import { buildAnalysisPrompt } from './analyze';
import { selectEntries } from './tools';

function raw(level: RawLogEntry['level'], text: string, ts = 1000, source?: string): RawLogEntry {
  return { level, text, ts, source };
}

describe('normalizeLevel', () => {
  it('maps CDP levels to stable LogLevels', () => {
    expect(normalizeLevel('error')).toBe('error');
    expect(normalizeLevel('assert')).toBe('error');
    expect(normalizeLevel('exception')).toBe('error');
    expect(normalizeLevel('warning')).toBe('warn');
    expect(normalizeLevel('WARN')).toBe('warn');
    expect(normalizeLevel('info')).toBe('log');
    expect(normalizeLevel('network')).toBe('net');
    expect(normalizeLevel('whatever')).toBe('log');
  });
});

describe('dedupeEntries', () => {
  it('groups identical entries and counts occurrences', () => {
    const out = dedupeEntries([
      raw('error', 'Boom', 1000),
      raw('error', 'Boom', 1200),
      raw('error', 'Boom', 900),
      raw('log', 'hi', 1100),
    ]);
    expect(out).toHaveLength(2);
    const boom = out.find((e) => e.text === 'Boom')!;
    expect(boom.count).toBe(3);
    expect(boom.ts).toBe(900); // earliest timestamp kept
  });

  it('normalizes whitespace before comparing', () => {
    const out = dedupeEntries([
      raw('warn', 'too   slow'),
      raw('warn', 'too slow'),
      raw('warn', '  too slow  '),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(3);
    expect(out[0].text).toBe('too slow');
  });

  it('keeps the first-seen source when later dupes lack one', () => {
    const out = dedupeEntries([
      raw('error', 'X', 1000),
      raw('error', 'X', 1100, 'https://a.test/app.js'),
    ]);
    expect(out[0].source).toBe('https://a.test/app.js');
  });

  it('preserves first-seen order deterministically', () => {
    const out = dedupeEntries([raw('log', 'b'), raw('log', 'a'), raw('log', 'b')]);
    expect(out.map((e) => e.text)).toEqual(['b', 'a']);
  });

  it('treats different levels with the same text as distinct', () => {
    const out = dedupeEntries([raw('error', 'same'), raw('warn', 'same')]);
    expect(out).toHaveLength(2);
  });
});

describe('countByLevel', () => {
  it('sums grouped counts per level', () => {
    const deduped = dedupeEntries([
      raw('error', 'a'),
      raw('error', 'a'),
      raw('warn', 'b'),
      raw('net', 'GET /x'),
    ]);
    expect(countByLevel(deduped)).toEqual({ error: 2, warn: 1, log: 0, net: 1 });
  });
});

describe('mostFrequentError', () => {
  it('returns the highest-count error', () => {
    const deduped = dedupeEntries([
      raw('error', 'rare'),
      raw('error', 'common'),
      raw('error', 'common'),
      raw('warn', 'noise'),
    ]);
    expect(mostFrequentError(deduped)?.text).toBe('common');
  });

  it('returns undefined when there are no errors', () => {
    const deduped = dedupeEntries([raw('log', 'hi'), raw('warn', 'eh')]);
    expect(mostFrequentError(deduped)).toBeUndefined();
  });
});

describe('buildAnalysisPrompt', () => {
  it('summarizes counts and surfaces the most frequent error', () => {
    const deduped = dedupeEntries([
      raw('error', 'TypeError: x is undefined'),
      raw('error', 'TypeError: x is undefined'),
      raw('warn', 'deprecated API'),
      raw('net', 'GET /api'),
    ]);
    const prompt = buildAnalysisPrompt(deduped);
    expect(prompt).toContain('Console Buddy');
    expect(prompt).toContain('2 error(s)');
    expect(prompt).toContain('seen 2x');
    expect(prompt).toContain('TypeError: x is undefined');
    expect(prompt).toContain('Other context:');
  });

  it('is deterministic for the same input', () => {
    const deduped = dedupeEntries([raw('error', 'Boom')]);
    expect(buildAnalysisPrompt(deduped)).toBe(buildAnalysisPrompt(deduped));
  });

  it('reports a healthy/empty console when nothing captured', () => {
    expect(buildAnalysisPrompt([])).toContain('No console output was captured.');
  });
});

describe('selectEntries', () => {
  const deduped = dedupeEntries([
    raw('error', 'e1'),
    raw('warn', 'w1'),
    raw('log', 'l1'),
    raw('net', 'GET /x'),
  ]);

  it('filters by level', () => {
    expect(selectEntries(deduped, { level: 'error' })).toHaveLength(1);
    expect(selectEntries(deduped, { level: 'error' })[0].text).toBe('e1');
  });

  it('returns everything for "all" or no filter', () => {
    expect(selectEntries(deduped, { level: 'all' })).toHaveLength(4);
    expect(selectEntries(deduped, {})).toHaveLength(4);
  });

  it('applies a most-recent limit', () => {
    expect(selectEntries(deduped, { limit: 2 })).toHaveLength(2);
    expect(selectEntries(deduped, { limit: 2 }).map((e) => e.text)).toEqual(['l1', 'GET /x']);
  });
});
