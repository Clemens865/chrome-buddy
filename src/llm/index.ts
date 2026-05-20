// Barrel exports for the LLM client + model/provider registry.
//
// Public surface for the rest of the extension (agent runtime, Tier-1 apps,
// skills) to consume the shared LLM client without reaching into internals.

export * from './types';

export { DEFAULT_REGISTRY } from './registry.default';

export {
  resolveModel,
  resolveDefaultModel,
  pickAdapter,
  buildFallbackChain,
  estimateCost,
} from './router';
export type { ResolvedModel, CostEstimate } from './router';

export { OpenAICompatibleAdapter, openAICompatibleAdapter } from './adapters/openaiCompatible';
export { GeminiNativeAdapter, geminiNativeAdapter } from './adapters/geminiNative';

export { LlmClient, LlmHttpError } from './client';
export type { ApiKeyGetter, GenerateArgs, GenerateResult } from './client';
