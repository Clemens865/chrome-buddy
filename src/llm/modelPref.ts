// Shared model preference. The user picks an INTENT (Cheapest / Balanced / Best
// / Custom) in Settings; chat, agent runs, skills, workflows, and the builder
// all resolve it to a concrete model id via useResolvedModelId() so they stay in
// sync. "Best" routes to Opus only when an Anthropic key is present (resolved
// per-call). The legacy `activeModel` key still holds the exact id for Custom.
import { usePersistedState } from '../sidepanel/usePersistedState';
import { useApiKey } from '../key/useApiKey';
import { DEFAULT_REGISTRY } from './registry.default';
import { resolveIntentModel, resolveChatModel, type ModelIntent } from './resolveModel';
import type { ModelConfig } from './types';

export const MODEL_PREF_KEY = 'activeModel';
export const MODEL_INTENT_KEY = 'modelIntent';
export const DEFAULT_ACTIVE_MODEL = DEFAULT_REGISTRY.defaultModel ?? 'gemini-2.5-flash';
// Cheapest is the default intent — a casual chat must never silently bill Opus
// (or even Pro) rates; the user opts up to Balanced/Best explicitly.
export const DEFAULT_MODEL_INTENT: ModelIntent = 'cheapest';

export type { ModelIntent };

/** Enabled chat/agent TEXT models (excludes image / embedding / computer-use). */
export function selectableModels(): ModelConfig[] {
  return Object.values(DEFAULT_REGISTRY.models).filter(
    (m) =>
      m.enabled &&
      m.capabilities?.tools !== false &&
      !m.capabilities?.imageOutput &&
      !m.capabilities?.embedding &&
      !m.capabilities?.computerUse,
  );
}

/** Human label for a model id (falls back to the id itself). */
export function modelLabel(id: string): string {
  return DEFAULT_REGISTRY.models[id]?.displayName ?? id;
}

/** Read/write the exact active model id (used when the intent is 'custom'). */
export function useActiveModel() {
  return usePersistedState<string>(MODEL_PREF_KEY, DEFAULT_ACTIVE_MODEL);
}

/** Read/write the model INTENT (cheapest / balanced / best / custom). */
export function useModelIntent() {
  return usePersistedState<ModelIntent>(MODEL_INTENT_KEY, DEFAULT_MODEL_INTENT);
}

/**
 * Resolve the user's intent to a concrete model id, RE-evaluated whenever the
 * intent or the Anthropic key changes (so 'best' degrades to Gemini the moment
 * the key is removed). Every chat/agent/skill/workflow call site reads this.
 */
export function useResolvedModelId(): string {
  const [intent] = useModelIntent();
  const [custom] = useActiveModel();
  const { keyStatus } = useApiKey('anthropic');
  return resolveIntentModel(intent, keyStatus === 'set', DEFAULT_REGISTRY, custom);
}

/**
 * The model for BASIC/plain chat — like useResolvedModelId but "Best" routes to
 * a fast Claude (Sonnet) instead of Opus so quick chat stays snappy + cheap.
 * Agent runs, the builder, and quick-app generation keep the full intent.
 */
export function useResolvedChatModelId(): string {
  const [intent] = useModelIntent();
  const [custom] = useActiveModel();
  const { keyStatus } = useApiKey('anthropic');
  return resolveChatModel(intent, keyStatus === 'set', DEFAULT_REGISTRY, custom);
}
