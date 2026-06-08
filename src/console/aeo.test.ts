import { describe, it, expect } from 'vitest';
import { analyzeAeo, buildLlmsTxt, scoreFor, parseBlockedAiCrawlers, type AeoSignal } from './aeo';

const good: AeoSignal = {
  url: 'https://example.com/guide',
  title: 'The Complete Guide to Widgets',
  metaDescription: 'Everything about widgets, explained clearly with examples.',
  htmlLang: 'en',
  h1Count: 1,
  headingCount: 8,
  questionHeadings: 3,
  wordCount: 1200,
  paragraphCount: 20,
  avgParagraphChars: 280,
  listOrTableCount: 4,
  schemaTypes: ['Article', 'FAQPage'],
  structuredDataBlocks: 2,
  structuredDataValid: true,
  hasAuthor: true,
  hasDate: true,
  hasLlmsTxt: true,
  blockedAiCrawlers: [],
};

describe('analyzeAeo', () => {
  it('scores a well-optimized page high with no issues', () => {
    const r = analyzeAeo(good);
    expect(r.issues).toHaveLength(0);
    expect(r.score).toBe(100);
    expect(r.facts.hasFaq).toBe(true);
    expect(r.facts.attributable).toBe(true);
    expect(r.facts.schemaTypes).toContain('faqpage');
  });

  it('flags missing structured data as high severity', () => {
    const r = analyzeAeo({ ...good, schemaTypes: [], structuredDataBlocks: 0 });
    const m = r.issues.find((i) => i.id === 'schema-missing');
    expect(m?.severity).toBe('high');
  });

  it('flags structured data with no citable @type', () => {
    const r = analyzeAeo({ ...good, schemaTypes: ['WebSite'], structuredDataBlocks: 1 });
    expect(r.issues.find((i) => i.id === 'schema-weak-type')).toBeTruthy();
  });

  it('treats >=2 question headings as a FAQ even without FAQPage schema', () => {
    const r = analyzeAeo({ ...good, schemaTypes: ['Article'], questionHeadings: 2 });
    expect(r.facts.hasFaq).toBe(true);
    expect(r.issues.find((i) => i.id === 'no-qa')).toBeFalsy();
  });

  it('flags thin content', () => {
    const r = analyzeAeo({ ...good, wordCount: 120 });
    const t = r.issues.find((i) => i.id === 'thin-content');
    expect(t?.severity).toBe('medium');
    expect(t?.detail).toBe('120 words');
  });

  it('flags poor chunkability only on long, list-free, long-paragraph pages', () => {
    expect(analyzeAeo({ ...good, listOrTableCount: 0, avgParagraphChars: 900 }).issues.find((i) => i.id === 'poor-chunking')).toBeTruthy();
    // short page is exempt
    expect(analyzeAeo({ ...good, wordCount: 200, listOrTableCount: 0, avgParagraphChars: 900 }).issues.find((i) => i.id === 'poor-chunking')).toBeFalsy();
  });

  it('flags blocked AI crawlers as high and counts them in facts', () => {
    const r = analyzeAeo({ ...good, blockedAiCrawlers: ['GPTBot', 'ClaudeBot'] });
    const b = r.issues.find((i) => i.id === 'ai-crawlers-blocked');
    expect(b?.severity).toBe('high');
    expect(r.facts.aiCrawlersBlocked).toBe(2);
  });

  it('flags a missing llms.txt only when the probe knew (false), not unknown', () => {
    expect(analyzeAeo({ ...good, hasLlmsTxt: false }).issues.find((i) => i.id === 'no-llms-txt')).toBeTruthy();
    expect(analyzeAeo({ ...good, hasLlmsTxt: undefined }).issues.find((i) => i.id === 'no-llms-txt')).toBeFalsy();
  });

  it('flags missing attribution with which signal is missing', () => {
    const r = analyzeAeo({ ...good, hasAuthor: false });
    expect(r.issues.find((i) => i.id === 'no-attribution')?.detail).toBe('author');
  });

  it('sorts issues by severity', () => {
    const r = analyzeAeo({ ...good, schemaTypes: [], structuredDataBlocks: 0, hasLlmsTxt: false });
    const ranks = r.issues.map((i) => i.severity);
    expect(ranks.indexOf('high')).toBeLessThan(ranks.indexOf('low'));
  });
});

describe('scoreFor', () => {
  it('subtracts severity weights and floors at 0', () => {
    expect(scoreFor([{ id: 'x', severity: 'high', rule: '', description: '', suggestion: '' }])).toBe(85);
    expect(scoreFor(Array(10).fill({ id: 'x', severity: 'critical', rule: '', description: '', suggestion: '' }))).toBe(0);
  });
});

describe('parseBlockedAiCrawlers', () => {
  it('detects AI crawlers disallowed from root, including shared blocks', () => {
    const robots = [
      'User-agent: *',
      'Disallow: /admin',
      '',
      'User-agent: GPTBot',
      'User-agent: CCBot',
      'Disallow: /',
      '',
      'User-agent: PerplexityBot',
      'Disallow: /private',
    ].join('\n');
    const b = parseBlockedAiCrawlers(robots);
    expect(b.sort()).toEqual(['CCBot', 'GPTBot']);
    expect(b).not.toContain('PerplexityBot'); // only /private blocked, not root
  });

  it('ignores comments and returns empty when nothing is blocked', () => {
    expect(parseBlockedAiCrawlers('# all welcome\nUser-agent: *\nAllow: /')).toEqual([]);
    expect(parseBlockedAiCrawlers('')).toEqual([]);
  });
});

describe('buildLlmsTxt', () => {
  it('produces a valid llms.txt skeleton with title, summary, and outline', () => {
    const txt = buildLlmsTxt(good, ['What is a widget?', 'How to install', 'Pricing']);
    expect(txt).toMatch(/^# The Complete Guide to Widgets/);
    expect(txt).toContain('> Everything about widgets');
    expect(txt).toContain('## Key pages');
    expect(txt).toContain('[The Complete Guide to Widgets](https://example.com/guide)');
    expect(txt).toContain('## On this page');
    expect(txt).toContain('- What is a widget?');
    expect(txt).toContain('example.com/llms.txt');
  });

  it('falls back to the host when title/description are absent', () => {
    const txt = buildLlmsTxt({ ...good, title: undefined, metaDescription: undefined });
    expect(txt).toMatch(/^# example\.com/);
    expect(txt).toContain('Key content from example.com.');
  });
});
