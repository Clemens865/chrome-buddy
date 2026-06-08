import { describe, it, expect } from 'vitest';
import {
  buildErrorAnalysisPrompt,
  parseErrorAnalysis,
  type ErrorAnalysisInput,
} from './errorAnalysis';
import type { ErrorMatch } from './errorPatterns';
import type { LogEntry } from './capture';

const match: ErrorMatch = {
  text: "TypeError: Cannot read properties of undefined (reading 'map')",
  category: 'Null Reference',
  framework: 'JavaScript',
  description: 'Attempting to access property on null/undefined',
  suggestion: 'Add null checks or use optional chaining (?.)',
  severity: 'high',
  count: 3,
};

const logs: LogEntry[] = [
  { level: 'error', text: "TypeError: Cannot read properties of undefined (reading 'map')", source: 'https://app.test/assets/main-abc.js:42:8', ts: 1, count: 3 },
  { level: 'warn', text: 'Missing Description for DialogContent', source: 'https://app.test/DialogContent.tsx:10', ts: 2, count: 1 },
  { level: 'log', text: 'just a log line', ts: 3, count: 1 },
];

describe('buildErrorAnalysisPrompt', () => {
  it('includes context, pre-diagnosed matches, and only error/warn raw lines', () => {
    const input: ErrorAnalysisInput = {
      matches: [match],
      logs,
      context: { url: 'https://app.test/', techStack: ['React', 'Next.js'] },
    };
    const p = buildErrorAnalysisPrompt(input);
    expect(p).toContain('https://app.test/');
    expect(p).toContain('React, Next.js');
    expect(p).toContain('[high] Null Reference · JavaScript');
    expect(p).toContain('main-abc.js:42:8'); // source carried through
    expect(p).toContain('Missing Description'); // warn included
    expect(p).not.toContain('just a log line'); // plain logs excluded
    // asks for the exact JSON shape
    expect(p).toContain('"summary"');
    expect(p).toContain('"aiPrompt"');
  });

  it('is deterministic (no clock / randomness)', () => {
    const input: ErrorAnalysisInput = { matches: [match], logs };
    expect(buildErrorAnalysisPrompt(input)).toBe(buildErrorAnalysisPrompt(input));
  });
});

describe('parseErrorAnalysis', () => {
  const full = JSON.stringify({
    summary: 'Two issues: an undefined map and a missing dialog description.',
    rootCause: 'A value is undefined when .map runs.',
    suggestedFixes: ['Guard with optional chaining', 'Add a DialogDescription'],
    suggestedCode: 'const items = data?.items ?? [];\\nitems.map(...)',
    filesToCheck: ['main-abc.js', 'DialogContent.tsx'],
    searchTerms: ['cannot read properties of undefined map'],
    aiPrompt: 'I am seeing two console errors. Please help me fix them...',
  });

  it('parses a clean JSON object', () => {
    const a = parseErrorAnalysis(full)!;
    expect(a.summary).toMatch(/Two issues/);
    expect(a.suggestedFixes).toHaveLength(2);
    expect(a.filesToCheck).toContain('DialogContent.tsx');
    // literal \n in the code string normalized to a real newline
    expect(a.suggestedCode).toContain('\n');
    expect(a.suggestedCode).not.toContain('\\n');
  });

  it('strips a ```json fence', () => {
    const a = parseErrorAnalysis('```json\n' + full + '\n```')!;
    expect(a.rootCause).toMatch(/undefined/);
  });

  it('salvages JSON wrapped in prose', () => {
    const a = parseErrorAnalysis('Here is the analysis:\n' + full + '\nHope that helps!')!;
    expect(a.summary).toBeTruthy();
  });

  it('accepts the legacy relatedFiles key as filesToCheck', () => {
    const a = parseErrorAnalysis(JSON.stringify({ summary: 's', rootCause: 'r', relatedFiles: ['x.ts'] }))!;
    expect(a.filesToCheck).toEqual(['x.ts']);
  });

  it('defaults missing arrays and omits empty code', () => {
    const a = parseErrorAnalysis(JSON.stringify({ summary: 's', rootCause: 'r', suggestedCode: '' }))!;
    expect(a.suggestedFixes).toEqual([]);
    expect(a.searchTerms).toEqual([]);
    expect(a.suggestedCode).toBeUndefined();
  });

  it('returns null when there is no summary or root cause', () => {
    expect(parseErrorAnalysis('not json at all')).toBeNull();
    expect(parseErrorAnalysis(JSON.stringify({ suggestedFixes: ['x'] }))).toBeNull();
  });
});
