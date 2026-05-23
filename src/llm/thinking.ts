// Map a semantic thinking level to the Gemini wire form.
// Gemini 3 (3.x ids):  { thinking_level: 'minimal'|'low'|'medium'|'high' }
// Gemini 2.5 (2.x ids): { thinking_budget: <int> }  — derived from the level.
// (See /Users/clemenshoenig/Documents/Software-Projects/Google_Geminin_documentation/thinking.md
//  L374-382 for the enum, L493 for the don't-mix rule.)
// Pure + unit-testable.

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

/** Token budget mapping for Gemini 2.5 models.
 *  - minimal → 0  (thinking off)
 *  - low     → 512
 *  - medium  → 2048
 *  - high    → -1  (dynamic / max)
 *  These are within the 0–24576 range allowed for 2.5 Flash.
 */
const BUDGET_FOR_LEVEL: Record<ThinkingLevel, number> = {
  minimal: 0,
  low: 512,
  medium: 2048,
  high: -1,
};

/** Build the `thinking_config` object for a model + level, or null when the
 *  level shouldn't be sent (no level requested, or the model doesn't support
 *  thinking at all — caller can also gate on `model.capabilities.thinking`). */
export function thinkingConfigFor(
  modelId: string,
  level: ThinkingLevel | undefined,
): Record<string, string | number> | null {
  if (!level) return null;
  if (isGemini3(modelId)) return { thinking_level: level };
  if (isGemini25(modelId)) return { thinking_budget: BUDGET_FOR_LEVEL[level] };
  return null;
}

export function isGemini3(modelId: string): boolean {
  return /^gemini-3(\.|-)/.test(modelId);
}
export function isGemini25(modelId: string): boolean {
  return /^gemini-2\.5/.test(modelId);
}
