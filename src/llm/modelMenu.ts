// Model picker menu — turns the registry into a grouped, named-model list for
// the composer + app-builder pickers. Replaces the abstract Cheapest/Balanced/
// Best tiers with the ACTUAL models (so the user sees + picks exactly what runs)
// plus one smart "Auto" default. Claude entries are key-gated. Pure → unit-tested.
import type { ModelRegistry, ModelConfig } from './types';

export const AUTO_VALUE = 'auto';

export interface ModelMenuItem {
  /** 'auto' (the balanced default) or a concrete model id. */
  value: string;
  label: string;
  /** Short price/availability hint shown beside the name. */
  hint?: string;
  disabled?: boolean;
}
export interface ModelMenuGroup {
  label: string;
  items: ModelMenuItem[];
}

const TIER_RANK: Record<string, number> = { lite: 0, standard: 1, pro: 2, specialized: 3 };
const tierRank = (m: ModelConfig) => TIER_RANK[m.tier ?? 'standard'] ?? 1;

/** Enabled chat/agent TEXT models (excludes image / embedding / computer-use). */
function textModels(registry: ModelRegistry): ModelConfig[] {
  return Object.values(registry.models).filter(
    (m) =>
      m.enabled !== false &&
      m.capabilities?.tools !== false &&
      !m.capabilities?.imageOutput &&
      !m.capabilities?.embedding &&
      !m.capabilities?.computerUse,
  );
}

/** Coarse $ hint from output price per MTok. */
function priceHint(m: ModelConfig): string {
  const out = m.pricing?.outputPerMTok ?? 0;
  if (out >= 20) return '$$$';
  if (out >= 5) return '$$';
  return '$';
}

/**
 * Grouped menu: a smart "Auto (Balanced)" default, then named Gemini models, then
 * named Claude models (disabled with a hint until an Anthropic key is set), each
 * sorted cheapest→priciest within its group.
 */
export function buildModelMenu(registry: ModelRegistry, hasAnthropicKey: boolean): ModelMenuGroup[] {
  const models = textModels(registry).sort(
    (a, b) => tierRank(a) - tierRank(b) || (a.pricing?.outputPerMTok ?? 0) - (b.pricing?.outputPerMTok ?? 0),
  );
  const gemini = models.filter((m) => m.provider !== 'anthropic');
  const claude = models.filter((m) => m.provider === 'anthropic');
  const item = (m: ModelConfig, gated: boolean): ModelMenuItem => ({
    value: m.id,
    label: m.displayName ?? m.id,
    hint: gated && !hasAnthropicKey ? 'needs Anthropic key' : priceHint(m),
    disabled: gated && !hasAnthropicKey,
  });
  const groups: ModelMenuGroup[] = [
    { label: 'Smart', items: [{ value: AUTO_VALUE, label: 'Auto (Balanced)', hint: 'recommended' }] },
  ];
  if (gemini.length) groups.push({ label: 'Gemini', items: gemini.map((m) => item(m, false)) });
  if (claude.length) groups.push({ label: 'Claude', items: claude.map((m) => item(m, true)) });
  return groups;
}

/**
 * The menu value reflecting the current persisted state: 'auto' for the balanced
 * smart-default, otherwise the resolved/explicit model id (so cheapest/best/
 * custom all highlight the actual model they run).
 */
export function selectedMenuValue(intent: string, resolvedModelId: string): string {
  return intent === 'balanced' ? AUTO_VALUE : resolvedModelId;
}

/** Short chip label for a menu value. */
export function menuShortLabel(value: string, registry: ModelRegistry): string {
  if (value === AUTO_VALUE) return 'Auto';
  return registry.models[value]?.displayName ?? value;
}
