import { describe, it, expect } from 'vitest';
import { buildFixPrompt, buildSingleFixPrompt, buildBuddyChatPrompt } from './fixPrompt';
import type { ErrorMatch } from './errorPatterns';

const REACT_CRIT: ErrorMatch = {
  text: 'Error: Maximum update depth exceeded. This can happen when a component repeatedly calls setState.',
  category: 'React',
  framework: 'React',
  description: 'Infinite loop in useEffect or setState',
  suggestion: 'Check useEffect dependencies and avoid setState in render',
  severity: 'critical',
  docUrl: 'https://reactjs.org/docs/hooks-faq.html',
  count: 3,
};

const NULL_HIGH: ErrorMatch = {
  text: "TypeError: Cannot read properties of undefined (reading 'x')",
  category: 'Null Reference',
  framework: 'JavaScript',
  description: 'Attempting to access property on null/undefined',
  suggestion: 'Add null checks or use optional chaining (?.)',
  severity: 'high',
  count: 1,
};

describe('buildFixPrompt', () => {
  it('includes context (URL, title, stack) when provided', () => {
    const out = buildFixPrompt({
      matches: [REACT_CRIT],
      context: { url: 'https://example.com/app', title: 'My App', techStack: ['React', 'Next.js'] },
    });
    expect(out).toContain('https://example.com/app');
    expect(out).toContain('My App');
    expect(out).toContain('React, Next.js');
  });

  it('renders one section per matched error with diagnosis + fix + docUrl', () => {
    const out = buildFixPrompt({ matches: [REACT_CRIT, NULL_HIGH] });
    expect(out).toContain('## 1. React · React — `critical`');
    expect(out).toContain('## 2. Null Reference · JavaScript — `high`');
    expect(out).toContain('Diagnosis:** Infinite loop in useEffect or setState');
    expect(out).toContain('Suggested fix:** Add null checks or use optional chaining');
    expect(out).toContain('https://reactjs.org/docs/hooks-faq.html');
  });

  it('surfaces a count note when the pattern fired multiple times', () => {
    const out = buildFixPrompt({ matches: [REACT_CRIT] });
    expect(out).toContain('fired 3 time(s)');
  });

  it('falls back gracefully when there are no matches', () => {
    const out = buildFixPrompt({ matches: [] });
    expect(out).toContain('No known patterns matched');
  });

  it('truncates oversized matched text (does not let logs explode the prompt)', () => {
    const big: ErrorMatch = { ...NULL_HIGH, text: 'X'.repeat(2_000) };
    const out = buildFixPrompt({ matches: [big] });
    expect(out).toContain('…');
    expect(out.length).toBeLessThan(2_500);
  });

  it('ends with a numbered task block', () => {
    const out = buildFixPrompt({ matches: [NULL_HIGH] });
    expect(out).toMatch(/Your task[\s\S]*1\. .* locate the offending code/i);
    expect(out).toContain('Run the project test suite');
  });

  it('adds a stack-hint when raw logs surface a source URL for the match', () => {
    const out = buildFixPrompt({
      matches: [NULL_HIGH],
      logs: [
        {
          level: 'error',
          text: "TypeError: Cannot read properties of undefined (reading 'x')",
          source: 'https://example.com/static/main.abc123.js:42:18',
          ts: Date.now(),
          count: 1,
        },
      ],
    });
    expect(out).toMatch(/Stack hint:.+example\.com/);
  });

  it('appends a recent-console tail when logs are passed', () => {
    const out = buildFixPrompt({
      matches: [NULL_HIGH],
      logs: [
        { level: 'log', text: 'fetched user', ts: 1, count: 1 },
        { level: 'error', text: NULL_HIGH.text, ts: 2, count: 1, source: 'https://example.com/a.js:1:1' },
      ],
    });
    expect(out).toContain('## Recent console snapshot');
    expect(out).toContain('[error]');
  });
});

describe('buildSingleFixPrompt', () => {
  it('wraps buildFixPrompt with a single match', () => {
    const out = buildSingleFixPrompt(NULL_HIGH, { url: 'https://x.test' });
    expect(out).toContain('Null Reference');
    expect(out).toContain('https://x.test');
  });
});

describe('buildBuddyChatPrompt', () => {
  it('builds a tool-using compact prompt for the Buddy chat handoff', () => {
    const out = buildBuddyChatPrompt({
      matches: [REACT_CRIT, NULL_HIGH],
      context: { url: 'https://example.com/', techStack: ['React'] },
    });
    expect(out).toContain('list_files');
    expect(out).toContain('read_file');
    expect(out).toContain('[critical] React');
    expect(out).toContain('[high] Null Reference');
  });

  it('caps to the top 5 errors so the chat prompt stays small', () => {
    const many: ErrorMatch[] = Array.from({ length: 10 }, (_, i) => ({ ...NULL_HIGH, text: `err ${i}` }));
    const out = buildBuddyChatPrompt({ matches: many });
    // Expect 5 bullets, not 10.
    const bullets = out.match(/^- \[/gm) ?? [];
    expect(bullets).toHaveLength(5);
  });
});
