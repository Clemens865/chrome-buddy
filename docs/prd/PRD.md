# Product Requirements Document: Chrome_Buddy
*Generated: 2026-05-20*
*Based on: `docs/research/` dossier (7 docs) + locked scope decisions*

## 0. Research Verdict & Premises

- **Verdict: BUILD.** The competitive scan found that "agentic" is used loosely — most extensions are assistants, not agents — and the genuinely capable agents (Operator/Atlas, Comet, HARPA, Bardeen, Zapier) are cloud-bound, model-opaque, and still fail ~1-in-4 complex real flows. The lane is open and we already own a 64-app predecessor (MicroLabs) to build from.
- **Demand reality: STRONG (category) / MODERATE-to-prove (our wedge).** The market sustains 15+ assistants at $4–13/mo and automation at $20–33/mo; Comet alone drove ~48% of tracked agentic web traffic in early 2026. The *specific* combination we bet on is unproven precisely because no one ships it well.
- **Key eureka insight:** *One shared tool registry, three automation levels.* Micro-apps, agentic chat, and skills/workflows are not three products — they are three consumption levels of one capability registry. Build a capability once; expose it three ways. Paired with *extensibility-as-data* (Web Store bright line: data allowed, remote/eval'd code banned), this makes "universal" tractable and self-extension/future-proofing routine.
- **Premise scorecard:** 3 CONFIRMED (open lane exists; data-driven extensibility is compliant; cross-session memory is a real gap), 3 OPEN (a self-built loop can hit competitive reliability — *highest risk*; BYO-key friction is tolerable; "one registry, three levels" is buildable without three codebases).
- **Biggest risk from research:** Self-built agent reliability (R1, score 25) — the industry-wide ~1-in-4 complex-flow failure rate that sank Operator and Mariner. The moat is the unsolved reliability + memory + trust frontier, not the now-table-stakes perception/loop.

## 1. Executive Summary

- **Problem:** Browser knowledge workers juggle single-purpose AI extensions and copy-paste into chat tabs; the capable agents that actually *act* are cloud-locked black boxes, hide which model runs and what it costs, fail on complex flows, and never remember what they learned. The status quo is agency without trust, capability without transparency, intelligence without memory.
- **Solution:** A universal agentic browser assistant that *reliably does* multi-step work — DOM-first, BYO-key, model-transparent, privacy-respecting — asking before any consequential action, remembering across sessions, and extending itself with new tools and models as pure data (no resubmission, no remote code).
- **Target user:** A specific person — the browser-resident knowledge worker/power user (researcher, analyst, ops/sales, technically-comfortable generalist) who lives across many tabs all day and already pays for AI tools.
- **Key differentiator:** Verified multi-step agency + live model/cost transparency + BYO-key privacy + cross-session memory + data-driven self-extension — the combination no incumbent offers.
- **The narrowest wedge (build FIRST):** A pinned side-panel agent that completes a real multi-step DOM-first task across current/related tabs, shows a visible plan and live cost, and asks before every consequential action. Prove that one loop is reliable and trustworthy; everything else is downstream.

## 2. Vision & Scope

**Vision:** *For knowledge workers and power users who live in the browser and are tired of juggling single-purpose AI extensions, Chrome_Buddy is a universal agentic browser assistant that reliably does multi-step work — not just talks about it. Unlike cloud-locked, model-opaque agents (Operator, Comet, HARPA, Zapier), it is model-transparent and BYO-key, runs DOM-first and privacy-respecting, asks before any consequential action, remembers what it learned across sessions, and extends itself with new tools and models as pure data.*

**Anti-Goals (what this is NOT):**
1. Not a single-vertical tool (edu/moderation/CRM niche) — those are owned and narrow; our value is the cross-profession shared registry.
2. Not a cloud-locked black box — BYO key in `storage.session`, calls from background SW, DOM-first, live model+cost display.
3. Not a fetcher/runner of remote code — skills/workflows/app-configs/registry are declarative data; generated code runs only in a bundled sandbox.
4. Not a CAPTCHA/bot-detection defeater — we detect, pause, and hand control to the human.
5. Not a vision-first/screenshot-loop agent — DOM-first; Computer Use vision is a fallback tier only.
6. Not a node-graph workflow IDE in v1 — workflows are declarative data + a linear editor.
7. Not a fire-and-forget autonomous agent for consequential actions — HITL confirmation is non-negotiable.

**Primary user:** browser-resident knowledge worker/power user. **JTBD:** "Reliably finish a multi-step browser task I'd otherwise do by hand, without babysitting it, trusting it because I see and approve every consequential step." **Switch willingness:** HIGH but conditional on transparency and control.
**Secondary users:** developers & skill authors (v1 — Tier-2 + skills), researchers/analysts (v1 core), sales/business (v1 tools tier), power tinkerers (v1 platform tier), students & non-technical mainstream (later, behind a future Nano free tier).

**North star:** Verified Multi-Step Task Completion Rate (VMSTCR). **Supporting:** confirmation-gate integrity (100% gated / 0 unauthorized), memory-assisted task lift, transparency engagement, self-extension adoption, BYO-key activation, Web Store first-pass.

## 3. Locked Scope Decisions (non-negotiable inputs)

See [`scope-decisions`](../../tmp/prd-generator/chrome-buddy/scope-decisions.md) (mirrored in research). The nine locked calls:
1. **Goal** — universal agentic + LLM extension; ~80% of any LLM/browser task for any profession; three layers over one shared tool registry.
2. **Primary LLM** — Gemini, BYO key in `storage.session`, cloud calls from background SW; multi-provider via registry-driven OpenAI-compatible adapter. Default `gemini-3.5-flash`; `2.5-flash-lite` cheap/fast; `3.1-pro` hard reasoning; `2.5-computer-use` automation fallback; Nano on-device for free/private quick tasks.
3. **Engine** — **build from scratch** (own plan→act→observe→reflect on Gemini function calling + Computer Use vision fallback; DOM-first; Planner→Executor→Validator; HITL gate). Borrow patterns, not code.
4. **Filesystem** — phased: File System Access API in v1; native messaging host in v2.
5. **Self-extending apps** — Tier-1 declarative JSON-config apps AND Tier-2 sandboxed-iframe code apps (QuickJS-wasm/SES + postMessage capability bridge) both in v1. Never fetch/eval remote code.
6. **Future-proofing** — in-app editable + signed-remote-updatable model/provider registry (data, not code); new Gemini model = one-line config add.
7. **UI** — always-on `chrome.sidePanel`, vertical icon rail + expandable panel; chat is home; pin + keyboard command (no auto-open).
8. **Compliance** — MV3 + Web Store; data allowed, remote/eval'd code banned; all extensibility is declarative data; code only in bundled sandboxes.
9. **Predecessor reuse** — keep MicroLabs' GenericApp templating, page-context extraction, webhook abstraction, profile personalization, Gemini hooks; fix security, permissions, storage schema/migrations, error handling, tests/CI, performance.

## 4. User Journeys

Five scenarios (full detail in [`user-journeys.md`](./user-journeys.md)):
1. **Agentic multi-step task** (competitor pricing comparison) — Planner→Executor→Validator, DOM-first with marked vision fallback, `ask_user` disambiguation, hard HITL confirmation before the external doc write. *Magic moment:* watching it finish a real task while you approve only what matters.
2. **Quick micro-app** (one-shot Extract Table) — deterministic, no-LLM, "$0.00" badge, with "Hand to Agent" escalation.
3. **AI-generate a micro-app in-app** — NL → validated Tier-1 JSON config (escalate to Tier-2 only if needed); appears in the grid. *Magic moment:* mint your own tool by describing it.
4. **Save a repeatable skill/workflow** — promote a run into the shared step schema, parameterize, add a trigger; gate preserved even on scheduled runs.
5. **Adopt a new Gemini model** — appears via signed remote registry update or one-line in-app add, zero code change.

**Critical path:** Scenario 1 — the day-one make-or-break and the wedge itself; the confirmation gate must be 100%, never 90%.

## 5. Requirements Overview

Full detail in [`requirements.md`](./requirements.md): **164 functional** (18 areas), **31 non-functional**, **15 data entities**, **10 integrations**, **14 constraints**.

| Area | FRs | Area | FRs | Area | FRs |
|------|----:|------|----:|------|----:|
| AGENT | 17 | APPS | 15 | MODEL-REGISTRY | 16 |
| TOOLS | 14 | APP-GEN | 12 | LLM | 12 |
| HITL | 8 | TIER2-SANDBOX | 7 | MEMORY | 5 |
| BROWSER-CONTROL | 8 | SKILLS | 11 | FILESYSTEM | 4 |
| UI | 10 | WORKFLOWS | 9 | INTEGRATIONS | 3 |
| ONBOARDING | 4 | SETTINGS/PROFILE | 5 | MEDIA | 4 |

NFR highlights (quantified): keys only in `storage.session`, 100% cloud calls from SW (NFR-SEC-1/2); page content fenced from instructions, gate fires regardless of source (NFR-SEC-6); VMSTCR + 100%/0 gate integrity + resumable-no-duplicate (NFR-REL-1/2/3); WCAG 2.1 AA (NFR-A11Y); per-run step/token/$ budget caps (NFR-COST-1); CI tests on loop + gate from day one (NFR-MAINT-1).

## 6. Architecture Overview

Full detail in [`architecture-sketch.md`](./architecture-sketch.md). Five MV3 surfaces; the **Background SW** is the brain and the only origin of cloud calls (key hygiene); **on-device Nano** runs only in content script/offscreen; **Tier-2 code** runs only in an opaque-origin sandboxed iframe.

```
        CLOUD (user BYO key): Gemini REST/Live · Signed Registry CDN · Catalog · Webhooks
                                   ▲ HTTPS from SW/offscreen only
 SIDE PANEL (React)                │
  icon rail + content   ◄── runtime messaging ──►  BACKGROUND SERVICE WORKER (stateless)
  (chat/apps/skills…)                               • Agent Runtime (plan→act→observe→reflect:
 CONTENT SCRIPTS                                       Planner·Executor·Validator·Scratchpad)
  • DOM read/act (scripting/userScripts) ◄────────   • Tool Registry (single source)
  • Nano on-device                                    • LLM Client (adapters, routing, $$$)
 OFFSCREEN DOC                                         • Model/Provider Registry (signed updates)
  • DOM parse · audio (STT/TTS) · Nano  ◄─────────    • PageContext · Browser Ctrl (scripting/CDP/CompUse)
 SANDBOXED IFRAME (Tier-2)                             • Tier-1 App Engine · Skill/WF Store · Generator
  • QuickJS-wasm/SES · cap-bridge      ◄─────────     • Memory (IndexedDB/RAG) · Filesystem · Integrations
                          chrome.storage (session keys / local config) · IndexedDB
```

**17 components** (SW, Agent Runtime, Tool Registry, LLM Client, Model Registry, PageContext, Browser Control, Tier-1 App Engine, Tier-2 Sandbox, App/Skill Generator, Skill/WF Store, Memory, Side Panel UI, Offscreen Doc, Filesystem, Integrations, Onboarding/Settings).

**Six key technical decisions:**

| Decision | Recommendation | Why it matters |
|----------|----------------|----------------|
| Perception | DOM-first; Computer Use vision as fallback tier only | Industry retreated from pure vision (cost/brittleness/privacy); DOM distillation hit 73.1% WebVoyager with no vision |
| Action mechanism | Hybrid: `scripting` synthetic events default, CDP only for trusted input | CDP debugger banner scares users; scripting alone fails hardened sites |
| Resumable steps | Checkpoint scratchpad to IndexedDB after every step | MV3 SW idles ~30s; keep-alive hacks are fragile/rejected |
| Where the loop runs | SW orchestrates; offload parse/audio→offscreen, DOM-act→content script | Cloud calls must originate in SW for key hygiene |
| Tier-2 isolation | QuickJS-wasm primary (hard termination), SES lighter alt | Untrusted code needs zero ambient authority + hard limits |
| Storage & migrations | IndexedDB (idb/Dexie) versioned + migrations; keys in `storage.session` | Fixes MicroLabs' schema/migration gap |

**Tech stack:** Manifest V3 · React 19 + TS + Vite + Tailwind · `@google/genai` + bundled OpenAI-compatible/native adapters · idb/Dexie · ajv · quickjs-emscripten/ses · jmespath/json-logic-js · Mozilla Readability · WebCrypto (Ed25519) · charting + markdown renderer · **plus the MicroLabs gaps**: ESLint+Prettier, Vitest, Playwright e2e, CI.

**Cost shape:** near-zero, client-side; all Gemini cost borne by user (BYO key); only first-party infra is a small static CDN for signed registry/catalog JSON; optional v2 native host adds per-OS packaging/signing.

## 7. Roadmap

Full detail in [`risks-and-priorities.md`](./risks-and-priorities.md). Three gates — note "v1" in the locked decisions = the **V1 public release**, not the MVP.

- **Phase 1 — MVP / Wedge** (internal → private beta) · **L** — *Prove the trustworthy agent.* The agent finishes a real multi-step task (S1), user approves each consequential step, live cost shown. Agent loop + ~10 tools + HITL gate + LLM client + hybrid browser control + minimal memory/FSA/onboarding + bundled-only model registry. **No Tier-2** — submit a clean, minimal Web Store build first. ~**10–14 weeks**, 2–3 engineers (reliability iteration is the variable). Exit gate: measured VMSTCR clears bar; 100%/0 gate integrity; injection red-team passes; resumes with no duplicate consequential steps.
- **Phase 2 — V1 Public Release** (full locked surface) · **L** — *Become the universal platform.* Tier-1 apps + NL app generation + Tier-2 sandboxed code apps + skills + scheduled workflows + full signed model/provider registry + webhooks + STT + learned-flow memory. Validates Web Store pass (incl. Tier-2), memory lift, transparency engagement, self-extension adoption.
- **Phase 3 — V2 Expansion** · **M–L** — *Extend reach and depth.* Native-host filesystem, parallel multi-tab/shadow-browser research, advanced semantic memory/RAG, DOM-acting generated apps, full media suite, recorder, app/skill sharing catalog/marketplace.

## 8. Risks

Top 10 of 17 (full matrix in [`risks-and-priorities.md`](./risks-and-priorities.md)):

| # | Risk | Cat | Score | Mitigation (short) |
|---|------|-----|:---:|--------------------|
| R1 | Self-built agent reliability falls short | Technical | 25 | Instrument VMSTCR from build 1; borrow patterns; plan preview + partial completion; gate MVP exit on measured rate |
| R2 | Prompt injection drives the agent | Security | 20 | Fence page content as untrusted; gate fires regardless of source; injection red-team in CI |
| R4 | Web Store rejects Tier-2 sandbox | Regulatory | 16 | Bundled non-obfuscated wasm; no fetch-and-eval; MVP has no Tier-2; compliance rationale + appeal packet for V1 |
| R5 | Scope sprawl ("universal" = unfocused) | Market | 16 | Wedge discipline; small MVP Must-set; build capability once, expose three ways |
| R6 | BYO-key onboarding kills adoption | Market | 16 | Clean walkthrough + live key test; target = power user; Nano free on-ramp as escape valve |
| R7 | Gemini model drift / preview instability | Dependency | 16 | Signed remote registry (one-line model add); tiered fallback; bundled-default floor |
| R3 | API key exfiltration | Security | 15 | Keys only in `storage.session`; calls only from SW; signature-verify registry `baseUrl` |
| R16 | Competitor (Google-native) ships it free | Market | 12 | Lean into BYO/transparency/local-first/self-extension that incumbents structurally won't do |
| R8 | Computer Use cost & latency | Technical | 12 | DOM-first default; vision only on DOM-miss; hard budget caps; action caching |
| R13 | "One registry, three levels" bet fails | Technical | 12 | Registry as single source; prove agent consumes it in MVP before exposing to apps/skills |

## 9. Validation Plan

Full detail in [`validation-plan.md`](./validation-plan.md): **12 assumptions, 11 methods, 11 kill criteria.** Operating principle: spend days, not months, killing what can kill the product. **Three cheap spikes come FIRST, before production code:**
- **Spike A — agent-loop reliability:** thin DOM-first loop on ~10 real multi-step tasks; measure VMSTCR vs a borrowed-engine baseline. Tests the highest-risk premise (A1/R1, BC2).
- **Spike B — Tier-2 isolation:** QuickJS/SES sandbox + capability bridge; red-team for escape to DOM/network/storage (A5/R14).
- **Spike C — Web Store policy pre-check:** validate the Tier-2 + CDP + userScripts posture against reviewers/policy before committing (A6/R4, binary metric #7).

**Highest-priority assumptions:** A1 (self-built loop reliability — Low confidence), A2 (gate holds 100% incl. SW restart + injection), A3 (users *value* the gate, not resent it), A4 (BYO-key activation tolerable). **Kill-criteria examples:** agent reliability stuck below bar after N iterations → revisit forking an engine before V1; Web Store rejects the sandbox posture twice → cut Tier-2/CDP from public build; power-user activation craters → pull the Nano free on-ramp forward.

## 10. Open Questions

- **Which 5–8 micro-apps ship in the V1 suite?** (MicroLabs has 64 to draw from — pick the highest-value, agent-complementary set.)
- **Positioning:** lead with "the reliable agent" or the "universal" claim? (BC1 says lead with the agent.)
- **Memory/RAG depth in V1:** minimal history + learned-flow recall only, or embeddings/semantic recall sooner?
- **Monetization given BYO-key:** the product has near-zero infra and no inference cost to us — what's the revenue model (one-time, pro features, hosted-key tier, marketplace cut)?
- **CDP aggressiveness:** how much to lean on `chrome.debugger` (banner cost) vs `scripting` for trusted-input flows?
- **Nano free on-ramp timing:** ship as a V1 hedge against BYO-key friction, or hold to V2?

## Appendix

- **Research dossier:** [`docs/research/`](../research/) — 00-synthesis, 01-microlabs-audit, 02-competitor-landscape, 03-gemini-models, 04-platform-capabilities, 05-agentic-landscape-deep, 06-architecture-skills-ui, 07-extensibility-future-proofing
- **Detailed PRD docs:** [`user-journeys.md`](./user-journeys.md) · [`requirements.md`](./requirements.md) · [`architecture-sketch.md`](./architecture-sketch.md) · [`risks-and-priorities.md`](./risks-and-priorities.md) · [`validation-plan.md`](./validation-plan.md)
