import { describe, it, expect } from 'vitest';
import { buildModelMenu, selectedMenuValue, menuShortLabel, AUTO_VALUE } from './modelMenu';
import { DEFAULT_REGISTRY } from './registry.default';

describe('buildModelMenu', () => {
  it('leads with a smart Auto option', () => {
    const groups = buildModelMenu(DEFAULT_REGISTRY, false);
    expect(groups[0].label).toBe('Smart');
    expect(groups[0].items[0].value).toBe(AUTO_VALUE);
  });
  it('lists named Gemini + Claude models (not abstract tiers)', () => {
    const groups = buildModelMenu(DEFAULT_REGISTRY, true);
    const gemini = groups.find((g) => g.label === 'Gemini');
    const claude = groups.find((g) => g.label === 'Claude');
    expect(gemini && gemini.items.length).toBeGreaterThan(0);
    expect(claude?.items.map((i) => i.value)).toContain('claude-haiku-4-5-20251001');
    expect(claude?.items.map((i) => i.value)).toEqual(
      expect.arrayContaining(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8']),
    );
  });
  it('key-gates Claude: disabled without an Anthropic key, enabled with one', () => {
    const locked = buildModelMenu(DEFAULT_REGISTRY, false).find((g) => g.label === 'Claude')!;
    expect(locked.items.every((i) => i.disabled)).toBe(true);
    expect(locked.items[0].hint).toMatch(/Anthropic key/);
    const open = buildModelMenu(DEFAULT_REGISTRY, true).find((g) => g.label === 'Claude')!;
    expect(open.items.every((i) => !i.disabled)).toBe(true);
  });
  it('sorts each group cheapest→priciest (Haiku before Opus)', () => {
    const claude = buildModelMenu(DEFAULT_REGISTRY, true).find((g) => g.label === 'Claude')!;
    const ids = claude.items.map((i) => i.value);
    expect(ids.indexOf('claude-haiku-4-5-20251001')).toBeLessThan(ids.indexOf('claude-opus-4-8'));
    // Opus is flagged as the pricey one.
    expect(claude.items.find((i) => i.value === 'claude-opus-4-8')?.hint).toBe('$$$');
  });
});

describe('selectedMenuValue / menuShortLabel', () => {
  it('maps the balanced default to Auto, else the resolved model id', () => {
    expect(selectedMenuValue('balanced', 'gemini-3.5-flash')).toBe(AUTO_VALUE);
    expect(selectedMenuValue('custom', 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(selectedMenuValue('cheapest', 'gemini-2.5-flash-lite')).toBe('gemini-2.5-flash-lite');
  });
  it('labels the chip with the model name or Auto', () => {
    expect(menuShortLabel(AUTO_VALUE, DEFAULT_REGISTRY)).toBe('Auto');
    expect(menuShortLabel('claude-opus-4-8', DEFAULT_REGISTRY)).toBe(DEFAULT_REGISTRY.models['claude-opus-4-8'].displayName);
  });
});
