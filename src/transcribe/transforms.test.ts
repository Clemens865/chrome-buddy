import { describe, it, expect } from 'vitest';
import { TRANSFORMS, transformDef, deriveTitle, formatDuration } from './transforms';

describe('transforms', () => {
  it('exposes the four post-processing actions with prompts that embed the transcript', () => {
    expect(TRANSFORMS.map((t) => t.kind).sort()).toEqual(['cleaned', 'notes', 'speakers', 'summary']);
    for (const t of TRANSFORMS) {
      expect(t.prompt('HELLO TRANSCRIPT')).toContain('HELLO TRANSCRIPT');
      expect(t.label.length).toBeGreaterThan(0);
    }
  });
  it('meeting-notes prompt asks for decisions + action items', () => {
    const p = transformDef('notes').prompt('x');
    expect(p).toMatch(/Decisions/);
    expect(p).toMatch(/Action items/);
  });
  it('clean-up prompt insists on returning only the cleaned transcript', () => {
    expect(transformDef('cleaned').prompt('x')).toMatch(/ONLY the cleaned transcript/i);
  });
  it('transformDef falls back to the first transform for an unknown kind', () => {
    // @ts-expect-error testing the fallback path
    expect(transformDef('bogus').kind).toBe('summary');
  });
});

describe('deriveTitle', () => {
  it('uses the opening words of the transcript', () => {
    expect(deriveTitle('Quarterly planning sync with the growth team about Q3', 0)).toBe('Quarterly planning sync with the growth team');
  });
  it('truncates very long openings', () => {
    const t = deriveTitle('a'.repeat(100) + ' more words here to pad it out nicely', 0);
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(61);
  });
  it('falls back to a clock stamp for empty/short transcripts', () => {
    expect(deriveTitle('', 0)).toMatch(/^Recording \d{2}:\d{2}$/);
    expect(deriveTitle('hi', 0)).toMatch(/^Recording /);
  });
});

describe('formatDuration', () => {
  it('renders MM:SS under an hour and H:MM:SS over', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });
});
