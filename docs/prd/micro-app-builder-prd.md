# Product Requirements Document: Micro-App Builder (Tier-3 Sandbox-UI Apps)
*Generated: 2026-05-28*
*Based on: `docs/blueprints/app-builder-blueprint.md` (approved after adversarial review) + the shipped Tier-1/Tier-2 app substrate (`src/apps/*`, `src/sandbox/*`, `src/views/AppsView.tsx`)*

## 0. Premises & Settled Decisions

- **Verdict: BUILD.** Chrome Buddy already mints user-described tools (Tier-1 prompt apps + Tier-2 value-return code apps). The next demanded step — "describe an app and get a *real little app with its own UI* I can iterate on, save, and share" — is buildable *safely* inside MV3 only if we render the app as **data inside the existing opaque-origin sandbox**, never as fetched-and-eval'd remote code. The benchmark experience is the MicroLabs SVG Icon Generator: a gallery UI, a style picker, batch generation, and vector export — a true micro-application, not a form.
- **The hard constraint is settled, not under debate:** MV3 + Web Store ban remote code execution. We honor it by injecting the app's `html/css/js` into the *static, bundled* `sandbox.html` "player" iframe over `postMessage` — an extension of today's Tier-2 mechanism, which already ships a code string into the opaque-origin frame and runs it via `new Function`. The signed extension bundle is never modified at runtime, and there is no fetch-and-run.
- **An app is DATA, not source.** A micro-app is a JSON record in the existing SW-owned IndexedDB `apps` store. At runtime the host injects its UI into the player iframe; capabilities reach it only through a permission-declared, HITL-gated, rate-capped `postMessage` bridge. Keys stay SW-only in `chrome.storage.session`.
- **Honest framing (carried verbatim from the blueprint posture):** This is *"build a real little app with its own UI and share it"* — a **sandboxed web-tech app with bridge capabilities**, NOT an OS-level app and NOT an arbitrary-network app. The sandbox boundary (no `chrome.*`, no same-origin DOM, no ambient network, no key access) is a **documented feature**, not a temporary limitation.
- **Sharing is user-initiated file export/import only.** A curated remote app store is **explicitly out of scope** — it would reintroduce remote-code-execution and is the one line we do not cross.
- **Builder model:** Gemini Flash is the free default (validate-and-repair). Anthropic Opus 4.8 is an **optional, user-keyed "power builder"** via a new adapter — never forced, never a runtime dependency; absence of an Anthropic key silently keeps Flash.

## 1. Executive Summary

- **Problem:** Chrome Buddy users can describe a tool and get a form-plus-prompt (Tier-1) or a value-returning transform (Tier-2), but they cannot get a *real interactive micro-application with its own custom UI* — a gallery, a picker, a batch runner, an exporter. The mental model is "build me an app like the SVG Icon Generator"; the product currently answers "here is a form." Closing that gap is normally done with Lovable-style arbitrary-DOM codegen, which on an extension surface that already holds page-read and network capability recreates phishing/spoofing/keystroke-capture risk and fails Web Store review intent.
- **Solution:** A conversational **Micro-App Builder** that turns a natural-language description into a true micro-app rendered inside the existing opaque-origin sandbox "player" iframe. The user builds it conversationally — *describe → live preview → iterate/test/improve → save → deploy to the apps grid* — and can export/import apps as JSON to share. The app is stored as data, runs in hard isolation, and reaches capabilities (gemini, image, download, app-scoped storage, read-only page) only through a HITL-gated, rate-capped bridge.
- **Target user:** The existing Chrome Buddy power user (browser-resident knowledge worker, tinkerer) who already mints Tier-1/Tier-2 tools and now wants tools with real UI they can share with a teammate as a file.
- **Key differentiator:** A *true custom-UI micro-app* delivered with MV3-grade isolation, key custody, and an auditable capability bridge — the "make your own little app" experience without the remote-code, ambient-network, or spoofing risk that the obvious approach carries.
- **The narrowest wedge (build FIRST):** A *visible* sandbox-UI runtime that renders a host-shipped, data-stored app inside the player iframe, framed by persistent Chrome Buddy chrome and a "sandboxed app" badge, proven by re-creating the **SVG Icon Generator** end-to-end (gallery, style picker, batch, vector export via the download bridge). Prove the runtime + one real app is safe and delightful before the conversational builder and sharing layer on top.

## 2. Vision & Scope

**Vision:** *For Chrome Buddy power users who want more than a form, the Micro-App Builder lets you describe an app in plain language and get a real little application — with its own interactive UI and real capabilities — that you build conversationally, test live, save to your apps grid, and share as a file. Unlike Lovable-style generators that render arbitrary untrusted DOM, every micro-app runs as data inside Chrome Buddy's existing opaque-origin sandbox: no chrome APIs, no key access, no ambient network — capabilities arrive only through a permission-declared, HITL-gated bridge. It is honestly a sandboxed web-tech app, not an OS-level or open-network app, and that boundary is the safety story, not a footnote.*

**Goals:**
1. Let a user **describe → preview → iterate → save → deploy** a custom-UI micro-app entirely in-app, conversationally.
2. Match the **SVG Icon Generator** experience class (custom UI, picker, batch, vector export) as the P1 proof.
3. Deliver it **inside the existing sandbox** with zero changes to the signed bundle's execution model and zero remote code.
4. Reach capabilities only through a **declared, HITL-gated, rate-capped bridge** with SW-only keys.
5. Make apps **portable** via user-initiated JSON export/import, with a review gate and capability disclosure on import.
6. Keep the **builder free by default** (Gemini Flash), with **optional user-keyed Opus 4.8** as a power upgrade.

**Non-Goals (what this is NOT):**
1. Not a **remote app store / marketplace** — sharing is file export/import only; a curated remote catalog = RCE and is out of scope.
2. Not an **OS-level or arbitrary-network app builder** — apps are sandboxed web tech reaching only bridge-declared capabilities; no raw `fetch`, no file system beyond the download bridge.
3. Not a **Lovable-style arbitrary-DOM-on-a-trusted-surface** generator — the app UI lives behind the opaque-origin sandbox with persistent Chrome Buddy chrome and a "sandboxed app" badge; it never paints over Chrome Buddy's own UI.
4. Not a **same-origin or key-bearing runtime** — the player iframe has no `allow-same-origin`, no `chrome.*`, and can never read the API key.
5. Not an **auto-trusting importer** — imported apps default to unreviewed; consequential capabilities are never auto-authorized without args-visible consent.
6. Not a **never-times-out runtime** — every run is wall-clock- and call-rate-capped; the existing refresh-on-every-round-trip behavior in `host.ts` is replaced.
7. Not a **replacement for Tier-1/Tier-2** — those remain the substrate; Tier-3 is additive and legacy apps keep loading.

**Primary user:** Chrome Buddy power user / tinkerer. **JTBD:** "Describe a small app with a real UI, watch it work, refine it by talking, save it to my grid, and hand the file to a teammate — trusting it because it runs sandboxed and asks before doing anything consequential." **Switch willingness:** HIGH (they already mint Tier-1/Tier-2 tools).
**Secondary users:** teammates who *receive* a shared app file (import → review → run) without authoring; skill/app authors who want a richer surface than a prompt form.

**North star:** Saved-and-rerun micro-apps per builder (an app is only "real" once it has produced a user-confirmed output and been run again). **Supporting:** build-to-save conversion rate, iterate-loop success rate, import-review completion, capability-consent integrity (100% gated / 0 unauthorized), Opus-upgrade adoption among keyed users.

## 3. Settled Architecture Decisions (non-negotiable inputs)

From `docs/blueprints/app-builder-blueprint.md` (approved after adversarial review) and the shipped substrate. These are inputs to the requirements, not open questions:

1. **Zero remote code (MV3 hard constraint).** App UI/logic is injected as data into the bundled `sandbox.html`; nothing is fetched-and-run. The signed bundle is never modified.
2. **Opaque-origin player iframe.** Reuse the existing sandbox (`src/sandbox/host.ts` → `sandbox.html`): manifest `sandbox` CSP grants `unsafe-eval` + `allow-scripts`, **no `allow-same-origin`** → hard isolation (no `chrome.*`, cannot read the API key, no same-origin DOM, no ambient network).
3. **App-as-data.** Stored as a JSON `AppConfig` (kind `'spec'`, tier 3) in the SW-owned IndexedDB `apps` store; `APP_SCHEMA_VERSION 1→2` envelope bump plus an internal `specVersion` so the grammar can evolve independently.
4. **Capability bridge only.** Capabilities reach the app exclusively through a permission-declared, HITL-gated, rate-capped `postMessage` bridge: `gemini` (text), `image` (`IMAGE_GENERATE` exists), `download`, app-scoped `storage`, read-only `page` (`read_dom`/`extract`). Keys stay SW-only in `chrome.storage.session`.
5. **Builder model policy.** Gemini Flash = free default with validate-and-repair; Opus 4.8 = optional user-keyed adapter (BYO Anthropic key), build-time only, never forced.
6. **Safety rails are first-class (NFRs below):** per-run wall-clock budget + bridge-call/rate caps; persistent Chrome Buddy chrome + "sandboxed app" badge (anti-spoofing); review gate + capability disclosure on import; consequential capabilities never auto-authorized in imports without args-visible consent; spec/app versioning with *visible* downgrade on import; capped validate-repair loop (≤3) + user confirms one real output before save; hardened markdown/output sanitizer.
7. **Honesty boundary.** Position as "a real little app with its own UI you can share"; document that it is a sandboxed web-tech app with bridge capabilities, not OS-level or open-network.

## 4. User Journeys

Four scenarios. The *magic moment* of each is called out, matching the predecessor PRD's convention.

### J1 — Build a micro-app from scratch (the SVG Icon Generator class)
The user opens Apps, taps "Build a micro-app," and types: *"An icon generator: I pick a style — outline, filled, duotone — type a few labels, and it makes an SVG icon for each in a gallery I can download."* The builder (Gemini Flash) emits a spec describing the UI (style picker, label inputs, a results gallery, per-icon download buttons) and its declared capabilities (`image` or `gemini` for vector generation, `download` for export). A **live preview** renders inside the player iframe, framed by persistent Chrome Buddy chrome and a "sandboxed app" badge. The user runs one real generation; the builder shows a real icon in the gallery. The user **confirms that one real output**, and the app saves to the grid. *Magic moment:* you described an app and got a working gallery-UI tool with batch and export — not a form.

### J2 — Iterate, test, and improve conversationally
With the preview open, the user says *"make the gallery 3 columns and add a 'duotone' style"* and *"the download should bundle all icons."* Each turn re-generates the spec, the validator checks it, and the live preview updates; the user re-tests against real output. A malformed turn triggers a capped **validate-and-repair** loop (≤3 iterations) and then either succeeds or fails honestly — never an infinite repair, never a silently-broken preview. *Magic moment:* the app gets better by talking to it, and you always see the real result before committing.

### J3 — Export, share, and import a reviewed app
The user exports the icon generator as a JSON bundle and sends the file to a teammate. The teammate imports it. Chrome Buddy forces `reviewed:false`, shows a **review gate** that discloses *exactly which capabilities the app declares* (e.g. "this app can generate images and download files"), and — if the bundle's `specVersion` exceeds the local version — shows a **visible downgrade** list ("3 of 20 features can't run in this version") rather than silently dropping anything. Any **consequential** capability in the import is not auto-authorized: it stays disabled until the user grants it with arguments visible. The teammate runs it once, confirms an output, and it becomes reviewed. *Magic moment:* you hand someone a file and they get the same app, with full visibility into what it can do before it runs.

### J4 — Run a deployed micro-app
A saved app sits in the apps grid like any other card. Opening it renders its custom UI inside the player iframe, always inside persistent Chrome Buddy chrome with the "sandboxed app" badge. The user interacts with the real UI; capability calls (generate, download, read page) route through the bridge under the per-run budget, with HITL prompts for consequential ops and a per-run consent for page/network-holding apps. The run is wall-clock- and rate-capped, so a runaway app can never wedge the panel. *Magic moment:* your own tool, with its own UI, living in your apps grid, running safely on demand.

**Critical path:** J1 + J4 — the visible sandbox-UI runtime and a real app (SVG generator) running in it. If the runtime is not safe and delightful, nothing downstream matters; the conversational builder (J2) and sharing (J3) are layered on a proven runtime.

## 5. Functional Requirements

FR area prefix: **FR-MAB-N**. Grouped by capability. (Tier-3 = `kind:'spec'` micro-apps; Tier-1/Tier-2 requirements live in the parent PRD.)

### 5.1 Conversational builder flow
- **FR-MAB-1** Apps view exposes a "Build a micro-app" entry that opens a conversational builder where the user describes the app in natural language (extends the `creating` flow in `src/views/AppsView.tsx`, replacing the one-shot `generate()` with a `buildSession`).
- **FR-MAB-2** The builder calls the model via `generateViaBackground` (SW path, key never in panel) with a Tier-3 system prompt and a `responseSchema`, returning a structured app spec (UI + declared capabilities + sample inputs).
- **FR-MAB-3** The builder maintains a conversation: each follow-up message ("make the gallery 3 columns", "add a duotone style") re-generates/edits the spec while preserving prior context, until the user saves.
- **FR-MAB-4** When a request falls outside what the runtime can express, the builder says so honestly (capability boundary message) rather than producing a broken or faked UI; it does not silently approximate.
- **FR-MAB-5** The builder surfaces the app's **declared capabilities** to the user during the build, before save, so the user sees what the app will be able to do (gemini/image/download/storage/page).

### 5.2 Live preview & sandbox-UI runtime
- **FR-MAB-6** The app's `html/css/js` renders inside the existing opaque-origin sandbox player iframe (`sandbox.html`), injected via `postMessage` — an extension of the Tier-2 `SANDBOX_RUN` mechanism in `src/sandbox/host.ts` / `src/sandbox/run.ts`. No remote fetch, no bundle modification.
- **FR-MAB-7** The live preview updates on each successful build/iterate turn and is interactive (the user can click pickers, type, run batches) exactly as the deployed app will behave.
- **FR-MAB-8** The runtime renders the app **inside persistent Chrome Buddy chrome** with an always-visible **"sandboxed app" badge**; the app UI can never occupy the full surface or hide/spoof Chrome Buddy's own controls (anti-spoofing).
- **FR-MAB-9** The player iframe has **no `allow-same-origin`**: the app has no `chrome.*` access, no same-origin DOM, no ambient network, and cannot read the API key — confirmed by the runtime, not assumed.
- **FR-MAB-10** A deployed Tier-3 app opens from the apps grid into the same runtime used for preview (J4), via the existing card → `setOpenGen` path generalized to `kind:'spec'`.

### 5.3 Iterate, test & validate-repair
- **FR-MAB-11** Each generated spec passes a structural validator (known widget/capability kinds, valid references, caps) before it renders; unknown kinds are rejected with a clear message, not rendered.
- **FR-MAB-12** Invalid specs enter a **validate-and-repair loop capped at ≤3 iterations**; on exhaustion the builder fails honestly (states it could not build the app) rather than looping or shipping a broken app.
- **FR-MAB-13** Before save, the user runs at least **one real output** (smoke run with model-emitted sample inputs, under the per-run budget) and **must confirm that real output**; the app is not persisted as reviewed until confirmed.
- **FR-MAB-14** The user can re-test a deployed/saved app's real behavior at any time and re-enter the builder to iterate further, producing a new spec version.

### 5.4 Capability bridge & permissions
- **FR-MAB-15** Capabilities reach the app **only** through the permission-declared `postMessage` bridge; an undeclared op resolves to "capability not available" (extends the `onBridge` authorization pattern in `AppsView.tsx`).
- **FR-MAB-16** Day-one bridge capabilities: `gemini` (text generation), `image` (via existing `IMAGE_GENERATE`), `download` (file/blob export, e.g. SVG), app-scoped `storage` (namespaced per app id), and read-only `page` (`read_dom`/`extract`).
- **FR-MAB-17** Each bridge op is authorized in the **SW** against the app's declared permissions; **keys stay SW-only in `chrome.storage.session`** and never enter the panel or the sandbox.
- **FR-MAB-18** **Consequential** capabilities (e.g. `download`, page reads on a sensitive page, any future write/network op) are **HITL-gated**: the user is prompted before the op runs, with **full arguments visible** in the prompt.
- **FR-MAB-19** Read-only/page capabilities that still touch user data require a **per-run consent** even when non-consequential, plus rate caps, because the app holds a page/network capability.
- **FR-MAB-20** App-scoped `storage` is isolated per app id; one app cannot read another app's stored data, and the store is the SW-owned IDB, not the page.

### 5.5 Deploy to the apps grid
- **FR-MAB-21** A saved Tier-3 app appears as a card in the apps grid ("Your generated apps" section), visually consistent with existing generated apps, and is deletable (reuse `AppCard` + `removeApp`).
- **FR-MAB-22** Tier-3 apps persist as `AppConfig` records (`kind:'spec'`, `tier:3`, `spec`, `reviewed`, `createdAt`) in the SW-owned IDB `apps` store via the existing `APP_SAVE/LIST/DELETE` request path.
- **FR-MAB-23** The store migration `APP_SCHEMA_VERSION 1→2` defaults legacy rows to `kind:'form'` so all existing Tier-1/Tier-2 apps keep loading and running unchanged.

### 5.6 Export / import & review gate
- **FR-MAB-24** A saved app can be **exported as a JSON bundle** (`{ schemaVersion, specVersion, apps }`), mirroring the workflow/skills export pattern; sharing is this file only — no remote publish.
- **FR-MAB-25** Import parses the bundle, drops malformed entries, and **forces `reviewed:false`** on every imported app.
- **FR-MAB-26** Import shows a **review gate** that discloses the app's declared capabilities in plain language before the first run; the user must acknowledge before the app can run.
- **FR-MAB-27** If the bundle's `specVersion` exceeds the local `APP_SPEC_VERSION`, import shows a **visible downgrade** report ("N of M features can't run in this version") and lists the affected features — never a silent drop.
- **FR-MAB-28** **Consequential capabilities in an imported app are not auto-authorized**: they are stripped or disabled and flagged until the user grants them with arguments visible; an imported app can carry only read-only capabilities by default.
- **FR-MAB-29** The first confirmed real run of an imported app flips it to `reviewed:true` (same gate as a locally built app).

### 5.7 Model selection (Flash default, optional Opus)
- **FR-MAB-30** The builder defaults to **Gemini Flash** for spec generation/repair; this path requires no extra keys and is the free default.
- **FR-MAB-31** A user with their own **Anthropic key** can opt into **Opus 4.8** as a "power builder" for build-time generation only, via a new Anthropic adapter registered in the user-registry overlay.
- **FR-MAB-32** Opus is **never forced and never a runtime dependency**: absence of an Anthropic key silently keeps Flash; the saved app's runtime behavior does not depend on which builder model authored it; the Anthropic key never leaves the SW.

## 6. Non-Functional Requirements

NFR prefix: **NFR-MAB-N**. Quantified where possible. The MV3/isolation constraints and the adversarial-review safety rails are first-class.

### 6.1 MV3 / security / isolation
- **NFR-MAB-SEC-1** Zero remote code execution: app `html/css/js` is injected into the *bundled* `sandbox.html` over `postMessage`; nothing is fetched-and-run and the signed bundle is never modified at runtime.
- **NFR-MAB-SEC-2** Hard isolation: the player iframe runs at an **opaque origin with no `allow-same-origin`** — no `chrome.*`, no same-origin DOM, no ambient network. `unsafe-eval`/`allow-scripts` are scoped to that frame via the manifest `sandbox` CSP only.
- **NFR-MAB-SEC-3** Key custody: the API key lives **only** in `chrome.storage.session` and is read **only** in the background SW; it never enters the panel, the spec, the bundle export, or the sandbox. 100% of capability calls that need the key originate in the SW.
- **NFR-MAB-SEC-4** All capability access is bridge-mediated and SW-authorized against the app's declared permissions; an undeclared or unauthorized op fails closed ("capability not available").
- **NFR-MAB-SEC-5** App-scoped storage is namespaced per app id; cross-app reads are impossible by construction.

### 6.2 Safety rails (from adversarial review)
- **NFR-MAB-SAFE-1** Per-run **wall-clock budget** + **bridge-call/rate caps**: a run that loops or never returns is killed; the existing refresh-the-timeout-on-every-bridge-round-trip behavior in `src/sandbox/host.ts` is replaced with a per-run budget so a working-but-runaway app cannot live forever or wedge the panel.
- **NFR-MAB-SAFE-2** Anti-spoofing: persistent Chrome Buddy chrome + an always-visible **"sandboxed app" badge** frame every preview and deployed run; the app UI can never cover Chrome Buddy's controls or impersonate Chrome Buddy chrome.
- **NFR-MAB-SAFE-3** Import is gated: review gate + plain-language **capability disclosure** before first run; `reviewed` is forced `false`; consequential capabilities are not auto-authorized without **args-visible** consent.
- **NFR-MAB-SAFE-4** Versioning with **visible downgrade**: every app carries `specVersion`; importing a higher-version bundle reports "N of M features can't run here" and lists them — never a silent drop.
- **NFR-MAB-SAFE-5** Build integrity: validate-and-repair is **hard-capped at ≤3 iterations** then fails honestly; the app cannot be saved as `reviewed:true` until the user confirms **one real output** (no "grades-its-own-homework" auto-approve).
- **NFR-MAB-SAFE-6** Output is sanitized: any model-authored markdown/HTML rendered by the app or host passes a hardened sanitizer — block `javascript:`/`data:` hrefs, image auto-load, inline `<script>`/`<style>`, event-handler attributes, and raw HTML passthrough — defeating prompt-injection-via-output exfiltration.
- **NFR-MAB-SAFE-7** Billing-DoS protection: the per-run budget (max LLM calls, max tool calls, max output bytes, depth) is the importer's protection against a malicious bundle running up their key; it applies to imported apps identically.

### 6.3 Performance & quota
- **NFR-MAB-PERF-1** A pure (no-bridge) run completes within a small wall-clock budget (single-digit seconds); a bridge-bearing run gets a larger but still finite budget; both are hard-capped and surfaced to the user on abort.
- **NFR-MAB-PERF-2** The preview renders interactively without blocking the panel; bridge round-trips are async and do not freeze Chrome Buddy.
- **NFR-MAB-PERF-3** All cost is client-side and user-borne (BYO key); the feature adds no first-party inference cost. Concrete budget defaults (`wallClockMs`, `maxLlmCalls`, `maxToolCalls`, `maxOutputBytes`) are tuned to cover real apps (e.g. a batch icon run) without enabling billing-DoS — see Open Questions.

### 6.4 Compatibility & maintainability
- **NFR-MAB-MAINT-1** The `APP_SCHEMA_VERSION 1→2` migration is non-destructive: every existing Tier-1/Tier-2 app loads and runs unchanged (defaulted to `kind:'form'`/legacy).
- **NFR-MAB-MAINT-2** CI carries unit tests for the validator, the budget/loop guard, the sanitizer, and import downgrade/consequential-strip, plus an e2e (Playwright) happy-path, expressiveness-boundary, injection, and budget/loop test — and a live regression that legacy apps still load after migration.

## 7. Architecture Overview

Full detail in [`docs/blueprints/app-builder-blueprint.md`](../blueprints/app-builder-blueprint.md). The runtime is the **existing opaque-origin sandbox as a "player"**, the app is **data**, and capabilities flow through a **SW-authorized bridge**.

```
 SIDE PANEL (React)                         BACKGROUND SERVICE WORKER (key custody)
  AppsView ── build/iterate ──▶ buildSession ──▶ generateViaBackground(LLM_GENERATE) ──▶ model
   │  ◀── spec JSON ──                              • authorizes every bridge op vs. declared perms
   ├─ validate (kinds/refs/caps)                    • key only in chrome.storage.session
   ├─ live preview ─────────────┐                   • IMAGE_GENERATE / TOOL_EXEC (read_dom, extract)
   └─ save ─▶ IDB 'apps' (SW)    │
                                 ▼
                    SANDBOXED PLAYER IFRAME (sandbox.html, opaque origin)
                     • app html/css/js injected via postMessage (extends SANDBOX_RUN)
                     • NO allow-same-origin · no chrome.* · no key · no ambient network
                     • capability bridge: gemini · image · download · storage · page(read-only)
                       └─ every op → host → SW (authorize + rate-cap + HITL) → result
                     framed by persistent Chrome Buddy chrome + "sandboxed app" badge
```

**Grounding in real files:**
- **Runtime:** `src/sandbox/host.ts` (player mount + per-run budget replacing the round-trip refresh) and `src/sandbox/run.ts` (in-frame execution; today runs a `new Function` body, extended to host the app UI).
- **App-as-data:** `src/apps/types.ts` — `AppConfig` gains `kind:'spec'` / `tier:3` / `spec` plus `APP_SCHEMA_VERSION 1→2` and an internal `specVersion`.
- **Store & request path:** the SW-owned IDB `apps` store via existing `APP_SAVE/LIST/DELETE` (`fetchApps`/`persistApp`/`removeApp`).
- **Builder + runtime UI:** `src/views/AppsView.tsx` — the one-shot `generate()` becomes a conversational `buildSession`; the `GeneratedApp` runner and `onBridge` authorization pattern generalize to Tier-3.
- **Bridge targets:** `IMAGE_GENERATE` (image), read-only `TOOL_EXEC` (`read_dom`/`extract`), `runPlainChat`/`generateViaBackground` (gemini) — all SW-side.
- **Model adapters:** Gemini Flash (default, via the existing adapters) + a new optional `src/llm/adapters/anthropic.ts` for Opus 4.8 (user-keyed, build-time only).

## 8. Risks & Mitigations

Pulled from the blueprint risk register, framed for this PRD:

| # | Risk | Cat | Mitigation (short) |
|---|------|-----|--------------------|
| R-MAB-1 | Expressiveness gap: the median request exceeds what the runtime can render | Technical | Honest capability-boundary UX; never fake/approximate a widget; clear "can't make that" message (FR-MAB-4) |
| R-MAB-2 | Untrusted UI enables phishing/spoofing on a capable surface | Security | Opaque-origin sandbox, no `allow-same-origin`; persistent Chrome Buddy chrome + "sandboxed app" badge; app never covers host UI (NFR-SAFE-2) |
| R-MAB-3 | Never-times-out / runaway run wedges the panel or burns the key | Technical/Cost | Per-run wall-clock + call/rate budget replacing round-trip refresh; loop detection (NFR-SAFE-1/7) |
| R-MAB-4 | Import re-validation is structural, not effect-aware (consent theater) | Security | Force `reviewed:false`; strip/disable consequential caps in imports; args-visible HITL before any consequential op (FR-MAB-28, NFR-SAFE-3) |
| R-MAB-5 | Version drift silently breaks imports | Compat | `specVersion` from day one; visible downgrade report, never silent skip (FR-MAB-27, NFR-SAFE-4) |
| R-MAB-6 | Validate-repair grades its own homework / loops | Technical | ≤3-iteration cap then honest failure; user confirms one real output before save (FR-MAB-12/13, NFR-SAFE-5) |
| R-MAB-7 | Prompt-injection via app/markdown output exfiltrates | Security | Hardened sanitizer (block `javascript:`/`data:`/img-autoload/raw HTML/event attrs); render-surface CSP (NFR-SAFE-6) |
| R-MAB-8 | Key exfiltration through the bridge | Security | Keys SW-only in `storage.session`; bridge ops authorized in SW; sandbox can't read the key (NFR-SEC-2/3) |
| R-MAB-9 | Web Store rejects the sandbox-UI runtime | Regulatory | No `unsafe-eval` outside the existing opaque-origin sandbox; no fetch-and-run; app-as-data is auditable; bundle never modified |
| R-MAB-10 | Opus path silently becomes a dependency | Dependency | Opus is opt-in, user-keyed, build-time only; no key → silently falls back to Flash; runtime never depends on builder model (FR-MAB-32) |

## 9. Phased Rollout

Sequenced so something honest and safe ships at each gate; each phase has an exit criterion.

- **P0 — Sandbox safety fixes (MUST land first) · S.** Replace the refresh-on-every-round-trip timeout in `src/sandbox/host.ts` with a **per-run wall-clock budget + bridge-call/rate cap**; add the reusable per-run budget/loop-detector primitive. *Exit:* a tight bridge loop is killed by the cap; a legit slow single LLM call still completes; existing sandbox tests pass.
- **P1 — Visible sandbox-UI runtime + SVG-generator proof · M.** Render a host-shipped, data-stored app UI inside the player iframe with persistent Chrome Buddy chrome + "sandboxed app" badge; ship the `AppConfig` `kind:'spec'` discriminator + `APP_SCHEMA_VERSION 1→2` migration. Re-create the **SVG Icon Generator** (gallery, style picker, batch, vector export via the download bridge) as the proof. *Exit:* the SVG generator runs end-to-end inside the sandbox; legacy apps still load; anti-spoofing holds.
- **P2 — Bridge expansion · M.** Wire the day-one capabilities (`gemini`, `image`/`IMAGE_GENERATE`, `download`, app-scoped `storage`, read-only `page`), each SW-authorized with HITL for consequential ops and per-run consent for page/network-holding apps. *Exit:* each capability works under the budget; undeclared ops fail closed; consequential ops prompt with full args.
- **P3 — Conversational builder · M.** Replace one-shot `generate()` with a `buildSession`: describe → spec → live preview → iterate, with the ≤3-iteration validate-repair loop and the confirm-one-real-output gate before save; capability-boundary UX. *Exit:* a malformed-then-repaired spec succeeds within 3 tries; a hopeless prompt fails honestly; save requires a confirmed output.
- **P4 — Export / import + review gate · M.** `toAppBundle`/`parseAppBundle`; force `reviewed:false`; capability-disclosure review gate; visible specVersion downgrade; strip/flag consequential caps in imports; output sanitizer hardened. *Exit:* import shows capability disclosure + downgrade list; consequential caps disabled; injected `javascript:`/`onerror` output rendered inert.
- **P5 — Optional Opus 4.8 power builder · S/M.** New Anthropic adapter, user-keyed, build-time only, registered in the user-registry overlay; key under `apiKey:anthropic` in `chrome.storage.session`. *Exit:* no key → Flash unchanged; with a key → Opus generates a valid spec; key never leaves the SW.

## 10. Open Questions

- **Expressiveness ceiling:** what is the concrete catalog of UI patterns the runtime supports at P1 (gallery, picker, batch, table, canvas?), and where exactly does the honest "can't make that" boundary fall?
- **Budget defaults:** concrete numbers for `wallClockMs` / `maxLlmCalls` / `maxToolCalls` / `maxOutputBytes` that cover a real batch (e.g. 20-icon generation) without enabling billing-DoS on an importer's key.
- **Per-run consent granularity:** one consent per app-run vs. per-capability-per-run for read-only page/network access — the least annoying that's still honest.
- **Download bridge scope:** how broad is `download` (blob/SVG only, or arbitrary file types)? What disclosure does it warrant as a consequential op?
- **Migration of existing Tier-2 code apps:** should any saved Tier-2 apps be re-flagged `reviewed:false` on the `v1→v2` bump, or is leaving their flag intact correct?
- **`responseSchema` on the native Gemini adapter:** confirm parity with the OpenAI-compat path so the default Flash build is reliable without Opus.
- **Opus exposure point:** where in the build UI does the optional Opus toggle live, and how is "you're spending your own Anthropic key" disclosed?

## 11. Success Metrics

- **North star — Saved-and-rerun micro-apps per builder:** an app counts only once it has produced a user-confirmed output and been run again after save.
- **Build-to-save conversion:** fraction of build sessions that reach a confirmed save (not abandoned at preview).
- **Iterate-loop success:** fraction of iterate turns that produce a valid, rendered spec within the ≤3-iteration cap (and the rate of honest failures vs. silent breakage — target: 0 silent breakage).
- **Capability-consent integrity:** 100% of consequential ops gated with full args visible; 0 unauthorized bridge calls; 0 key exposures outside the SW.
- **Import-review completion:** fraction of imports where the user sees and acknowledges the capability disclosure before first run; 100% of imports forced `reviewed:false`; 0 silent downgrades.
- **Runtime safety:** 0 panel wedges from runaway apps; 100% of over-budget runs aborted with a clear message.
- **Sharing adoption:** apps exported, and apps imported-then-run, per active builder.
- **Opus upgrade adoption:** fraction of Anthropic-keyed users who opt into Opus, with Flash remaining the silent default for everyone else.

## Appendix

- **Design blueprint:** [`docs/blueprints/app-builder-blueprint.md`](../blueprints/app-builder-blueprint.md) — concepts, grammar, risk register, roadmap.
- **Parent PRD:** [`docs/prd/PRD.md`](./PRD.md) — Tier-1/Tier-2 apps, the shared tool registry, the agent loop.
- **Grounding code:** `src/apps/types.ts` (`AppConfig`, `APP_SCHEMA_VERSION`), `src/sandbox/host.ts` + `src/sandbox/run.ts` (opaque-origin runtime + bridge), `src/views/AppsView.tsx` (apps grid, generation flow, `onBridge` authorization).
