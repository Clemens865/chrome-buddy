# Chrome_Buddy — Risk Matrix, Adversarial Pass, Prioritization & Roadmap

> Risk and prioritization layer for the universal agentic + LLM Chrome extension. Grounded in `vision-scope.md`, `requirements.md`, `architecture-sketch.md`, LOCKED `scope-decisions.md`, and research `05`/`00`.
>
> Scope-tension note (read first): the LOCKED decisions say Tier-1 *and* Tier-2 apps, skills, workflows, model registry, media, and FSA all ship in **"v1"** (the full first public release). The **MVP/wedge** is a narrower, internal proof of the trustworthy agent loop. This document treats MVP → V1 → V2 as three distinct gates: **MVP** = wedge proof (internal/private beta); **V1** = the full public release with all LOCKED features; **V2** = expansion (native host, parallel research, advanced memory, marketplace). Nothing here weakens the LOCKED v1 surface — it sequences how we get there.

---

## Risk Matrix

Sorted by Score (Likelihood × Impact) descending. Scale 1–5 each. Categories: Technical / Market / Regulatory / Team / Dependency / Security.

| # | Risk | Category | Likelihood | Impact | Score | Mitigation | Owner |
|---|------|----------|:---:|:---:|:---:|------------|-------|
| R1 | **Self-built agent reliability falls short** — `05` shows ~1-in-4 complex real flows still fail even at human-parity CUA; our hand-built loop (LOCKED #3, no engine fork) may underperform browser-use/Stagehand on day one. This is premise #2, the highest-risk bet, and it directly drives the VMSTCR north star. | Technical | 5 | 5 | **25** | Instrument VMSTCR from first internal build (NFR-REL-1). Borrow proven patterns (action caching, change-observation recovery, escalation ladder, loop detection — FR-AGENT-10/12) from `05`, not code. Plan preview + `ask_user` + partial completion (FR-AGENT-2/11, FR-TOOLS-11) convert silent failure into visible decisions. Gate MVP exit on a credible measured rate; ship narrow (current + related tabs only, FR-AGENT-17) before broadening. | Agent/ML lead |
| R2 | **Prompt injection from page content drives the agent** — the agent has credential access and reads untrusted DOM; a malicious page could instruct it to send/buy/delete or exfiltrate. Trust *is* the product (metric #2); one breach kills credibility. | Security | 4 | 5 | **20** | NFR-SEC-6: treat all page-derived content as untrusted data, fence it from instructions, and ensure page content can NEVER silently invoke a consequential tool — the HITL gate (FR-HITL-1) still fires regardless of source. PageContext is the single injection-fenced reader (architecture §6). Log every consequential action + approval (FR-HITL-7). Red-team injection corpus in CI alongside the gate tests (NFR-MAINT-1). | Security lead |
| R3 | **API key exfiltration** — BYO Gemini/provider keys are the user's money and identity; a leak (to page DOM, logs, storage.local, or a malicious provider `baseUrl`) is catastrophic and irreversible. | Security | 3 | 5 | **15** | NFR-SEC-1/2: keys only in `chrome.storage.session` (in-memory), never to disk/sync/logs/DOM; 100% of cloud calls from the SW/offscreen, never a content script. NFR-SEC-5: signature-verify (Ed25519/JWS) the remote registry before merge so a malicious `baseUrl` can't redirect keys. Scoped/optional host perms (NFR-SEC-7). Audit for key handling on every release. | Security lead |
| R4 | **Chrome Web Store rejects Tier-2 code sandbox** — reviewers may read QuickJS/SES "running generated code" as the banned remote-code/interpreter pattern even though it's bundled+data; rejection blocks launch (metric #7 is binary). | Regulatory | 4 | 4 | **16** | NFR-COMP-2/3: state single purpose as "an AI workspace for building/running browser micro-tools"; ship the QuickJS/SES `.wasm` bundled, readable, non-obfuscated; never `fetch()`-and-`eval()` (NFR-SEC-3). Tier-2 requires human review of code+caps before first run (FR-T2-5). **De-risk sequencing:** the MVP/wedge contains NO Tier-2 — submit the agent + Tier-1 first to establish a clean review relationship, add Tier-2 in the V1 submission with a written compliance rationale. Prepare a reviewer appeal packet. | Compliance/PM |
| R5 | **Scope sprawl — "universal" = unfocused** — "~80% of any task for any profession" (LOCKED #1) across apps + agent + skills + workflows + registry + media is enormous; risk of shipping many half-built features and a mediocre core, never proving the wedge. | Market | 4 | 4 | **16** | The wedge discipline below: MVP proves ONE loop (Scenario S1) before the suite. MoSCoW (below) forces a small Must-Have set. "One shared registry, three exposure levels" (LOCKED #1) means capability is built once, not three times — the structural defense against sprawl. North star (VMSTCR) keeps the team anchored to the agent, not feature count. | PM |
| R6 | **BYO-key onboarding friction kills mainstream adoption** — premise #5 is OPEN; requiring users to obtain and paste a Gemini key (FR-ONB-1) is a steep activation funnel (metric #6) that power users tolerate but mainstream users may abandon at install. | Market | 4 | 4 | **16** | Clean key-acquisition walkthrough with live test-call validation (FR-ONB-1/2). Accept that the **target user is the power user / knowledge worker** (vision Primary User) — mainstream is explicitly "Later" gated behind a future Nano free tier (vision Secondary Users). Measure metric #6 from day 1; if activation is too low, prioritize the on-device Nano free on-ramp (FR-LLM-8). Show value before the key wall where possible (deterministic Tier-1 apps need no key, FR-APP-10). | PM/Growth |
| R7 | **Gemini model-lineup drift / preview-model instability** — Computer Use is preview, paid-only since 2026-04-01; model IDs, pricing, and availability change fast and are outside our control (Constraints table). A pulled/renamed model breaks core flows. | Dependency | 4 | 4 | **16** | Signed remote-updatable model registry (FR-MR-1/5) makes a new/renamed model a one-line data edit, no resubmission (LOCKED #6). Tiered fallback Nano→Flash-Lite→Flash→Pro (FR-LLM-11, NFR-COST-3). Bundled-default registry is the floor and never blocks first use (FR-MR-2). Defensive capability probing (FR-MR-14). Auto-route when a model lacks a needed capability (FR-MR-15). | Platform lead |
| R8 | **Computer Use cost & latency** — the vision fallback tier is slow and expensive; over-reliance blows the user's BYO budget and the latency NFRs, recreating the cost/latency problem that helped sink Operator/Mariner (`05` open frontier #3). | Technical | 4 | 3 | **12** | DOM-first by default; Computer Use ONLY as fallback after DOM yields nothing (FR-BC-5, FR-AGENT-13, LOCKED #3) — the architectural bet aligned with where the frontier landed. Hard step + token + $ budget caps per run with pause-on-breach (FR-AGENT-9, NFR-COST-1). Live cost meter (FR-LLM-10, NFR-COST-2). Action caching pattern to replay at zero LLM cost (`05`). Default routing favors cheapest viable model (NFR-COST-3). | Agent lead |
| R9 | **CAPTCHA / bot-detection walls** — no clean ToS-compliant answer (`05` open frontier #2, anti-goal #4); hardened sites will block the agent mid-flow, capping the universe of automatable tasks and frustrating users. | Technical | 4 | 3 | **12** | Anti-goal #4 — we do NOT attempt to defeat them. FR-HITL-8/FR-BC-6: detect CAPTCHA/2FA/login walls and undriveable contexts, pause, and hand control to the human ("solve this and click Resume"). Partial completion (FR-AGENT-11) returns what succeeded. Set user expectations in onboarding about what is/isn't automatable. | Agent lead |
| R10 | **Memory / privacy concerns** — cross-session memory (FR-MEM-1) stores page-derived data and learned site flows locally; users may distrust an agent that "remembers," and a privacy misstep undermines the privacy-respecting differentiator. | Security | 3 | 4 | **12** | Local-first, IndexedDB-only, no first-party cloud sync of run data in v1 (NFR-PRIV-1/3). User-clearable history/memory (FR-SET-5). Free-tier-training disclosure (NFR-PRIV-4). Memory is a differentiator only if trusted — make retention visible and controllable. Start memory minimal in MVP (run scratchpad + history) and add learned-flow recall (FR-MEM-4) as a measured V1 lift. | Privacy/PM |
| R11 | **CDP debugger banner scares users** — when `chrome.debugger` is needed for trusted input, Chrome shows an un-hideable "extension is debugging this browser" banner (Constraints table) that reads as malware to non-experts and erodes trust. | Technical | 4 | 2 | **8** | Hybrid control: `scripting` synthetic events by default — no banner — and CDP only when trusted input is genuinely required (FR-BC-1/2, LOCKED #3). When CDP activates, proactively explain the banner is expected (FR-BC-3). Minimize CDP surface; most MVP flows should never trigger it. | Browser-control lead |
| R12 | **MicroLabs migration effort underestimated** — LOCKED #9 says keep GenericApp/extraction/webhook/profile patterns but FIX security, permissions, storage schema/migrations, error handling, tests/CI, performance. Reusing a codebase with those exact gaps can cost more than greenfield if the gaps are entangled. | Team | 3 | 3 | **9** | Treat reuse as **pattern reuse, not code lift** where the gaps live (security, storage, permissions). Stand up TS+ESLint+Vitest+Playwright+CI BEFORE features (synthesis "fix from day one" #4; NFR-MAINT-1). Port the safe, valued pieces (GenericApp templating, page extraction, renderers) first; rebuild key handling, storage schema, and permission model fresh. Time-box the audit-vs-rebuild decision per module. | Tech lead |
| R13 | **"One shared registry, three exposure levels" architecture bet fails** — premise #6 is OPEN; cleanly separating the agent runtime from tool apps over one Tool Registry is unproven at this scope. If it doesn't hold, we get three tangled codebases (the sprawl R5 was meant to avoid). | Technical | 3 | 4 | **12** | Tool Registry as single source of truth with schema-as-truth (architecture §3, FR-TOOLS-1/13). Build the registry + 4–5 tools in the MVP and prove the agent consumes them; only then expose the *same* tools to Tier-1 apps and skills in V1. Per-caller `allowedTools` whitelist (FR-TOOLS-14) enforces the boundary. Validate the pattern on the wedge before scaling exposure. | Architect |
| R14 | **Self-extension (AI-generated apps/skills) produces unsafe or broken configs** — generated JSON could request non-whitelisted tools/hosts or be invalid; a bad generated app erodes trust or (worse) over-reaches permissions. | Security | 3 | 3 | **9** | Re-validate every generated/imported config against schema + allowedTools/renderers/hosts allowlists before persist (FR-APPGEN-4/6, FR-SKILL-9/10). Capped auto-repair loop; NEVER persist invalid JSON (FR-APPGEN-5). Strip non-whitelisted elements (FR-APPGEN-6). Consent screen on import (FR-SKILL-9). Human review of Tier-2 code+caps before first run (FR-T2-5). This is a V1 surface, not MVP — de-risked by sequencing. | Security/Apps lead |
| R15 | **Confirmation-gate bypass under SW restart / scheduled runs** — MV3 SW idles ~30s; a resumed or unattended run could duplicate a consequential step or skip the gate (metric #2 demands 100%/0). | Technical | 2 | 5 | **10** | Per-step IndexedDB checkpointing (FR-AGENT-8, NFR-PERF-7); idempotency on consequential steps so resume never double-executes (NFR-REL-3). Unattended/scheduled consequential steps hard-pause + notify, never auto-execute (FR-HITL-5, FR-WF-6). Gate logic is a CI-tested hard path (NFR-MAINT-1). | Agent lead |
| R16 | **Competitive landscape moves under us** — Comet owns consumer mindshare (~48% agentic traffic), Gemini-in-Chrome is folding agentic in natively; Google could ship our differentiator (transparent BYO agent in Chrome) for free. | Market | 3 | 4 | **12** | Lean into what incumbents structurally won't do: BYO-key transparency, local-first privacy, data-driven self-extension, model-agnostic registry. Google-native agentic will be cloud-bound and model-locked by definition. Ship the wedge fast; defensibility is the unsolved frontier (reliability+memory+trust), not raw capability. | PM |
| R17 | **File System Access permission friction / persistence gaps** — FSA initial pick needs a gesture and persistence may require per-session re-grant (Constraints); repeated prompts annoy users and break "save to file" flows. | Dependency | 3 | 2 | **6** | First file op triggers the one-time pick (FR-FS-2); use persistent permissions on Chrome 122+ with a one-click per-session re-grant fallback (FR-FS-3). Native messaging host deferred to V2 for prompt-free access (FR-FS-4, LOCKED #4). | Platform lead |

**Coverage:** 17 risks across Technical (R1, R8, R9, R11, R13, R15), Security (R2, R3, R10, R14), Regulatory (R4), Market (R5, R6, R16), Dependency (R7, R17), Team (R12). All twelve mandated risks are present (R1 reliability, R4 Web Store/Tier-2, R11 CDP banner, R6 BYO-key, R2 prompt injection, R7 Gemini drift, R3 key exfil, R5 scope sprawl, R8 Computer Use cost, R9 CAPTCHA, R10 memory/privacy, R12 MicroLabs migration).

---

## Adversarial / Bear-Case Pass

An independent stress-test of the concept as specified. Each is the strongest version of the argument AGAINST building this; each gets a rebuttal or is conceded and converted to a tracked risk/validation item.

**BC1 — "Universal = master of none vs focused incumbents."**
The bear case: `02` shows verticals are already owned by focused players (AnswerAI=edu, True AI=moderation), and the most-used agents (Comet, Operator) are deep, not broad. A tool that tries to do ~80% of every profession's browser work will be beaten on every individual job by a specialist, and will confuse positioning.
*Response (partial concede → R5):* The defensible core is NOT breadth-of-features but the **one trustworthy agent loop** that generalizes across tasks — breadth is an emergent property of a reliable general agent + a shared registry, not 64 hand-built verticals. We concede the risk of sprawl and convert it to **R5** (managed by wedge discipline + MoSCoW). The MVP deliberately proves depth on ONE scenario (S1) before claiming breadth. Positioning should lead with the agent, not the "universal" claim.

**BC2 — "Build-from-scratch engine reinvents what browser-use/Stagehand already solved."**
The bear case: `05` says the planner/executor/validator loop, hybrid perception, and self-healing are now *table stakes* defined by mature OSS (browser-use 79k★ MIT, Stagehand 50k★ MIT with caching + self-healing). LOCKED #3 forbids forking them. We will burn months rebuilding the solved floor and arrive late with a worse loop.
*Response (rebut, with conceded validation item):* The floor is table stakes, but `05` is explicit that the **moat is the unsolved frontier — reliability on authenticated/complex flows, memory, trust — not the loop primitives.** Forking an MIT engine still leaves us owning that frontier; LOCKED #3's bet is that owning the loop end-to-end is necessary to move reliability and to avoid upstream churn on a preview-model-dependent path. **Conceded validation item:** the build-vs-borrow-patterns boundary is real cost (R1) — we mitigate by borrowing *patterns* (caching, change-observation, escalation ladder) per the architecture, not starting from zero theory. The MVP exit gate (measured VMSTCR) is precisely the test of whether the from-scratch loop is competitive; if it materially lags, revisit the engine decision before V1.

**BC3 — "Tier-2 sandbox is a Web Store + security liability for marginal benefit."**
The bear case: Tier-2 (QuickJS/SES code apps) is the single biggest review-rejection risk (R4) and a security surface (R14), yet most user value comes from Tier-1 declarative apps + the agent. We are taking on launch-blocking and breach risk for a power-user escape hatch few will use.
*Response (concede → resequence, not cut):* Largely conceded — and reflected in the roadmap. **Tier-2 is NOT in the MVP.** The wedge ships agent + Tier-1 only, establishing a clean review record. Tier-2 still ships in V1 per LOCKED #5, but as a *separately defensible* submission with a compliance rationale (NFR-COMP-2/3) and mandatory human code review (FR-T2-5). The marginal-benefit critique is answered by sequencing: we earn the right to ship Tier-2 by proving the safe core first, rather than betting the launch on it.

**BC4 — "BYO-key kills mainstream adoption."**
The bear case: requiring a Gemini key at install (FR-ONB-1) is a brutal funnel; every successful consumer AI product hides the key behind a hosted plan. Metric #6 (activation) is likely to be low, capping the market to a sliver of power users.
*Response (concede the segment, rebut the framing → R6):* Conceded that BYO-key excludes mainstream — but mainstream is **explicitly not the v1 target** (vision Primary User = power user/knowledge worker; mainstream is "Later" behind a Nano free tier). BYO-key is a deliberate trade for zero-infra, privacy, and model transparency — the exact things the target buyer demands. The risk is that even power-user activation is too high-friction; that is **R6**, measured via metric #6, with the Nano free on-ramp as the prepared escape valve.

**BC5 — "Self-extending apps + signed remote registry is platform-grade complexity for a v1."**
The bear case: AI-generated validated JSON apps, a signed Ed25519 remote registry, multi-provider adapters, import/export with consent — this is platform infrastructure (`07`) bolted onto an unproven agent. It multiplies surface area (R5, R13, R14) and review risk before the core is validated.
*Response (rebut via sequencing):* The registry-as-data and self-extension are LOCKED v1 bets *because* they collapse future model/app churn from resubmissions into data edits — they lower long-run cost (R7 mitigation). But they are **downstream of the MVP**: the MVP needs only a minimal bundled model registry and zero self-extension. We concede the complexity and answer it by gating: prove the loop (MVP) → add the platform (V1). The architecture's "build capability once, expose three ways" is the structural bet that this *isn't* three codebases (R13, validated on the wedge first).

**BC6 — "The whole thing depends on a preview model and a single vendor's API."**
The bear case: Computer Use is preview and paid-only; Gemini pricing/lineup drifts (R7); the entire automation story rests on Google not changing or pulling capabilities. That is existential single-vendor dependency.
*Response (rebut, partly conceded → R7):* DOM-first design (LOCKED #3) means the *core* loop does NOT depend on Computer Use — vision is a fallback tier, so a Computer-Use change degrades gracefully rather than breaking the agent. The registry-driven OpenAI-compatible adapter (FR-MR-9/10) means the product is model-agnostic by construction; Gemini is the default, not a hard dependency. Conceded residual is **R7** (model drift), mitigated by the signed remote registry and tiered fallback. The single-vendor risk is real but architecturally bounded, not existential.

---

## MoSCoW Prioritization

Functional requirements from `requirements.md` categorized by release gate. **Must = MVP** (the wedge), **Should = V1** (full public release, includes LOCKED features), **Could = V2** (expansion), **Won't = out of scope** (anti-goals). Discipline note: the MVP Must-Have set is deliberately small — it is the agent loop + the tools/HITL/transparency it needs to be trustworthy, plus the BYO-key gate. Everything that makes Chrome_Buddy a *platform* (Tier-1/2 apps, generation, skills, workflows, remote registry, media) is V1, not MVP — consistent with the scope-tension reconciliation: LOCKED "v1" = our **V1 public release**, not the MVP.

### Must Have — MVP / Wedge (the trustworthy agent loop)
- **Agent loop:** FR-AGENT-1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12, -13, -14, -17 (plan→act→observe→reflect, visible plan, resumable, budgets, recovery, partial completion, vision escalation, current+related tabs).
- **Tools (the wedge subset):** FR-TOOLS-1, -2, -3, -4, -5, -6, -7, -11, -12, -13 (registry, navigate/click/type/scroll, read_dom, screenshot, extract, summarize, ask_user, consequential flag, machine-readable schema).
- **HITL (non-negotiable):** FR-HITL-1, -2, -3, -4, -6, -7, -8 (confirmation gate, payload/target shown, edit-before-approve, Computer-Use safety protocol, missing-target prompt, audit log, CAPTCHA/login pause).
- **Browser control:** FR-BC-1, -5, -6, -7 (DOM-first synthetic events, Computer-Use fallback tier, undriveable-context detection, PageContext wait-for-stable).
- **LLM client:** FR-LLM-1, -2, -3, -4, -5, -9, -10, -11 (BYO key in session storage, single shared client, Gemini model tiers, function calling, JSON mode, Computer-Use loop, live cost metering, tiered fallback).
- **Memory (minimal):** FR-MEM-1, -2, -3 (IndexedDB persistence, shareable scratchpad, browsable history).
- **Filesystem (minimal, for outputs):** FR-FS-1, -2 (FSA root pick, first-op triggers pick).
- **UI (the panel):** FR-UI-1, -2, -3, -4, -5, -6, -9 (side panel, icon rail, chat home, always-on via pin, live plan/steps/cards/cost, inline ask_user, done card with provenance + Save-as-skill stub).
- **Onboarding:** FR-ONB-1, -2, -3 (BYO-key walkthrough, live key validation, feature gating).
- **Settings (minimal):** FR-SET-1 (key mgmt, folder, budget guards), FR-SET-4 (default model).
- **Minimal model registry:** FR-MR-1, -2, -3 (declarative registry as data, bundled default floor, pricing/capability fields) — bundled only, no remote update yet.

### Should Have — V1 (full public release; LOCKED features land here)
- **Skill promotion + management:** FR-AGENT-15, -16; FR-SKILL-1..11 (call_skill, memory-assisted lift, full skill schema/editor/import-export/consent).
- **Tier-1 declarative apps:** FR-APP-1..15 (GenericApp interpreter, input UI, pipeline, renderers, disambiguation, preview, Hand-to-Agent, graceful degrade).
- **App generation (NL → validated JSON):** FR-APPGEN-1..12.
- **Tier-2 sandboxed code apps:** FR-T2-1..7 (QuickJS/SES sandbox, capability bridge, human review) — LOCKED #5; submitted with compliance rationale (R4).
- **Workflows:** FR-WF-1, -2, -4, -5, -6, -7 (skill+trigger, NL/linear front doors, manual/schedule/event triggers, resumable, unattended gate, view + import/export).
- **Full model/provider registry:** FR-MR-4, -5, -6, -7, -8, -9, -10, -11, -12, -13 (one-line model add, signed remote update, in-app editor, adapters, OpenAI-compatible provider, Test button) — LOCKED #6.
- **Tools (platform-completing):** FR-TOOLS-8 (call_skill), -9 (send_webhook), -10 (read/write_file), -14 (allowedTools whitelist).
- **Browser control (hardening):** FR-BC-2, -3, -4 (CDP-when-needed + banner warning, screenshot stitching).
- **Integrations:** FR-INT-1, -2, -3 (webhooks, host perms, gated consequential webhooks).
- **LLM extras:** FR-LLM-6, -7, -8, -12 (thinking levels, streaming, Nano on-device path, mid-task model switch).
- **Memory lift:** FR-MEM-4 (learned-flow recall, metric #3).
- **HITL automation:** FR-HITL-5 (unattended hard-pause), FR-WF-6.
- **Settings/profile:** FR-SET-2, -3, -5 (profile, per-app integration config, data-retention controls).
- **Filesystem:** FR-FS-3 (persistent permissions).
- **Media (light):** FR-MEDIA-1 (speech-to-text input).
- **UI:** FR-UI-7, -8 (per-step "vision used" marker, Apps grid + New app entry).
- **Skill self-healing:** FR-WF-8, -9.

### Could Have — V2 (expansion)
- **Native messaging filesystem:** FR-FS-4 (prompt-free always-on access) — LOCKED #4 phased.
- **Recorder front door for workflows:** FR-WF-3.
- **Advanced memory / RAG:** FR-MEM-5 (embeddings, semantic recall).
- **Capability handling polish:** FR-MR-14, -15, -16 (defensive probing, auto-route, stale-pricing badge) — Should-leaning; land as registry matures.
- **DOM-acting generated apps:** FR-BC-8 (`chrome.userScripts` for Tier-2 DOM apps).
- **Media suite:** FR-MEDIA-2, -3, -4 (TTS, image gen, image edit).
- **In-page overlay UI:** FR-UI-10.
- **Parallel research / shadow browsers** (post-v1 per vision; differentiator from `05`).
- **App/skill sharing catalog / marketplace** (vision Secondary Users "matures later").

### Won't Have (out of scope — anti-goals)
- **Single-vertical product** (edu/moderation/CRM niche) — anti-goal #1.
- **Cloud-locked / model-opaque architecture** — anti-goal #2.
- **Fetch-and-eval of remote code / remote interpreter** — anti-goal #3; NFR-SEC-3.
- **CAPTCHA / bot-detection defeater** — anti-goal #4 (we detect-and-pause, FR-HITL-8).
- **Vision-first / screenshot-loop-primary agent** — anti-goal #5 (vision is fallback only).
- **Node-graph / drag-and-drop workflow IDE** — anti-goal #6 (workflows are data + linear editor).
- **Fire-and-forget autonomous agent for consequential actions** — anti-goal #7 (HITL is non-negotiable).
- **Mainstream no-key onboarding in v1** — gated behind future Nano free tier (vision Secondary Users).

---

## MVP Definition — The Narrowest Wedge

**The wedge (one sentence):** A pinned side-panel agent that completes a real multi-step DOM-first task across the current and a few related tabs, showing a visible plan and live cost, asking before any consequential action, and recording the run to local history — proving that a self-built agent can be both reliable enough to finish the work and trustworthy enough that the user approves every consequential step.

**User scenario served:** **Scenario S1** (the competitor-pricing agent) — the critical path. Vision-scope names S1 as the flagship demo of the JTBD: "research-gather-extract-fill-act across several tabs without babysitting, trusting it because I can see and approve every consequential step." All other scenarios (S2 Tier-1 app, S3 app generation, S4 skills/workflows, S5 model adoption) are downstream of proving this loop.

**Only the Must-Have FR IDs it needs:**
- Agent loop: FR-AGENT-1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12, -13, -14, -17
- Tools: FR-TOOLS-1, -2, -3, -4, -5, -6, -7, -11, -12, -13
- HITL: FR-HITL-1, -2, -3, -4, -6, -7, -8
- Browser control: FR-BC-1, -5, -6, -7
- LLM client: FR-LLM-1, -2, -3, -4, -5, -9, -10, -11
- Memory: FR-MEM-1, -2, -3
- Filesystem: FR-FS-1, -2
- UI: FR-UI-1, -2, -3, -4, -5, -6, -9
- Onboarding: FR-ONB-1, -2, -3
- Settings: FR-SET-1, -4
- Model registry (bundled-only): FR-MR-1, -2, -3
- Cross-cutting NFRs that gate the wedge: NFR-SEC-1, -2, -6 (key hygiene + injection); NFR-REL-1, -2, -3 (VMSTCR, gate integrity, resumability); NFR-COST-1, -2; NFR-MAINT-1 (CI/tests on loop + gate from day one).

**Simplest architecture (subset of the full sketch):**
- **Background SW** hosting the hand-built Agent Runtime (Planner/Executor/Validator) + scratchpad checkpointing.
- **Tool Registry** with ~10 tools (navigate/click/type/scroll/read_dom/screenshot/extract/summarize/ask_user + consequential flagging) — single source of truth, schema-as-truth.
- **LLM Client** on `@google/genai`: Gemini function calling, JSON mode, Computer-Use fallback loop, live cost metering, tiered fallback. BYO key in `storage.session`, calls from SW only.
- **PageContext service** (the only page reader, wait-for-stable, injection-fenced) + **hybrid Browser Control** (scripting-first synthetic events; Computer-Use vision fallback).
- **Memory** = IndexedDB scratchpad + run history (no embeddings, no learned-flow recall yet).
- **Side Panel** (React 19/Vite/Tailwind) with rail + chat: live plan, step log, result cards, inline confirmation cards, cost meter, done card.
- **FSA** minimal (root pick on first save). **Onboarding** BYO-key walkthrough.
- **Bundled-only model registry** (no remote update, no in-app editor, no multi-provider adapters).
- **Excluded from MVP:** Tier-1/Tier-2 apps, app generation, skills, workflows, signed remote registry, OpenAI-compatible adapters, webhooks, Nano on-device, media, native host, learned-flow memory.

**Estimated time to build:** ~**10–14 weeks** for a small team (2–3 engineers), realistically. Rough breakdown: ~2 weeks foundation (TS/Vite/CI/storage schema/permissions/MicroLabs pattern port — done first per synthesis); ~4–6 weeks the agent loop + Tool Registry + LLM client + hybrid browser control (the differentiated, highest-risk core, R1); ~2 weeks HITL gate + injection fencing + resumability (the hard correctness paths, R2/R15); ~2 weeks side-panel UI + onboarding + minimal memory/FSA; ~1–2 weeks VMSTCR instrumentation + reliability hardening against a task suite before the exit gate. Reliability iteration (R1) is the variable that can extend this — the loop is "done" only when measured VMSTCR clears the exit bar, not when it runs once.

**What it validates:**
- Premise #2 — can a self-built DOM-first loop hit *competitive* reliability (the highest-risk bet)? Measured by VMSTCR.
- Premise #1 — does the model-transparent, BYO-key, privacy-respecting agent have a real lane (early-user pull)?
- Premise #5 (partial) — is BYO-key onboarding tolerable for the power-user target (metric #6)?
- The non-negotiable: 100% consequential-action gating, 0 unauthorized executions (metric #2), including under SW restart.
- Premise #6 (partial) — does the agent cleanly consume a shared Tool Registry (the foundation the three-layer bet rests on)?

**What it does NOT validate:**
- Premise #3 — Web-Store compliance of Tier-2 code sandbox (R4) — deferred to V1 submission.
- Premise #4 — cross-session memory as a differentiator (FR-MEM-4 lift, metric #3) — only minimal history is in MVP.
- Premise #6 (full) — the "one registry, three exposure levels" platform bet (apps + skills both consuming the registry) — only the agent consumes it in MVP.
- Self-extension adoption (metric #5), self-service model adoption (S5), workflow scheduling, multi-provider breadth — all V1.

---

## Phased Roadmap

| Phase | Goal (value unlocked) | Key Requirements (FR IDs) | Validation | Complexity | Depends-on |
|-------|----------------------|---------------------------|------------|:---:|-----------|
| **Phase 1 — MVP / Wedge** (internal → private beta) | **Prove the trustworthy agent.** A user watches the agent finish a real multi-step task (S1), approves each consequential step, and sees live cost — the single thing that proves the entire concept. Establishes a clean Web Store review record with a minimal, compliant submission (agent only, no code sandbox). | Agent FR-AGENT-1..14,17; Tools FR-TOOLS-1..7,11,12,13; HITL FR-HITL-1..4,6,7,8; BC FR-BC-1,5,6,7; LLM FR-LLM-1..5,9,10,11; Mem FR-MEM-1,2,3; FS FR-FS-1,2; UI FR-UI-1..6,9; Onb FR-ONB-1,2,3; Set FR-SET-1,4; MR FR-MR-1,2,3. NFRs: SEC-1,2,6; REL-1,2,3; COST-1,2; MAINT-1. | VMSTCR clears exit bar (R1); metric #2 = 100%/0; metric #6 activation baseline; injection red-team passes; resumes across SW restart with no duplicate consequential steps. | **L** | Foundation (TS/CI/storage/permissions); MicroLabs pattern port (PageContext, React stack). |
| **Phase 2 — V1 Public Release** (full LOCKED surface) | **Become the universal platform.** Turn the proven loop into the three-layer product: focused micro-apps, self-extending app generation, sandboxed code apps, saved skills + scheduled workflows, a future-proof model/provider registry, voice input, files, and webhooks — "build a capability once, expose it three ways." | Skills FR-SKILL-1..11, FR-AGENT-15,16; Tier-1 FR-APP-1..15; AppGen FR-APPGEN-1..12; Tier-2 FR-T2-1..7; Workflows FR-WF-1,2,4..9; Registry FR-MR-4..16; Tools FR-TOOLS-8,9,10,14; BC FR-BC-2,3,4; Integrations FR-INT-1,2,3; LLM FR-LLM-6,7,8,12; Mem FR-MEM-4; HITL FR-HITL-5; Set FR-SET-2,3,5; FS FR-FS-3; Media FR-MEDIA-1; UI FR-UI-7,8. NFRs: SEC-3,4,5,7; COMP-1,2,3; PRIV-1..4; REL-4; A11Y-1,2; COST-3. | Metric #7 (Web Store pass incl. Tier-2, R4); metric #3 (memory-assisted lift, premise #4); metric #4 (transparency engagement); metric #5 (self-extension adoption); S5 self-service model adoption works; VMSTCR holds/improves at broader scope. | **L** | Phase 1 (Tool Registry, agent loop, shared LLM client, PageContext, gate). |
| **Phase 3 — V2 Expansion** (depth + reach) | **Extend reach and depth.** Prompt-free filesystem via native host, parallel multi-tab/shadow-browser research (the `05` differentiator), advanced semantic memory/RAG, DOM-acting generated apps, full media suite, recorder, and an app/skill sharing catalog/marketplace. | FS FR-FS-4; Mem FR-MEM-5; WF FR-WF-3 (recorder); BC FR-BC-8; Registry polish FR-MR-14,15,16; Media FR-MEDIA-2,3,4; UI FR-UI-10; + parallel research and sharing catalog (vision post-v1). | Memory-recall hit rate at scale; parallel-research throughput vs linear; marketplace import/share usage; native-host adoption; sustained VMSTCR on harder/long-horizon flows. | **M–L** | Phase 2 (skills/apps/registry/memory foundations); native-host packaging + code-signing infra. |

---

## Metrics Framework

Tied to the seven vision-scope Success Criteria (VMSTCR north star + #1–#7). Each phase names which metrics must move.

**Phase 1 — MVP / Wedge** (prove reliability + trust)
- **VMSTCR (north star)** — instrumented from the first internal build; must clear a credible exit bar before private beta. *Proves premise #2, the highest-risk bet.*
- **#2 Confirmation-gate integrity** — 100% of consequential actions gated, 0 unauthorized executions, sustained across SW restarts. *Hard pass/fail; non-negotiable.*
- **#6 Activation through BYO-key onboarding** — baseline the install → valid-key → first-completed-task funnel. *Tests premise #5 / R6 early, even in beta.*
- *Leading indicators:* per-step overhead (NFR-PERF-5), resumability success rate (NFR-REL-3), injection red-team pass rate (NFR-SEC-6), Computer-Use fallback frequency (cost proxy, R8).

**Phase 2 — V1 Public Release** (prove platform + differentiators)
- **#7 Web Store first-submission pass** — binary; includes the Tier-2 sandbox (R4). *Gatekeeper that can block launch.*
- **#3 Memory-assisted task lift** — measurable step/time reduction on repeat tasks; memory-recall hit rate (FR-MEM-4). *Validates premise #4 (cross-session memory differentiator).* Within 60 days of V1.
- **#4 Transparency engagement** — % of sessions viewing model/cost or switching model mid-task. *Confirms the cheap differentiator is valued.* First 90 days.
- **#5 Self-extension adoption** — N validated user-created/AI-generated apps or skills per active user; import/export usage. *Proves the data-driven extensibility bet (premise #6, `07`).* Within 90 days.
- **#6 Activation** — full public funnel; trigger the Nano free on-ramp prioritization if too low (R6).
- *Continuing:* VMSTCR (must hold or improve at the broader public scope) and #2 gate integrity (sustained, now public-facing).

**Phase 3 — V2 Expansion** (prove depth + reach)
- **VMSTCR on harder flows** — sustained completion rate as long-horizon/parallel/authenticated tasks enter scope (`05` frontier #1/#5).
- **#3 at scale** — memory-recall hit rate as the corpus grows (drives the FR-MEM-5 RAG decision).
- **#5 at scale** — sharing-catalog/marketplace import + share volume; native-host adoption.
- *New leading indicators:* parallel-research throughput vs linear baseline; native-host install/retention.

---

*End of risk matrix, adversarial pass, prioritization & roadmap.*
