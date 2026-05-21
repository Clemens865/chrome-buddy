// Core LLM types for Chrome_Buddy.
//
// These are the provider-neutral shapes the rest of the extension talks in.
// Adapters translate between these "Normalized*" shapes and each provider's
// wire format. See docs/research/07-extensibility-future-proofing.md (registry
// schema, adapter interface) and docs/prd/architecture-sketch.md (component #4/#5).
//
// Key custody note (PRD NFR-SEC-1/2): the API key is NEVER read here. The
// background service worker injects it into the client via a getter. Adapters
// receive the key only at request-build time.

/**
 * A single message in a chat conversation. Content may be a plain string or a
 * list of typed content parts (text / image) for multimodal models. Tool/role
 * semantics mirror the OpenAI chat shape since that is our primary wire format.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Plain text, or structured multimodal parts. */
  content: string | ContentPart[];
  /** Present on assistant messages that requested tool calls. */
  toolCalls?: NormalizedToolCall[];
  /** Present on `tool` messages: the id of the call this result answers. */
  toolCallId?: string;
  /** Optional display/author name (e.g. tool name on a tool message). */
  name?: string;
}

/** A typed piece of message content for multimodal input. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; /** data: URL or remote https URL */ imageUrl: string };

/**
 * A tool/function the model may call. `parameters` is a JSON Schema object
 * (data, not code — compliant with the MV3 bright line). This is consumed
 * directly as a Gemini/OpenAI function declaration (FR-TOOLS-13).
 */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  parameters: Record<string, unknown>;
  /** Marks side-effecting tools that require a HITL gate (FR-TOOLS-12). */
  consequential?: boolean;
}

/** A tool call requested by the model, normalized across providers. */
export interface NormalizedToolCall {
  /** Provider-assigned call id, used to correlate the tool result message. */
  id: string;
  name: string;
  /** Parsed arguments. Adapters JSON-parse the wire string defensively. */
  arguments: Record<string, unknown>;
}

/** Token accounting for one generation, used by the cost meter (FR-LLM-10). */
export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  /** Cached input tokens, when the provider reports them (cheaper tier). */
  cachedInputTokens?: number;
  totalTokens: number;
}

/** Why generation stopped. */
export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' | 'unknown';

/** A complete, normalized non-streaming response. */
export interface NormalizedResponse {
  /** The assistant text (may be empty when only tool calls were returned). */
  text: string;
  /** Any tool calls the model requested. */
  toolCalls: NormalizedToolCall[];
  finishReason: FinishReason;
  usage: UsageStats;
  /** The model id that produced this response. */
  model: string;
  /** Raw provider payload, kept for debugging / native-feature passthrough. */
  raw?: unknown;
}

/**
 * One incremental chunk from a streaming response. Adapters emit these from
 * `parseStreamChunk`; fields are present only when the chunk carries them.
 */
export interface NormalizedDelta {
  /** Incremental text fragment, if any. */
  textDelta?: string;
  /** Incremental / completed tool-call info, if any. */
  toolCallDelta?: Partial<NormalizedToolCall> & { /** index in the tool-call list */ index?: number };
  /** Set on the terminal chunk. */
  finishReason?: FinishReason;
  /** Usage, when the provider reports it on the final chunk. */
  usage?: UsageStats;
}

/** Authentication descriptor for a provider (key value resolved separately). */
export interface AuthConfig {
  method: 'bearer' | 'header' | 'query' | 'none';
  /** Symbolic reference to the stored secret, e.g. "secret:gemini". */
  keyRef?: string;
  /** For method 'header'/'query': the header/param name carrying the key. */
  paramName?: string;
}

/** Adapter module identifiers shipped in the bundle. */
export type AdapterId = 'openai-compatible' | 'gemini-native';

/** A provider entry in the registry (inert data driving bundled logic). */
export interface ProviderConfig {
  id: string;
  displayName: string;
  /** Names a BUNDLED adapter module — never remote code. */
  adapter: AdapterId;
  baseUrl: string;
  auth: AuthConfig;
  enabled?: boolean;
}

/** Declared model capabilities; gate UI and request shaping (FR-MR-14). */
export interface ModelCapabilities {
  vision?: boolean;
  tools?: boolean;
  thinking?: boolean;
  jsonMode?: boolean;
  streaming?: boolean;
  /** Purpose-built for browser automation (e.g. computer-use). */
  computerUse?: boolean;
  /** Generates images (native generateContent w/ responseModalities: IMAGE). */
  imageOutput?: boolean;
  /** Text/multimodal embedding model (embedContent endpoint). */
  embedding?: boolean;
}

/** Per-million-token pricing (USD). Tier-aware pricing is summarized here. */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Discounted price for cached input tokens, when offered. */
  cachedInputPerMTok?: number;
}

/** A model entry in the registry. */
export interface ModelConfig {
  id: string;
  provider: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  pricing: ModelPricing;
  capabilities: ModelCapabilities;
  /** Default sampling params merged into each request. */
  defaultParams?: Record<string, unknown>;
  /** Declarative param renames (our name -> provider wire name). */
  paramMap?: Record<string, string>;
  enabled?: boolean;
  /** Optional tier hint for fallback selection: lower = faster/cheaper. */
  tier?: 'lite' | 'standard' | 'pro' | 'specialized';
}

/**
 * The model/provider registry. Bundled-default ships in the package and is the
 * floor; signed remote updates merge over it (precedence user > remote >
 * bundled). It is pure data — adding a model is a one-line config edit.
 */
export interface ModelRegistry {
  schemaVersion: string;
  providers: Record<string, ProviderConfig>;
  models: Record<string, ModelConfig>;
  /** Optional id of the model to use when none is specified. */
  defaultModel?: string;
}

/** Caller-supplied generation parameters (provider-neutral). */
export interface GenerationParams {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  /** Request strict JSON output; adapters map to the provider's json mode. */
  jsonMode?: boolean;
  /** JSON Schema constraining structured output (FR-LLM-5). */
  responseSchema?: Record<string, unknown>;
  /** Thinking effort/budget hint; adapters that support it map it (FR-LLM-6). */
  thinking?: 'off' | 'low' | 'medium' | 'high';
  /** Force a stop on these sequences. */
  stop?: string[];
}

/** Everything an adapter needs to build a request, resolved by the client. */
export interface GenerateRequest {
  model: ModelConfig;
  provider: ProviderConfig;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  params?: GenerationParams;
  /** True to ask the provider to stream the response. */
  stream?: boolean;
}

/** A ready-to-send HTTP request, produced by an adapter's `buildRequest`. */
export interface WireRequest {
  url: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  /** Serialized JSON body. */
  body: string;
}

/**
 * Provider adapter interface. Each shipped adapter (selected by the registry's
 * `adapter` field) implements this minimal surface. Adapters are PURE w.r.t.
 * I/O: they build requests and parse payloads but never perform fetches and
 * never read the API key from storage — the key arrives as an argument.
 */
export interface ProviderAdapter {
  /** Adapter identifier matching `ProviderConfig.adapter`. */
  readonly id: AdapterId;

  /**
   * Build the HTTP request for a generation. `apiKey` is injected by the
   * client (resolved in the SW). May be undefined when the provider needs no
   * key (e.g. local Ollama).
   */
  buildRequest(req: GenerateRequest, apiKey: string | undefined): WireRequest;

  /** Parse a complete (non-streaming) provider response payload. */
  parseResponse(payload: unknown, model: ModelConfig): NormalizedResponse;

  /**
   * Parse one raw streaming chunk (already decoded from SSE: the JSON object
   * after `data: `). Returns null for non-data lines (heartbeats / `[DONE]`).
   */
  parseStreamChunk(rawChunk: unknown, model: ModelConfig): NormalizedDelta | null;

  /** Map normalized tool specs to this provider's wire tool format. */
  mapToolsToWire(tools: ToolSpec[]): unknown;

  /** Extract normalized tool calls from a provider message/payload. */
  parseToolCalls(payload: unknown): NormalizedToolCall[];
}
