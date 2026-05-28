# App Builder Blueprint — Declarative Spec Grammar (Tier-3 Hybrid)

> Status: Approved after adversarial design review. Decision: build the **HYBRID** — a
> declarative UI-spec grammar (Concept 3) as the spine, plus **read-only ToolActions**
> and the existing **value-return sandbox** for pure transforms. Freeform codegen +
> visible-DOM sandbox (C1) and consequential/imported tool actions are **deferred**.
> Model default = **Gemini Flash + validate-and-repair**; Opus 4.8 is an **optional,
> user-keyed upgrade only** (new Anthropic adapter, never a default or dependency).
>
> Honest framing: this is a **"prompt-app builder with light data tools,"** NOT a
> "Lovable-like" freeform UI generator. The widget grammar is a **documented boundary**,
> not a temporary limitation.

---

## 1. Executive Summary

**Problem.** Users want to describe a small tool in natural language and get a usable
"app" inside Chrome Buddy, but MV3's no-remote-code-execution rule and the Web Store
review bar make a Lovable-style "generate arbitrary UI + DOM" approach a non-starter —
rendering model-authored DOM recreates phishing, spoofing, and keystroke-capture risk on
an extension surface that already holds page-read and network capabilities.

**Chosen approach.** Ship a closed, host-rendered **declarative spec grammar**: the model
emits validated JSON describing a fixed set of input widgets, output widgets, and a small
set of typed actions (`LlmAction`, `ToolAction` restricted to read-only tools, and an
optional pure `ExprAction`); the host renders only known widget types — never untrusted
DOM — and routes actions through the existing `LLM_GENERATE` and `TOOL_EXEC` paths with
HITL preserved.

**Why it won.** Concept 3 scored highest (47) in the evaluation because it delivers the
"describe-it, get-an-app" experience while staying inside MV3/Web-Store constraints, reuses
almost all existing infrastructure (`apps/*`, `tools/registry.ts`, `llm/instance.ts`,
sandbox value-return, workflow export/import), and converts the central security wall into
a *feature* (a documented, auditable boundary) rather than fighting it.

**Key risk + mitigation.** The dominant risk is the **expressiveness cliff** — the median
request (kanban, canvas, chart, editable table) falls outside the grammar, so a naive build
would either fake those widgets (dangerous, dishonest) or feel broken; mitigation is an
explicit "**this grammar can't do that**" UX backed by a capability manifest, plus a layered
budget/loop/consent/sanitizer defense (Phase 0 + Phase 4) so that every dynamic surface
(LLM calls, tool calls, markdown output, imports) is bounded, consent-gated, and sanitized
before anything ships.

---

## 2. Concepts Explored

| # | One-line description | Why considered | Decision | Eval score |
|---|----------------------|----------------|----------|------------|
| **C0** | Status quo: Tier-1 `{name,inputs,promptTemplate}` form + Tier-2 value-return code app (`src/apps/build.ts`) | Already shipped, MV3-safe, zero new risk | **Kept as substrate** — Tier-1 is the degenerate case of the new grammar; Tier-2 sandbox reused for `ExprAction` | baseline |
| **C1** | Freeform codegen rendering model-authored DOM in a visible sandbox iframe ("Lovable-like") | Maximum expressiveness; matches user mental model | **Rejected / deferred** — needs `unsafe-eval` + `allow-same-origin` on a *visible* surface = phishing/keystroke/spoof risk; fails Web-Store review intent | 22 |
| **C2** | Multi-step "flow" apps: chain LLM + tool steps with branching (workflow-like) | Composability; covers automations the grammar alone can't | **Deferred (post-MVP)** — fold in later as a `flow` action kind reusing `src/workflows/*`; depth/loop budget required first | 38 |
| **C3** | Declarative UI-spec grammar: fixed widgets + typed actions, host-rendered, no untrusted DOM | Expressive enough for prompt-apps + light data tools; stays inside MV3; reuses all infra | **SELECTED (spine)** | 47 |
| **Hybrid** | C3 spine + read-only `ToolAction` (today, via `TOOL_EXEC`) + value-return sandbox for pure `ExprAction`; C2 flow + Opus adapter later | Ships honest value early, leaves a clean extension path | **BUILD THIS** | — |

---

## 3. Architecture

### 3.1 The new AppConfig discriminator

The existing `AppConfig` (`src/apps/types.ts`) gains a third kind. Tier-1/Tier-2 stay as
legacy fields so already-saved apps keep loading. Bump `APP_SCHEMA_VERSION 1 → 2` and add
a grammar-internal `specVersion` so the *grammar* can evolve independently of the envelope.

```ts
// src/apps/types.ts  (additions)
export const APP_SCHEMA_VERSION = 2;       // envelope (store shape) version
export const APP_SPEC_VERSION = 1;         // declarative-grammar version

export interface AppConfig {
  id: string;
  name: string;
  description: string;
  inputs: AppInput[];                      // legacy Tier-1/2 still use this
  tier?: 1 | 2 | 3;                        // 3 = declarative spec
  kind?: 'form' | 'code' | 'spec';         // discriminator; 'spec' => tier 3
  // tier 1
  promptTemplate?: string;
  // tier 2
  code?: string;
  permissions?: string[];
  // tier 3 (NEW)
  spec?: AppSpec;
  reviewed?: boolean;                      // false on import; true after first confirmed run
  createdAt: number;
}
```

### 3.2 The declarative grammar (`src/apps/spec/schema.ts`)

A spec is **pure data**: a list of input widgets, a list of output widgets, and a list of
typed actions wired by id. The host renderer knows every widget type at compile time — the
model can only *select and parameterize* them, never inject markup.

```ts
export interface AppSpec {
  specVersion: number;                     // APP_SPEC_VERSION at author time
  inputs: InputWidget[];                   // <= 8
  actions: Action[];                       // <= 6, run in declared order on "Run"
  output: OutputWidget[];                  // <= 8
  sampleInputs?: Record<string, string>;   // model-emitted smoke-run values (C3-5)
}

// ---- Input widgets (closed set) ----
export type InputWidget =
  | { id: string; kind: 'text';     label: string; placeholder?: string }
  | { id: string; kind: 'textarea'; label: string; placeholder?: string }
  | { id: string; kind: 'number';   label: string; min?: number; max?: number }
  | { id: string; kind: 'select';   label: string; options: string[] }
  | { id: string; kind: 'checkbox'; label: string };

// ---- Actions (closed set) ----
export type Action = LlmAction | ToolAction | ExprAction;

export interface LlmAction {
  id: string;
  kind: 'llm';
  promptTemplate: string;                  // {{inputId}} and {{actionId}} refs
  jsonMode?: boolean;
  outId: string;                           // which output widget receives the result
}

export interface ToolAction {
  id: string;
  kind: 'tool';
  tool: ReadOnlyTool;                      // RESTRICTED — see 3.4
  args: Record<string, string>;            // {{...}} templated, validated per-tool schema
  outId: string;
}

export interface ExprAction {              // pure transform, NO bridge (see 3.5)
  id: string;
  kind: 'expr';
  expr: string;                            // body of (ctx) => value; pure JS only
  outId: string;
}

// ---- Output widgets (closed set; host renders, never raw HTML) ----
export type OutputWidget =
  | { id: string; kind: 'markdown' }       // sanitized — see 3.6
  | { id: string; kind: 'text' }
  | { id: string; kind: 'json' }           // pretty-printed read-only tree
  | { id: string; kind: 'table'; columns: string[] }  // rows: string[][] only
  | { id: string; kind: 'copyButton'; sourceOutId: string };

// Read-only tools the grammar may name (day-one subset):
export type ReadOnlyTool =
  | 'read_dom' | 'extract' | 'search_web' | 'search_library';
```

**Honest boundary (C3-1).** There is deliberately no `chart`, `canvas`, `kanban`,
`draggable`, `editableGrid`, or `iframe` widget. The validator (3.7) rejects unknown
`kind`s and the build UI surfaces a literal message: *"This builder makes form-and-output
apps. It can't make a [kanban/chart/canvas] — try describing the data you want instead."*
We **never** approximate a chart/kanban as a `table`.

### 3.3 Host renderer — NO untrusted DOM

`src/apps/spec/SpecAppView.tsx` is a normal React component. It `switch`es on each widget's
`kind` and renders a **fixed, app-authored** component per case. The model's spec only fills
props (`label`, `placeholder`, `options`, `columns`). There is:

- **No `dangerouslySetInnerHTML`** except inside the markdown widget, which renders through
  the hardened sanitizer (3.6) — never the model's raw string.
- **No `eval`/`new Function`** in the render path. `ExprAction` (if kept) runs only in the
  opaque-origin sandbox iframe (3.5), never in the panel.
- **No model-supplied URLs, event handlers, or styles.** `table` rows are coerced to
  `string[][]`; `json` is rendered as a read-only tree.

This is what answers the CRITIC's central wall: rich-feeling UI without rendering untrusted
DOM, because the *vocabulary* is closed and host-owned.

### 3.4 ToolAction routing (read-only, via existing TOOL_EXEC)

Read-only tools already **execute** today through the background SW (`src/background/pageTools.ts`,
`search.ts`, `fileSearch.ts`) via `{ type:'TOOL_EXEC', tool, args }` — the in-process
`notWired()` handlers in `src/tools/defs.ts` are stubs, but the SW path is live. So:

- The runner builds a `ToolContext` and calls the SW path for the **read-only subset only**
  (`read_dom`, `extract`, `search_web`, `search_library`).
- Gating reuses `evaluateGate` (`src/tools/registry.ts`): the app's `allowedTools` is the
  spec's set of named tools; read-only tools are `consequential:false` so they pass without
  HITL, but **per-run consent + rate caps (Phase 0) still apply** because the app holds a
  page-read / network capability.
- **Consequential tools (`send_webhook`, `github_write`, `write_file`) are NOT addable to a
  spec in v1.** If a locally-authored app later needs one, it routes through the **existing
  HITL** (`needs-confirmation` → approve), and the HITL dialog must render **full args**
  (C3-3). Imported apps can **never** carry a consequential tool (3.8).

### 3.5 ExprAction purity (C3-2) — defend in code or drop

`ExprAction` reuses the existing value-return sandbox (`src/sandbox/host.ts` →
`sandbox.html`, opaque origin, `allow-scripts`, **no** `allow-same-origin`, `unsafe-eval`
scoped to that frame only). Purity is enforced, not promised:

1. **No bridge.** `runInSandbox(expr, ctx, { capabilities: [], onBridge: undefined })` — an
   `ExprAction` is invoked with an empty capability set, so `bridge.*`/network/LLM calls
   resolve to *"capability not available."*
2. **Static deny-list** at validation time: reject `expr` containing `await`, `fetch`,
   `import`, `XMLHttpRequest`, `WebSocket`, `bridge`, `postMessage`, backtick-`${`-template
   side channels into globals — pure-transform vocabulary only.
3. **Wall-clock + output-size cap** from the Phase-0 budget (per-run budget, not per-round-trip).
4. **Fallback rule:** if any of the above cannot be enforced for a given build target, the
   feature is **dropped** and the model is instructed to express the transform as an
   `LlmAction` instead. (Decision gate lives in Phase 3 validation.)

### 3.6 Output sanitizer (C3-6)

`src/apps/spec/sanitize.ts` (new, pure, unit-tested). The `markdown` widget renders model
output through it: allow a small tag/attribute allowlist (headings, lists, code, bold/italic,
links with `href` only); **block** `javascript:`/`data:` hrefs, `<img>` auto-load (render as
a click-to-load placeholder or strip), inline `<script>`/`<style>`, event-handler attrs, and
raw HTML passthrough. A `<meta>`/CSP-equivalent constraint is enforced by the React render
surface (no `srcdoc`, no inline handlers). This blocks prompt-injection-via-output exfiltration.

### 3.7 Validate-and-repair build loop (C3-5)

`src/apps/spec/validate.ts` (pure) + `src/apps/spec/buildSession.ts` (orchestration).

```
user NL prompt
  └─ generateViaBackground({ system: SPEC_BUILDER_SYSTEM, jsonMode:true, responseSchema })
       (default model: gemini-3.5-flash; OPTIONAL user-keyed Opus 4.8 upgrade)
  └─ parseAppSpec(json) -> structural validate -> action/widget ref check -> ExprAction purity
       ├─ valid?  -> SMOKE RUN with spec.sampleInputs (real LLM/tool calls, budget-capped)
       │             └─ render one real output -> USER must CONFIRM it before save
       └─ invalid -> append validator errors to the conversation, REPAIR
                     (max 3 iterations; then surface failure honestly — no infinite loop)
```

- `responseSchema` is passed to the adapter. **Prereq:** `responseSchema` is still a TODO in
  `src/llm/adapters/geminiNative.ts`; the OpenAI-compat adapter (`registry.default.ts`,
  default `gemini-3.5-flash`) already supports `jsonMode`/`responseSchema`, so the default
  path works — wire `responseSchema` in the native adapter as a small Phase-0/1 prereq.
- The model self-validates *structure*, but **semantic correctness is confirmed by the
  human**: the model emits `sampleInputs`, the runner does one real smoke run, and **the user
  must approve the actual output** before the app is saved (`reviewed:true`). The repair loop
  is hard-capped at ~3 iterations to prevent "grades-its-own-homework" infinite repair.

### 3.8 Export / import (reuse workflow + skills patterns)

New `toAppBundle` / `parseAppBundle` in `src/apps/build.ts` mirror
`toWorkflowBundle`/`parseWorkflowBundle` (`src/workflows/build.ts`): schema-versioned
envelope `{ schemaVersion, specVersion, apps }`, drop-bad-entries on parse. Consent reuses
`reviewImport`/`KNOWN_TOOLS` shape (`src/skills/edit.ts`).

- On import, **force `reviewed:false`** (verbatim rule from skills/workflows).
- **Visible downgrade, never silent skip (C3-4):** if `bundle.specVersion >` local
  `APP_SPEC_VERSION`, the importer reports *"3 of 20 features can't run in this version"* and
  lists them; it does not silently drop widgets.
- **Imported apps may carry only read-only ToolActions.** Any consequential tool in an
  imported spec is stripped + flagged (C3-3 / C2-4 — structural re-validation is consent
  theater for *arguments/effects*, so consequential effects are disabled in imports until an
  args-visible per-tool authorization UX exists).

### 3.9 Budgets, loop detection, consent (cross-cutting — C3-7 / C2-5)

`src/apps/spec/runtime.ts` enforces a **per-run budget object** carried through every action:
`{ wallClockMs, maxLlmCalls, maxToolCalls, maxOutputBytes, depth }`. Loop detection trips on
repeated identical (action,args) signatures. `call_skill`/future-`flow` depth is capped. The
budget is the importer's protection against a malicious bundle running up their LLM bill on
their own key (billing-DoS).

### 3.10 Data flow

```
AppsView (build)  ── NL ──▶ buildSession ──▶ generateViaBackground(LLM_GENERATE) ──▶ SW ──▶ model
                                  │  ◀── spec JSON ──
                                  ├─ validate.ts (structure + refs + ExprAction purity)
                                  ├─ smoke run (sampleInputs) ─▶ runtime.ts (budgeted)
                                  └─ USER confirms output ─▶ store.ts (IDB 'apps', reviewed:true)

SpecAppView (run) ── user inputs ──▶ runtime.ts (budget) ──▶ per action:
      LlmAction   ─▶ generateViaBackground(LLM_GENERATE) ─▶ SW ─▶ model
      ToolAction  ─▶ {type:'TOOL_EXEC',tool,args} ─▶ SW (pageTools/search/fileSearch)  [read-only]
      ExprAction  ─▶ runInSandbox(expr, ctx, {capabilities:[]})  [pure, no bridge]
                          └─ outputs ─▶ closed widgets (markdown via sanitize.ts)
```

### 3.11 Integration points (real files)

- **Schema/builders:** `src/apps/types.ts` (discriminator + version bumps), `src/apps/build.ts`
  (add `SPEC_BUILDER_SYSTEM`, `parseAppSpec`, `toAppBundle`/`parseAppBundle`; keep Tier-1/2).
- **New spec module:** `src/apps/spec/{schema.ts,validate.ts,sanitize.ts,runtime.ts,buildSession.ts,SpecAppView.tsx}`.
- **Store:** `src/apps/store.ts` (IDB `apps`, SW-owned) — add migration `v1→v2` (default
  `kind:'form'` for legacy rows). `src/apps/request.ts` `APP_SAVE/LIST/DELETE` unchanged.
- **Sandbox:** `src/sandbox/host.ts` (Phase-0 budget fix), reused for `ExprAction`.
- **Tools:** `src/tools/registry.ts` `evaluateGate` (reused), `src/background/pageTools.ts`/
  `search.ts`/`fileSearch.ts` (read-only `TOOL_EXEC` targets).
- **LLM:** `src/llm/instance.ts` `generateViaBackground`; `src/llm/adapters/geminiNative.ts`
  (`responseSchema` prereq); new optional `src/llm/adapters/anthropic.ts` (Phase 5, Opus).
- **View wiring:** `src/views/AppsView.tsx` (replace one-shot `generate()` with `buildSession`),
  export/import wiring mirrors `src/views/StubViews.tsx` SkillsView.

---

## 4. Implementation Roadmap

Sequenced so something **honest ships early**: Phase 0 closes the two MUST-carry safety
holes; Phase 1 ships a real declarative app (LLM-only, no tools) that already beats Tier-1;
tools, output polish, and the Opus upgrade layer on after.

### Phase 0 — Pre-build safety fixes (MUST land first) — **S**
*What:* (1) Fix the never-times-out bridge loop in `host.ts`: add a **per-run wall-clock
budget** + a **bridge-call count cap**, replacing the refresh-on-every-round-trip that lets
a working-but-runaway app live forever. (2) Add a reusable **per-run consent + rate-cap**
primitive (`runtime.ts` budget object) for any app holding a network/LLM capability.
*Files:* modify `src/sandbox/host.ts`; create `src/apps/spec/runtime.ts` (budget + loop
detector, pure).
*Validation:* unit test proving a bridge that returns instantly in a tight loop is killed by
wall-clock/count cap; existing `run.test.ts` still passes; a legit slow single LLM call
still completes.
*Size:* S.

### Phase 1 — Spec grammar + host renderer, LLM-only (no tools) — **M**
*What:* `schema.ts`, `validate.ts`, `parseAppSpec`, `SPEC_BUILDER_SYSTEM`, `SpecAppView.tsx`
(input + output widgets, `LlmAction` only), `AppConfig` discriminator + `APP_SCHEMA_VERSION
1→2` migration in `store.ts`. Wire `responseSchema` in `geminiNative.ts` (prereq).
*Files:* create `src/apps/spec/{schema.ts,validate.ts,SpecAppView.tsx}`; modify
`src/apps/types.ts`, `src/apps/build.ts`, `src/apps/store.ts`, `src/llm/adapters/geminiNative.ts`.
*Validation:* generate a "summarize text" + "rewrite tone" spec app, run end-to-end via
`generateViaBackground`; legacy Tier-1 apps still load (migration test).
*Size:* M.

### Phase 2 — Build session: validate-and-repair + confirm-before-save — **M**
*What:* `buildSession.ts` (3-iteration repair cap, then honest failure), smoke run with
`sampleInputs`, **user-confirms-one-real-output** gate before `reviewed:true`. Replace
one-shot `generate()` in `AppsView.tsx`. Expressiveness-cliff UX ("can't make a chart").
*Files:* create `src/apps/spec/buildSession.ts`; modify `src/views/AppsView.tsx`,
`src/apps/build.ts`.
*Validation:* a malformed-then-repaired spec succeeds within 3 tries; a hopeless prompt
fails honestly (no infinite loop); a kanban request gets the boundary message, not a fake table.
*Size:* M.

### Phase 3 — Read-only ToolActions + ExprAction — **M**
*What:* `ToolAction` for `read_dom`/`extract`/`search_web`/`search_library` via `TOOL_EXEC`
+ `evaluateGate`, under the Phase-0 budget/consent. `ExprAction` purity (deny-list + no-bridge
sandbox run); **decision gate**: if purity can't be enforced for the build target, drop
`ExprAction` and fold into `LlmAction`.
*Files:* modify `src/apps/spec/{schema.ts,validate.ts,runtime.ts,SpecAppView.tsx}`; reuse
`src/tools/registry.ts`, `src/background/pageTools.ts`, `src/sandbox/host.ts`.
*Validation:* an "extract page title + summarize" app runs read-only tools with per-run
consent + rate cap; an `ExprAction` containing `fetch`/`await` is rejected at validation; a
pure `ExprAction` runs with empty capabilities.
*Size:* M.

### Phase 4 — Output sanitizer + export/import + import downgrade — **M**
*What:* `sanitize.ts` (markdown hardening — block `javascript:`/`data:`/img-autoload/raw
HTML/event attrs). `toAppBundle`/`parseAppBundle` mirroring workflows; consent screen reusing
`reviewImport` shape; **force `reviewed:false`**; **visible specVersion downgrade**; strip +
flag consequential tools in imports.
*Files:* create `src/apps/spec/sanitize.ts`; modify `src/apps/build.ts`, `src/views/AppsView.tsx`
(import/export wiring mirroring SkillsView in `src/views/StubViews.tsx`).
*Validation:* injected `<img onerror>` / `javascript:` link in markdown output is neutralized;
importing a higher-`specVersion` bundle shows "N of M features can't run"; imported
consequential tool is stripped + flagged.
*Size:* M.

### Phase 5 — Optional Opus 4.8 upgrade (user-keyed) — **S/M**
*What:* New Anthropic adapter so a user with their own Anthropic key can opt into Opus 4.8
for *build-time generation only*. Strictly optional — never a default, never a runtime
dependency; absence of a key silently keeps Gemini Flash.
*Files:* create `src/llm/adapters/anthropic.ts`; register in `src/llm/registry.default.ts`
(user-registry overlay), key under `apiKey:anthropic` in `chrome.storage.session`.
*Validation:* with no Anthropic key, builder uses Flash unchanged; with a key, Opus path
generates a valid spec; key never leaves the SW.
*Size:* S/M.

### Phase 6 (Deferred) — C2 flow actions
Multi-step branching as a `flow` action kind reusing `src/workflows/*`, behind the existing
depth/loop budget (`call_skill`/`flow` depth cap). Not in MVP.

---

## 5. Test Specifications

### 5.1 Unit — spec validator / repair (`validate.test.ts`, `buildSession.test.ts`)
- Rejects unknown widget `kind` (e.g. `chart`, `kanban`, `iframe`) → returns boundary error.
- Rejects an `outId`/`{{ref}}` that points at a non-existent widget/action.
- Enforces caps (≤8 inputs, ≤6 actions, ≤8 outputs); over-cap is trimmed/rejected, not silently kept.
- Repair loop stops at exactly 3 iterations and returns an honest failure (no infinite repair).
- Confirm-before-save: spec is **not** persisted with `reviewed:true` until a real output is confirmed.

### 5.2 Unit — action budget / loop guard (`runtime.test.ts`) (C3-7 / C2-5)
- Wall-clock budget kills a tight bridge loop that returns instantly each round-trip (the
  never-times-out regression).
- `maxLlmCalls` / `maxToolCalls` caps trip and abort the run with a clear error.
- Loop detector trips on repeated identical (action,args) signatures.
- `maxOutputBytes` truncates/aborts oversized output.

### 5.3 Unit — ExprAction purity (`validate.test.ts`) (C3-2)
- Deny-list rejects `await`, `fetch`, `import`, `XMLHttpRequest`, `WebSocket`, `bridge`,
  `postMessage`.
- A pure expr runs in the sandbox with **empty capabilities**; a `bridge.gemini(...)` call
  inside an expr resolves to "capability not available."

### 5.4 Unit — import downgrade + consequential strip (`build.test.ts`) (C3-3/C3-4/C2-4)
- Bundle with `specVersion > APP_SPEC_VERSION` produces a **visible** "N of M features can't
  run here" list; nothing silently dropped.
- Import forces `reviewed:false`.
- A consequential tool (`send_webhook`/`github_write`/`write_file`) in an imported spec is
  stripped and flagged; only read-only tools survive.

### 5.5 Unit — sanitizer (`sanitize.test.ts`) (C3-6)
- `<img src=x onerror=...>` neutralized; `<a href="javascript:...">` stripped; `data:` href
  blocked; inline `<script>`/event-handler attrs removed; raw HTML passthrough disabled;
  `![](http://attacker/leak?...)` does not auto-load.

### 5.6 E2E (Playwright, Chrome Buddy style — load extension, drive side panel, screenshot)
- **Happy path:** describe "summarize pasted text," builder generates a spec, smoke run shows
  real output, user confirms, app saves and re-runs. Screenshot each step (per project rule).
- **Expressiveness cliff (C3-1):** ask for a kanban board → builder shows the boundary message,
  does **not** render a fake table. Screenshot.
- **Read-only tool app (C2-1):** "extract this page's headings + summarize" runs `extract` +
  `summarize` via `TOOL_EXEC` with a per-run consent prompt + rate cap. Screenshot consent.
- **Injection via output (C3-6):** an app whose LLM output contains a `javascript:` link /
  `onerror` img renders inert.
- **Import downgrade (C3-4):** import a higher-`specVersion` bundle → visible downgrade list.
- **Budget/loop (C3-7):** a spec engineered to loop is aborted with a clear error, panel stays
  responsive.
- **Regression:** legacy Tier-1/Tier-2 apps still load + run after the `v1→v2` migration
  (internal-only-change live regression, per project rule).

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| C3-1 Expressiveness cliff is the *median* request | High | High | Honest "this builder makes form-and-output apps" framing; capability manifest; explicit "can't make a chart/kanban" UX; never fake a widget |
| C3-2 ExprAction can't be kept pure | Medium | High | No-bridge invocation + static deny-list + wall-clock/output caps; **drop ExprAction → LlmAction** if unenforceable (Phase-3 gate) |
| C3-3/C2-4 Import re-validation is structural, not effect-aware (consent theater) | High | High | Disable consequential tools in imports; HITL dialog renders **full args**; consequential effects deferred to args-visible authorization UX |
| C3-4 Version drift silently breaks imports | Medium | Medium | `specVersion` from day one; **visible downgrade** report, never silent skip |
| C3-5 Validate-repair grades own homework / infinite repair | Medium | High | 3-iteration cap then honest failure; **user confirms one real output** before save |
| C3-6 Prompt-injection via markdown output | Medium | High | Hardened sanitizer + render-surface CSP; block `javascript:`/`data:`/img-autoload/raw HTML |
| C3-7/C2-5 LlmAction loop / recursion / billing-DoS on importer key | Medium | High | Per-app/per-run LLM+tool+wall-clock budget; loop detection; `call_skill`/`flow` depth cap |
| Never-times-out bridge loop wedges panel | High (existing bug) | High | Phase-0 per-run wall-clock + bridge-call count cap in `host.ts` (not per-round-trip refresh) |
| C2-1 Read-only tool still leaks page data without consent | Medium | Medium | Per-run consent + rate caps even for non-consequential tools holding page/network capability |
| Web-Store review rejects the feature | Low | High | No `unsafe-eval` outside the existing opaque-origin sandbox; no untrusted DOM; closed grammar is auditable |
| Opus path silently becomes a dependency | Low | Medium | Opus is opt-in, user-keyed, build-time only; absence of key silently falls back to Flash |

---

## 7. Open Questions (validate during implementation)

1. **ExprAction keep-or-drop:** does the static deny-list + no-bridge run actually hold under
   the chosen build target, or do we drop it in Phase 3? (Decision gate — measure, don't assume.)
2. **Action chaining refs:** is letting `LlmAction.promptTemplate` reference a prior
   `{{actionId}}` output worth the added validation/loop surface in v1, or restrict actions to
   reference inputs only?
3. **`responseSchema` in `geminiNative.ts`:** confirm the native adapter's schema enforcement
   matches the OpenAI-compat path so the default Flash build is reliable without Opus.
4. **Per-run consent UX granularity:** one consent per app-run vs. per-tool-per-run for
   read-only tools — what's the least annoying that's still honest about page/network access?
5. **Budget defaults:** concrete numbers for `wallClockMs` / `maxLlmCalls` / `maxToolCalls` /
   `maxOutputBytes` that cover real apps without enabling billing-DoS on an importer's key.
6. **Migration safety:** any saved Tier-2 code apps that should be re-`reviewed:false` on the
   `v1→v2` bump, or is leaving their `reviewed` flag intact correct?
