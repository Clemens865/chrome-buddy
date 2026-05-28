# Gemini Action Items — Chrome Buddy

Prioritized, code-mapped. Source: a deep-read pass over the Gemini API documentation set on 2026-05-23 (publicly available at https://ai.google.dev/gemini-api/docs). Each item cites the source doc and the file(s) in this repo it affects.

Legend: 🔴 MUST FIX · 🟠 HIGH-VALUE · 🟡 OPTIMIZATION · 🟢 NICE-TO-HAVE.

---

## 🔴 MUST FIX (silent bugs / breakage windows)

### F1. Drop `temperature: 0.7` from Gemini-3 model defaults
- **Why:** `troubleshooting.md` L76 + `text-generation.md` L468-469: non-default temperature on Gemini 3 **causes looping/degradation**. Default is `1.0`. We currently set `0.7` for every model.
- **Where:** `src/llm/registry.default.ts:43,55,67,81,93,105,117,131`
- **Fix:** For models whose id starts with `gemini-3`, omit `temperature` (or set `1.0`). Keep `0.7` allowed only for `gemini-2.5-*` and lower.

### F2. Set `safetySettings` explicitly on every request
- **Why:** `safety-settings.md` L65, L82-83: defaults are **OFF** on Gemini 2.5/3. We never set them → we ship with filters off.
- **Where:** `src/llm/adapters/openaiCompatible.ts` (request builder), `src/background/background.ts:88,149` (image+audio direct calls), `src/background/search.ts:30`.
- **Fix:** Normal preset = `BLOCK_MEDIUM_AND_ABOVE` on 4 categories (`HARM_CATEGORY_HARASSMENT`, `…HATE_SPEECH`, `…SEXUALLY_EXPLICIT`, `…DANGEROUS_CONTENT`). Add a Strict/Kid-Safe toggle = `BLOCK_LOW_AND_ABOVE`. Handle `promptFeedback.blockReason` + `finishReason === 'SAFETY'` (currently silent-empty).

### F3. Thought-signature pass-through (blocking when we move to Gemini 3)
- **Why:** `thought-signatures.md` L18-22, L60-72: Gemini 3 + function calling **requires** echoing the first-part `thoughtSignature` of every assistant turn back in subsequent turns. Missing → 400 `"missing thought_signature"`. Parallel calls: only the *first* FC part carries the sig; never reorder. Don't interleave parallel FC/FRs.
- **Where:** `src/llm/adapters/geminiNative.ts` (currently STUB — must be wired before bumping default); `src/llm/adapters/openaiCompatible.ts` (preserve `tool_calls[].extra_content.google.thought_signature` round-trip).
- **Fix:** When the stub becomes real, capture `parts[].thoughtSignature` on the model→client side and re-attach unchanged on the client→model side. Our evidence-compression step (`src/agent/runtime.ts` ~ `proposeToolCalls` stateless rebuild) MUST keep the first FC part's signature verbatim or rebuild a fresh history each turn (we already do the latter — verify it stays that way).

### F4. FunctionResponse `id` + `name` pairing
- **Why:** `function-calling.md` L209-212: Gemini 3 requires `functionResponse.id` exactly matching the originating `functionCall.id`, and `name` must match. We must guarantee it for every executed call.
- **Where:** `src/agent/runtime.ts` `executeCalls` + the adapter result-mapper in `openaiCompatible.ts` / `geminiNative.ts`.
- **Fix:** Audit that every tool result we send back carries both fields. (Stateless per-step prompts dodge much of this — verify.)

### F5. Unrestricted API keys stop working on 2026-06-19
- **Why:** `api-key.md` (Cat A): 27 days from today. Affects users who paste a key without scoping.
- **Fix:** Onboarding nudge — `src/views/Onboarding.tsx`. Recommend creating a key restricted to `generativelanguage.googleapis.com` referrer or IP-locked. Link the docs.

### F6. 429 / 503 / 504 handling
- **Why:** `troubleshooting.md` L20-29; `rate-limits.md`. We have no backoff (`grep -rn "429\|Retry-After"` returned nothing).
- **Fix:** Add exponential backoff with jitter (`base * 2^attempt * (0.5 + rand())`, cap ~60s, 3-5 attempts), honor `Retry-After` if present. 503 → model fallback (3.5-flash → 2.5-flash → 2.5-flash-lite). 504 → bump client timeout. Surface "Model declined / rate limited" instead of silent empty.
- **Where:** `src/llm/adapters/openaiCompatible.ts` (`generate()`), `src/background/search.ts`, `src/background/background.ts` image+audio calls.

### F7. Privacy disclosure
- **Why:** `logs-policy.md` L35, L41-56: billing-enabled projects → prompts/responses NOT used for training, retained 55 days. Free projects → may be used. We must disclose what we send and to where.
- **Fix:** Update Web Store + in-app onboarding / Settings → Privacy. Verify the prod key's project has billing enabled.

---

## 🟠 HIGH-VALUE ADDITIONS

### H1. Bump default model to `gemini-3.5-flash` — DEFERRED
- **Status:** Attempted in commit-pending PR; F3 + F4 landed but the H1 flip itself was reverted after live e2e regressed (ask-user.spec, root-folder-live AUTO both failed on 3.5 Flash). Suspect: 3.5 Flash's `medium` thinking default interacting with our synthesis step or the OAI-compat shim's behavior under tool use. Needs a focused diagnostic pass.
- **Why we want it:** `whats-new-gemini-3.5.md` L6-25, `models.md` L12-14. `gemini-2.5-flash` shuts down 2026-10-16.
- **Where:** `src/llm/registry.default.ts:20` (`defaultModel`), `src/background/search.ts:8`, `src/background/background.ts:189` (`TRANSCRIBE_MODEL`).
- **Next steps before retrying:**
  1. Live-capture the actual 3.5-flash response for a failing flow (likely empty `.msg-agent:not(.msg-subtle)` after a multi-step run).
  2. Try `thinkingLevel: 'low'` for synthesis (H2) to see if it fixes the empty-answer pattern.
  3. Consider wiring the geminiNative adapter so we route around the OAI-compat shim entirely for Gemini 3.x models.

### H2. `thinking_level` enum + a "Think harder" toggle
- **Why:** `thinking.md` L374-382: Gemini 3 uses `thinkingLevel` ∈ `minimal|low|medium|high`. `medium` is the new default for `gemini-3.5-flash`. `thinkingBudget` (integer, 2.5-only) and `thinkingLevel` (3.x-only) **don't mix**.
- **Recommended routing**:
  - Planner → `low`
  - Executor / tool calls → `medium` (default)
  - Synthesis over compressed evidence → `high`
  - Plain chat → `minimal`
- **UI**: surface a "Think harder" toggle on the composer that overrides to `high` for one turn.
- **Where:** new param in `src/llm/types.ts` GenerateOptions, plumbed through `src/llm/router.ts` + adapter request body.

### H3. Strict `responseFormat` JSON Schema for the planner
- **Why:** `structured-output.md` L100-242: replaces "prompt + jsonMode" with guaranteed-shape JSON. Eliminates parse retries.
- **Where:** `src/agent/runtime.ts` `planTask` (currently uses `params.jsonMode: true`). Define `PlanSchema = { steps: Array<{ intent: string }> }`.

### H4. Native streaming on the chat reply
- **Why:** `text-generation.md` L940-954, `streaming.md`: `streamGenerateContent?alt=sse` gives major TTFB win.
- **Where:** `src/llm/adapters/openaiCompatible.ts` (already supports SSE for OpenAI-compat path; verify our chat reply consumes it), `src/views/ChatView.tsx` plain-chat path. Stream `chunk.candidates[0].content.parts[].text` directly into the bubble.

### H5. Built-in **`googleSearch`** grounding tool (replace our `search_web`)
- **Why:** `google-search.md`: native grounding returns `groundingMetadata.{webSearchQueries, groundingChunks, groundingSupports, searchEntryPoint}`. One round-trip. Free quota: 1,500/day on 2.5 / 5,000/month on 3.x, then $14/1k (3.x) or $35/1k (2.5).
- **Where:** add as a `tool` declaration in `src/agent/runner.ts` `wireRegistry` (Gemini-native path). Keep our DIY `search_web` as fallback for niche / site-restricted / authenticated sources. Render citations in `src/views/ChatView.tsx`.

### H6. Built-in **`urlContext`** tool
- **Why:** `url-context.md` L285-306: fetch up to 20 public URLs / 34 MB each as model context. Replaces our `read_dom + navigate` for "summarize this URL" use cases. Limits: no paywalls/YouTube/Google Docs/localhost.
- **Where:** new tool exposed in the registry; keep our DOM tools for SPAs/authenticated pages.

### H7. Built-in **`computerUse`** on the Computer-Use model (massive capability win)
- **Why:** `computer-use.md`: 13 predefined actions (`click_at`, `type_text_at`, `scroll_at`, `drag_and_drop`, `key_combination`, `navigate`, `screenshot`, etc.). Coordinates normalized 0–999. `safety_decision.require_confirmation` plugs straight into our HITL gate.
- **Models supported:** `gemini-2.5-computer-use-preview-10-2025` and `gemini-3-flash-preview` ONLY (not 3.5-flash).
- **Where:** new "Vision mode" agent route that uses the computer-use model and maps actions to our existing CDP/`act()` engine in `src/page/cdp.ts` + `src/page/browserControl.ts`. The model is already in our registry (`registry.default.ts:123`).
- **Migration plan:** keep current DOM tools as the default route; add a flag to switch to Computer-Use route for "automate this page" tasks.

### H8. Multimodal **`fileSearch`** built-in RAG
- **Why:** `file-search.md`: free storage, free query-time embeddings, $0.15/M indexing. 100MB/file. Skip building our own vector store for "my saved files / past chats" recall.
- **Where:** could power a future "search my history / saved pages" feature.

### H9. PDF ingestion (huge UX gap)
- **Why:** `document-processing.md` L924-948: native PDF vision up to 50 MB / 1000 pages; 258 tokens/page; native text is **free** under Gemini 3.
- **Where:** new chat composer affordance "Drop PDF". Inline if ≤20 MB request, else Files API.

### H10. Bounding-box object detection for the page agent
- **Why:** `image-understanding.md` L587-630: prompt for `[ymin,xmin,ymax,xmax]∈[0,1000]` JSON to locate UI elements visually before clicking. Compose with our screenshot tool to "find the Buy button" without selectors.

### H11. Per-origin agent playbooks (`SKILL.md` model)
- **Why:** `custom-agents.md` L205-287: Google's filesystem-native customization model — base `AGENTS.md` + per-origin `SKILL.md` with YAML frontmatter. Maps perfectly to our skills system + the browser-harness "domain-skills" idea.
- **Where:** add `playbooks/<origin>/playbook.md`-style storage in `src/skills/`. Auto-attach to system prompt when active tab URL matches.

### H12. Collaborative planning mode
- **Why:** `deep-research.md` L98-230: agent emits an editable plan first → user approves → execute. Fewer HITL interrupts, higher trust.
- **Where:** extends our existing plan-approval gate (FR-AGENT-3) — already there; add an "Edit plan" affordance + a one-turn plan→execute pattern.

---

## 🟡 OPTIMIZATIONS (cost / latency)

### O1. Implicit context caching (zero code, biggest cheap win)
- **Why:** `caching.md` L12-32, L19-25: Flash models cache prefixes ≥1024 tokens, cached input = ~90% off. We need to reorder prompts: `[system + tools + history] → [new user turn]` in **stable byte order**.
- **Where:** message-builder in `src/llm/adapters/openaiCompatible.ts` + `src/agent/runtime.ts` `planTask`/`proposeToolCalls`/`synthesizeAnswer`. Verify identical byte ordering across turns.

### O2. Explicit caching for paid users with long system prompts
- **Why:** `caching.md` L34-45: `client.caches.create({…})` + `cachedContent: cache.name`. 30-60 min TTL. Storage cost $1/M-tok-hour; break-even when prefix is reused ≥5-10× per hour.

### O3. `media_resolution: MEDIUM` global default for screenshots
- **Why:** `media-resolution.md` L233-238: ≈50% input-token reduction with negligible accuracy loss. Per-part on Gemini 3 (`v1alpha`).
- **Where:** screenshot path (CDP capture → inline image) in `src/background/pageTools.ts` `capturePage`.

### O4. Pre-flight `countTokens()`
- **Why:** `tokens.md` L32-46: **free**, doesn't count against quota (`billing.md` L418-421). Pre-count before sending large prompts → reject/trim before $$ is spent.
- **Where:** new helper in `src/llm/router.ts`; call before any request with attached page or PDF.

### O5. Full `usageMetadata` in the cost ledger
- **Why:** Today we sum `inputTokens` + `outputTokens` only. Missing: `thoughtsTokenCount` (billed at output rate, currently invisible) and `cachedContentTokenCount` (discount line item).
- **Where:** `src/llm/router.ts:149-153` (extend `billedInput` and add `thoughtsTokens`); `src/llm/types.ts` `UsageStats`.

### O6. Refresh price table
- **Why:** `pricing.md` (Cat F): current rates per million tokens for our active models.
  - `gemini-2.5-flash`: $0.30 in / $2.50 out / $0.03 cached
  - `gemini-3.5-flash`: $1.50 in / $9.00 out / $0.15 cached
  - `gemini-3.1-flash-lite`: $0.25 in / $1.50 out / $0.025 cached
- **Where:** wherever we hardcode pricing in `src/llm/router.ts` and budget calc.

### O7. `service_tier` plumbing (Flex / Standard / Priority)
- **Why:** `flex-inference.md`, `priority-inference.md`: paid users only. Flex = -50% for slow background. Priority = +75-100% for low-latency interactive.
- **Routing**: paid+interactive → `priority`; paid+background (recall enrichment, audio post-processing) → `flex`; free → `standard`.

### O8. Batch API for offline jobs
- **Why:** `batch-api.md`: 50% off, 24h turnaround. Fits Recall embedding regeneration, weekly summary digests.
- **Caveat:** Doc currently flags "Ongoing incident: batch jobs randomly fail" — gate behind feature flag.

### O9. Long-context: query at the end, no pre-chunking ≤500k
- **Why:** `long-context.md` L184-187: question after context improves accuracy. Don't pre-chunk pages — ~99% accuracy single-needle to 1M tokens.

### O10. `x-goog-api-client: chrome-buddy/<version>` header
- **Why:** `partner-integration.md` L132-177. One-line change; gives us a Google support channel. Zero cost.
- **Where:** `src/llm/adapters/openaiCompatible.ts` request headers, plus the three native fetch sites in `src/background/`.

### O11. Bump image-gen model
- **Why:** `image-generation.md` §"Model selection" L2235-2238: `gemini-3.1-flash-image-preview` ("Nano Banana 2") is the new recommended default. Adds 512/1K/2K/4K resolutions, 14 aspect ratios, grounding. `gemini-2.5-flash-image` shuts down 2026-10-02.
- **Where:** `src/image/generate.ts` / `src/llm/registry.default.ts:137`.

### O12. Bump audio model + Files API for >20MB
- **Why:** `audio.md` L14, L404: bump `TRANSCRIBE_MODEL` to `gemini-3.5-flash`. Switch to Files API for any audio >20MB inline cap.
- **Where:** `src/background/background.ts:189`.

---

## 🟢 NICE-TO-HAVE / FUTURE

### N1. Live API "Talk to Buddy" voice mode (SW-proxied WSS)
- `live-api.md`, `session-management.md`. SW holds the key, opens WSS, side panel ↔ SW frames via `chrome.runtime.Port` (no external backend needed for ephemeral tokens). Session limits: 15-min audio / 2-min A+V. Must implement sliding-window compression + resumption from day one.
- Engineering: 1-2 weeks; main risk = MV3 SW lifetime (mitigated by Port + alarms).

### N2. Gemini TTS as "Read aloud (premium)" toggle
- `speech-generation.md` L463-476: 30 voices, emotional tags, 80+ languages auto-detected. Cost concern: audio output tokens. Chunk for >2-min reads. Default to browser SpeechSynthesis.

### N3. `gemini-embedding-2` semantic search (saved chats / pages / screenshots)
- `embeddings.md` L13, L1063-1071. Multimodal, 768-dim float32 ≈ 3KB/item — fits IndexedDB. Use Batch (50% off) for bulk indexing.

### N4. Anti-loop recap instruction in system prompt
- `troubleshooting.md` L89: *"When thinking silently: ALWAYS start the thought with a brief recap of current progress on the task and whether the task is already done."* Addresses ReAct repetition failure mode.

### N5. Tool-combination on Gemini 3 (search + url-context + code-exec + custom)
- `tool-combination.md`: set `includeServerSideToolInvocations: true` in `toolConfig`. Lets one turn ground from search, fetch a URL, run code, AND call our custom tools.

### N6. Auto-context compaction at a threshold
- `antigravity-agent.md` L54, `managed-agents-quickstart.md` L113-115: trigger a "summarize prior turns" step at ~80k tokens (Flash) instead of waiting for context rot. Builds on our existing evidence compression.

### N7. Adversarial test set
- `safety-guidance.md` L180-198: red-team dataset of prompt-injection pages (hidden text, alt-attr payloads, comment-encoded). Run before each release.

### N8. Few-shot examples in planner/executor prompts
- `prompting-strategies.md` L110-157: "Prompts without few-shot examples are likely to be less effective." We're zero-shot today.

### N9. Webhooks (Gemini's, not our `send_webhook` tool)
- `webhooks.md`: inbound callbacks for async LROs (Batch, video). Only relevant if we adopt Batch (O8) or video.

### N10. Stop/cancel mid-stream
- `antigravity-agent.md` L219: a "Stop" button that aborts the SSE stream when the loop is stuck.

---

## Quick wins (do these in order this week)

1. **F1** — strip `temperature` from Gemini-3 model entries (5-minute edit).
2. **F2** — wire `safetySettings` into the request builder (one helper + adapter call).
3. **O10** — `x-goog-api-client` header (one line per fetch site).
4. **O1** — prompt-order discipline for implicit caching (verify message builder).
5. **F5** — Onboarding nudge for API-key restriction (one-time copy + link).
6. **F6** — exponential backoff with jitter (one helper, three call sites).
7. **O5** — extend `UsageStats` with `thoughtsTokens` + `cachedContentTokens`.

After these, plan F3+F4+H1 (the model bump path) as a single coordinated PR.
