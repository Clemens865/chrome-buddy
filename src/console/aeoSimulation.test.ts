import { describe, it, expect } from 'vitest';
import { buildSimulationPrompt, parseSimulation } from './aeoSimulation';

describe('buildSimulationPrompt', () => {
  it('includes url/title, bounds the page text, and asks for the JSON shape', () => {
    const p = buildSimulationPrompt({ url: 'https://x.test/a', title: 'A Page', text: 'hello '.repeat(2000) });
    expect(p).toContain('https://x.test/a');
    expect(p).toContain('Title: A Page');
    expect(p).toContain('"citableFacts"');
    expect(p).toContain('"gaps"');
    expect(p.length).toBeLessThan(6800); // page text capped at ~6000 chars
  });

  it('is deterministic', () => {
    const i = { url: 'https://x.test', text: 'body' };
    expect(buildSimulationPrompt(i)).toBe(buildSimulationPrompt(i));
  });
});

describe('parseSimulation', () => {
  const full = JSON.stringify({
    answer: 'This page is a guide to widgets and how to install them.',
    citableFacts: ['Widgets cost $5', 'Installation takes 2 minutes'],
    gaps: ['No publish date', 'Pricing region is unclear'],
  });

  it('parses a clean object', () => {
    const s = parseSimulation(full)!;
    expect(s.answer).toMatch(/guide to widgets/);
    expect(s.citableFacts).toHaveLength(2);
    expect(s.gaps).toContain('No publish date');
  });

  it('strips a fence and salvages prose-wrapped JSON', () => {
    expect(parseSimulation('```json\n' + full + '\n```')!.answer).toBeTruthy();
    expect(parseSimulation('Here you go:\n' + full + '\nDone')!.answer).toBeTruthy();
  });

  it('defaults missing arrays', () => {
    const s = parseSimulation(JSON.stringify({ answer: 'ok' }))!;
    expect(s.citableFacts).toEqual([]);
    expect(s.gaps).toEqual([]);
  });

  it('returns null without an answer', () => {
    expect(parseSimulation('garbage')).toBeNull();
    expect(parseSimulation(JSON.stringify({ citableFacts: ['x'] }))).toBeNull();
  });
});
