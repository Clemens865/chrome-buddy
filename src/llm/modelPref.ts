// Shared "active model" preference. The user picks a model in Settings; chat,
// agent runs, and the panel header all read it from the same persisted key so
// they stay in sync. Falls back to the registry default.
import { usePersistedState } from '../sidepanel/usePersistedState';
import { DEFAULT_REGISTRY } from './registry.default';
import type { ModelConfig } from './types';

export const MODEL_PREF_KEY = 'activeModel';
export const DEFAULT_ACTIVE_MODEL = DEFAULT_REGISTRY.defaultModel ?? 'gemini-2.5-flash';

/** Enabled chat/agent models from the registry (excludes image-only models). */
export function selectableModels(): ModelConfig[] {
  return Object.values(DEFAULT_REGISTRY.models).filter(
    (m) => m.enabled && m.capabilities?.tools !== false,
  );
}

/** Human label for a model id (falls back to the id itself). */
export function modelLabel(id: string): string {
  return DEFAULT_REGISTRY.models[id]?.displayName ?? id;
}

/** Read/write the active model id (persisted, shared across views). */
export function useActiveModel() {
  return usePersistedState<string>(MODEL_PREF_KEY, DEFAULT_ACTIVE_MODEL);
}
