import { describe, it, expect } from 'vitest';
import { thinkingConfigFor, isGemini3, isGemini25 } from './thinking';

describe('thinkingConfigFor', () => {
  it('emits thinking_level for Gemini 3 ids', () => {
    expect(thinkingConfigFor('gemini-3.5-flash', 'low')).toEqual({ thinking_level: 'low' });
    expect(thinkingConfigFor('gemini-3-flash-preview', 'high')).toEqual({ thinking_level: 'high' });
    expect(thinkingConfigFor('gemini-3.1-pro-preview', 'minimal')).toEqual({ thinking_level: 'minimal' });
  });

  it('emits thinking_budget for Gemini 2.5 ids', () => {
    expect(thinkingConfigFor('gemini-2.5-flash', 'minimal')).toEqual({ thinking_budget: 0 });
    expect(thinkingConfigFor('gemini-2.5-flash', 'low')).toEqual({ thinking_budget: 512 });
    expect(thinkingConfigFor('gemini-2.5-flash', 'medium')).toEqual({ thinking_budget: 2048 });
    expect(thinkingConfigFor('gemini-2.5-flash', 'high')).toEqual({ thinking_budget: -1 });
  });

  it('returns null when no level or for non-Gemini ids', () => {
    expect(thinkingConfigFor('gemini-3.5-flash', undefined)).toBeNull();
    expect(thinkingConfigFor('gpt-4o', 'high')).toBeNull();
  });
});

describe('model-family helpers', () => {
  it('classifies ids', () => {
    expect(isGemini3('gemini-3.5-flash')).toBe(true);
    expect(isGemini3('gemini-3-flash-preview')).toBe(true);
    expect(isGemini3('gemini-2.5-flash')).toBe(false);
    expect(isGemini25('gemini-2.5-flash-lite')).toBe(true);
    expect(isGemini25('gemini-3.5-flash')).toBe(false);
  });
});
