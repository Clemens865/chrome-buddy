// User registry overlay (FR-MR-1/8/10): user-added models/providers stored as
// declarative JSON in chrome.storage.local, merged OVER the bundled default
// (precedence: user > bundled). Pure merge + thin storage wrappers. API keys
// are NOT here — they live in storage.session (NFR-SEC-1).
import { DEFAULT_REGISTRY } from './registry.default';
import type { ModelConfig, ModelRegistry, ProviderConfig } from './types';

export const USER_REGISTRY_KEY = 'userRegistry';

export interface UserRegistry {
  models?: Record<string, ModelConfig>;
  providers?: Record<string, ProviderConfig>;
}

/** PURE: merge a user overlay over a base registry (user wins per id). */
export function mergeRegistry(base: ModelRegistry, user: UserRegistry): ModelRegistry {
  return {
    ...base,
    providers: { ...base.providers, ...(user.providers ?? {}) },
    models: { ...base.models, ...(user.models ?? {}) },
  };
}

function area() {
  return typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
}

export async function loadUserRegistry(): Promise<UserRegistry> {
  const store = area();
  if (!store) return {};
  return ((await store.get(USER_REGISTRY_KEY))[USER_REGISTRY_KEY] as UserRegistry | undefined) ?? {};
}

async function save(reg: UserRegistry): Promise<void> {
  await area()?.set({ [USER_REGISTRY_KEY]: reg });
}

export async function saveUserModel(model: ModelConfig): Promise<void> {
  const reg = await loadUserRegistry();
  await save({ ...reg, models: { ...(reg.models ?? {}), [model.id]: model } });
}

export async function removeUserModel(id: string): Promise<void> {
  const reg = await loadUserRegistry();
  if (!reg.models?.[id]) return;
  const models = { ...reg.models };
  delete models[id];
  await save({ ...reg, models });
}

/** The effective registry = bundled floor + user overlay. */
export async function effectiveRegistry(): Promise<ModelRegistry> {
  return mergeRegistry(DEFAULT_REGISTRY, await loadUserRegistry());
}
