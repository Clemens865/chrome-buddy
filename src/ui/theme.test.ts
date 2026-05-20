import { describe, it, expect } from 'vitest';
import { hexAlpha } from '../ui/theme';

describe('hexAlpha', () => {
  it('converts a hex color + alpha to an rgba string', () => {
    expect(hexAlpha('#6366F1', 0.12)).toBe('rgba(99,102,241,0.12)');
  });

  it('handles black and white', () => {
    expect(hexAlpha('#000000', 1)).toBe('rgba(0,0,0,1)');
    expect(hexAlpha('#FFFFFF', 0.5)).toBe('rgba(255,255,255,0.5)');
  });

  it('returns the input unchanged when not a hex color', () => {
    expect(hexAlpha('rebeccapurple', 0.5)).toBe('rebeccapurple');
    expect(hexAlpha('', 0.5)).toBe('');
  });
});
