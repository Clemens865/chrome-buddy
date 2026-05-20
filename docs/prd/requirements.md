# Chrome_Buddy — Requirements Specification

> Structured, testable requirements derived from `vision-scope.md`, `user-journeys.md` (Scenarios S1–S5), LOCKED `scope-decisions.md`, and research docs `03`, `04`, `06`, `07`. Every step of every journey that needs something from the system appears below as a functional requirement. Priority = Must/Should/Could. Scenario = the journey that needs it (S1=competitor pricing agent, S2=Extract Table micro-app, S3=AI-generate app, S4=save skill/workflow, S5=adopt model). "All" = exercised across journeys / cross-cutting.

---

## 1. Functional Requirements

### 1.1 AGENT — plan→act→observe→reflect loop

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-AGENT-1 | The agent SHALL implement a plan→act→observe→reflect loop with distinct Planner, Executor, and Validator roles, built on Gemini function calling (not a fork of browser-use/Nanobrowser/Stagehand). | Must | S1, S4 | Locked decision #3; research `06` §2. |
| FR-AGENT-2 | On receiving a task, the Planner SHALL produce a visible, numbered step plan rendered in the chat thread before any execution begins. | Must | S1 | S1 step 1 "Plan preview". |
| FR-AGENT-3 | The user SHALL be able to approve, edit, or let-run the proposed plan before execution starts. | Must | S1 | S1 step 1 user decision. |
| FR-AGENT-4 | The Executor SHALL execute one plan step at a time by issuing tool calls from the shared Tool Registry (§1.2), supporting Gemini parallel and sequential calls keyed by call `id`. | Must | S1 | `06` §2. |
| FR-AGENT-5 | After each tool call the agent SHALL observe the result and any page change, append it to the scratchpad, and reflect to decide the next step or completion. | Must | S1 | observe→reflect; `06` §2. |
| FR-AGENT-6 | The Validator SHALL check each step's result against the step's intent and mark the step succeeded / failed / needs-retry. | Must | S1, S4 | Planner→Executor→Validator structure. |
| FR-AGENT-7 | The agent SHALL maintain a structured scratchpad in IndexedDB persisted per run, including the running result table, action history, and source-URL provenance. | Must | S1, S4 | S1 step 4; SW is stateless (`04` §1) so scratchpad must be resumable. |
| FR-AGENT-8 | Every agent run SHALL be fully resumable from `chrome.storage`/IndexedDB after a service-worker restart, with no loss of completed-step state. | Must | All | `04` §1 SW idles ~30s; design rule #1. |
| FR-AGENT-9 | The agent SHALL enforce a configurable step budget and token/cost budget per run; on reaching either, it SHALL stop and report rather than continue. | Must | S1 | S1 edge "budget/step cap prevents runaway". |
| FR-AGENT-10 | On a failed step the agent SHALL apply bounded retries with recovery strategies (alternative-element fallback, change-observation re-plan, escalation ladder) before failing the step. | Must | S1, S4 | `06` §2 recovery; S4 self-healing. |
| FR-AGENT-11 | The agent SHALL deliver graceful partial completion: when one sub-task fails it SHALL return the parts that succeeded plus a flagged row/note for what failed, never silently aborting the whole run. | Must | S1 | S1 edge "one competitor fully fails"; vision metric (no silent failure). |
| FR-AGENT-12 | The agent SHALL feed prior action history back into the prompt to detect and avoid action loops (repeating the same failing step). | Must | S1 | `06` §2 "fed back to avoid loops". |
| FR-AGENT-13 | The agent SHALL detect when DOM extraction yields no usable result and escalate that step to the vision fallback tier (§1.4 / FR-LLM-9). | Must | S1 | S1 step 3 JS/canvas widget → vision. |
| FR-AGENT-14 | The agent SHALL emit a live step log to the panel (e.g. "opened acme.com/pricing ✓") updated as each step completes. | Must | S1 | S1 step 2 "live step log". |
| FR-AGENT-15 | The agent SHALL be invokable from a saved skill via `call_skill`, executing the skill's predefined steps with supplied inputs. | Must | S4 | `06` §1; S4 step 5. |
| FR-AGENT-16 | When run from a skill, the agent SHALL reuse learned site flows from cross-session memory (§1.12) to reduce steps/cost vs. the first run. | Should | S4 | S4 step 6 memory-assisted lift; success metric #3. |
| FR-AGENT-17 | The agent SHALL operate over the current tab plus a small set of related tabs in v1 (linear, not parallel shadow browsers). | Must | S1 | Critical-path MVP scope; parallel research is post-v1. |

### 1.2 TOOLS — shared tool registry

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-TOOLS-1 | The system SHALL expose a single Tool Registry as the one source of capabilities consumed by micro-apps, the agent, and skills/workflows alike. | Must | All | Locked #1; `06` §5 "one registry, three levels". |
| FR-TOOLS-2 | The registry SHALL provide a `navigate` tool (open/go-to a URL or search) implemented via `chrome.tabs`/`chrome.scripting`. | Must | S1 | `06` §2 tool set. |
| FR-TOOLS-3 | The registry SHALL provide `click`, `type`, and `scroll` tools that act on DOM elements via `chrome.scripting.executeScript` synthetic events by default. | Must | S1 | `04` §3 DOM-first, no debugger banner. |
| FR-TOOLS-4 | The registry SHALL provide a `read_dom` tool returning distilled/parsed page structure via the shared PageContext service. | Must | S1, S2 | `06` §5.1 PageContext is the only page reader. |
| FR-TOOLS-5 | The registry SHALL provide a `screenshot` tool via `captureVisibleTab` for vision analysis. | Must | S1 | `04` §3; viewport only (stitch for full page). |
| FR-TOOLS-6 | The registry SHALL provide an `extract` tool that returns structured data conforming to a supplied Gemini `responseSchema` (plan/price/period/limits etc.). | Must | S1, S2, S3 | S1 step 3; S2 output; S3 generated apps. |
| FR-TOOLS-7 | The registry SHALL provide a `summarize` tool. | Must | S1 | `06` §2 tool set; wedge tool. |
| FR-TOOLS-8 | The registry SHALL provide a `call_skill` meta-tool by which the agent discovers and invokes saved skills via Gemini function calling. | Must | S4 | `06` §1/§2. |
| FR-TOOLS-9 | The registry SHALL provide a `send_webhook` tool that POSTs to external systems within declared `host_permissions`. | Must | S4 | §1.13 INTEGRATIONS; `04` §5. |
| FR-TOOLS-10 | The registry SHALL provide `read_file` and `write_file` tools backed by the File System Access root folder in v1 (§1.11). | Must | S1, S2 | Locked #4; S2 "Save to file". |
| FR-TOOLS-11 | The registry SHALL provide an `ask_user` tool that pauses the run and surfaces a question/choice in the panel, resuming on the user's answer. | Must | S1 | S1 step 2 disambiguation. |
| FR-TOOLS-12 | Each tool definition SHALL declare a `consequential` boolean; tools that send/buy/delete/auth SHALL be flagged `consequential: true`. | Must | S1, S4 | `06` §2 HITL; gates §1.3. |
| FR-TOOLS-13 | Each tool SHALL declare a machine-readable schema (name, params, returns) usable directly as a Gemini function declaration. | Must | All | Function calling requires declarations. |
| FR-TOOLS-14 | The registry SHALL enforce a per-skill/per-app `allowedTools` whitelist, rejecting or stripping any tool call not on the caller's whitelist. | Must | S3, S4 | `06` §1 compliance boundary. |

### 1.3 HITL — human-in-the-loop confirmation

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-HITL-1 | Before executing ANY `consequential`-flagged action (send/buy/delete/write-external), the system SHALL render an inline confirmation card with Approve / Edit / Cancel and SHALL NOT proceed without explicit Approve. | Must | S1, S4 | Anti-goal #7; success metric #2 (100% gated, 0 unauthorized). Cannot ship at 90%. |
| FR-HITL-2 | The confirmation card SHALL show the exact payload/target of the action (e.g. the full table + "Insert into [Doc title] at cursor?"). | Must | S1 | S1 step 5. |
| FR-HITL-3 | The user SHALL be able to edit the action target/payload from the confirmation card before approving (e.g. change the target Doc). | Must | S1 | S1 step 5 "she edits target first". |
| FR-HITL-4 | When a Computer Use response returns `safety_decision: "require_confirmation"`, the system SHALL surface a confirmation card and only resend with `safety_acknowledgement: "true"` after explicit user approval. | Must | S1 | `04` §3; `06` §2. |
| FR-HITL-5 | The confirmation gate SHALL apply identically to scheduled/unattended runs: a consequential step in an unattended run SHALL hard-pause at the gate and send a notification rather than auto-execute. | Must | S4 | S4 step 4 + edge; anti-goal #7 holds for automation. |
| FR-HITL-6 | If the action target is missing at confirm time (e.g. target Doc not open), the card SHALL prompt the user to pick/supply a target rather than writing blindly. | Must | S1 | S1 step 5 edge "Doc not open at confirm time". |
| FR-HITL-7 | The system SHALL log every consequential action and its approval (who/what/when/payload) to history for auditability. | Must | S1, S4 | Trust/auditability frontier (`05`); success metric #2. |
| FR-HITL-8 | On detecting a CAPTCHA, bot-detection challenge, or login/2FA wall, the agent SHALL pause and hand control to the human ("solve this and click Resume") rather than attempt to bypass. | Must | S1, S4 | Anti-goal #4; `04` §3; S1 + S4 edges. |

### 1.4 BROWSER-CONTROL

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-BC-1 | Browser actions SHALL be DOM-first: simple read/click/type/scroll SHALL use `chrome.scripting.executeScript` synthetic events by default (no debugger banner). | Must | S1, S2 | `04` §3 hybrid recommendation. |
| FR-BC-2 | The system SHALL use `chrome.debugger` (CDP) only when synthetic events are insufficient (trusted-input needed), minimizing banner exposure. | Should | S1 | `04` §3/§8 hybrid; CDP shows un-hideable banner. |
| FR-BC-3 | When CDP/debugger is active, the system SHALL inform the user that the "extension is debugging this browser" banner is expected. | Should | S1 | `04` §3 banner is un-hideable. |
| FR-BC-4 | The system SHALL capture viewport screenshots via `captureVisibleTab` and stitch multiple captures when full-page vision is required. | Should | S1 | `04` §3 viewport-only caveat. |
| FR-BC-5 | The system SHALL run the Gemini Computer Use loop (screenshot-in → normalized 0–999 action-out → execute → screenshot-back) only as the vision fallback tier after DOM-first fails. | Must | S1 | Locked #3; `04` §3; `06` §2. |
| FR-BC-6 | The system SHALL detect restricted/undriveable contexts (`chrome://`, Web Store pages, unauthorized cross-origin iframes) and report them as un-actionable rather than failing opaquely. | Must | S1 | `04` §3 "can't automate". |
| FR-BC-7 | All page reads SHALL go through the shared PageContext service, which SHALL wait for page stability (lazy/async-rendered content) before returning DOM. | Must | S1, S2 | `06` §5.1; S2 edge "page still loading". |
| FR-BC-8 | When DOM-acting on the current tab from a generated/code app, execution SHALL use `chrome.userScripts` (gated toggle), never privileged eval. | Could | S3 | `07` Tier-2 DOM-acting apps. |

### 1.5 APPS — Tier-1 declarative GenericApp interpreter

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-APP-1 | The system SHALL provide a bundled GenericApp interpreter that runs Tier-1 micro-apps defined entirely as declarative JSON config (no per-app code). | Must | S2, S3 | Locked #5; `07` Tier-1; reuse MicroLabs `GenericApp`. |
| FR-APP-2 | A Tier-1 app config SHALL declare `{ inputsSchema, promptTemplate, pipeline[], allowedTools[], outputRenderer, requiredHosts[] }`. | Must | S2, S3 | `07` Tier-1 format. |
| FR-APP-3 | The interpreter SHALL render each app's input UI from its `inputsSchema` (toggles, checkboxes, selects), including pre-detected defaults (e.g. "first row is header"). | Must | S2 | S2 step 3. |
| FR-APP-4 | The interpreter SHALL run a multi-step `pipeline` using only bundled primitives (e.g. JSONLogic/JMESPath expressions, pipeline runner). | Should | S2, S3 | `07` Tier-1 runtime; configs stay data. |
| FR-APP-5 | The interpreter SHALL render output via bundled renderers selected by `outputRenderer` (table / CSV / Markdown / JSON / chart / diff). | Must | S2 | S2 step 3 CSV/MD/JSON toggle. |
| FR-APP-6 | Apps SHALL read the page only via the shared PageContext service (same reader as the agent). | Must | S2 | `06` §5.1. |
| FR-APP-7 | When multiple candidate targets exist (e.g. 3 tables), the app SHALL present labelled/thumbnail choices ("3 tables found — which?") rather than guessing. | Must | S2 | S2 step 2. |
| FR-APP-8 | The app SHALL render a live preview of parsed/extracted output in-panel before the user commits/exports. | Must | S2 | S2 step 3/4. |
| FR-APP-9 | Each app result SHALL offer Copy and Save-to-file (File System Access root folder) actions. | Must | S2 | S2 step 4. |
| FR-APP-10 | When an app makes no LLM call, its model badge SHALL display "deterministic — no LLM call, $0.00". | Must | S2 | S2 step 4 transparency even when free. |
| FR-APP-11 | Each app SHALL expose a persistent "Hand to Agent" action that packages the app's current context and seeds a multi-step agent run. | Must | S2 | S2 step 5; `06` §5 escalation path. |
| FR-APP-12 | When an app cannot perform its job on the page (e.g. CSS-grid not a semantic `<table>`), it SHALL degrade gracefully with a handoff suggestion ("try Agent for layout extraction") instead of returning garbage. | Must | S2 | S2 step 2 + edge. |
| FR-APP-13 | For large outputs (e.g. 10k-row table) the app SHALL stream/paginate the preview and warn before a giant copy. | Should | S2 | S2 edge "huge table". |
| FR-APP-14 | The app SHALL flatten merged/nested cells with a visible note ("merged cells expanded"). | Should | S2 | S2 edge. |
| FR-APP-15 | Saved/generated apps SHALL appear in the Apps grid with a name and icon, indistinguishable in use from built-in apps; the grid SHALL provide search. | Must | S2, S3 | S2 step 1 search box; S3 step 6. |

### 1.6 APP-GEN — NL → validated JSON app config

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-APPGEN-1 | The Apps grid SHALL offer "+ New app — describe it"; the user describes the desired app in natural language. | Must | S3 | S3 trigger + step 1. |
| FR-APPGEN-2 | The system SHALL offer a "use current page as test sample" toggle when generating an app. | Should | S3 | S3 step 1. |
| FR-APPGEN-3 | The system SHALL generate a Tier-1 JSON config by default, using Gemini structured/JSON output constrained to the app-config schema. | Must | S3 | Locked #5; `07` Tier-1 AI generation; S3 step 2. |
| FR-APPGEN-4 | The generated config SHALL be re-validated against the local schema AND the `allowedTools`/renderers/hosts allowlists before persistence. | Must | S3 | `06` §1; `07` rule #6; S3 step 3. |
| FR-APPGEN-5 | If validation fails, the system SHALL run a capped auto-repair prompt loop; on exhausting retries it SHALL fall back to the linear field editor ("let's refine together") and SHALL NEVER persist invalid JSON. | Must | S3 | S3 step 3 + edge. |
| FR-APPGEN-6 | A generated config requesting a non-whitelisted tool, host, or permission SHALL have that element stripped/flagged; the app degrades to allowed capability. | Must | S3 | S3 step 3/4 edge. |
| FR-APPGEN-7 | If the description is ambiguous, the generator SHALL ask one clarifying question rather than guessing the schema. | Should | S3 | S3 edge "ambiguous description". |
| FR-APPGEN-8 | The system SHALL run the draft app live against the current page and show actual output before save. | Must | S3 | S3 step 5. |
| FR-APPGEN-9 | The user SHALL be able to refine the description and regenerate before saving (e.g. "current company only"). | Must | S3 | S3 step 5. |
| FR-APPGEN-10 | On save, the app SHALL be exportable as self-contained portable JSON (with `schemaVersion`/semver), re-validated on a recipient's import. | Must | S3 | S3 step 6; `07` sharing. |
| FR-APPGEN-11 | When an app was tuned on a single page sample, the system SHALL warn the user to test on a second page before relying on it. | Should | S3 | S3 edge "page sample atypical". |
| FR-APPGEN-12 | App config SHALL escalate to Tier-2 (§1.7) only when the task genuinely needs imperative logic the declarative vocabulary cannot express. | Must | S3 | S3 step 4; `07` Tier-2 trigger. |

### 1.7 TIER2-SANDBOX — sandboxed code apps

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-T2-1 | Tier-2 code apps SHALL run inside a sandboxed iframe (manifest `sandbox` key, opaque origin, `allow-scripts` WITHOUT `allow-same-origin`) hosting a bundled QuickJS-wasm or SES `Compartment` (after `lockdown()`). | Must | S3 | Locked #5; `07` Tier-2 runtime. |
| FR-T2-2 | Generated/imported code SHALL run only in the sandbox with zero ambient authority; the system SHALL NEVER `fetch()`-and-`eval()` remote code nor `eval` in a privileged context. | Must | S3 | Anti-goal #3; `07` rule #1/#3; locked #8. |
| FR-T2-3 | The sandbox SHALL communicate only over a narrow `postMessage` RPC capability bridge; it SHALL be able to call only operations the host explicitly exposes (`gemini.generate`, gated `fetch`, app-scoped storage). | Must | S3 | `07` capability bridge. |
| FR-T2-4 | The host SHALL authorize each bridged call against the app's declared per-app permissions (capability model, not blocklist). | Must | S3 | `07` rule #4. |
| FR-T2-5 | The system SHALL require human review of the generated code and its requested capabilities before the app's first run. | Must | S3 | `07` Tier-2 "always with human review"; locked #5. |
| FR-T2-6 | The sandbox SHALL enforce execution timeouts/termination; a runtime error SHALL be an isolated failure surfaced as "this app's script errored", unable to touch the page or other apps. | Must | S3 | `07` rule #4; S3 edge. |
| FR-T2-7 | The QuickJS/SES engine and `.wasm` SHALL be bundled, readable, and non-obfuscated (CSP `wasm-unsafe-eval`). | Must | S3 | `07` rule #2; Web Store review. |

### 1.8 SKILLS

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-SKILL-1 | A skill SHALL be defined as validated JSON: `{ id, name, description, trigger, systemPrompt, allowedTools[], inputs[], outputSchema, steps[] }` — never executable code. | Must | S4 | `06` §1 schema; locked #8. |
| FR-SKILL-2 | A skill's short `description` SHALL always be kept in the agent's context so the agent can decide relevance; the `systemPrompt`/body SHALL load on demand. | Must | S4 | `06` §1. |
| FR-SKILL-3 | The user SHALL be able to promote a completed agent run into a skill ("Save as skill" on the done card), capturing the run's steps into the shared step schema. | Must | S1, S4 | S1 step 6; S4 step 1. |
| FR-SKILL-4 | The system SHALL propose a skill name and short description on promotion, editable by the user. | Must | S4 | S4 step 1. |
| FR-SKILL-5 | The system SHALL auto-detect variable parts of a promoted run and offer them as `inputs` (e.g. `{{competitors}}`); the user SHALL be able to mark additional parts (e.g. target Doc) as parameters. | Must | S4 | S4 step 2. |
| FR-SKILL-6 | The skill editor SHALL be a linear step-list editor allowing reorder/remove of steps with highlighted variables. | Must | S4 | S4 step 2; `06` §3 linear editor (no node-graph, anti-goal #6). |
| FR-SKILL-7 | Each skill SHALL record an `allowedTools` whitelist that bounds what it can do at runtime. | Must | S4 | S4 step 3; `06` §1 boundary. |
| FR-SKILL-8 | Skills SHALL be exportable/importable as self-contained JSON, re-validated against the local registry on import. | Must | S4 | S4 step 5; `06` §1. |
| FR-SKILL-9 | On import the system SHALL show a consent screen listing the tools and hosts the skill requests before enabling it. | Must | S4 | `07` Tier-1 sharing consent. |
| FR-SKILL-10 | On import, if a skill references a tool/model/capability not present, the system SHALL flag the missing capability and offer to map or disable that step. | Must | S4 | S4 edge "imported skill references missing tool". |
| FR-SKILL-11 | Saved skills SHALL appear in the Skills view and be invocable from chat ("run competitor pricing for X, Y, Z") via `call_skill`. | Must | S4 | S4 step 5. |

### 1.9 WORKFLOWS

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-WF-1 | Workflows SHALL be a skill plus a trigger; skills and workflows SHALL share one step schema (vocab: `navigate / extract / gpt / branch / loop / jump`, with `{{param}}` variables). | Must | S4 | `06` §3; locked #1. |
| FR-WF-2 | The system SHALL provide three front doors that all emit the shared step schema: (a) NL → workflow, (b) linear step-list editor, (c) recorder. | Should | S4 | `06` §3. NL→workflow + linear editor are Must for S4; recorder Should. |
| FR-WF-3 | The recorder SHALL capture user clicks/inputs on a page and generate corresponding steps. | Could | — | `06` §3; not on a critical journey step. |
| FR-WF-4 | A workflow SHALL support `trigger` types `manual`, `schedule`, and `event`. | Must | S4 | S4 step 4; `06` §1. |
| FR-WF-5 | A scheduled workflow SHALL fire on its schedule via `chrome.alarms` and run resumably even after SW restarts. | Must | S4 | S4 step 4; `04` §1. |
| FR-WF-6 | A scheduled/unattended run reaching a consequential step SHALL hard-pause and notify the user (per FR-HITL-5), never auto-executing. | Must | S4 | S4 step 4 edge; metric #2. |
| FR-WF-7 | The Workflows view SHALL list each workflow with its trigger; workflows SHALL be exportable/importable as JSON (re-validated on import). | Must | S4 | S4 step 5. |
| FR-WF-8 | When a step's selector/target has changed since recording, the workflow runtime SHALL re-plan that step (self-healing) and flag it in the run report. | Should | S4 | S4 edge "site layout changed"; `05` self-healing. |
| FR-WF-9 | Before a workflow's first scheduled fire, the system SHALL offer a test-run and surface unused inputs ("this input was never used"). | Should | S4 | S4 edge over/under-parameterized. |

### 1.10 MODEL-REGISTRY

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-MR-1 | The system SHALL store an editable model/provider registry as declarative JSON data (`schemaVersion`, `providers{}`, `models{}`) in `chrome.storage.local`, with API keys stored separately. | Must | S5 | Locked #6; `07` §B schema. |
| FR-MR-2 | The system SHALL ship a bundled-default registry that is the floor and SHALL never block first use on a remote fetch. | Must | S5 | `07` §B "never block first use". |
| FR-MR-3 | Each model entry SHALL declare `contextWindow`, `maxOutputTokens`, `pricing{inputPerMTok,outputPerMTok}`, and a `capabilities{vision,tools,thinking,jsonMode,streaming,computerUse}` block. | Must | S5 | `07` §B; locked #2 model tiers. |
| FR-MR-4 | Adding a new Gemini model SHALL require only a one-line config entry (no code change); the bundled adapter forwards the model string. | Must | S5 | S5 step 2; `07` §B. |
| FR-MR-5 | The system SHALL fetch a signed remote registry update (verify Ed25519/JWS signature via `crypto.subtle` → validate against bundled JSON Schema → check `schemaVersion` compat → merge with precedence user-edit > remote > bundled), triggered on SW start and a daily `chrome.alarms` poll. | Must | S5 | `07` §B remote update; locked #6. |
| FR-MR-6 | A bad or unsigned remote payload SHALL be rejected and the last-good (or bundled) registry retained — no broken model list. | Must | S5 | S5 edge; `07` §B signature check. |
| FR-MR-7 | New models SHALL appear automatically in the model picker after a registry refresh with their pricing and a "new" badge; no extension update/resubmission required. | Must | S5 | S5 step 1. |
| FR-MR-8 | The registry editor SHALL let a power user add a model entry in-app (id, context window, $/token, capability flags). | Must | S5 | S5 step 2. |
| FR-MR-9 | The system SHALL bundle adapter modules (`OpenAICompatibleAdapter`, optional `AnthropicMessagesAdapter`, `GeminiNativeAdapter`) selected by a model's `adapter` field; `paramMap` SHALL handle param renames declaratively. | Must | S5 | `07` §B provider abstraction; locked #2. |
| FR-MR-10 | The user SHALL be able to add an OpenAI-compatible provider as config (base URL, key field, model list); the bundled adapter speaks the protocol — never remote code. | Must | S5 | S5 step 4; locked #2; anti-goal #3. |
| FR-MR-11 | Enabling/adding a new provider host SHALL request `optional_host_permissions` via `chrome.permissions.request()`; default-provider hosts SHALL be pre-declared. | Must | S5 | `07` §B network-permission limit. |
| FR-MR-12 | A "Test" button SHALL run a tiny prompt against a model/provider and display latency + sample token cost + green/red status before it is relied upon. | Must | S5 | S5 step 5; step 2 invalid-id fast-fail. |
| FR-MR-13 | A typo'd/invalid model id or non-conformant provider response SHALL fail the Test call fast with a clear error and mark the entry invalid (default won't switch to a broken model). | Must | S5 | S5 step 2/4 + edges. |
| FR-MR-14 | For undeclared capabilities the system SHALL probe defensively: default conservative (text-only, no tools), on a 400/"unsupported param" set the cap false in cache, retry without it, notify once, and persist probe results per provider+model. | Should | S5 | `07` §B graceful capability handling. |
| FR-MR-15 | When a skill needs a capability (e.g. computer-use) the chosen model lacks, the agent SHALL auto-route to a model that has it or warn. | Should | S5 | S5 edge. |
| FR-MR-16 | A stale pricing field SHALL mark the cost display "est. — verify with provider" without blocking usage. | Could | S5 | S5 edge. |

### 1.11 LLM — Gemini client

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-LLM-1 | The system SHALL accept a BYO Gemini API key, store it in `chrome.storage.session`, and make all cloud LLM calls from the background service worker (never from a content script sharing the page DOM). | Must | All | Locked #2; `03` §7 security pattern. |
| FR-LLM-2 | There SHALL be a single shared Gemini client used by apps, agent, and skills (one client for model selection, keys, retries, streaming, structured output, Computer Use). | Must | All | `06` §5.2. |
| FR-LLM-3 | The default workhorse model SHALL be `gemini-3.5-flash`, with `gemini-2.5-flash-lite` for cheap/fast, `gemini-3.1-pro` for hard reasoning, and `gemini-2.5-computer-use-preview` for browser automation. | Must | S1, S5 | Locked #2; `03` §8. |
| FR-LLM-4 | The client SHALL support Gemini function calling (parallel + sequential, keyed by call `id`). | Must | S1 | `06` §2/§5.2. |
| FR-LLM-5 | The client SHALL support JSON mode / `responseSchema` structured output. | Must | S1, S3 | `06`; S1 extract, S3 app-gen. |
| FR-LLM-6 | The client SHALL support configurable thinking levels per model where the model supports it. | Should | S1 | `03` §1 dynamic thinking. |
| FR-LLM-7 | The client SHALL support streaming responses to the panel. | Should | S1 | `03` capability; live UX. |
| FR-LLM-8 | The system SHALL support a Gemini Nano on-device path (Prompt/Summarizer/Translator etc.) for small/private/free tasks, run in a content script or offscreen document (NOT the SW), with feature detection via `LanguageModel.availability()` and always a cloud fallback. | Should | S2 | `03` §6; locked #2; SW cannot call Nano. |
| FR-LLM-9 | The client SHALL run the Computer Use loop as the vision fallback tier and handle its `safety_decision`/`safety_acknowledgement` protocol. | Must | S1 | `04` §3; `06` §2. |
| FR-LLM-10 | The system SHALL meter token usage and dollar cost per call and per run using registry pricing, exposing a running total to the UI. | Must | S1, S5 | S1 ticking $; success metric #4. |
| FR-LLM-11 | On Gemini rate-limit/slow/error, the client SHALL apply tiered fallback (e.g. Flash → Flash-Lite) and show "model busy, retrying" rather than hang. | Must | S1, S5 | S1 edge; S5 edge; `03` §8 tiered fallback. |
| FR-LLM-12 | The user SHALL be able to switch model mid-task. | Should | S1, S5 | S5 step 3; vision §22 transparency. |

### 1.12 MEMORY

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-MEM-1 | The system SHALL persist cross-session memory in IndexedDB (learned site flows, run history, scratchpads, results). | Must | S1, S4 | `04` §10; `06` §2/§5.4. |
| FR-MEM-2 | A run scratchpad SHALL persist intermediate results and provenance and be shareable so an app's output can seed an agent run. | Must | S1, S2 | `06` §5.4; S2 step 5 escalation. |
| FR-MEM-3 | Run history SHALL be browsable in the History view, including steps, model/cost, and confirmed consequential actions. | Must | S1, S4 | `06` §4; FR-HITL-7. |
| FR-MEM-4 | On re-running a skill, the agent SHALL recall learned site flows (e.g. Acme's real pricing URL, "Cyrus is quote-only") to reduce steps/cost, measurable as memory-recall hit rate. | Should | S4 | S4 step 6; success metric #3. |
| FR-MEM-5 | The system MAY compute and store embeddings (`gemini-embedding-001`/`-2`) in IndexedDB to support semantic recall/RAG over saved pages and prior runs. | Could | S4 | `03` §3; `04` §10; v1.x. |

### 1.13 FILESYSTEM

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-FS-1 | v1 SHALL use the File System Access API: the user picks a root folder once (gesture) and the extension gets read+write to that tree, backing `read_file`/`write_file` and Save-to-file. | Must | S1, S2 | Locked #4; `04` §2. |
| FR-FS-2 | The first Save/file operation SHALL trigger the one-time folder pick if no root is set yet. | Must | S2 | S2 edge "no folder picked". |
| FR-FS-3 | The system SHALL use persistent permissions (Chrome 122+) where available and re-request a one-click grant per session when the browser requires it. | Should | S2 | `04` §2 persistence caveat. |
| FR-FS-4 | [Phase v2] The system SHALL add a native messaging host for prompt-free always-on root-folder access. | Could | — | Locked #4 phased; `04` §2. v2 only. |

### 1.14 INTEGRATIONS

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-INT-1 | The system SHALL send webhooks (HTTP POST) to external systems (Slack/Notion/Zapier/custom) via `fetch` from the background SW/offscreen doc within declared `host_permissions`. | Must | S4 | `04` §5; `06` §2 `send_webhook`. |
| FR-INT-2 | Webhook target hosts SHALL be declared as `host_permissions` (or requested as `optional_host_permissions` when a user configures a new one). | Must | S4 | `04` §5; `07` §B. |
| FR-INT-3 | A webhook that performs a consequential external action SHALL pass through the HITL gate (§1.3). | Must | S4 | Anti-goal #7; FR-HITL-1. |

### 1.15 MEDIA

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-MEDIA-1 | The system SHALL support speech-to-text for the chat input via Web Speech API (free) or Gemini Live (quality), run in a content/offscreen context (not SW), gated on mic permission. | Should | S1 | `04` §6; `06` §4 voice icon. |
| FR-MEDIA-2 | The system SHALL support text-to-speech via `chrome.tts` (free) or Gemini TTS (quality). | Could | — | `04` §7. |
| FR-MEDIA-3 | The system SHALL support image generation via Imagen 4 / Nano Banana (`gemini-2.5-flash-image`) displayed in-panel and saveable via FSA. | Could | — | `04` §8; `03` §4. |
| FR-MEDIA-4 | The system SHALL support image editing (Nano Banana edit + Canvas crop/filter/composite). | Could | — | `04` §8. |

### 1.16 UI

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-UI-1 | The primary surface SHALL be `chrome.sidePanel`, set global, persisting across tab navigation and user-resizable. | Must | All | Locked #7; `04` §9. |
| FR-UI-2 | The panel SHALL present a vertical icon rail (Chat / Apps / Skills / Workflows / History, Settings pinned bottom) plus an expandable content panel. | Must | All | Locked #7; `06` §4. |
| FR-UI-3 | Chat SHALL be the home view; the rail SHALL switch the content panel between Chat, Apps grid, Skills, Workflows, History, and Settings. | Must | All | `06` §4. |
| FR-UI-4 | "Always-on" SHALL be achieved via global side panel + `openPanelOnActionClick` + a registered keyboard command + pin; the system SHALL NOT attempt to auto-open the panel without a user gesture. | Must | S1 | `04` §9; locked #7. |
| FR-UI-5 | The chat thread SHALL display the live plan, step log, per-step result cards, inline confirmation cards, the model badge, and the running cost. | Must | S1 | S1 steps 1–6. |
| FR-UI-6 | The system SHALL render `ask_user` prompts inline in the chat thread. | Must | S1 | S1 step 2. |
| FR-UI-7 | A per-competitor/per-step mini-result card SHALL be shown, including a "vision used here" marker on steps that used the vision fallback. | Should | S1 | S1 step 3 transparency marker. |
| FR-UI-8 | The Apps grid SHALL show focused tools with search and the "+ New app" entry; launching an app SHALL render it in the same panel. | Must | S2, S3 | S2 step 1; `06` §4. |
| FR-UI-9 | The done card SHALL show provenance (source links), total cost and elapsed time, and a "Save as skill" action. | Must | S1 | S1 step 6. |
| FR-UI-10 | The system MAY render in-page anchored UI via a content-script overlay where appropriate. | Could | — | `06` §4; `04` §9. |

### 1.17 ONBOARDING

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-ONB-1 | First run SHALL present a BYO-key setup walkthrough guiding the user to obtain and paste a Gemini API key. | Must | All | Vision premise #5; success metric #6. |
| FR-ONB-2 | The walkthrough SHALL validate the pasted key with a live test call before completing setup. | Must | All | FR-MR-12 reuse; key must work. |
| FR-ONB-3 | Cloud-LLM features SHALL be gated behind a valid key; the system SHALL clearly indicate which features are unavailable until a key is added (on-device Nano features MAY work without a key). | Must | All | Locked #2; metric #6 activation funnel. |
| FR-ONB-4 | The walkthrough SHALL explain key storage location (`chrome.storage.session`) and the privacy posture. | Should | All | Trust/transparency differentiator. |

### 1.18 SETTINGS / PROFILE

| ID | Requirement | Priority | Scenario | Notes |
|----|-------------|----------|----------|-------|
| FR-SET-1 | The Settings view (pinned bottom of rail) SHALL include Models & Providers (registry editor), key management, folder selection, and budget/spend guards. | Must | S5 | `06` §4; S5 trigger. |
| FR-SET-2 | The system SHALL store a user profile for personalization (carried into prompt context) — reused from MicroLabs' profile pattern. | Should | All | Locked #9 keep "user-profile personalization". |
| FR-SET-3 | The system SHALL support per-app integration configuration (e.g. a webhook target, default output folder per app). | Should | S4 | Locked #9 webhook/integration abstraction. |
| FR-SET-4 | The user SHALL be able to set default model and per-task model tiers (cheap / hard / browser-automation). | Must | S5 | S5 step 3. |
| FR-SET-5 | Settings SHALL include data-retention controls (clear history/memory). | Should | All | Privacy posture; NFR-PRIV-3. |

---

## 2. Non-Functional Requirements

| ID | Category | Requirement | Target | Rationale |
|----|----------|-------------|--------|-----------|
| NFR-PERF-1 | Performance | Side-panel open → interactive (rail + chat input usable). | ≤ 300 ms p95 on a mid-range laptop. | Always-on surface must feel instant; UX parity with Slack/VS Code rail. |
| NFR-PERF-2 | Performance | Apps-grid render and app launch into the panel. | ≤ 200 ms p95. | S2 "instant" deterministic-tool feel. |
| NFR-PERF-3 | Performance | Deterministic micro-app (no LLM, e.g. Extract Table) output rendered. | ≤ 500 ms p95 for ≤1k-row tables; paginated stream start ≤ 800 ms for ≥10k rows. | S2 magic moment is one-click instant. |
| NFR-PERF-4 | Performance | First streamed token from a cloud LLM call after dispatch. | ≤ 2.5 s p95 (network-dependent). | Live UX; perceived responsiveness. |
| NFR-PERF-5 | Performance | Agent per-step overhead (orchestration excl. model/network latency). | ≤ 400 ms p95. | Loop must not add felt lag on top of model latency. |
| NFR-PERF-6 | Performance | PageContext DOM read + distillation on a typical page. | ≤ 1 s p95; honor a wait-for-stable timeout ≤ 5 s. | S1/S2 page reads; lazy-render handling. |
| NFR-PERF-7 | Performance | Run state checkpoint to IndexedDB after each step. | ≤ 150 ms; must complete before SW idle (~30 s). | Resumability (FR-AGENT-8); SW disposable. |
| NFR-SEC-1 | Security | Gemini/provider API keys SHALL live only in `chrome.storage.session` (in-memory) and SHALL never be written to `storage.local`/`sync`, logs, or the page DOM. | 0 keys persisted to disk or exposed to content scripts. | Locked #2; `03` §7; fixes MicroLabs key handling. |
| NFR-SEC-2 | Security | All cloud LLM/webhook calls SHALL originate in the background SW or offscreen doc, never a content script. | 100% of cloud calls off-page. | `03` §7 key hygiene. |
| NFR-SEC-3 | Security | No remotely-hosted or `eval`'d code SHALL ever execute; only declarative data is fetched/generated/imported. | 0 instances of fetch-and-eval; passes Web Store review. | Anti-goal #3; locked #8; `07` bright line. |
| NFR-SEC-4 | Security | Generated/imported code SHALL run only in the bundled sandbox (QuickJS-wasm/SES, opaque origin, no `allow-same-origin`) with zero ambient authority and capability-gated bridge calls. | Sandbox escape attempts = 0; all host calls authorized. | `07` Tier-2; FR-T2-*. |
| NFR-SEC-5 | Security | Remote registry config SHALL be signature-verified (Ed25519/JWS via `crypto.subtle`) and schema-validated before merge; unverified payloads rejected. | 100% of remote merges verified. | `07` §B; prevents malicious `baseUrl` key theft. |
| NFR-SEC-6 | Security | The system SHALL apply prompt-injection guards: page-derived content SHALL be treated as untrusted data, fenced from instructions, and SHALL NOT be able to silently invoke consequential tools (gate still fires). | No page content can trigger an unconfirmed consequential action. | Agent has credential access; `05` trust frontier; metric #2. |
| NFR-SEC-7 | Security | Host permissions SHALL be scoped/optional (no default `<all_urls>` + `debugger`); new provider/site hosts requested at runtime via `chrome.permissions.request()`. | No over-broad default grants. | Fixes MicroLabs (locked #9); `07` §B; Web Store. |
| NFR-PRIV-1 | Privacy | Local-first: page reading, DOM actions, memory, and deterministic apps SHALL run locally; only explicit LLM calls leave the device, to the user's chosen provider. | No telemetry of page content to first-party servers. | Vision privacy-respecting differentiator. |
| NFR-PRIV-2 | Privacy | An on-device (Gemini Nano) path SHALL be available for eligible small tasks with no network egress. | Nano tasks: 0 bytes to cloud. | `03` §6; locked #2. |
| NFR-PRIV-3 | Privacy | Cross-session memory/history SHALL be local (IndexedDB) and user-clearable; no first-party cloud sync of run data in v1. | User can purge all stored memory/history. | NFR; FR-SET-5; privacy posture. |
| NFR-PRIV-4 | Privacy | The user SHALL be warned that BYO free-tier Gemini usage may be used for training by Google (paid tier is not). | Disclosure shown in onboarding/settings. | `03` §7. |
| NFR-REL-1 | Reliability | Verified Multi-Step Task Completion Rate (north star) SHALL be instrumented from first internal build and reported each release, improving release-over-release. | Credible, transparently-measured rate at v1; target attacking the ~1-in-4 industry failure. | Vision north star; `05`. |
| NFR-REL-2 | Reliability | Confirmation-gate integrity: 100% of consequential actions gated, with 0 unauthorized executions. | Hard 100% / 0; sustained. | Success metric #2; non-negotiable. |
| NFR-REL-3 | Reliability | Agent runs SHALL survive ≥1 SW restart mid-run and resume without duplicating completed/consequential steps. | 100% resume without duplicate side effects. | FR-AGENT-8; idempotency on consequential steps. |
| NFR-REL-4 | Reliability | Bad remote registry / provider outage SHALL degrade gracefully (last-good registry, tiered model fallback) with no hard failure of in-progress runs. | 0 hard crashes from config/provider faults. | S5 edges; FR-MR-6, FR-LLM-11. |
| NFR-COMP-1 | Compliance | The extension SHALL be MV3-compliant and pass Chrome Web Store review on first submission (no remote-code/permission rejections). | Pass on first submission (binary). | Success metric #7; locked #8. |
| NFR-COMP-2 | Compliance | Single purpose SHALL be framed as "an AI workspace for building/running browser micro-tools" so generated apps stay on-theme for review. | Stated single purpose; generated apps on-theme. | `07` rule #5; gatekeeper mitigation. |
| NFR-COMP-3 | Compliance | The bundled QuickJS/SES engine + `.wasm` SHALL be readable and non-obfuscated. | Reviewer-legible engine code. | `07` rule #2. |
| NFR-A11Y-1 | Accessibility | The panel SHALL meet WCAG 2.1 AA: full keyboard operability (rail switch, confirm/cancel), visible focus, ARIA roles, ≥4.5:1 text contrast. | WCAG 2.1 AA conformance. | Knowledge-worker tool; keyboard-first power users. |
| NFR-A11Y-2 | Accessibility | Confirmation cards and `ask_user` prompts SHALL be reachable and actionable by keyboard and announced to screen readers. | 100% of HITL surfaces keyboard+SR accessible. | Gate must never be mouse-only. |
| NFR-COST-1 | Cost-control | The system SHALL enforce user-set per-run and per-day spend caps and a per-run step budget; on breach it SHALL pause and require explicit continue. | Hard stop at configured cap; 0 silent overruns. | BYO-key cost on user; FR-AGENT-9; FR-SET-1. |
| NFR-COST-2 | Cost-control | Token + dollar cost SHALL be displayed live per run and aggregated per day. | Cost visible within ≤1 s of each call completing. | Success metric #4; FR-LLM-10. |
| NFR-COST-3 | Cost-control | The system SHALL default to cheaper tiers (Nano/Flash-Lite) for small/bulk tasks and reserve Pro for hard requests. | Default routing favors cheapest viable model. | `03` §8 tiered fallback. |
| NFR-MAINT-1 | Maintainability | New code SHALL be TypeScript (ES modules), with typecheck + lint + tests in CI (fixing MicroLabs' no-tests/CI gap). | CI green required to merge; meaningful test coverage on agent loop + gate. | Locked #9 fix; CLAUDE.md workflow. |

---

## 3. Data Requirements

| Data Entity | Source | Format | Volume | Privacy | Storage |
|-------------|--------|--------|--------|---------|---------|
| Gemini/provider API key(s) | User paste (onboarding/settings) | String secret, keyed by provider | A few keys | Highly sensitive; never to disk/page/logs | `chrome.storage.session` (in-memory only) |
| User profile | User input (settings) | JSON (name, role, prefs) | <10 KB | Personal; local | `chrome.storage.local` |
| App configs (Tier-1) | Built-in, AI-generated, imported | Declarative JSON (`inputsSchema`, `promptTemplate`, `pipeline`, `allowedTools`, `outputRenderer`, `requiredHosts`, `schemaVersion`) | 10s–100s of apps | Shareable data; validated | `chrome.storage.local` / IndexedDB |
| Tier-2 app code | AI-generated / user-supplied | JS string run only in sandbox | Rare | Untrusted; sandboxed | IndexedDB; executed in sandbox iframe |
| Skills | Promoted runs, authored, imported | JSON (`id,name,description,trigger,systemPrompt,allowedTools,inputs,outputSchema,steps`) | 10s–100s | Shareable; consent on import | IndexedDB / `storage.local` |
| Workflows | Skill + trigger | JSON (skill ref + `trigger`) | 10s | Shareable | IndexedDB; schedule via `chrome.alarms` |
| Model/provider registry | Bundled default + in-app edits + signed remote | JSON (`providers{}`, `models{}`, `schemaVersion`, capabilities, pricing) | <100 KB | Non-secret data (keys stored separately) | `chrome.storage.local` (cache for offline) |
| Agent run scratchpad | Agent runtime | JSON (intermediate results, action history, provenance) | KB–low MB per run | Local; may hold page-derived data | IndexedDB (per-run, resumable) |
| Run history | Completed runs | JSON (steps, model/cost, confirmed actions, outcomes) | Grows over time; cap/prune | Local; user-clearable | IndexedDB (`unlimitedStorage`) |
| Cross-session memory (learned site flows) | Agent observations | JSON keyed by site/task | Low MB | Local | IndexedDB |
| Page context cache | PageContext service | Distilled DOM / parsed structures | Transient, per page | Untrusted page content; ephemeral | In-memory / short-lived IndexedDB cache |
| Generated/edited images | Imagen/Nano Banana + Canvas | PNG/JPEG/WebP | MBs each | User content | In-panel; saved via FSA / downloads |
| Embeddings (optional) | `gemini-embedding-*` over saved pages/runs | Float vectors + metadata | Low MB; grows | Local | IndexedDB |
| File artifacts | `write_file` / Save-to-file | CSV/MD/JSON/etc. | User-defined | In user's chosen folder | FSA root folder (v1) / native host (v2) |
| Spend/usage ledger | Cost meter | JSON (per-run + per-day token/$ totals) | Small | Local | `chrome.storage.local` |

---

## 4. Integration Requirements

| System | Direction | Protocol | Auth | Data Exchanged | Frequency |
|--------|-----------|----------|------|----------------|-----------|
| Google Gemini API | Outbound (from SW) | HTTPS REST (`@google/genai`) + OpenAI-compatible `…/v1beta/openai/chat/completions` | BYO API key (Bearer), from `storage.session` | Prompts, page-derived context, function declarations/calls, structured output, images; usage/token counts back | Per LLM call (interactive + scheduled) |
| Gemini Live API | Bidirectional | WebSocket | BYO key | Streaming audio in / transcript or audio out | During voice/STT sessions (offscreen/content ctx) |
| Gemini Nano (on-device) | Local | Chrome Built-in AI (`LanguageModel`/`Summarizer`/`Translator`) | None | Short prompts in / text out; no network | Per small/private task (content/offscreen) |
| OpenAI-compatible providers | Outbound (from SW) | HTTPS REST (chat/completions) via bundled adapter | User key per provider; host via `optional_host_permissions` | Same shape as Gemini-OpenAI | Per call when provider selected |
| Webhooks (Slack / Notion / Zapier / custom) | Outbound | HTTPS POST | Per-integration (token/URL secret) | Run results, payloads to external systems | Per `send_webhook` step (gated by HITL) |
| Remote model-registry config (CDN) | Inbound | HTTPS fetch | None (payload signed Ed25519/JWS) | Signed registry JSON (models/providers/pricing) | SW start + daily `chrome.alarms` poll |
| Tier-1 app/skill catalog (CDN) | Inbound | HTTPS fetch | None | Declarative app/skill config JSON | On browse/import (consent on import) |
| File System Access (browser) | Bidirectional (local) | FSA API (`showDirectoryPicker`) | User gesture grant | File read/write in chosen root folder | Per file op; first op triggers pick |
| Native messaging host (v2) | Bidirectional (local) | Native messaging stdio | OS-level (installed binary) | Prompt-free file read/write | v2 only |
| Target web pages | Bidirectional (local) | `chrome.scripting` / `chrome.debugger` (CDP) / `captureVisibleTab` | activeTab / scoped host perms | DOM read, synthetic events, screenshots | Per agent/app browser action |

---

## 5. Constraints

| Constraint | Type | Impact | Source |
|------------|------|--------|--------|
| Chrome Web Store remote-code ban (no fetch-and-eval, no remote `<script>`/WASM, no interpreter for fetched commands). | Platform/Compliance | All extensibility (skills, workflows, app configs, registry) must be declarative data; generated code only in bundled sandbox. | `07` bright line; locked #8; anti-goal #3. |
| MV3 service worker is stateless and idles out (~30 s). | Platform | Every agent step must checkpoint and be resumable from IndexedDB/`storage`; long/audio/DOM work needs an offscreen doc. | `04` §1; design rule #1. |
| `chrome.sidePanel` cannot be force-opened programmatically. | Platform | "Always-on" achieved via global panel + pin + keyboard command + action-click, not auto-launch. | `04` §9; locked #7; FR-UI-4. |
| `chrome.debugger`/CDP shows an un-hideable "extension is debugging this browser" banner. | Platform/UX | Use DOM-first synthetic events by default; CDP only when necessary; warn the user. | `04` §3; FR-BC-2/3. |
| CAPTCHAs, bot-detection, `chrome://`, Web Store pages, unauthorized cross-origin iframes are uncircumventable. | Platform/Legal | Agent detects, pauses, and hands control to the human; never attempts to defeat. | `04` §3; anti-goal #4; FR-HITL-8. |
| Gemini Nano unavailable in service/web workers; needs ~16 GB RAM/>4 GB VRAM, ~22 GB disk, Chrome 138+. | Platform/Hardware | On-device path runs in content/offscreen with feature detection and mandatory cloud fallback. | `03` §6; FR-LLM-8. |
| Gemini Nano tiny context (~1,024 tok/prompt; <500 in / <200 out rule). | Platform | On-device limited to summarize/classify/rewrite/short-extract; not long-doc/heavy reasoning. | `03` §6. |
| Computer Use, several preview models, and pricing/lineup are outside our control and drift fast (paid-only since 2026-04-01). | External/Cost | Signed remote-updatable registry + tiered fallback decouple from model churn. | `03` intro/§5/§7; `07` §B. |
| File System Access API: initial pick needs a user gesture; persistence may require per-session re-grant. | Platform/UX | First file op triggers pick; re-request grant when required; native host deferred to v2. | `04` §2; locked #4. |
| BYO Gemini key shifts LLM cost to the user. | Business/UX | Onboarding friction; mandatory spend/step caps + live cost display to prevent runaway bills. | Vision premise #5; NFR-COST-*. |
| Web Store review is binary and can block launch entirely. | Business/Gatekeeper | Compliance posture (data-not-code, scoped/optional perms, sandbox, single-purpose framing) is launch-gating. | Vision gatekeepers; success metric #7. |
| Industry-wide ~1-in-4 complex-flow failure rate (the unsolved reliability frontier). | Product Risk | VMSTCR is the make-or-break metric; plan preview + gate + `ask_user` + partial completion turn silent failure into visible decisions. | `05`; vision premise #2 (highest risk). |
| Free-tier Gemini prompts may be used for training. | Privacy/Legal | Disclose; recommend paid tier for sensitive use. | `03` §7; NFR-PRIV-4. |
| New wire protocol (non-OpenAI/Anthropic/Gemini-native) requires a shipped bundled adapter update. | Platform | Only true code-update case for the registry; everything else is a data edit. | `07` §B/net effect. |

---

*End of requirements specification.*
