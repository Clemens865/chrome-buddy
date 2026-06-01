# Chrome Buddy — Architecture

> Reference for the whole system as of **v0.4.0**. Chrome Buddy is a Manifest V3
> Chrome side-panel extension that combines an agentic assistant, a multi-provider
> LLM layer, a no-code app builder, and a local RAG library — all **model-transparent,
> BYO-key, zero-RCE, and privacy-respecting** (everything runs locally; the only
> network calls are to the LLM provider you bring a key for).

## Table of contents
1. [Vision & the four layers](#1-vision--the-four-layers)
2. [High-level architecture](#2-high-level-architecture)
3. [Security & key custody](#3-security--key-custody)
4. [Storage (IndexedDB)](#4-storage-indexeddb)
5. [LLM layer](#5-llm-layer)
6. [Agent core](#6-agent-core)
7. [Tools & extensibility](#7-tools--extensibility)
8. [Apps, builder & marketplace](#8-apps-builder--marketplace)
9. [Library RAG](#9-library-rag)
10. [Page control & vision](#10-page-control--vision)
11. [Voice & Voice Transcriber](#11-voice--voice-transcriber)
12. [Console Inspector](#12-console-inspector)
13. [UI shell & views](#13-ui-shell--views)
14. [Built-in apps](#14-built-in-apps)
15. [Message protocol reference](#15-message-protocol-reference)
16. [Design principles](#16-design-principles)
17. [Known gaps & roadmap](#17-known-gaps--roadmap)

---

## 1. Vision & the four layers

Chrome Buddy is one assistant that *does* multi-step browser work, layered over **one
shared tool registry**:

1. **Focused micro-apps** — single-purpose tools (Console Inspector, Image Generator,
   Audio + Voice Transcribers, Webhook Flows, Scrape to Table, Data Visualizer, Tab
   Manager, SVG Icon Generator, BrandSnap).
2. **Agentic chat** — multi-step execution (plan → act → observe → reflect), a
   human-in-the-loop (HITL) confirmation gate before any consequential action,
   multi-tab context, and an opt-in bounded **sub-agent** mode.
3. **A natural-language app builder** — generates *real* apps with their own UI:
   Tier-1 (declarative), Tier-2 (sandboxed JS), Tier-3 (sandbox-UI micro-apps).
   Apps live as **data** (export/import/edit), never as committed code.
4. **User-extensible skills + workflows** — capabilities added as data, including
   Claude `SKILL.md` import, plus an MCP-server connector.

---

## 2. High-level architecture

Three execution contexts, each with a distinct trust level:

```
┌──────────────────────────────────────────────────────────────────────┐
│ SIDE PANEL / OVERLAY  (React, extension origin — trusted UI)           │
│  • View routing, chat, library, settings, app UIs                      │
│  • Orchestrates long-running work (imports, recording) so the SW can   │
│    stay short-lived                                                    │
│  • NEVER holds the API key; requests go to the SW by message/port      │
└───────────────┬────────────────────────────────────────────────────────┘
                │ chrome.runtime sendMessage / connect(port)
┌───────────────▼────────────────────────────────────────────────────────┐
│ BACKGROUND SERVICE WORKER  (the security boundary + authority)         │
│  • API key custody (chrome.storage.session, TRUSTED_CONTEXTS)          │
│  • ALL cloud LLM/embed/image/audio calls originate here                │
│  • Page tools via chrome.scripting; IndexedDB owner; alarms; menus     │
└───────────────┬────────────────────────────────────────────────────────┘
                │ postMessage (opaque-origin, capability-gated)
┌───────────────▼────────────────────────────────────────────────────────┐
│ SANDBOX IFRAME  (opaque origin — zero ambient authority)               │
│  • Runs untrusted Tier-2/3 app code                                    │
│  • No chrome.*, no key, no network, no same-origin DOM                 │
│  • Reaches capabilities ONLY through the narrow postMessage bridge     │
└──────────────────────────────────────────────────────────────────────┘
```

**Why this split**
- **MV3 SW lifecycle**: the service worker is killed after ~30s idle. Long work
  (folder import, recording, multi-step agent loops) is driven from the panel
  (long-lived while open); the SW does short, stateless units per message.
- **Key custody**: the key never leaves the SW, so neither the panel, the overlay,
  content scripts, nor sandboxed apps can read it.
- **Zero-RCE**: untrusted code only ever runs in the opaque-origin sandbox.

Runtime dependencies are deliberately tiny: `idb`, `react`, `react-dom`,
`react-markdown`, `remark-gfm`. Everything else (chunking, embeddings math, PCM/WAV,
HTML parsing, distillation, cost) is hand-rolled and unit-tested.

---

## 3. Security & key custody

**NFR-SEC-1 — keys live ONLY in `chrome.storage.session`** (in-memory, cleared when
the browser session ends; never `local`/`sync`/disk). The SW sets the session store
to `TRUSTED_CONTEXTS` on boot so content scripts cannot read it; if `setAccessLevel`
fails the SW logs a security error.

- `src/key/messages.ts` — typed message protocol. `KEY_SET` (store; empty string
  clears), `KEY_STATUS` (boolean only — never echoes the key), `KEY_VALIDATE` (live
  one-shot test of a candidate without storing it), `LLM_GENERATE` (use the stored key).
- `src/key/useApiKey.ts` — React hook; status is `unknown|set|unset`, never holds the
  key in component state.
- `src/llm/instance.ts` `readSessionApiKey(provider)` — resolves `apiKey:<provider>`
  from session storage, with a dev-only `.env` fallback (`VITE_GEMINI_API_KEY` etc.,
  empty in shipped builds).

Every key-using message (`LLM_GENERATE`, `IMAGE_GENERATE`, `AUDIO_TRANSCRIBE`,
`LIBRARY_*`, voice/vision) is SW-handled: the SW reads the key, builds the request,
returns only the response. **MCP bearer tokens** follow the same model
(`src/mcp/keys.ts` → `chrome.storage.session`, session-only).

Other guardrails: adapters never log auth headers; remote model-registry updates must
be **Ed25519-signed** and verified against a bundled key before merge; the **zero-RCE
line** means all app code is data executed in the opaque sandbox, never remote-fetched
script.

---

## 4. Storage (IndexedDB)

Single DB **`chrome-buddy`**, owned by the SW, current **VERSION 14** (`src/db.ts`).
The `upgrade()` callback guards each store with `if (!contains(name))` so upgrades are
replay-safe; data migrations (e.g. v14 backfill) are gated on `oldVersion`.

| Store | keyPath | Indexes | Purpose |
|---|---|---|---|
| `runs` | `id` | `startedAt` | Agent run traces (memory/history) |
| `skills` | `id` | `createdAt` | Saved skill templates |
| `workflows` | `id` | `createdAt` | Multi-step automations + schedules |
| `apps` | `id` | `createdAt` | Tier-1/2/3 apps (stored as data) |
| `chats` | `id` | `updatedAt` | Chat conversations |
| `notes` | `key` | `updatedAt` | Scratchpad notes |
| `libraryDocs` | `id` | `updatedAt`, `source`, `collectionId`¹ | RAG docs (display unit) |
| `libraryChunks` | `id` | `docId`, `collectionId`¹ | Embedded chunks (search units) |
| `collections`¹ | `id` | `kind` | Named RAG buckets |
| `transcriptSessions` | `id` | `createdAt` | Voice Transcriber sessions |
| `webhooks` | `id` | `name` (unique) | Webhook address book |
| `webhookFlows` | `id` | `updatedAt`, … | "Snapshot page → POST" flows |
| `mcpServers` | `id` | `name` (unique), `updatedAt` | MCP server config (no keys) |
| `fsroot` | — | — | File System Access root handle |
| `runState` | — | — | In-flight agent checkpoint (resume) |

¹ **v14** added the `collections` store, the `collectionId` indexes on
`libraryDocs`/`libraryChunks`, and a cursor backfill stamping legacy rows with
`collectionId: 'general'`.

---

## 5. LLM layer

Normalizes multi-provider cloud LLM access behind one adapter interface, routed by a
declarative registry, with per-call model-intent resolution and cost accounting.

**Key files**
- `src/llm/types.ts` — provider-neutral shapes (`ChatMessage`, `GenerateRequest`,
  `NormalizedResponse`, `ProviderAdapter`, `ModelRegistry`).
- `src/llm/client.ts` — `LlmClient`; resolves model→provider→adapter; `.generate()`
  (one-shot) and `.stream()` (async generator).
- `src/llm/instance.ts` — entry points: `generateViaBackground()` (UI→SW),
  `getLlmClient()` (SW-only), `readSessionApiKey()`.
- `src/llm/registry.default.ts` — bundled floor: Gemini 2.5/3.x, Claude Opus/Sonnet/
  Haiku, image + Computer Use models, with tier hints, pricing, and capabilities.
- `src/llm/userRegistry.ts` / `remoteRegistry.ts` — user overlay (`storage.local`) and
  signed remote updates; precedence **user > remote > bundled**.
- `src/llm/resolveModel.ts` + `modelPref.ts` — the **Cheapest / Balanced / Best /
  Custom** intent selector, resolved at *every* call site; "Best" → Opus when an
  Anthropic key is set, else strongest Gemini; chat-intent downgrades Best→Sonnet to
  keep Q&A snappy.
- `src/llm/adapters/` — `openaiCompatible.ts` (the default path for Gemini via its
  OpenAI-compatible `/v1beta/openai/chat/completions`, plus OpenRouter/Groq/Ollama),
  `anthropic.ts` (Claude Messages API), `geminiNative.ts` (stub — native
  `generateContent` not yet wired for chat).
- `src/llm/retry.ts` (429/503/504 + network, exp-backoff + jitter, honors
  `Retry-After`), `safety.ts` (Gemini harm-category blocking), `thinking.ts`
  (Gemini 3 `thinking_level` vs 2.5 `thinking_budget`), `nano.ts` (on-device Chrome
  Prompt API; returns null on unavailable so callers fall back to cloud).

**Generation flow**
1. UI → `generateViaBackground(req)` posts `LLM_GENERATE`.
2. SW resolves provider id → `getLlmClient(provider)` (lazy key getter).
3. `client.generate()` → adapter `buildRequest(req, apiKey)` → `retryFetch` →
   adapter `parseResponse` → `estimateCost(usage, model)`.
4. **Streaming** uses the `chat-stream` **port** (not a message): the panel connects,
   sends `START`, receives `DELTA…`/`DONE`/`ERROR`, can `ABORT`. The key is read in
   the SW per stream.

**Pinned routes**: image generation, audio transcription, voice, and vision/Computer
Use go through Gemini-native endpoints in the SW (not the OpenAI-compatible adapter).

**Cost** (`src/cost/budget.ts` + `estimateCost`): every response carries a USD cost
(input/output/cached broken out); a rolling **daily spend ledger** lives in
`storage.local`; budget caps (per-run, per-day, max steps) gate the agent loop. *(Exact
default cap values live in `budget.ts`.)*

---

## 6. Agent core

The agentic loop lives in `src/agent/`. It runs **in the side panel** (not the SW —
so a SW restart can't kill an in-flight run), calling the SW per tool/LLM step.

**Loop**: plan → act → observe → reflect. The planner decomposes a task into steps;
each step may call tools; observations feed back; the loop reflects and replans until
done or budget-exhausted.

**Key concerns**
- **HITL confirmation gate** — before any *consequential* tool runs (e.g.
  `send_webhook`, `write_file`, GitHub writes, MCP `confirm` tools), the loop emits a
  `confirmation_required` event and awaits an `ApprovalResolver`. Confirms are keyed by
  `runId` + the real `callId` so a streaming race can't mis-route an approval.
- **Budget** — a shared `BudgetLedger` bounds cost/calls/wall-clock across a run *and*
  its sub-agents (one ceiling, not per-agent). When present it's the cost authority;
  otherwise per-state `costBudget` is the fallback (zero-risk rollout).
- **Sub-agents (bounded delegation)** — a flat planner→worker queue spine with a
  read-only capped `delegate` op. Hard caps on delegation depth, sub-count, per-sub
  iterations, the shared token budget, and wall-clock — the safety Agent Zero lacks.
  The HITL gate still fires from inside sub-agents (never auto-authorized).
- **Checkpoint / resume (MV3 survival)** — `runState` (IDB) holds an in-flight
  checkpoint. The loop checkpoints **before** dispatching a side effect and records it
  dispatched, so on resume a consequential action is *skipped* rather than re-fired
  (re-firing a webhook/commit is worse than missing one; the user sees the skip).
- `src/agent/context.ts` — builds the system context: the active page summary and/or
  the user profile (professional/personal).

---

## 7. Tools & extensibility

**Tool registry** (`src/tools/defs.ts` + the registry wired in the runner): each
`ToolDefinition` carries `name`, `description`, `paramsSchema`, a `consequential` flag,
and a handler `(args, ctx) => Promise<ToolResult>` returning `ok(data)` or
`err(code, message)`. The `consequential` flag is all it takes to get the HITL gate.

Dispatch by kind:
- **Page tools** (`navigate/click/type/scroll/read_dom/extract/screenshot/summarize`)
  → `TOOL_EXEC` → SW `executePageTool` (chrome.scripting).
- **Built-in handlers** (`search_web`, `fetch_url`, `file_search`, `github_*`,
  console analyzers, `search_library`, `search_catalog`, `list_webhooks`) → SW.
- **MCP tools** (`mcp__<serverId>__<tool>`) → dispatcher → `McpClient.callTool`.

**Skills** (`src/skills/`) — saved prompt templates with parameters; importable from
Claude `SKILL.md` files; `call_skill` runs a nested agent task sharing the parent's
ledger + event sink.

**Workflows** (`src/workflows/`) — multi-step automations with triggers (schedule via
`chrome.alarms`, or event via `tabs.onUpdated` URL pattern). Due workflows are *flagged*
(`storage.local`) + notified — **never auto-run**; the user opens Flows → Run. Alarms
are reconciled on `onStartup`/`onInstalled`.

**Webhook Flows** (`src/webhookFlows/`) — one-tap "snapshot the page → POST to a saved
webhook". `buildFlowPayload()` (pure) assembles `{source, flow, page, profile, prompt}`
with `{url}/{title}/{selected_text}` template substitution; `snapshotMode`
(`none|meta|text|full`); per-flow `trustNoConfirm` (skip the per-run modal). The
`send_webhook` HITL gate is separate and always fires for the consequential tool.

**Webhooks address book** (`src/webhooks/store.ts`) — named endpoints (URL + headers),
HTTPS-only (http for localhost), URL masking in the UI, `lastUsedAt` audit.

**MCP connector** (`src/mcp/`) — Model Context Protocol client (2025-03-26). HTTP POST
+ JSON-RPC 2.0; responses are `application/json` (single) or `text/event-stream` (SSE);
`Mcp-Session-Id` echoed per request. Auth `none|bearer|header` (token in
`storage.session`). Tools are namespaced `mcp__<serverId>__<tool>`, descriptions
sanitized (strip injection patterns, truncate) and per-(server,tool) **trust**
(`always|confirm`, default confirm). `enabledInAgent` + `toolFilter` gate exposure.

---

## 8. Apps, builder & marketplace

Apps decouple UI capability from extension code via a **three-tier model**; all are
stored as JSON **data** (`apps` IDB store), never as committed source.

| Tier | What it is | Runs as | Review |
|---|---|---|---|
| **1 — Declarative** | form (`inputs`) + `promptTemplate` | UI fills `{{id}}` → LLM | none (no code) |
| **2 — Sandboxed code** | `(inputs, bridge) => …` returning a value | opaque iframe via `new Function` | first-run gate |
| **3 — Sandbox-UI** | `{html, css, ui}` micro-app | opaque iframe, renders own DOM | first-run gate |

**Key files**: `src/apps/types.ts` (`AppConfig`, `KNOWN_APP_CAPS`),
`src/apps/store.ts` (CRUD), `src/apps/build.ts` + `uiBuild.ts` (builder system prompts
+ `parseAppConfig`/`parseCodeApp`/`parseUiApp`), `src/apps/appBundle.ts`
(`toAppBundle`/`parseAppBundle`), `src/sandbox/` (iframe entry + host broker),
`src/views/apps/SandboxAppFrame.tsx` (React host + bridge broker + rate limit + review
gate), `src/views/AppBuilderView.tsx` (conversational builder).

**Capability bridge** — the iframe has zero ambient authority and reaches capabilities
only through a narrow `postMessage` protocol the host authorizes per call:
- `SANDBOX_MOUNT` (host→iframe: html/css/ui + theme CSS + capabilities)
- `SANDBOX_BRIDGE` (iframe→host: `{op, args}`) → host checks the op is in
  `app.permissions`, rate-limits, executes → `SANDBOX_BRIDGE_RESULT`.
- Ops: `bridge.gemini(prompt)→text`, `bridge.image({prompt,inputImage?,aspect?})→dataUrl`,
  `api.download(name,content,mime?)`, `bridge.storage({action,key,value})` (per-app KV,
  ~100-key cap), `bridge.page()→{url,title,text}` (read-only).
- Guards: idle timeout (refreshed, clamped to wall-clock), an absolute wall-clock cap
  (never refreshed — kills `while(true){await bridge…}`), a per-run bridge-call quota,
  and ~30 calls/min for Tier-3.

**`parseAppBundle` re-validation** (import path): routes each entry through its
tier-specific parser, **reassigns ids** (collision-proof), **forces `reviewed:false`**
(re-arms the gate), and **allowlists capabilities** to `KNOWN_APP_CAPS`. Malformed
entries are dropped.

**Marketplace / catalog** (`src/catalog/`) — a public GitHub repo
(`chrome-buddy-catalog`) fetched over **raw HTTPS, no auth**. `index.json` lists
`CatalogEntry`s (name, kind app/skill/workflow, version, tier, permissions, dataPath,
sha?). Install = fetch entry data → `parseAppBundle` → `persistApp`. `compareVersions`
drives an "update available" badge. The agent can discover entries via the
`search_catalog` tool (`src/background/catalog.ts`).

---

## 9. Library RAG

A local, vector-indexed RAG over the user's private knowledge — notes, chats, imported
files, and captured pages — organized into **collections**. Indexing + search are
SW-owned (key + IDB); the math is pure and unit-tested.

**Key files** (`src/library/` unless noted)
- `index.ts` — orchestration: `indexDoc()` (chunk → embed → store, atomic, idempotent
  via `contentHash`), `searchLibrary(query,{k,threshold,collectionIds})` (embed query →
  cosine rank → top-K with doc provenance), `findSimilarDocs()` (consolidation, scoped).
- `store.ts` — IDB CRUD for `libraryDocs`/`libraryChunks`; `getAllChunks(collectionIds?)`
  (unions via the `collectionId` index when scoped); `setDocCollection()`;
  `evictOldestDocs()` (cap, default 1000, oldest-`updatedAt` first); FNV-1a `hashContent`.
- `chunk.ts` — markdown-aware chunker: split on headings → char-window long sections
  (target 500, overlap 50, hardMax 800), preferring paragraph/sentence breaks; stable
  `charStart/charEnd`.
- `embed.ts` — Gemini embeddings (`gemini-embedding-001`) batched at concurrency 8;
  pure `cosineSim` / `cosineSimAll` (brute-force linear scan, **not** an ANN index).
- `collections.ts` — `Collection {kind: profile|project|general, autoContext:
  always|active|manual}`; seeds **General** (manual) + **Personal Profile** (always);
  protected ids can't be deleted; `slugify`/`makeCollectionId`/`validateCollectionName`.
- `parseFile.ts` — multi-format text extraction (md/mdx/txt/csv/json/html/xml/code):
  HTML tag-stripped + entity-decoded, JSON pretty-printed, markdown H1 → title.
- `walk.ts` — folder import via File System Access (recursive, ≤1 MB/file).
- `mirror.ts` — fire-and-forget auto-mirror of chats/notes → library.
- `consolidate.ts` — opt-in LLM dedup: cosine fast-paths (≥0.92 replace, <0.78 keep) and
  a flash-lite JSON judge in the ambiguous band; scoped within a collection.
- `src/background/library.ts` — SW handlers: `executeSearchLibrary`, `executeIndexDoc`,
  `executeListCollections`, `executeSaveCollection`, `executeDeleteCollection`
  (reassigns docs to General), `executeCapturePage`, `executeLibraryBackfill`.

**Data model** — every `LibraryDoc` + `LibraryChunk` carries a `collectionId`; docs also
carry an optional user **`note`** ("is a competitor", "about our product") surfaced with
every retrieved snippet (`SearchHit.docNote`) so the model gets framing the raw text
lacks. Sources: `chat | note | folder | manual | file | page`.

**Ingest** (all collection-aware, all route through `LIBRARY_INDEX` → `indexDoc`):
- **+ Files** — multi-select, parsed by `parseFile`.
- **+ This page** — `LIBRARY_CAPTURE_PAGE` → `capturePageContext` distills the active
  tab → indexed (`source:'page'`). Also exposed as a **right-click context menu**
  "Add page to Library ▸ \<collection\>", rebuilt whenever collections change.
- **+ Folder** — FSA walk.
- Auto-mirror of chats/notes; one-time `LIBRARY_BACKFILL`.

**Retrieval** — `search_library` (agent tool, same path the UI uses) and **opt-in chat
auto-context** (`ChatView`): embeds the user message, retrieves top-K above a threshold,
prepends a "From your Library" block, renders an audit card. Search can scope to the
selected collection.

**Why SW-owned + scoped**: the key + IDB live in the SW; collection scoping keeps a
search from loading the whole corpus into memory (the main lever against the brute-force
cost) and keeps consolidation from merging across unrelated collections.

---

## 10. Page control & vision

DOM-first page interaction (`src/page/`).
- `distill.ts` — **pure** DOM→clean-text distiller (operates on a `DomNodeLike` tree, so
  it's testable without jsdom); the basis of every page read.
- `pageContext.ts` — **the only page reader**: `getContext(tabId)` injects the distiller
  via `chrome.scripting.executeScript` and returns `{url, title, text}`;
  `capturePageContext(maxChars, tabId)` is the compact-summary variant (used by chat
  context, page capture, `read_tab`); `screenshot(tabId)` via `captureVisibleTab`.
- `browserControl.ts` — `act(tabId, action)` dispatches click/type/scroll/navigate via
  **synthetic events** by default (no debugger banner); `cdp.ts` is the trusted
  **CDP/debugger** fallback (coordinate-based, lazy single-tab attach, warns once).
- `restricted.ts` — rejects undriveable URLs (chrome://, Web Store, PDFs, file://…) with
  a structured signal.
- **Browser-native research** (`src/background/pageTools.ts`): read-only `list_tabs` +
  `read_tab(tabId)` (reads behind-login pages a server-side tool can't reach).
- **Vision / Computer Use** (`src/background/vision.ts`): Gemini 2.5 computer-use model
  takes a task + screenshot → returns actions (normalized 0–999 coords mapped to CSS px
  by CDP); safety-flagged actions require HITL approval.

---

## 11. Voice & Voice Transcriber

Two distinct subsystems that share the 16 kHz mic-capture path.

**Voice chat** (`src/voice/`) — real-time bidirectional voice via the **Gemini Live
WebSocket** (BidiGenerateContent). The panel-side `VoiceSession` (`liveSession.ts`)
opens the mic → `AudioContext(16000)` → `ScriptProcessor` → `floatToBase64Pcm16`
(`livePcm.ts`, pure) → a `voice-stream` **port**; the **SW owns the WebSocket** (key
never leaves it). Model audio (24 kHz) is decoded and scheduled back. Emits `VoiceEvent`s
(transcript, turn-done, function-call, audio, flow counters); function calling works
in-stream. `src/voice/speech.ts` wraps Web Speech STT/TTS (degrade to no-op).

**Voice Transcriber** (`src/transcribe/`, app id `livescribe`) — the **robust
record-then-transcribe** path (not the flaky Live socket):
- `recorder.ts` `MicRecorder` — same 16 kHz capture, but *accumulates* Float32 chunks
  and encodes a **WAV** on stop (`wav.ts` pure `encodeWavPcm16` — Gemini accepts WAV but
  not MediaRecorder's webm/opus).
- One-shot transcription via `AUDIO_TRANSCRIBE` (`src/audio/request.ts`).
- `store.ts` — each recording saved as a `TranscriptSession` (title, createdAt,
  durationMs, transcript, transforms) in IDB, listed like chat history.
- `transforms.ts` — **pure** prompt builders for post-processing: **Summarize / Clean up
  / Meeting notes / Add speakers**; the UI runs them via `generateViaBackground` and
  saves each onto the session as its own tab.
- `liveCaption.ts` — best-effort live captions while recording via browser
  `SpeechRecognition` (preview only; the Gemini WAV transcript is authoritative); the
  result reducer is pure + tested.

---

## 12. Console Inspector

An 11-tab "agent-tools + UI hybrid" (`src/console/` + `src/views/apps/console/`).
Console/network signals are captured via **chrome.debugger** (CDP), normalized +
deduped. Every analyzer is **pure** (no chrome, no I/O) so it's reused by both agent
tools and the UI:
- `errorPatterns.ts` (26+ framework-aware patterns), `sensitivePatterns.ts` (API keys,
  JWTs, cards via Luhn…), `techStack.ts`, `a11y.ts`, `seo.ts`, `storageSummary.ts`.
- `healthScore.ts` — composes them into one `HealthReport` with a weighted-floor 0–100
  score (one critical issue tanks it); the **Health tab is the default landing surface**.
- `fixPrompt.ts` — builds a paste-ready IDE fix prompt; every analytical panel has
  **Copy-fix-prompt** + **Send-to-Buddy**.
- Exposed to the agent as tools (`analyze_errors`, `web_vitals`, `read_network`,
  `scan_security`, `read_storage`, `scan_sensitive_data`, `detect_tech_stack`,
  `analyze_a11y`, `analyze_seo`, `read_console`).

---

## 13. UI shell & views

- `src/ui/PanelApp.tsx` — side-panel root: theme application, view routing
  (chat/apps/skills/flows/library/history/settings), and **lazy-loaded** app code-splits
  (console, image, transcriber, livescribe, webhooks, scrape, viz, tabs, sandbox,
  builder). `surface: 'sidepanel' | 'overlay'` governs close/collapse behavior.
- `src/panel/BuddyPanel.tsx` — icon rail (vertical nav) + content area; collapses to a
  floating rail card in overlay mode.
- `src/ui/theme.ts` / `icons.tsx` — themes (slate/cream/graphite) + accent swatches;
  icon set.
- `src/content/overlay.tsx` — content script that injects an `<iframe
  src="chrome-extension://…/overlay.html">` (default **OFF**). The iframe runs at the
  **extension origin**, so its IndexedDB is shared with the side panel (fixing the
  earlier per-site-IDB isolation bug).
- `src/fs/root.ts` — File System Access root folder (pick/persist handle in `fsroot`,
  read/write/list, path sanitization, permission re-request).

**Views** (`src/views/`)
- **ChatView** — agentic + plain chat; streaming bubbles (chat-stream port); HITL
  confirm cards; library auto-context audit cards; multi-tab context; artifact cards;
  conversational memory (recent turns); voice + vision inputs.
- **LibraryView** — collections bar (pills with counts + always-on dot, `+ New` inline
  form), ingest row (note field + `+ Files` / `+ This page` / `+ Folder` + delete
  collection), search, doc list (note chip + source pill), view/edit/re-index.
- **SettingsView** — appearance, API key, model + intent, profile (professional/
  personal), feature toggles (overlay, ask-before-plan, decompose, vision-confirm,
  library auto-context, consolidation, max docs), File System root, **MCP servers**,
  **Webhooks**, backfill, clear history.
- **AppsView** — the app grid (built-ins + generated) + import/export + review gates.
- **Onboarding** — first-run key custody explainer + paste/validate, skippable.

---

## 14. Built-in apps

| App (id) | What it does |
|---|---|
| Console Inspector (`console`) | 11-tab console/network/security/a11y/SEO/health analysis |
| Image Generator (`image`) | text → image (Gemini native image model) |
| Audio Transcriber (`transcriber`) | upload an audio file → transcript |
| Voice Transcriber (`livescribe`) | record → transcript → summarize/clean/notes + live captions |
| Webhook Flows (`webhooks`) | one-tap snapshot page → POST to a saved webhook |
| Scrape to Table (`scrape`) | extract structured data → CSV |
| Data Visualizer (`viz`) | CSV/JSON/table → SVG charts |
| Tab Manager (`tabs`) | search, dedupe, group, save tab sessions |
| SVG Icon Generator (`svggen`) | Tier-3: describe → inline SVG → download |
| BrandSnap AI (builtin Tier-3) | place a logo on a canvas → generate a branded scene |
| App Builder (`builder`) | conversational Tier-3 app generator |

---

## 15. Message protocol reference

All panel↔SW traffic is a typed discriminated union (`src/key/messages.ts`). The SW
router is `handleBuddyMessage()` (`src/background/background.ts`), fronted by a runtime
type guard **`isBuddyMessage()`** — a new message type must be added to *both* the TS
union and that guard or the SW silently drops it.

Grouped (request types):
- **Keys**: `KEY_SET`, `KEY_STATUS`, `KEY_VALIDATE`
- **LLM**: `LLM_GENERATE` (+ the `chat-stream` port for streaming)
- **Tools**: `TOOL_EXEC` (built-in handlers, page tools, and `mcp__*`)
- **Page/Vision**: `PAGE_CONTEXT`, `VISION_TURN`, `VISION_ACTION`, `VISION_CAPTURE`
- **Media**: `IMAGE_GENERATE`, `AUDIO_TRANSCRIBE`
- **Library**: `LIBRARY_INDEX`, `LIBRARY_BACKFILL`, `LIBRARY_COLLECTIONS`,
  `LIBRARY_COLLECTION_SAVE`, `LIBRARY_COLLECTION_DELETE`, `LIBRARY_CAPTURE_PAGE`
- **Data CRUD**: `SKILL_*`, `WORKFLOW_*`, `APP_*`, `MEMORY_*`
- **MCP**: `MCP_TEST`
- **Ports**: `chat-stream` (streaming chat), `voice-stream` (Gemini Live)

Handlers return a typed response or `{type:'ERROR', ok:false, error}`; the listener
keeps the channel open with `return true` and resolves via `sendResponse`.

---

## 16. Design principles

- **Zero-RCE** — untrusted code runs only in the opaque-origin sandbox; nothing is
  fetched as remote script; imported apps re-arm the review gate.
- **BYO-key, key-in-SW-only** — the key lives in `chrome.storage.session`, never reaches
  any other context; all key-using calls are SW-handled.
- **Panel orchestrates, SW executes short units** — survives MV3 SW death; long loops
  (agent, import, recording) live in the long-lived panel.
- **Pure core, thin I/O shell** — chunking, embeddings math, PCM/WAV, HTML parsing,
  distillation, cost, analyzers, transforms are all pure + unit-tested; IDB/network are
  thin wrappers covered by e2e.
- **Apps & extensibility as data** — apps, skills, workflows export/import as JSON;
  capabilities are allowlisted + capability-gated.
- **HITL by default** — consequential actions confirm; trust is opt-in and granular.
- **Verify via Playwright** — every change ships with unit tests + an e2e regression and
  screenshots.

---

## 17. Known gaps & roadmap

- **RAG retrieval intelligence** — *done:* Slice 3 **PDF ingest** (`pdfjs` bundled,
  panel-side) and Slice 4 **collection-aware retrieval** (collection-scoped
  `search_library`; always-on auto-context for profile collections; the
  collections-awareness block injected into the agent planner/executor via the
  `extraContext` runtime hook). *Remaining:* a per-collection "active for this
  session" toggle in the chat UI; a real-PDF manual smoke.
- **Embeddings** — `embed.ts` sends no `taskType` (asymmetric
  `RETRIEVAL_QUERY`/`RETRIEVAL_DOCUMENT` would improve accuracy) and no
  `outputDimensionality` (the store comment says 768-dim but `gemini-embedding-001`
  defaults higher — verify + consider 768 for 4× smaller/faster vectors). Changing
  either needs a one-time re-embed migration.
- **Search is brute-force** — `cosineSimAll` is a linear scan over loaded chunks; fine
  at thousands, an ANN index (HNSW) would be needed at tens of thousands. Collection
  scoping mitigates this today.
- **`geminiNative` adapter is a stub** — Gemini chat/text currently goes through the
  OpenAI-compatible endpoint.
- **Audio Transcriber vs Voice Transcriber overlap** — possible future consolidation
  (fold file-upload into the Voice Transcriber).

---

*This document reflects the codebase at v0.4.0. Where exact constants (budget caps,
sandbox timeouts/quotas, embedding dimensionality) matter, treat the cited source file
as authoritative.*
