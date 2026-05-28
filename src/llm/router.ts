// LLM routing — PURE, unit-testable functions.
//
// No I/O, no storage, no fetch: just resolve models/adapters from the registry,
// compute tiered fallback chains, and estimate cost from usage. (PRD FR-LLM-11,
// NFR-COST-3; research/03 §8 "tiered fallback".)

import { anthropicAdapter } from './adapters/anthropic';
import { geminiNativeAdapter } from './adapters/geminiNative';
import { openAICompatibleAdapter } from './adapters/openaiCompatible';
import type {
  ModelConfig,
  ModelRegistry,
  ProviderAdapter,
  ProviderConfig,
  UsageStats,
} from './types';

/** A resolved model + its provider, ready to hand to an adapter. */
export interface ResolvedModel {
  model: ModelConfig;
  provider: ProviderConfig;
}

/**
 * Resolve a model id to its config + provider. Returns null when the id is
 * unknown, the model/provider is disabled, or the provider is missing — the
 * caller decides how to surface that.
 */
export function resolveModel(registry: ModelRegistry, id: string): ResolvedModel | null {
  const model = registry.models[id];
  if (!model) return null;
  if (model.enabled === false) return null;
  const provider = registry.providers[model.provider];
  if (!provider) return null;
  if (provider.enabled === false) return null;
  return { model, provider };
}

/**
 * Resolve the registry's default model, falling back to the first enabled
 * model if `defaultModel` is unset or invalid. Returns null if none qualify.
 */
export function resolveDefaultModel(registry: ModelRegistry): ResolvedModel | null {
  if (registry.defaultModel) {
    const byDefault = resolveModel(registry, registry.defaultModel);
    if (byDefault) return byDefault;
  }
  for (const id of Object.keys(registry.models)) {
    const resolved = resolveModel(registry, id);
    if (resolved) return resolved;
  }
  return null;
}

/** Select the bundled adapter instance for a provider. */
export function pickAdapter(provider: ProviderConfig): ProviderAdapter {
  switch (provider.adapter) {
    case 'openai-compatible':
      return openAICompatibleAdapter;
    case 'gemini-native':
      return geminiNativeAdapter;
    case 'anthropic':
      return anthropicAdapter;
    default: {
      // Exhaustiveness guard: a new AdapterId must add a case here.
      const exhaustive: never = provider.adapter;
      throw new Error(`No bundled adapter for provider adapter '${String(exhaustive)}'`);
    }
  }
}

// ---- Tiered fallback --------------------------------------------------------

/** Ascending order: lower index = faster/cheaper preferred first. */
const TIER_ORDER: Record<NonNullable<ModelConfig['tier']>, number> = {
  lite: 0,
  standard: 1,
  pro: 2,
  specialized: 3,
};

function tierRank(model: ModelConfig): number {
  return model.tier ? TIER_ORDER[model.tier] : TIER_ORDER.standard;
}

/**
 * Build a tiered fallback chain starting at `primaryId`. The primary comes
 * first; the remaining enabled models follow, ordered by ascending tier
 * (cheaper/faster first) then by ascending input price as a tie-break. Models
 * the primary's tier outranks are still included as escalation/degradation
 * options, so callers can walk the chain on error (e.g. unsupported param,
 * rate limit). Pure: returns ResolvedModel[].
 *
 * `requireCapabilities` filters out models that lack a needed capability flag
 * (e.g. require tools/vision) so the chain stays valid for the request.
 */
export function buildFallbackChain(
  registry: ModelRegistry,
  primaryId: string,
  requireCapabilities: Array<keyof ModelConfig['capabilities']> = [],
): ResolvedModel[] {
  const chain: ResolvedModel[] = [];
  const seen = new Set<string>();

  const hasCaps = (m: ModelConfig): boolean =>
    requireCapabilities.every((cap) => m.capabilities[cap] === true);

  const primary = resolveModel(registry, primaryId);
  if (primary && hasCaps(primary.model)) {
    chain.push(primary);
    seen.add(primary.model.id);
  }

  const candidates: ResolvedModel[] = [];
  for (const id of Object.keys(registry.models)) {
    if (seen.has(id)) continue;
    const resolved = resolveModel(registry, id);
    if (!resolved) continue;
    if (!hasCaps(resolved.model)) continue;
    candidates.push(resolved);
  }

  candidates.sort((a, b) => {
    const tierDiff = tierRank(a.model) - tierRank(b.model);
    if (tierDiff !== 0) return tierDiff;
    return a.model.pricing.inputPerMTok - b.model.pricing.inputPerMTok;
  });

  for (const c of candidates) chain.push(c);
  return chain;
}

// ---- Cost accounting --------------------------------------------------------

/** A per-call cost estimate in USD, broken out for the cost meter (FR-LLM-10). */
export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  cachedInputCost: number;
  totalCost: number;
  currency: 'USD';
}

/**
 * Estimate the USD cost of one generation from its token usage and the model's
 * pricing. Cached input tokens (when reported) are billed at the cheaper
 * cached rate and excluded from the standard input count. Pure.
 */
export function estimateCost(usage: UsageStats, model: ModelConfig): CostEstimate {
  const { pricing } = model;
  const cached = usage.cachedInputTokens ?? 0;
  const billedInput = Math.max(0, usage.inputTokens - cached);

  const PER_TOKEN = 1_000_000;
  const inputCost = (billedInput / PER_TOKEN) * pricing.inputPerMTok;
  const outputCost = (usage.outputTokens / PER_TOKEN) * pricing.outputPerMTok;
  const cachedRate = pricing.cachedInputPerMTok ?? pricing.inputPerMTok;
  const cachedInputCost = (cached / PER_TOKEN) * cachedRate;

  return {
    inputCost,
    outputCost,
    cachedInputCost,
    totalCost: inputCost + outputCost + cachedInputCost,
    currency: 'USD',
  };
}
