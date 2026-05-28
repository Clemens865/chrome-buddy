# Gemini Findings — By Category

Per-category digest of the 79-doc Gemini API documentation set (publicly available at https://ai.google.dev/gemini-api/docs). Each section gives the key facts + the actionable bits with line refs. For prioritized actions, see `action-items.md`.

Today: **2026-05-23**.

---

## A. Models & Breaking Changes

**Docs:** models, capabilities, changelog, deprecations, whats-new-gemini-3.5, **interactions-breaking-changes-may-2026**, interactions, migrate, migrate-to-interactions, api-key, ephemeral-tokens, libraries, quickstart, get-started-sdk, get-started-websocket, openai.

**Key facts:**
- **`gemini-3.5-flash`** GA since 2026-05-19. 1M context, 65k output, thinking on by default at `medium`, automatic thought preservation across turns (`whats-new-gemini-3.5.md` L6-25; `models.md` L12-14).
- **`gemini-3.1-flash-lite`** GA since 2026-05-07 — cheap/fast pick (`changelog.md` L27-29).
- **`gemini-2.5-flash` and `gemini-2.5-flash-image` shut down 2026-10-16 / 2026-10-02** (`deprecations.md` L25, L49).
- **2026-06-19**: unrestricted API keys stop working (`api-key.md`).
- **`gemini-3.x`** + function calling **requires** `thoughtSignature` echo (`thought-signatures.md` L18-22).
- **`gemini-3.x`** breaks with non-default `temperature` (`text-generation.md` L468-469).
- **OpenAI-compat** works but signature handling needs `extra_content.google.thought_signature` round-trip (`openai.md` L1097-1123). Native unlocks `thinking_level`, Search grounding, URL context, multimodal function responses cleanly.
- **Interactions API** (new, post-may-2026): server-side `previous_interaction_id` removes need to ship full history. Free tier: 1-day retention. Gemini 3 doesn't support remote MCP via Interactions yet.

**Status for us:**
- USE ✓ `chrome.storage.session` key custody.
- FIX defaults: 3.x temperature; safetySettings.
- MISSING: thoughtSignature handling in `geminiNative.ts` stub.
- MIGRATE: 2.5-flash → 3.5-flash within 5 months.

---

## B. Text / Thinking / Structured

**Docs:** text-generation, thinking, thought-signatures, structured-output, streaming, long-context, tokens, prompting-strategies, best-practices (live-only — N/A).

**Key facts:**
- **`thinkingLevel` (Gemini 3) vs `thinkingBudget` (Gemini 2.5)** — don't mix (`thinking.md` L493). Levels: `minimal | low | medium | high`. `medium` is default for 3.5-flash.
- Cost: `response price = output_tokens + thoughts_tokens`. Surface `usageMetadata.thoughtsTokenCount` separately (`thinking.md` L645-678).
- **Thought signatures** (`thought-signatures.md`):
  - 3.x + function calling: returning first-part signature is **mandatory** (L18-22, L60-72).
  - Parallel calls: only the *first* `functionCall` carries the sig; preserve verbatim (L41-46).
  - Multi-step: every step's first FC needs its sig AND all prior sigs in the turn (L74-292).
  - Don't interleave parallel FC/FR — order must be `FC1+sig, FC2, FR1, FR2` (L843).
  - Dummy `"skip_thought_signature_validator"` for OpenAI-compat → Gemini history migrations (L838-841).
- **Structured output**: use `config.responseFormat = { text: { mimeType: 'application/json', schema: <JSONSchema> } }` (`structured-output.md` L100-242). Output guaranteed valid + key order matches schema.
- **Streaming**: `streamGenerateContent?alt=sse` (`text-generation.md` L940-954) or Interactions API step-based events `step.start/delta/stop` (`streaming.md`).
- **Long context (1M)**: put question **at the end** after context (L184-187). Don't pre-chunk under 500k. Multi-needle retrieval is weaker than single-needle (L167-179).
- **`countTokens` is free**, doesn't count against quota (`tokens.md` L32-46; `billing.md` L418-421).
- **Prompting strategies** worth lifting verbatim:
  - "Knowledge cutoff / current date" clause (`prompting-strategies.md` L338-349).
  - Strict-grounding clause for synthesis (L354-364).
  - Agentic-workflow template with "intelligent persistence" + "inhibit response until reasoning done" (L494-536).
  - Few-shot strongly recommended (L110-157).

**Status for us:**
- FIX: planner uses `jsonMode` — upgrade to strict `responseFormat` schema.
- MISSING: streaming on plain-chat reply (TTFB win), `countTokens` pre-flight, full `usageMetadata` capture.
- ADD: "Think harder" toggle → `thinkingLevel: high`.

---

## C. Function-Calling & Built-In Tools

**Docs:** function-calling, tools, tool-combination, code-execution, google-search, url-context, file-search, maps-grounding, webhooks, computer-use.

**Key facts:**
- **Function-calling wire shape:** model→client `{parts:[{functionCall:{name,args,id}, thoughtSignature}]}`; client→model `{parts:[{functionResponse:{name,id,response}}]}`. Echo `id`+`name` (mandatory on 3.x). `function-calling.md` L209-212, L358-448.
- **`tool_choice`**: `functionCallingConfig.mode` ∈ `AUTO|ANY|NONE|VALIDATED`, with optional `allowed_function_names` (L1061-1107).
- **Parameter schema**: OpenAPI subset; use `enum`; avoid dict types + deep nesting in `ANY` mode (L1824-1828).
- **`googleSearch`** built-in tool: Citations in `groundingMetadata.{webSearchQueries, groundingChunks[uri,title], groundingSupports, searchEntryPoint}`. Billed per executed query on Gemini 3 (`google-search.md` L99-148, L234-244). Free quota then $14/1k (3.x) or $35/1k (2.5).
- **`urlContext`** built-in tool: Up to 20 public URLs per request, 34 MB / URL. Supports html/json/xml/css/js/csv/text/image/pdf. **No paywall/YouTube/Google Docs/localhost** (`url-context.md` L285-306).
- **`fileSearch`** built-in RAG: Free storage + free query-time embeddings. Pay at indexing + retrieved tokens. Free 1 GB; T1 10 GB; T2 100 GB; T3 1 TB. 100 MB/file. **Cannot combine with Search/URL context** (`file-search.md` L1077-1101). Multimodal via `gemini-embedding-2` (L522-569).
- **`codeExecution`**: built-in Python sandbox, 30 s, fixed library set, no custom installs. Gemini 3 Flash can run code with image input — useful for "zoom into screenshot region for fine-grained reasoning" (`code-execution.md` L191-245). Doesn't replace our Tier-2 client-side sandbox.
- **`computerUse`** built-in:
  - Models: `gemini-2.5-computer-use-preview-10-2025`, `gemini-3-flash-preview` (NOT 3.5-flash) (`computer-use.md` L6, L125-129).
  - 13 actions: `open_web_browser`, `wait_5_seconds`, `go_back`, `go_forward`, `search`, `navigate`, `click_at`, `hover_at`, `type_text_at`, `key_combination`, `scroll_document`, `scroll_at`, `drag_and_drop` (L568-582).
  - Coordinates **normalized 0-999**; denormalize as `x/1000 * width`. Recommended viewport 1440×900 (L232-253).
  - `safety_decision.require_confirmation` → ask user → echo `safety_acknowledgement:"true"` in the `FunctionResponse.response` (L615-677). Drop-in for our HITL.
  - `excludedPredefinedFunctions` lets us mix built-in + our custom function declarations.
- **`tool combination`** (Gemini 3 only): `googleSearch + urlContext + codeExecution + functionDeclarations + computerUse` in ONE call with `includeServerSideToolInvocations: true` (`tool-combination.md` L438-509). All responses come back with `id` + `tool_type` + `thought_signature` parts.
- **`mapsGrounding`**: $25/1k after 500/day free; for geo-intent queries (`maps-grounding.md`).
- **Gemini Webhooks ≠ our `send_webhook` tool** — Gemini's are inbound LRO callbacks (Batch/video). No overlap (`webhooks.md`).

**Status for us:**
- FIX: thought-signature + id-pairing contract.
- MISSING (high value): `googleSearch`, `urlContext`, `fileSearch`, `computerUse`. `codeExecution` is optional.
- USE ✓ keep our DIY DOM tools as fallback/complement; do not remove.

---

## D. Multimodal & Files

**Docs:** image-understanding, document-processing, video-understanding, audio, image-generation, imagen, video, speech-generation, files, file-input-methods, media-resolution, embeddings.

**Key facts:**
- **Vision** (`image-understanding.md`):
  - Tiling math: ≤384 px = 258 tokens; larger → 768×768 tiles, crop ≈ `floor(min(w,h)/1.5)`, tiles = `ceil(w/crop)×ceil(h/crop)×258` (L668-678).
  - **`media_resolution`**: `LOW | MEDIUM | HIGH | ULTRA_HIGH` — direct cost lever. Gemini 3 defaults: image 1120 tok; PDF 560/page; video 70/frame (`media-resolution.md` L205, L233-238).
  - **Bounding boxes**: ask for `[ymin,xmin,ymax,xmax]∈[0,1000]` JSON with `response_mime_type=application/json` (L587-630). Useful for "where is the Buy button?" before click.
- **PDFs** (`document-processing.md`):
  - Up to **50 MB / 1000 pages** inline or via Files API. 258 tokens/page. **Native text is free on Gemini 3** (L924-948).
  - **DOCX/XLSX**: NOT vision-understood — only text extracted, no layout (L952-957). Convert to PDF client-side first.
- **Image generation** — three flavors (`image-generation.md` L23-27):
  - `gemini-2.5-flash-image` (current default) — limited; shuts down **2026-10-02**.
  - **`gemini-3.1-flash-image-preview`** = "Nano Banana 2" — recommended default. 512/1K/2K/4K, 14 aspect ratios up to 8:1, thinking for text rendering, image-search grounding.
  - `gemini-3-pro-image-preview` = "Nano Banana Pro" — premium.
- **Imagen 4**: pure text-to-image, English-only, no input image (`imagen.md`). Only for photoreal portraits Nano Banana can't match.
- **Audio understanding** (`audio.md`): inline ≤20 MB; Files API above. Max **9.5 h** per prompt (L893). 32 tokens/sec. Latest doc model `gemini-3.5-flash` (L14, L185).
- **Speech generation (TTS)** (`speech-generation.md`): `gemini-3.1-flash-tts-preview` — 30 voices, 80+ langs, audio tags (`[whispers]`, `[excited]`), multi-speaker. 24 kHz PCM. **Audio output tokens are expensive** — chunk long reads; default to browser SpeechSynthesis.
- **Files API** (`files.md` L309-313): free, 48-hour retention, 2 GB/file, 20 GB/project. Use whenever request would exceed inline 20 MB cap.
- **Method picker** (`file-input-methods.md` L94-98): Inline (≤20 MB) / Files API (≤2 GB) / GCS URI / external public URL.
- **Embeddings** (`embeddings.md`):
  - **`gemini-embedding-2`** (April 2026): multimodal (text + image + video + audio + PDF), 8192 input tokens, MRL dims 128–3072 (recommended 768/1536/3072).
  - Task via prompt prefix: `"task: search result | query: {text}"` and `"title: {t} | text: {c}"` (L137-141).
  - Spaces incompatible across model versions — start on `embedding-2` directly (L1087-1091).
- **Video**: 1 FPS default ~300 tokens/sec. Inline <100 MB / <1 min. **YouTube URLs free in preview** (`video-understanding.md` L246).
- **Veo 3.1 video gen** (`video.md`): no clear Chrome Buddy use case — N/A.
- **Lyria music gen** + Robotics — N/A.

**Status for us:**
- FIX: image-gen model bump to `gemini-3.1-flash-image-preview`; audio transcription model bump to `gemini-3.5-flash`.
- ADD: PDF ingestion (inline ≤20 MB + Files API), `media_resolution` knob (≈50% screenshot savings), bounding-box detection for the page agent, multimodal embeddings for Recall.

---

## E. Live / Realtime

**Docs:** live-api, session-management, music-generation, realtime-music-generation, robotics-overview.

**Key facts:**
- **Live API** (`live-api.md`): low-latency bidirectional WSS — voice in/out (16-bit PCM 16kHz in / 24kHz out), JPEG ≤1 FPS in, text, **tool calling + Google Search**, barge-in/VAD native, 70-language. Production note: "**use ephemeral tokens instead of standard API keys**" (L55).
- **MV3 design pattern**: SW holds the long-lived key, opens the WSS, side panel ↔ SW frames over `chrome.runtime.Port`. No external token endpoint needed (Port keeps SW alive while panel open; bridge with `chrome.alarms` for keep-alive).
- **Session limits** (`session-management.md` L13-24): audio-only = 15 min; audio+video = 2 min; connection lifetime ~10 min. `GoAway.timeLeft` warning before termination (L201-223).
- **Resumption** (L58-199): persist `sessionResumptionUpdate.newHandle` on every update; pass as `sessionResumption.handle` on reconnect. 2-hour validity window.
- **Sliding-window context compression** (L26-56): removes the 15-min wall — required from day one.
- **Music gen / Robotics**: N/A for a productivity side panel.

**Status for us:**
- OPTIONAL/FUTURE: "Talk to Buddy" voice mode via SW-proxied WSS. Engineering cost 1-2 wks; main risk = MV3 SW lifetime (mitigated). Ship sliding-window + resumption from day one.

---

## F. Cost / Scale

**Docs:** caching, batch-api, flex-inference, priority-inference, pricing, billing, rate-limits, optimization.

**Key facts:**
- **Caching** (`caching.md`):
  - Implicit: automatic on 2.5+; just byte-stable prefix ordering. Min cache: 1024 tokens (Flash) / 4096 (Pro). ~90% off cached input (`pricing.md` L60-61, L560-562).
  - Explicit: `client.caches.create(...)` + `cachedContent: cache.name` + TTL (default 1h). Storage cost $1/M-tok/h. Break-even when prefix reused ≥5-10× per hour.
- **Pricing snapshot (per 1M tokens, USD, paid tier):**
  - `gemini-2.5-flash`: $0.30 in / $2.50 out / $0.03 cached
  - `gemini-3.5-flash`: $1.50 in / $9.00 out / $0.15 cached
  - `gemini-3.1-flash-lite`: $0.25 in / $1.50 out / $0.025 cached
  - `gemini-3.1-flash-image-preview`: $0.50 text in / $3 text out + $60/M image tokens (~$0.067/1K img)
  - `gemini-embedding-2`: $0.20 text / $0.45 image / $6.50 audio / $12 video (multimodal)
  - Thinking tokens billed **as output tokens** (no separate line).
- **Batch API** (`batch-api.md`): 50% off, 24h turnaround. Doc currently flags ongoing-failure incident (L3-5). Fits Recall embedding regen, nightly digest, non-realtime audio post-processing. Webhooks for `batch.succeeded` (L746-797) instead of polling.
- **Service tiers** (`flex-inference.md`, `priority-inference.md`):
  - Priority: +75-100% premium, sub-second TTFB, non-sheddable, T2+ only. Rate limit = 0.3× standard.
  - Standard: 1.0×, seconds-minutes latency.
  - Flex: -50%, 1-15 min latency, best-effort, sheddable. All paid tiers.
  - Batch: -50%, async ≤24h.
  - Priority overflow auto-downgrades to Standard (billed at Standard).
- **Rate limits** (`rate-limits.md`): per-project (NOT per-key). Specific RPM/TPM numbers live in the AI Studio dashboard, not in docs. No programmatic discovery — store tier from user-provided billing status or read response headers.
- **Failed (400/500) requests NOT billed** but still count against quota (`billing.md` L413-416). **`countTokens` is free + doesn't count against quota** (L418-421).
- **Billing tiers** (`billing.md` L9-14): Free → T1 ($250 cap, link billing) → T2 ($2k cap, $100 + 3 days) → T3 ($20k+, $1k + 30 days). Caps enforced since 2026-04-01.

**Status for us:**
- FIX: 429/503/504 handling with exponential backoff + jitter + Retry-After.
- ADD: implicit caching prompt-ordering (cheap big win); `countTokens` pre-flight; full `usageMetadata`; `service_tier` plumbing; refreshed prices in cost ledger.

---

## G. Safety / Agents / Misc

**Docs:** safety-settings, safety-guidance, logs-policy, logs-datasets, agents, agent-environment, custom-agents, coding-agents, antigravity-agent, deep-research, managed-agents-quickstart, troubleshooting, docs, partner-integration.

**Key facts:**
- **`safetySettings`** (`safety-settings.md`):
  - **Defaults are OFF on Gemini 2.5/3** (L65, L82-83). Must set explicitly.
  - 4 adjustable categories: `HARM_CATEGORY_HARASSMENT`, `HATE_SPEECH`, `SEXUALLY_EXPLICIT`, `DANGEROUS_CONTENT`. Child-safety filters always on.
  - Thresholds: `OFF | BLOCK_NONE | BLOCK_ONLY_HIGH | BLOCK_MEDIUM_AND_ABOVE | BLOCK_LOW_AND_ABOVE`.
  - Handle `promptFeedback.blockReason` and `finishReason === 'SAFETY'` (currently we render empty).
- **Logs policy** (`logs-policy.md`): billing-enabled projects → prompts/responses **NOT used for training** by default (L41-44). Retained 55 days (L35). License grant covers system instructions, cached content, files (L63-68).
- **Custom agents** (`custom-agents.md` L205-287): Google's `AGENTS.md` + per-origin `SKILL.md` model with YAML frontmatter. Layer-additive (L106). Override per-invocation (L605-644). **Perfect template for per-origin Chrome Buddy playbooks.**
- **Deep research** (`deep-research.md`):
  - Collaborative planning: plan-first → user edits/approves → execute (L98-230).
  - Stream `thinking_summaries: "auto"` to UI (L862-867).
  - Browser-content agent safety notes (L1126-1134): exfiltration risk when DOM-read + outbound tool — require HITL on any outbound tool from sensitive origins.
- **Antigravity / managed agents quickstart**: automatic context compaction at ~135k tokens; mid-stream cancellation pattern; separate "conversation state" vs "environment state".
- **Troubleshooting** (`troubleshooting.md`):
  - 429: exponential backoff (L26).
  - 503/500: auto-retry once with model fallback (Pro → Flash → Flash-Lite) (L27-28).
  - 504: bump client timeout (L29).
  - **3.x temperature**: "strongly recommend keeping `temperature` at default 1.0" (L76).
  - `RECITATION` finish: surface "model declined; try rephrasing" (L71-74).
  - **Anti-loop recap instruction** (L89): paste into system prompt verbatim — *"When thinking silently: ALWAYS start the thought with a brief (one sentence) recap of the current progress on the task. In particular, consider whether the task is already done."*
  - Never embed API key in bundle (L97-135) — verify ours lives only in `chrome.storage.session`.
- **Partner integration** (`partner-integration.md` L132-177): set `x-goog-api-client: chrome-buddy/<version>` header. Free support channel.

**Status for us:**
- FIX: `safetySettings` (defaults are OFF), block-reason handling, 429 backoff, drop temperature on 3.x.
- ADD: per-origin playbooks (SKILL.md model), collaborative planning mode, exfiltration audit on sensitive origins, anti-loop recap clause, `x-goog-api-client` header, privacy disclosure update.

---

## Skipped (framework examples)

`crewai-example.md`, `langgraph-example.md`, `llama-index.md`, `vercel-ai-sdk-example.md`, `temporal-example.md`. None applicable to our MV3 extension.
