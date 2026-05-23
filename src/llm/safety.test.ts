import { describe, it, expect } from 'vitest';
import { defaultSafetySettings, safetySettingsForNative } from './safety';

describe('defaultSafetySettings', () => {
  it('blocks the four adjustable harm categories at the requested threshold', () => {
    const normal = defaultSafetySettings('normal');
    expect(normal.map((s) => s.category)).toEqual([
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ]);
    expect(normal.every((s) => s.threshold === 'BLOCK_MEDIUM_AND_ABOVE')).toBe(true);
  });

  it('uses BLOCK_LOW_AND_ABOVE in strict preset', () => {
    const strict = defaultSafetySettings('strict');
    expect(strict.every((s) => s.threshold === 'BLOCK_LOW_AND_ABOVE')).toBe(true);
  });
});

describe('safetySettingsForNative', () => {
  it('returns plain {category,threshold} objects ready for the native endpoint body', () => {
    const out = safetySettingsForNative();
    expect(out).toHaveLength(4);
    for (const s of out) {
      expect(typeof s.category).toBe('string');
      expect(typeof s.threshold).toBe('string');
    }
  });
});
