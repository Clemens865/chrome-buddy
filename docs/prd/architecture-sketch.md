# Chrome_Buddy — Conceptual Architecture Sketch

> High-level architecture for a universal agentic + LLM Chrome extension (MV3). This is a CONCEPTUAL sketch — component boundaries, data flow, and key technical bets — not a detailed design. Grounded in `vision-scope.md`, `requirements.md`, LOCKED `scope-decisions.md`, and research `03`/`04`/`06`/`07`.
>
> Three coexisting layers (micro-apps, agentic chat, skills/workflows) over **one shared Tool Registry**. Build-from-scratch agent loop (LOCKED #3). Data-not-code extensibility (LOCKED #8).

---

## System Overview

The extension spans five MV3 surfaces. The **Background Service Worker (SW)** is the brain and the only place cloud LLM calls happen (key hygiene, LOCKED #2). The **Side Panel** is the React UI. **Content Scripts** read/act on the page DOM and run on-device Nano. The **Offscreen Document** does long/audio/parsing work the SW can't. The **Sandboxed Iframe** runs Tier-2 untrusted code with zero ambient authority.

```
                                  ┌──────────────────────────────────────────────────────────┐
                                  │                  CLOUD (user's BYO key)                    │
                                  │  Gemini API (REST + OpenAI-compat)  ·  Gemini Live (WS)    │
                                  │  Signed Registry CDN  ·  App/Skill Catalog CDN  ·  Webhooks│
                                  └───────────▲───────────────────────────▲──────────────────┘
                                              │ HTTPS (from SW/offscreen only)  │ signed JSON
  ┌────────────────────────┐                 │                                 │
  │   SIDE PANEL (React)    │                 │                                 │
  │  ┌──────┬────────────┐  │   chrome        │                                 │
  │  │ icon │  content   │  │   .runtime      │                                 │
  │  │ rail │  panel     │  │   messaging     │                                 │
  │  │ 💬▦✦ │ chat/apps/ │◄─┼──────────┐      │                                 │
  │  │ ⟲⚙   │ skills/... │  │          │      │                                 │
  │  └──────┴────────────┘  │          ▼      │                                 │
  └────────────────────────┘   ┌───────────────────────────────────────────────┴────────┐
                                │            BACKGROUND SERVICE WORKER (stateless)         │
                                │  ┌────────────────────────────────────────────────────┐ │
  ┌────────────────────────┐   │  │ Agent Runtime (plan→act→observe→reflect)           │ │
  │   CONTENT SCRIPTS       │   │  │   Planner · Executor · Validator · Scratchpad      │ │
  │  (per driven tab)       │   │  └────────────────────────────────────────────────────┘ │
  │ • DOM read/act          │◄──┤  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
  │   (scripting/userScript)│   │  │ Tool Registry│ │ LLM Client   │ │ Model/Provider   │ │
  │ • Nano on-device LLM    │   │  │ (single src) │ │ (adapters,   │ │ Registry         │ │
  │ • in-page overlay (opt) │   │  │              │ │ routing,$$$) │ │ (signed updates) │ │
  └────────────────────────┘   │  └──────────────┘ └──────────────┘ └──────────────────┘ │
                                │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
  ┌────────────────────────┐   │  │ PageContext  │ │ Browser Ctrl │ │ Tier-1 App Engine│ │
  │  OFFSCREEN DOCUMENT     │◄──┤  │ Service      │ │ (scripting/  │ │ (GenericApp      │ │
  │ • DOM parse/distill     │   │  │              │ │  CDP/CompUse)│ │  interpreter)    │ │
  │ • audio (STT/TTS)       │   │  └──────────────┘ └──────────────┘ └──────────────────┘ │
  │ • Nano (alt host)       │   │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
  │ • heavy compute         │   │  │ Memory Svc   │ │ Skill/WF     │ │ App/Skill        │ │
  └────────────────────────┘   │  │ (IndexedDB,  │ │ Store        │ │ Generator        │ │
                                │  │  RAG)        │ │ (validation) │ │ (NL→validated)   │ │
  ┌────────────────────────┐   │  └──────────────┘ └──────────────┘ └──────────────────┘ │
  │  SANDBOXED IFRAME       │   │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
  │ (Tier-2 code apps)      │◄──┤  │ Filesystem   │ │ Integrations │ │ Onboarding /     │ │
  │ • QuickJS-wasm / SES    │   │  │ (FSA v1)     │ │ /Webhooks    │ │ Settings         │ │
  │ • opaque origin         │   │  └──────────────┘ └──────────────┘ └──────────────────┘ │
  │ • postMessage cap-bridge│   └──────────────────────────────────────────────────────────┘
  └────────────────────────┘            │ chrome.storage (session keys / local config) · IndexedDB

  Execution-locus legend:
   • CLOUD Gemini calls .......... ALWAYS from SW (or offscreen for Live/WS) — never content script (key hygiene)
   • On-device Nano .............. CONTENT SCRIPT or OFFSCREEN only (Nano unavailable in SW)
   • DOM read/act ................ CONTENT SCRIPT (scripting/userScripts) ; CDP attaches from SW
   • Tier-2 untrusted code ....... SANDBOXED IFRAME only (zero ambient authority)
   • Heavy/long/audio work ....... OFFSCREEN DOCUMENT (SW idles ~30s)
```

---

## Component Inventory

For each: Purpose · Responsibilities · I/O · Technology candidates (tradeoffs) · Build/Buy/Integrate.

### 1. Background Service Worker (host process)
- **Purpose**: The orchestration brain; hosts all shared services; sole origin of cloud calls.
- **Responsibilities**: Route messages between panel/content/offscreen/sandbox; own the agent loop; hold keys in `storage.session`; checkpoint state to IndexedDB before idle (~30s); register `chrome.alarms` for schedules + registry poll.
- **I/O**: In — runtime messages, alarms, action clicks. Out — cloud fetches, content-script injections, panel updates.
- **Tech candidates**: (a) Plain MV3 SW + hand-rolled message router — full control, more boilerplate; (b) `webext-bridge`/comlink RPC layer — typed cross-context calls, small dep; (c) effector/xstate-driven SW — structured state but heavier. **Tradeoff**: typed RPC pays off across 5 surfaces.
- **Recommendation**: **BUILD** the SW shell; **INTEGRATE** a thin typed-RPC lib (comlink-style) for cross-context messaging.

### 2. Agent Runtime (plan→act→observe→reflect)
- **Purpose**: The wedge. Multi-step DOM-first execution with HITL gating (LOCKED #3; FR-AGENT-1..17).
- **Responsibilities**: **Planner** emits visible numbered plan (FR-AGENT-2/3); **Executor** runs one step at a time via Tool Registry, supporting Gemini parallel/sequential calls keyed by `id` (FR-AGENT-4); **Validator** scores each step succeeded/failed/needs-retry against intent (FR-AGENT-6); scratchpad in IndexedDB, resumable across SW restart (FR-AGENT-7/8); step+cost budget caps (FR-AGENT-9); bounded retries + self-healing + loop detection (FR-AGENT-10/12); partial completion (FR-AGENT-11); vision escalation when DOM yields nothing (FR-AGENT-13); live step log (FR-AGENT-14); `call_skill` entry (FR-AGENT-15).
- **I/O**: In — task prompt, page observations, tool results, user approvals. Out — plan, step log, tool calls, confirmation requests, final result + memory writes.
- **Tech candidates**: (a) **Hand-built loop on `@google/genai` function calling** — full control of the unsolved reliability frontier, no upstream churn; (b) fork browser-use/Nanobrowser — faster start but FORBIDDEN by LOCKED #3 and inherits opinions; (c) LangGraph.js state machine — structured graph but heavy and cloud-flavored. **Tradeoff**: the moat IS the loop; owning it is the point.
- **Recommendation**: **BUILD from scratch** (LOCKED). Borrow *patterns* (action caching, change-observation recovery, escalation ladder) from `05`, not code.

### 3. Tool Registry (shared by apps + agent + skills)
- **Purpose**: Single source of capabilities consumed three ways (LOCKED #1; FR-TOOLS-1).
- **Responsibilities**: Hold tool defs (`navigate/click/type/scroll/read_dom/screenshot/extract/summarize/call_skill/send_webhook/read_file/write_file/ask_user`); each declares a machine-readable schema usable directly as a Gemini function declaration (FR-TOOLS-13) and a `consequential` flag (FR-TOOLS-12); enforce per-caller `allowedTools` whitelist, stripping/rejecting off-list calls (FR-TOOLS-14).
- **I/O**: In — tool-call requests (from agent/app/skill) + caller's allowlist. Out — typed tool results; Gemini function-declaration JSON.
- **Tech candidates**: (a) **TS module registry + Zod/ajv schemas → JSON Schema for Gemini** — single source of truth, runtime validation; (b) decorator-based registration — clean but reflection-heavy; (c) plain object map — simplest, weakest typing. **Tradeoff**: schema-as-truth dedupes function declarations and validation.
- **Recommendation**: **BUILD**; **INTEGRATE** ajv (or zod-to-json-schema) for declaration generation + arg validation.

### 4. Gemini / LLM Client
- **Purpose**: The single shared LLM client for apps, agent, skills (FR-LLM-2; `06` §5.2).
- **Responsibilities**: Registry-driven adapter selection (OpenAI-compatible + native Gemini); model routing + tiered fallback (FR-LLM-11; NFR-COST-3); function calling (FR-LLM-4), JSON/`responseSchema` (FR-LLM-5), thinking levels (FR-LLM-6), streaming (FR-LLM-7); Computer Use loop + `safety_decision`/`safety_acknowledgement` (FR-LLM-9); per-call/per-run token+$ metering (FR-LLM-10); mid-task model switch (FR-LLM-12). Reads key from `storage.session`, runs only in SW (NFR-SEC-1/2).
- **I/O**: In — messages, tool decls, model id, schema. Out — completions/streams, tool calls, usage counts → cost meter.
- **Tech candidates**: (a) **`@google/genai` for native + a thin fetch-based OpenAI-compat adapter** — native features (thinking budgets, multimodal) plus one adapter covering Gemini-OpenAI/OpenRouter/Groq/Ollama; (b) Vercel AI SDK — multi-provider out of the box but abstracts away the cost/Computer-Use control we need; (c) raw fetch only — max control, reimplements SDK plumbing. **Tradeoff**: native SDK for Gemini depth + bundled adapters for breadth.
- **Recommendation**: **INTEGRATE** `@google/genai`; **BUILD** the adapter layer + routing/cost/Computer-Use orchestration.

### 5. Model / Provider Registry
- **Purpose**: Future-proofing as data — new Gemini model = one-line config, no resubmission (LOCKED #6; FR-MR-1..16).
- **Responsibilities**: Editable JSON (`schemaVersion`, `providers{}`, `models{}` with context/pricing/capabilities) in `storage.local`, keys stored separately (FR-MR-1/3); bundled default floor, never block first use (FR-MR-2); signed remote update (Ed25519/JWS via `crypto.subtle` → ajv validate → schemaVersion check → merge user>remote>bundled) on SW start + daily alarm (FR-MR-5); reject bad/unsigned payloads, keep last-good (FR-MR-6); adapter modules selected by `adapter` field, `paramMap` for renames (FR-MR-9); in-app editor + Test button (FR-MR-8/12); `optional_host_permissions` request for new provider hosts (FR-MR-11); defensive capability probing (FR-MR-14).
- **I/O**: In — bundled JSON, in-app edits, signed remote payloads. Out — resolved model/provider config to LLM Client; picker entries to UI.
- **Tech candidates**: (a) **`storage.local` cache + ajv schema + WebCrypto Ed25519 verify** — standards-based, no deps beyond ajv; (b) embed full registry only in bundle (no remote) — simplest, loses future-proofing; (c) sign with a third-party JWT lib — heavier. **Tradeoff**: WebCrypto-native signing keeps the dep surface and review burden minimal.
- **Recommendation**: **BUILD** (data layer is core IP); **INTEGRATE** ajv + WebCrypto.

### 6. Page Context Service
- **Purpose**: The ONLY page reader; shared by agent + apps (FR-TOOLS-4; FR-APP-6; `06` §5.1).
- **Responsibilities**: Inject into the target tab, wait for page stability before returning (FR-BC-7; lazy/async content); distill/parse DOM into a compact structure (and accessibility tree); cache transiently; treat all output as untrusted, injection-fenced data (NFR-SEC-6).
- **I/O**: In — tab id, read options. Out — distilled DOM / parsed structures (tables, forms, text) + provenance.
- **Tech candidates**: (a) **Readability/DOM-distillation in a content script, heavy parse offloaded to offscreen** — reuse MicroLabs' rich extraction (LOCKED #9); (b) full-page CDP DOM snapshot — richer but pulls in debugger banner; (c) raw `innerText` — cheap, loses structure. **Tradeoff**: distillation hit 73.1% WebVoyager with no vision (`05`) — invest here.
- **Recommendation**: **BUILD** on MicroLabs' extractor; **INTEGRate** Mozilla Readability for article distillation.

### 7. Browser Control Layer
- **Purpose**: Execute DOM-first actions, escalate to CDP then vision (FR-BC-1..8; LOCKED #3).
- **Responsibilities**: `scripting.executeScript` synthetic events by default — no debugger banner (FR-BC-1); `chrome.debugger`/CDP only when trusted input needed, with user warning about the banner (FR-BC-2/3); `captureVisibleTab` + stitching for full-page vision (FR-BC-4); Computer Use loop (screenshot→0–999 action→execute→screenshot) as fallback tier only (FR-BC-5); detect undriveable contexts (`chrome://`, Web Store, cross-origin iframes) and report (FR-BC-6); `chrome.userScripts` for DOM-acting generated apps (FR-BC-8).
- **I/O**: In — action commands (click/type/scroll/navigate), Computer Use actions. Out — action results, page deltas, screenshots, "undriveable" signals.
- **Tech candidates**: (a) **Hybrid scripting-first + CDP-on-demand + Computer-Use-fallback** (`04` recommendation) — minimizes banner, maximizes reach; (b) CDP-only — most reliable, always-banner, heavy perms; (c) scripting-only — clean but fails on hardened sites. **Tradeoff**: hybrid is explicitly the researched sweet spot.
- **Recommendation**: **BUILD** the hybrid layer (this is differentiated engineering).

### 8. Tier-1 App Engine (GenericApp interpreter)
- **Purpose**: Run declarative micro-apps as JSON config, no per-app code (LOCKED #5; FR-APP-1..15).
- **Responsibilities**: Interpret `{inputsSchema, promptTemplate, pipeline[], allowedTools[], outputRenderer, requiredHosts[]}` (FR-APP-2); render input UI from schema (FR-APP-3); run pipeline via bundled primitives — JSONLogic/JMESPath, never eval'd expression strings (FR-APP-4); render via bundled renderers table/CSV/MD/JSON/chart/diff (FR-APP-5); read page only via PageContext (FR-APP-6); candidate disambiguation (FR-APP-7); live preview (FR-APP-8); Copy/Save (FR-APP-9); deterministic `$0.00` badge (FR-APP-10); "Hand to Agent" escalation (FR-APP-11); graceful degrade + handoff (FR-APP-12); pagination for large output (FR-APP-13).
- **I/O**: In — app config + user inputs + page context. Out — rendered output, files, agent handoff payload.
- **Tech candidates**: (a) **Extend MicroLabs' `GenericApp` + JMESPath/JSONLogic + bundled renderers** — proven base (LOCKED #9), data-safe; (b) build a custom DSL interpreter — risks the "interpreter for fetched commands" line (`07`); (c) template-literal eval — FORBIDDEN. **Tradeoff**: declarative primitives stay on the safe side of the bright line.
- **Recommendation**: **BUILD** on MicroLabs base; **INTEGRATE** jmespath + json-logic-js as bundled, non-eval primitives.

### 9. Tier-2 Sandbox (iframe + QuickJS/SES + postMessage bridge)
- **Purpose**: Gated escape hatch for untrusted generated/imported code (LOCKED #5; FR-T2-1..7).
- **Responsibilities**: Sandboxed iframe (manifest `sandbox` key, opaque origin, `allow-scripts` WITHOUT `allow-same-origin`) hosting bundled QuickJS-wasm or SES `Compartment` after `lockdown()` (FR-T2-1); zero ambient authority, never fetch-and-eval (FR-T2-2; NFR-SEC-3); narrow `postMessage` RPC capability bridge exposing only `gemini.generate`, gated `fetch`, app-scoped storage (FR-T2-3); host authorizes each call against declared per-app permissions (FR-T2-4); human review of code + caps before first run (FR-T2-5); timeouts/termination, isolated failure (FR-T2-6); bundled, readable, non-obfuscated `.wasm` (FR-T2-7; NFR-COMP-3).
- **I/O**: In — app code (sandbox), bridge RPC requests. Out — bridge results, app output, isolated errors.
- **Tech candidates**: (a) **QuickJS-wasm** (quickjs-emscripten) — true JS-in-JS isolation, hard memory/time limits, language-agnostic; (b) **SES `Compartment`** — lighter, same-language, MetaMask-Snaps-proven, but shares the JS heap; (c) Web Worker only — weaker isolation, no hard CPU cap. **Tradeoff**: QuickJS gives the strongest isolation + termination guarantees; SES is lighter for trusted-ish authoring.
- **Recommendation**: **INTEGRATE** quickjs-emscripten (primary) with ses as a lighter alternative; **BUILD** the capability bridge + permission authorizer.

### 10. App / Skill Generator (NL → validated config)
- **Purpose**: Self-extension — describe an app, get a validated Tier-1 config (FR-APPGEN-1..12).
- **Responsibilities**: "+ New app — describe it" entry (FR-APPGEN-1); "use current page as sample" (FR-APPGEN-2); generate Tier-1 JSON via Gemini structured output constrained to the app-config schema (FR-APPGEN-3); re-validate against schema + allowedTools/renderers/hosts allowlists before persist (FR-APPGEN-4); capped auto-repair loop, fall back to field editor, NEVER persist invalid JSON (FR-APPGEN-5); strip non-whitelisted tools/hosts (FR-APPGEN-6); one clarifying question if ambiguous (FR-APPGEN-7); live draft run before save (FR-APPGEN-8); refine+regenerate (FR-APPGEN-9); portable export with semver (FR-APPGEN-10); escalate to Tier-2 only when declarative vocab insufficient (FR-APPGEN-12).
- **I/O**: In — NL description, optional page sample. Out — validated app config, draft run output, repair prompts.
- **Tech candidates**: (a) **Gemini `responseSchema`-constrained generation + ajv validate + repair loop** — keeps generation on-schema; (b) freeform generation + parse — brittle, more repair cycles; (c) few-shot template fill — safe but limited expressiveness. **Tradeoff**: schema-constrained output minimizes invalid drafts.
- **Recommendation**: **BUILD** (orchestrates Gemini client + Tool Registry allowlists + Skill/WF Store validation).

### 11. Skill / Workflow Store
- **Purpose**: Persistence + validation + import/export — the "data not code" boundary (FR-SKILL-1..11; FR-WF-1..9; `06` §1/§3).
- **Responsibilities**: Store skills as validated JSON (`id,name,description,trigger,systemPrompt,allowedTools,inputs,outputSchema,steps`) — never code (FR-SKILL-1); keep short description always in context, body on demand (FR-SKILL-2); promote completed run → skill, auto-detect variable inputs (FR-SKILL-3/5); linear step-list editor, no node-graph (FR-SKILL-6; anti-goal #6); per-skill `allowedTools` (FR-SKILL-7); export/import with re-validation + consent screen + missing-capability mapping (FR-SKILL-8/9/10); workflow = skill + trigger sharing one step schema (`navigate/extract/gpt/branch/loop/jump`, FR-WF-1); triggers manual/schedule/event via `chrome.alarms`, resumable (FR-WF-4/5); unattended runs hard-pause at consequential gate (FR-WF-6); self-healing on changed selectors (FR-WF-8); recorder front door (FR-WF-2/3, Could).
- **I/O**: In — authored/promoted/imported JSON, triggers. Out — validated skills/workflows, `call_skill` catalog, alarm registrations.
- **Tech candidates**: (a) **IndexedDB (idb/Dexie) + ajv schema validation + semver migrations** — structured, queryable, versioned; (b) `storage.local` JSON blobs — simple, weak query/migration; (c) SQLite-wasm — powerful but heavy. **Tradeoff**: Dexie gives indexes + migrations the LOCKED #9 storage-schema fix demands.
- **Recommendation**: **BUILD** the store logic; **INTEGRATE** idb/Dexie + ajv.

### 12. Memory Service (IndexedDB + embeddings/RAG)
- **Purpose**: Cross-session memory — the differentiator (FR-MEM-1..5; success metric #3).
- **Responsibilities**: Persist learned site flows, run history, scratchpads, results in IndexedDB (FR-MEM-1); scratchpad shareable so app output seeds an agent run (FR-MEM-2); browsable History view (FR-MEM-3); recall learned flows on skill re-run to cut steps/cost (FR-MEM-4); optional `gemini-embedding-001/-2` vectors for semantic recall/RAG (FR-MEM-5, Could); local-only, user-clearable (NFR-PRIV-3).
- **I/O**: In — run events, observations, page saves. Out — recalled flows, history, RAG context.
- **Tech candidates**: (a) **IndexedDB + in-memory cosine over stored vectors** — zero infra, fine at v1 scale; (b) `voy`/`hnswlib-wasm` ANN index — scales to many vectors, added wasm weight; (c) external vector DB — violates local-first (NFR-PRIV-1). **Tradeoff**: brute-force cosine is enough until corpus grows.
- **Recommendation**: **BUILD** on IndexedDB; defer ANN lib until corpus demands it; embeddings via the shared LLM client.

### 13. Side Panel UI (React icon rail + panel)
- **Purpose**: The always-on primary surface (LOCKED #7; FR-UI-1..10).
- **Responsibilities**: Global `chrome.sidePanel`, persists across navigation, resizable (FR-UI-1); vertical icon rail (Chat/Apps/Skills/Workflows/History + Settings bottom) + expandable content panel (FR-UI-2/3); always-on via pin + `openPanelOnActionClick` + keyboard command, no auto-open (FR-UI-4); chat thread renders live plan, step log, per-step result cards, inline confirmation cards, model badge, running cost (FR-UI-5/7/9); inline `ask_user` prompts (FR-UI-6); Apps grid with search + "+ New app" (FR-UI-8); WCAG 2.1 AA, keyboard-operable HITL surfaces (NFR-A11Y-1/2).
- **I/O**: In — user input, runtime messages (plan/steps/cost/confirmations). Out — task prompts, approvals, edits, navigation.
- **Tech candidates**: (a) **React 19 + Vite + Tailwind** (reuse MicroLabs stack, LOCKED #9); (b) Preact — lighter bundle, minor ecosystem gaps; (c) Svelte — smallest, abandons React reuse. **Tradeoff**: React 19 reuse beats marginal bundle savings.
- **Recommendation**: **BUILD** on the MicroLabs React 19/Vite/Tailwind stack; **INTEGRATE** a markdown renderer + charting lib for result cards.

### 14. Offscreen Document
- **Purpose**: Invisible DOM context for work the SW can't do (`04` §1/§9).
- **Responsibilities**: Heavy DOM parsing/distillation; audio capture for STT and playback for TTS (FR-MEDIA-1/2); alternate Nano host; clipboard; long compute that would outlive SW idle. Created/torn down on demand via `chrome.offscreen`.
- **I/O**: In — parse/audio/compute requests from SW. Out — parsed structures, transcripts, audio, results.
- **Tech candidates**: (a) **Single multiplexed offscreen doc with reason-tagged tasks** — one lifecycle to manage; (b) per-task offscreen docs — cleaner isolation, more churn (Chrome allows limited concurrent); (c) push all into content scripts — impossible for non-tab work. **Tradeoff**: one multiplexed doc is simplest under Chrome's single-offscreen constraint.
- **Recommendation**: **BUILD** a thin offscreen manager.

### 15. Filesystem Layer (FSA v1 / native host v2)
- **Purpose**: Read/write a user root folder (LOCKED #4; FR-FS-1..4).
- **Responsibilities**: v1 File System Access — one-gesture root pick, read+write tree, back `read_file`/`write_file` + Save-to-file (FR-FS-1); first op triggers pick (FR-FS-2); persistent permissions (Chrome 122+) with per-session re-grant fallback (FR-FS-3); v2 native messaging host for prompt-free access (FR-FS-4, Could/deferred).
- **I/O**: In — read/write/save requests + handles. Out — file contents, write confirmations.
- **Tech candidates**: (a) **FSA API (`showDirectoryPicker`) + IndexedDB-persisted handles** — zero install (v1); (b) native messaging host — best UX, needs per-OS installer (v2); (c) Downloads API — write-only, no read-back. **Tradeoff**: FSA ships now; native host is the v2 upgrade.
- **Recommendation**: **BUILD** the FSA layer (v1); **BUILD** native host later (v2, LOCKED phased).

### 16. Integrations / Webhooks
- **Purpose**: Push results to external systems (FR-INT-1..3; `04` §5).
- **Responsibilities**: `send_webhook` HTTP POST from SW/offscreen within declared `host_permissions` (FR-INT-1); declare hosts, request `optional_host_permissions` for new ones (FR-INT-2); consequential webhooks pass HITL gate (FR-INT-3).
- **I/O**: In — webhook step (target + payload). Out — POST request, response/status.
- **Tech candidates**: (a) **Plain `fetch` + per-integration config + `declarativeNetRequest` header rules** — minimal, MV3-native; (b) bundled SDKs (Slack/Notion) — richer, heavier, more hosts; (c) route everything through a hosted relay — violates local-first/BYO. **Tradeoff**: declarative webhook config (data, not code) stays compliant and light.
- **Recommendation**: **BUILD** a declarative webhook tool; reuse MicroLabs' webhook abstraction (LOCKED #9).

### 17. Onboarding / Settings
- **Purpose**: BYO-key activation + control center (FR-ONB-1..4; FR-SET-1..5).
- **Responsibilities**: First-run BYO-key walkthrough with live test-call validation (FR-ONB-1/2); gate cloud features behind a valid key, indicate unavailable features, allow Nano without key (FR-ONB-3); explain `storage.session` key location + privacy + free-tier-training disclosure (FR-ONB-4; NFR-PRIV-4); Settings: Models & Providers registry editor, key mgmt, folder selection, budget/spend guards (FR-SET-1; NFR-COST-1); user profile personalization (FR-SET-2; LOCKED #9); per-app integration config (FR-SET-3); default + per-tier model selection (FR-SET-4); data-retention/clear controls (FR-SET-5).
- **I/O**: In — key, preferences, budgets, folder grant. Out — validated config to registry/client/memory, gating signals to UI.
- **Tech candidates**: (a) **React settings views over the shared registry + storage** — consistent with panel UI; (b) standalone options page — separate surface, more nav; (c) hosted account/config — violates zero-infra/BYO. **Tradeoff**: in-panel settings keep one surface and zero infra.
- **Recommendation**: **BUILD** in-panel; reuse MicroLabs profile pattern (LOCKED #9).

---

## Data Flow

### (a) Agentic multi-step task — "Compare pricing across these 3 competitors and put it in my Doc" (S1)

1. **Prompt** — User types the task in the Side Panel chat; panel sends a `runAgent` message to the SW.
2. **Plan** — Agent Runtime's Planner calls the LLM Client (`gemini-3.5-flash`, function declarations from the Tool Registry) and renders a **visible numbered plan** in the chat thread (FR-AGENT-2). User can approve/edit/let-run (FR-AGENT-3).
3. **Checkpoint** — The plan + empty scratchpad are written to IndexedDB so the run survives a SW restart (FR-AGENT-8; NFR-PERF-7).
4. **Act (step N)** — Executor issues a tool call (e.g. `navigate` → Browser Control opens a tab; `read_dom` → PageContext distills the page after wait-for-stable). Cloud calls go from the SW; the key never leaves it (NFR-SEC-2).
5. **Observe** — Tool result + page delta returned; appended to the scratchpad with source-URL provenance (FR-AGENT-7).
6. **Reflect / Validate** — Validator scores the step against its intent (FR-AGENT-6). On failure: bounded retry → alternative-element fallback → change-observation re-plan; loop detection prevents repeats (FR-AGENT-10/12).
7. **Vision escalation** — If `read_dom`/`extract` yields nothing usable (JS/canvas widget), the step escalates to the Computer Use loop: `captureVisibleTab` → model returns a 0–999 action → Browser Control executes → screenshot back (FR-AGENT-13; FR-BC-5). A "vision used here" marker is shown (FR-UI-7).
8. **ask_user** — On ambiguity the agent calls `ask_user`, pausing and surfacing an inline prompt; resumes on the answer (FR-TOOLS-11).
9. **Budget guard** — After each step the cost meter updates the running $; on hitting the step/token/$ cap the run pauses and reports (FR-AGENT-9; NFR-COST-1).
10. **Confirmation gate** — Before the consequential `write to Doc` step (tool flagged `consequential`, or Computer Use returns `require_confirmation`), an inline confirmation card shows the exact payload + target (FR-HITL-1/2). User edits target if needed (FR-HITL-3) or supplies one if missing (FR-HITL-6). Nothing executes without explicit Approve; the approval is logged (FR-HITL-7).
11. **Execute consequential action** — On Approve, Computer Use is re-sent with `safety_acknowledgement: true` (FR-HITL-4) / the webhook or `write_file` fires (idempotently, NFR-REL-3).
12. **Partial completion** — If one competitor fully fails, the agent returns the rows that succeeded plus a flagged note — never a silent abort (FR-AGENT-11).
13. **Result + memory** — The done card shows provenance, total cost, elapsed time, and "Save as skill" (FR-UI-9). Learned site flows (e.g. real pricing URL) are written to Memory for future recall (FR-MEM-4). The run is browsable in History (FR-MEM-3).
14. **Promote (optional)** — "Save as skill" captures the run's steps into the shared step schema; variable parts become `inputs`; an `allowedTools` whitelist is recorded (FR-SKILL-3/5/7).

### (b) Tier-1 app run — "Extract Table" micro-app (S2)

1. **Launch** — User opens the Apps grid (search), taps Extract Table; the Tier-1 App Engine renders its input UI from `inputsSchema` with pre-detected defaults (FR-APP-3).
2. **Read page** — App calls PageContext (the same reader the agent uses) which waits for stability and returns the parsed DOM (FR-APP-6; FR-BC-7).
3. **Disambiguate** — If multiple tables exist, the app shows labelled choices rather than guessing (FR-APP-7). If the target is a CSS-grid (not a semantic `<table>`), it degrades gracefully and suggests "try Agent" (FR-APP-12).
4. **Transform** — The app runs its declarative `pipeline` using bundled primitives (JMESPath/JSONLogic) — no LLM call here, so the model badge shows "deterministic — $0.00" (FR-APP-4/10).
5. **Preview** — Output renders live in-panel via the `outputRenderer` (table/CSV/MD/JSON); large outputs paginate with a warning (FR-APP-5/8/13).
6. **Commit** — User taps Copy or Save-to-file; the first Save triggers the one-time FSA folder pick (FR-APP-9; FR-FS-2).
7. **Escalate (optional)** — "Hand to Agent" packages the app's current context into the shared scratchpad and seeds a multi-step agent run ("now do this on the next 10 pages and email me") — flowing into data-flow (a) at step 1 (FR-APP-11; FR-MEM-2).

---

## Key Technical Decisions

| Decision | Options | Recommendation | Why It Matters |
|----------|---------|----------------|----------------|
| **Perception: DOM-first vs vision-first** | (1) Pure vision/screenshot loop; (2) DOM/accessibility-first with vision fallback; (3) DOM-only | **DOM-first, vision (Computer Use) as fallback tier only** (LOCKED #3) | The industry retreated from pure vision (slow/costly/brittle — Mariner killed); DOM distillation hit 73.1% WebVoyager with no vision (`05`). Vision-only would blow cost/latency budgets and privacy posture. Vision-only-never would fail JS/canvas widgets — hence the fallback tier. |
| **Action mechanism: scripting vs CDP** | (1) `scripting` synthetic events; (2) `chrome.debugger`/CDP trusted input; (3) hybrid | **Hybrid: scripting by default, CDP only when trusted input is required** (FR-BC-1/2) | CDP shows an un-hideable "extension is debugging this browser" banner that scares users; scripting alone fails on hardened sites needing trusted input. Hybrid minimizes banner exposure while keeping reach (`04` §3). |
| **Resumable SW steps: where run state lives** | (1) In-memory in SW; (2) checkpoint each step to IndexedDB; (3) keep SW alive with a port hack | **Checkpoint scratchpad to IndexedDB after every step** (FR-AGENT-8; NFR-PERF-7) | The MV3 SW is stateless and idles ~30s (`04` §1). In-memory state is lost on restart; keep-alive hacks are fragile and rejected at review. Per-step checkpointing is the only way runs survive restarts without duplicating consequential side effects (NFR-REL-3). |
| **Where the agent loop runs** | (1) Background SW; (2) offscreen document; (3) content script | **SW orchestrates; offload only what the SW can't do (parse/audio → offscreen, DOM act → content script)** | Cloud calls must originate in the SW for key hygiene (NFR-SEC-2); Nano and DOM access can't run in the SW. The loop is the SW's job; it delegates surface-specific work by message-passing. Putting the loop in a content script would expose the key to the page DOM. |
| **Tier-2 isolation: QuickJS vs SES** | (1) QuickJS-wasm; (2) SES `Compartment`; (3) Web Worker | **QuickJS-wasm primary (strongest isolation + hard termination), SES as a lighter option** (FR-T2-1) | Untrusted generated code needs zero ambient authority, hard memory/CPU limits, and clean termination (FR-T2-6). QuickJS isolates in a separate VM; SES shares the JS heap (lighter, MetaMask-Snaps-proven); a bare Worker lacks a hard CPU cap. Both run in an opaque-origin sandboxed iframe with a capability bridge — never `eval` in a privileged context (NFR-SEC-3/4). |
| **Storage layout & migrations** | (1) `storage.local` blobs; (2) IndexedDB via idb/Dexie with versioned schema; (3) SQLite-wasm | **IndexedDB (idb/Dexie) with semver schema + migrations; keys in `storage.session`; small config in `storage.local`** | LOCKED #9 calls out MicroLabs' storage-schema/migration gap as a thing to fix. Runs/history/memory/scratchpads/embeddings are large and structured — IndexedDB with indexes + migrations. Keys must stay in-memory only (`storage.session`, NFR-SEC-1); registry config caches in `storage.local`. |

---

## Build vs Buy vs Integrate Analysis

> LOCKED #3 mandates **build-from-scratch** for the agent engine — honored below. "Buy" is rarely apt (zero-infra, BYO-key product); the real axis is **Build** (our IP) vs **Integrate** (bundled, reviewable OSS libs).

| Capability | Build | Buy | Integrate | Recommendation |
|------------|-------|-----|-----------|----------------|
| **Agent loop (plan→act→observe→reflect)** | Own Planner/Executor/Validator on Gemini function calling | — | (patterns only from browser-use/Nanobrowser/Stagehand `05`) | **BUILD** (LOCKED #3) — the moat is reliability+memory+trust, not raw capability |
| **Tier-2 code sandbox** | Capability bridge + permission authorizer | — | **quickjs-emscripten** (or **ses**) as the bundled VM | **INTEGRATE** the VM, **BUILD** the bridge — never write a JS engine |
| **Schema validation** | Tool/skill/config schemas | — | **ajv** (JSON Schema validator) | **INTEGRATE** ajv for registry/skill/app-gen validation + Gemini declaration generation |
| **Charting / result rendering** | Renderer wiring in result cards | — | a charting lib (e.g. Recharts/uPlot) + **markdown renderer** | **INTEGRATE** for `outputRenderer` table/chart/markdown (FR-APP-5) |
| **Storage / persistence** | Stores, schema, migrations | — | **idb / Dexie** over IndexedDB | **INTEGRATE** idb/Dexie; **BUILD** the store + migration logic (LOCKED #9 fix) |
| **LLM SDK + adapters** | Adapter layer, routing, cost, Computer-Use loop | — | **@google/genai** (native Gemini) | **INTEGRATE** the SDK; **BUILD** the OpenAI-compatible adapter + routing |
| **DOM distillation** | Page distillation + accessibility tree | — | **Mozilla Readability** for articles | **INTEGRATE** Readability; **BUILD** the structured/table/form extraction |
| **Config signing** | Verify + merge pipeline | — | **WebCrypto (`crypto.subtle`)** Ed25519/JWS | **INTEGRATE** WebCrypto; **BUILD** the verify→validate→merge flow |
| **Declarative pipeline primitives** | Pipeline runner | — | **jmespath**, **json-logic-js** (bundled, non-eval) | **INTEGRATE** as data-safe primitives; **BUILD** the runner (Tier-1) |
| **UI shell** | Panel, rail, chat, confirmation cards | — | **React 19 + Vite + Tailwind** (MicroLabs reuse) | **INTEGRATE** the stack; **BUILD** the agent-specific UI |
| **Filesystem (v1 / v2)** | FSA layer; native host later | — | FSA API (browser); native messaging (v2) | **BUILD** both layers (LOCKED #4 phased) |
| **Memory / RAG** | IndexedDB memory + cosine recall | — | (ANN lib e.g. voy/hnswlib-wasm only when corpus grows) | **BUILD** on IndexedDB; defer ANN integration |

---

## Cost Estimation Signals

- **Infra shape: near-zero, client-side.** The product is a client-only extension; **all Gemini cost is borne by the user (BYO key)** so there is **no per-user inference cost to us** (LOCKED #2; premise #5). No accounts, no first-party data sync in v1 (NFR-PRIV-3).
- **Only first-party infra: a small static CDN** serving (1) the **signed model/provider registry** updates and (2) the optional **app/skill catalog** JSON — both inert, cacheable data behind signature verification (FR-MR-5; `07`). Bandwidth is trivial (config is <100 KB; polled daily). One-time cost: an Ed25519 signing key + a server-side signing step.
- **Optional v2 native messaging host** adds per-OS packaging, code-signing certs (Windows/macOS), and an installer/update channel — a real but deferred operational line item (LOCKED #4; FR-FS-4).
- **Team skills / dev burden:** TS/React extension engineers; the differentiated effort concentrates in the **agent loop reliability**, the **hybrid browser control**, and the **Tier-2 sandbox security** — these are where time and review scrutiny go. Web Store review is a binary launch gate (success metric #7).
- **Operational burden:** low and bounded — sign+publish registry/catalog updates, monitor Gemini model/pricing drift (absorbed as data edits, not releases), and Web Store resubmissions only for genuinely new wire protocols or bundled-code changes (`07` net effect). No servers to scale, no inference bill, no per-user storage cost (local IndexedDB).

---

## Tech Stack Recommendation

| Layer | Choice | Notes |
|-------|--------|-------|
| **Platform** | **Manifest V3** | Stateless SW, scoped/optional permissions (no default `<all_urls>`+`debugger`, NFR-SEC-7), sidePanel, offscreen, sandbox key |
| **UI** | **React 19 + TypeScript + Vite + Tailwind** | Reuse MicroLabs stack (LOCKED #9); fast HMR; utility CSS |
| **LLM** | **`@google/genai`** + bundled **OpenAI-compatible** & native adapters | Native Gemini depth (thinking, multimodal, Computer Use) + multi-provider breadth (FR-MR-9) |
| **Storage** | **idb / Dexie** (IndexedDB) + `chrome.storage.session` (keys) + `storage.local` (config) | Versioned schema + migrations (LOCKED #9 fix) |
| **Validation** | **ajv** (JSON Schema) | Registry, skills, app-gen, tool declarations |
| **Tier-2 sandbox** | **quickjs-emscripten** (primary) / **ses** (lighter) | Bundled, readable, non-obfuscated `.wasm` (NFR-COMP-3) |
| **Pipeline primitives** | **jmespath**, **json-logic-js** | Bundled, non-eval, data-safe (FR-APP-4) |
| **Distillation** | **Mozilla Readability** + custom structured extraction | Article + table/form parsing |
| **Crypto** | **WebCrypto (`crypto.subtle`)** Ed25519/JWS | Signed registry verification (NFR-SEC-5) |
| **Rendering** | charting lib (uPlot/Recharts) + markdown renderer | Result cards (FR-APP-5) |
| **Dev quality (MicroLabs gaps, LOCKED #9)** | **ESLint + Prettier**, **Vitest** (unit — agent loop + gate), **Playwright** (e2e extension), **CI** (typecheck+lint+test green-to-merge) | NFR-MAINT-1; fixes the no-tests/no-CI gap. Coverage focus: agent loop + confirmation gate (NFR-REL-2) |

---

*End of conceptual architecture sketch.*
