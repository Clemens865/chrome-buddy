// Model-intent resolution (P1 of "Opus everywhere"). The user picks an INTENT
// — Cheapest / Balanced / Best — and this PURE resolver maps it to a concrete
// registry model id at call time. "Best" only routes to Opus when an Anthropic
// key is present (else the strongest Gemini), and resolution happens per-call so
// revoking the key never strands a stale Opus id. Excludes non-text models
// (image / embedding / computer-use) — those surfaces stay Gemini-pinned.
import type { ModelConfig, ModelRegistry } from './types';

export type ModelIntent = 'cheapest' | 'balanced' | 'best' | 'custom';

export const OPUS_MODEL_ID = 'claude-opus-4-8';
// Basic/plain chat never uses Opus (slow + costly for quick Q&A). On "Best"
// with an Anthropic key, chat routes here — a fast, strong, much cheaper Claude.
export const CHAT_BEST_MODEL_ID = 'claude-sonnet-4-6';
const FALLBACK_MODEL = 'gemini-2.5-flash';
const defaultId = (registry: ModelRegistry): string => registry.defaultModel ?? FALLBACK_MODEL;

const TIER_RANK: Record<string, number> = { lite: 0, standard: 1, pro: 2, specialized: 3 };
const tierRank = (m: ModelConfig) => TIER_RANK[m.tier ?? 'standard'] ?? 1;

/** Enabled, tool-capable TEXT models — excludes image/embedding/computer-use. */
export function textModels(registry: ModelRegistry): ModelConfig[] {
  return Object.values(registry.models).filter(
    (m) =>
      m.enabled !== false &&
      m.capabilities?.tools !== false &&
      !m.capabilities?.imageOutput &&
      !m.capabilities?.embedding &&
      !m.capabilities?.computerUse,
  );
}

/** Cheapest enabled Gemini text model (lowest tier, then lowest input price). */
export function cheapestModelId(registry: ModelRegistry): string {
  const models = textModels(registry).filter((m) => m.provider !== 'anthropic');
  const sorted = [...models].sort((a, b) => tierRank(a) - tierRank(b) || a.pricing.inputPerMTok - b.pricing.inputPerMTok);
  return sorted[0]?.id ?? defaultId(registry);
}

/** Strongest enabled Gemini text model (highest tier, then highest price proxy). */
export function bestGeminiModelId(registry: ModelRegistry): string {
  const models = textModels(registry).filter((m) => m.provider !== 'anthropic');
  const sorted = [...models].sort((a, b) => tierRank(b) - tierRank(a) || b.pricing.inputPerMTok - a.pricing.inputPerMTok);
  return sorted[0]?.id ?? defaultId(registry);
}

/**
 * Resolve an intent → concrete model id.
 * - cheapest → lowest-tier Gemini
 * - balanced → the registry default
 * - best → Opus 4.8 when an Anthropic key is present + enabled, else best Gemini
 * - custom → the explicit model the user picked (falls back to default)
 */
export function resolveIntentModel(
  intent: ModelIntent,
  hasAnthropicKey: boolean,
  registry: ModelRegistry,
  customModel?: string,
): string {
  switch (intent) {
    case 'cheapest':
      return cheapestModelId(registry);
    case 'best':
      return hasAnthropicKey && registry.models[OPUS_MODEL_ID]?.enabled !== false
        ? OPUS_MODEL_ID
        : bestGeminiModelId(registry);
    case 'custom':
      return customModel && registry.models[customModel] ? customModel : defaultId(registry);
    case 'balanced':
    default:
      return defaultId(registry);
  }
}

/**
 * Resolve the intent for BASIC/plain chat — same as resolveIntentModel except
 * "Best" routes to a fast Claude (Sonnet) instead of Opus, so quick chat stays
 * responsive + affordable. Opus is reserved for agent runs, the app builder,
 * and other heavy/task work. 'custom' still honors the user's exact pick.
 */
export function resolveChatModel(
  intent: ModelIntent,
  hasAnthropicKey: boolean,
  registry: ModelRegistry,
  customModel?: string,
): string {
  if (intent === 'best') {
    return hasAnthropicKey && registry.models[CHAT_BEST_MODEL_ID]?.enabled !== false
      ? CHAT_BEST_MODEL_ID
      : bestGeminiModelId(registry);
  }
  return resolveIntentModel(intent, hasAnthropicKey, registry, customModel);
}
