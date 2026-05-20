// LlmClient — the single shared LLM client (PRD component #4; FR-LLM-2).
//
// Responsibilities: registry-driven adapter selection + routing, a non-stream
// `generate()` and a streaming `stream()`, returning normalized responses with
// usage so the cost meter can account spend (FR-LLM-10).
//
// KEY CUSTODY (PRD NFR-SEC-1/2): the API key is NEVER read from chrome.storage
// here. The background service worker owns the key and injects it via the
// `getApiKey` getter passed to the constructor. This file uses only the
// built-in `fetch` (no @google/genai dependency — that swap is a future TODO
// for native features; see adapters/geminiNative.ts).

import { pickAdapter, resolveDefaultModel, resolveModel } from './router';
import type { CostEstimate } from './router';
import { estimateCost } from './router';
import type {
  ChatMessage,
  GenerateRequest,
  GenerationParams,
  ModelConfig,
  ModelRegistry,
  NormalizedDelta,
  NormalizedResponse,
  ProviderAdapter,
  ProviderConfig,
  ToolSpec,
  WireRequest,
} from './types';

/** Resolver for the active API key. Returns undefined when no key is set. */
export type ApiKeyGetter = () => Promise<string | undefined>;

/** Arguments to `generate` / `stream`. `model` is a registry model id. */
export interface GenerateArgs {
  model?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  params?: GenerationParams;
  /** Optional AbortSignal to cancel an in-flight request. */
  signal?: AbortSignal;
}

/** A non-stream result enriched with the cost estimate. */
export interface GenerateResult extends NormalizedResponse {
  cost: CostEstimate;
}

/** Error carrying HTTP status so callers can drive capability fallback. */
export class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly bodyText: string,
  ) {
    super(`LLM request failed: ${status} ${statusText} — ${bodyText.slice(0, 500)}`);
    this.name = 'LlmHttpError';
  }
}

export class LlmClient {
  private readonly registry: ModelRegistry;
  private readonly getApiKey: ApiKeyGetter;

  constructor(registry: ModelRegistry, getApiKey: ApiKeyGetter) {
    this.registry = registry;
    this.getApiKey = getApiKey;
  }

  /** Resolve a model id (or the registry default) to model + provider + adapter. */
  private resolve(modelId: string | undefined): {
    model: ModelConfig;
    provider: ProviderConfig;
    adapter: ProviderAdapter;
  } {
    const resolved = modelId ? resolveModel(this.registry, modelId) : resolveDefaultModel(this.registry);
    if (!resolved) {
      throw new Error(
        modelId
          ? `Unknown or disabled model '${modelId}'.`
          : 'No default model available in the registry.',
      );
    }
    return { ...resolved, adapter: pickAdapter(resolved.provider) };
  }

  private buildGenerateRequest(
    model: ModelConfig,
    provider: ProviderConfig,
    args: GenerateArgs,
    stream: boolean,
  ): GenerateRequest {
    return {
      model,
      provider,
      messages: args.messages,
      tools: args.tools,
      params: args.params,
      stream,
    };
  }

  private async send(wire: WireRequest, signal: AbortSignal | undefined): Promise<Response> {
    const res = await fetch(wire.url, {
      method: wire.method,
      headers: wire.headers,
      body: wire.body,
      signal,
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new LlmHttpError(res.status, res.statusText, bodyText);
    }
    return res;
  }

  /** Non-streaming generation. Returns a normalized response plus cost. */
  async generate(args: GenerateArgs): Promise<GenerateResult> {
    const { model, provider, adapter } = this.resolve(args.model);
    const apiKey = await this.getApiKey();
    const wire = adapter.buildRequest(this.buildGenerateRequest(model, provider, args, false), apiKey);

    const res = await this.send(wire, args.signal);
    const payload: unknown = await res.json();
    const normalized = adapter.parseResponse(payload, model);
    return { ...normalized, cost: estimateCost(normalized.usage, model) };
  }

  /**
   * Streaming generation. Yields normalized deltas as Server-Sent Events
   * arrive. The terminal delta carries `finishReason` and (when reported)
   * `usage`; callers can run `estimateCost` on that usage.
   */
  async *stream(args: GenerateArgs): AsyncGenerator<NormalizedDelta, void, void> {
    const { model, provider, adapter } = this.resolve(args.model);
    const apiKey = await this.getApiKey();
    const wire = adapter.buildRequest(this.buildGenerateRequest(model, provider, args, true), apiKey);

    const res = await this.send(wire, args.signal);
    if (!res.body) throw new Error('Streaming response had no body.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by a blank line; data lines start with "data:".
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, '');
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;

          const data = line.slice('data:'.length).trim();
          if (data === '' ) continue;
          if (data === '[DONE]') return;

          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue; // ignore malformed fragments defensively
          }
          const delta = adapter.parseStreamChunk(parsed, model);
          if (delta) yield delta;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
