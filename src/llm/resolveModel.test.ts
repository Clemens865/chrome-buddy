import { describe, it, expect } from 'vitest';
import { resolveIntentModel, cheapestModelId, bestGeminiModelId, textModels, OPUS_MODEL_ID } from './resolveModel';
import { DEFAULT_REGISTRY } from './registry.default';
import type { ModelRegistry } from './types';

const R = DEFAULT_REGISTRY;

describe('textModels', () => {
  it('excludes image / embedding / computer-use / non-tool models', () => {
    const ids = textModels(R).map((m) => m.id);
    expect(ids).toContain(R.defaultModel);
    for (const m of textModels(R)) {
      expect(m.capabilities?.imageOutput).toBeFalsy();
      expect(m.capabilities?.embedding).toBeFalsy();
      expect(m.capabilities?.computerUse).toBeFalsy();
    }
  });
});

describe('cheapest/best Gemini', () => {
  it('cheapest is a lite-tier Gemini', () => {
    const id = cheapestModelId(R);
    expect(R.models[id].tier).toBe('lite');
    expect(R.models[id].provider).not.toBe('anthropic');
  });
  it('best Gemini is a pro-tier Gemini (never anthropic)', () => {
    const id = bestGeminiModelId(R);
    expect(R.models[id].provider).not.toBe('anthropic');
    expect(R.models[id].tier).toBe('pro');
  });
});

describe('resolveIntentModel', () => {
  it('balanced → registry default', () => {
    expect(resolveIntentModel('balanced', false, R)).toBe(R.defaultModel);
  });
  it('cheapest → a lite Gemini regardless of key', () => {
    expect(R.models[resolveIntentModel('cheapest', true, R)].tier).toBe('lite');
  });
  it('best → Opus when an Anthropic key is present', () => {
    expect(resolveIntentModel('best', true, R)).toBe(OPUS_MODEL_ID);
  });
  it('best → best Gemini (NOT Opus) when no Anthropic key', () => {
    const id = resolveIntentModel('best', false, R);
    expect(id).not.toBe(OPUS_MODEL_ID);
    expect(R.models[id].provider).not.toBe('anthropic');
  });
  it('custom → the explicit model, else default', () => {
    expect(resolveIntentModel('custom', false, R, 'gemini-2.5-pro')).toBe('gemini-2.5-pro');
    expect(resolveIntentModel('custom', false, R, 'nonexistent-model')).toBe(R.defaultModel);
  });
  it('best falls back to Gemini when Opus is disabled even with a key', () => {
    const noOpus: ModelRegistry = { ...R, models: { ...R.models, [OPUS_MODEL_ID]: { ...R.models[OPUS_MODEL_ID], enabled: false } } };
    expect(resolveIntentModel('best', true, noOpus)).not.toBe(OPUS_MODEL_ID);
  });
});
