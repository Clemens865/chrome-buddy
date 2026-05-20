# Chrome_Buddy — Validation Plan

> What must be true for Chrome_Buddy to succeed, and how to test each assumption *before* committing to a full build. Grounded in `vision-scope.md`, `risks-priorities.md`, `user-journeys.md`, LOCKED `scope-decisions.md`, and research `05-agentic-landscape-deep.md`.
>
> Operating principle: spend days, not months, killing the assumptions that can kill the product. The three highest-leverage things to learn — agent reliability, Tier-2 sandbox isolation, and Web Store policy posture — are all cheap technical/policy spikes that should happen FIRST, before any production code. This plan sequences them.

---

## Inherited From Research

The vision/risk layer already separated what is **CONFIRMED** from what is **OPEN**. The OPEN premises and the bear cases are the highest-priority validation targets — everything CONFIRMED needs only spot-checking; everything OPEN is a place the product can die.

**Demand reality (carried forward, unchanged):** **STRONG for the category / MODERATE-to-prove for our specific wedge.**
- *Strong, validated:* the market sustains 15+ assistants at $4–13/mo, automation tools command $20–33/mo (Bardeen/Zapier), and Comet alone drove ~48% of tracked agentic web traffic in early 2026 (`05`). People want browser AI and pay for it. **We do not need to re-validate that browser AI is wanted.**
- *Moderate / unproven:* the specific combination — privacy-respecting, model-transparent, *reliable* multi-step agency with cross-session memory — is unproven precisely because no one has shipped it well. ~1-in-4 complex real flows still fail industry-wide (`05`), the failure mode that sank Operator and Mariner. **Demand for the promise is strong; demand for our execution is what the wedge MVP must validate.** So the validation burden is on *execution and trust*, not market existence.

**OPEN premises pulled forward as primary validation targets (from `vision-scope.md`):**
| Premise | Status (inherited) | Why it leads the plan |
|---------|--------------------|------------------------|
| #2 — a self-built DOM-first + vision-fallback loop can hit *competitive* reliability | **OPEN (highest risk)** | Drives the VMSTCR north star; `05` says the floor is reachable but the frontier (reliability on complex/authenticated flows) is unsolved. This is the make-or-break. |
| #5 — BYO Gemini key is acceptable onboarding friction for the target user | **OPEN** | Make-or-break activation funnel (metric #6); power users tolerate it, mainstream may not — and mainstream is explicitly deferred. |
| #6 — "one shared registry, three exposure levels" is buildable without three codebases | **OPEN (architectural bet)** | If it fails we get the sprawl (R5) the architecture was meant to prevent. |
| #4 — cross-session memory feeding automations is a real, unfilled differentiator | **CONFIRMED as a gap / OPEN as execution** | The gap is real (`02`/`05`); whether *our* memory produces measurable lift is post-MVP. |
| #1 — model-transparent, BYO-key, privacy-respecting agent has an open lane | **CONFIRMED (gap) / OPEN (pull)** | No incumbent occupies the lane; whether users actually *pull* for it is an early-user signal. |
| #3 — self-extending apps + remote model registry are Web-Store-compliant | **CONFIRMED as feasible-as-data / OPEN as reviewer judgment** | Feasibility is established; whether a *human reviewer* reads QuickJS/SES as the banned interpreter pattern is the residual risk (R4). |

**Bear-case arguments carried forward as validation targets (from `risks-priorities.md` adversarial pass):**
- **BC2 — "build-from-scratch reinvents what browser-use/Stagehand solved."** Conceded as real cost; the explicit test is the MVP's measured VMSTCR vs. a borrowed-engine baseline. *→ validated by Spike A.*
- **BC3 — "Tier-2 sandbox is a Web Store + security liability for marginal benefit."** Largely conceded; Tier-2 is resequenced out of the MVP. *→ validated by Spike B + Spike C before any V1 commitment.*
- **BC4 — "BYO-key kills mainstream adoption."** Segment conceded (mainstream is "Later"); residual risk is whether *power-user* activation is tolerable. *→ validated by metric #6 baseline + landing-page test.*
- **BC1 — "universal = master of none."** Positioning risk; lead with the agent, not the "universal" claim. *→ validated by landing-page / message test.*
- **BC6 — "depends on a single preview model / vendor."** Architecturally bounded (DOM-first core, model-agnostic adapter); residual is model drift. *→ technical spike on adapter abstraction.*

---

## Critical Assumptions

Both inherited research premises and new PRD-level assumptions (architecture, UX, BYO-key, self-built-loop reliability, the confirmation gate, AI-generated configs, Web Store approval). Confidence is the team's honest prior; "What Breaks If Wrong" names the concrete failure.

| # | Assumption | Confidence | Evidence | What Breaks If Wrong |
|---|------------|:---:|------------|----------------------|
| A1 | A self-built DOM-first plan→act→observe→reflect loop can hit a *competitive* completion rate on real multi-step tasks (the VMSTCR bar) without forking an OSS engine. | **Low** | `05`: DOM distillation alone hit 73.1% WebVoyager (floor reachable); but ~1-in-4 complex flows fail industry-wide. Premise #2 OPEN; R1 score 25; BC2 conceded. | The product's core promise. If the loop can't finish real work reliably, nothing downstream matters — Chrome_Buddy is just another assistant. Pivot to forking Stagehand/browser-use, or stop. |
| A2 | The HITL confirmation gate holds at 100% (0 unauthorized consequential executions) — including across MV3 SW restart / resumed runs — and prompt injection from page DOM can NEVER silently trigger a consequential tool. | **Medium** | scope-decisions HITL non-negotiable; metric #2; R2 (injection, score 20) + R15 (SW-restart bypass, score 10). Computer Use returns `require_confirmation` (`04`). | Trust is the product. One unauthorized send/buy/delete, or one injection-driven action, destroys credibility irrecoverably and likely triggers Web Store / user backlash. |
| A3 | Users will *value* the confirmation gate as control, not resent it as friction — they approve consequential steps deliberately rather than reflexively click-through or churn from "too many prompts." | **Low–Medium** | Asserted in vision/journeys ("nothing touched my doc until I said so"); no behavioral evidence. New PRD-UX assumption, untested. | If users reflexively approve everything, the gate is theater (no real safety). If they find it annoying, they disable/abandon — undermining both the safety story and retention. The whole "trust" differentiator hinges on the gate being *welcomed*. |
| A4 | BYO Gemini key is acceptable activation friction for the *power-user* target — a clean walkthrough + live key-test gets an acceptable % of installs to a completed first task. | **Low–Medium** | Premise #5 OPEN; R6 score 16; BC4 (segment conceded). Zero-infra, ships immediately, but the funnel is unproven. | If even power-user activation craters, the install→value funnel breaks and the Nano free on-ramp must be pulled forward (de-scoping the BYO-key purity bet) — or the product never activates a base. |
| A5 | A bundled QuickJS-wasm / SES sandbox can provide *real* isolation (no escape to page DOM, network, storage, or other apps) with a usable postMessage capability bridge — for Tier-2 code apps. | **Medium** | scope-decisions #5; architecture; R14 (unsafe configs, score 9). Pattern is known-good in principle; our specific bridge + caps model is unbuilt. | If isolation leaks, a generated/imported Tier-2 app becomes an arbitrary-code security hole with credential-adjacent reach — catastrophic, and self-inflicted. Tier-2 must be cut or rebuilt. |
| A6 | Chrome Web Store reviewers will accept the Tier-2 sandbox + scoped CDP (`chrome.debugger`) + (later) `userScripts` posture as compliant "data + bundled sandbox," not as the banned remote-code/interpreter pattern. | **Low–Medium** | Premise #3 CONFIRMED as *feasible-as-data*; R4 score 16; bright line understood (`07`/scope #8). But reviewer *judgment* on QuickJS+CDP+userScripts together is unknown. Metric #7 is binary. | Rejection blocks launch entirely (metric #7). Repeated rejection forces cutting Tier-2/CDP from the public build, gutting the self-extension and trusted-input stories. |
| A7 | AI-generated Tier-1 JSON app-configs are good enough — Gemini reliably emits valid, in-schema, correctly-scoped configs (after a capped auto-repair loop) that produce useful output on a real page, often enough that "describe an app" feels magical, not broken. | **Medium** | Scenario 3; FR-APPGEN; R14. MicroLabs proves the GenericApp interpreter works; NL→config generation quality at acceptable yield is unproven. | If generation mostly produces invalid/over-scoped/useless configs, the "mint your own tool by talking" magic moment (S3) fails — a headline V1 differentiator collapses to a frustrating toy. |
| A8 | The "one shared Tool Registry, three exposure levels" architecture holds — the agent, Tier-1 apps, and skills can all cleanly consume the *same* registry with per-caller `allowedTools` whitelisting, without three tangled codebases. | **Medium** | Premise #6 OPEN; R13 score 12; strong precedent in MicroLabs' GenericApp+config-registry pattern (`01`). The agent-runtime/tool-app separation at this scope is unproven. | If it doesn't hold, capability must be built three times (the sprawl R5 warns of) — blowing scope, schedule, and the structural defense against "universal = unfocused." |
| A9 | Cross-session memory of learned site flows produces *measurable* lift — repeat runs are faster/cheaper/fewer-steps than first runs — and users trust an agent that "remembers." | **Low** | Premise #4 (gap CONFIRMED, execution OPEN); metric #3; R10 (memory/privacy, score 12). The gap is real (`02`/`05`); our lift is unmeasured; trust in "it remembers" is asserted. | If memory yields no measurable lift, premise #4 (a core differentiator) is a feature checkbox, not a moat. If users distrust "remembering," the privacy story is damaged. |
| A10 | DOM-first execution covers enough real-world tasks that vision (Computer Use) stays a rare, marked fallback — keeping cost/latency acceptable and avoiding the Operator/Mariner cost trap. | **Medium** | scope-decisions #3; anti-goal #5; `05` (DOM-first pivot, 73.1% no-vision); R8 (cost/latency, score 12). | If most real pages force vision escalation, BYO-key budgets blow up, latency NFRs fail, and we recreate the exact cost/brittleness problem that killed vision-first agents. |
| A11 | The target lane is real *pull*, not just a gap — power users will actually adopt a model-transparent, BYO-key, privacy-first agent over free cloud incumbents (Comet, Gemini-in-Chrome). | **Medium** | Premise #1 CONFIRMED as a *gap*; R16 (Google could ship it free, score 12); BC1 positioning risk. No incumbent occupies the lane, but pull is unmeasured. | If transparency/privacy/BYO aren't actually decisive purchase drivers, Google's free native agent wins and our differentiators are nice-to-haves, not switching reasons. |
| A12 | MicroLabs reuse is a net accelerant — porting GenericApp/extraction/renderer *patterns* (while rebuilding key handling, storage, permissions) is cheaper than greenfield. | **Medium** | scope-decisions #9; R12 score 9. Working 64-app predecessor exists, but the gaps (security, storage, permissions) are exactly where reuse is riskiest. | If the gaps are entangled with the reusable code, reuse costs *more* than greenfield — a hidden schedule bomb in the "10–14 week" MVP estimate. |

---

## Validation Methods

For each Medium/Low-confidence assumption: how to test it, scope, success/failure signals, time, and cost. **Prioritized by (risk if wrong) × uncertainty** — the cheap technical/policy spikes that gate everything come FIRST. (A2's gate-integrity correctness and A5's isolation are tested as engineering spikes with CI red-teaming, not interviews.)

### TIER 0 — Do these FIRST, before any production code (cheap spikes that can kill or reshape the build)

**V-A1 — Thin agent-loop spike (validates A1; addresses BC2, R1; the single highest-leverage test)**
- **Method:** Technical spike / prototype test.
- **What to do:** Build a *throwaway* DOM-first plan→act→observe→reflect loop on Gemini function calling — read_dom/navigate/click/type/extract only, no UI, no gate, no memory, hardcoded BYO key. Borrow the patterns from `05` (action history to break loops, change-observation recovery, escalation ladder). Run it against **10 real, representative multi-step tasks** drawn from Scenario S1's shape (search → find canonical page → extract structured data → assemble), spanning easy static pages to messy JS/SPA pricing pages. In parallel, run the *same 10 tasks* through an off-the-shelf browser-use or Stagehand baseline to get a reference completion rate.
- **Scope / sample:** 10 tasks × ~3 runs each (30 runs) per stack; 1 engineer.
- **Success signal:** Self-built loop completes ≥ 6–7/10 tasks end-to-end, and lands within ~10–15 points of the OSS baseline — i.e., the from-scratch path is plausibly competitive and improvable.
- **Failure signal:** Self-built loop completes ≤ 4/10, *or* trails the OSS baseline by a wide, non-closing margin after iteration — i.e., we'd be rebuilding the solved floor worse and slower (BC2 realized).
- **Time:** 1–2 weeks. **Cost:** ~1 eng-week + < $50 Gemini tokens.

**V-A5 — Tier-2 sandbox isolation spike (validates A5; addresses BC3, R14)**
- **Method:** Technical spike.
- **What to do:** Stand up a QuickJS-wasm (or SES) sandbox in a bundled iframe with a postMessage capability bridge exposing only whitelisted caps. Write a small **escape-attempt corpus** (try to reach page DOM, `fetch`/network, `chrome.*`, `storage.local`, the host window, and a sibling app) and confirm every attempt fails. Confirm the bridge round-trips a real capability call (e.g., a date-math transform) cleanly.
- **Scope:** ~15–20 escape vectors; 1 engineer.
- **Success signal:** 0 successful escapes; capability bridge works for a real Tier-2 use case; `.wasm` ships readable/non-obfuscated.
- **Failure signal:** Any escape to DOM/network/storage/other-app, or the bridge can't express a useful capability without leaking surface. → Cut Tier-2 from V1 or redesign isolation before committing.
- **Time:** 1 week. **Cost:** ~1 eng-week.

**V-A6 — Web Store policy pre-check (validates A6; addresses BC3, R4; the binary launch gate)**
- **Method:** Web Store pre-review / policy analysis.
- **What to do:** Two parts. (1) Submit a *minimal real extension* exercising the riskiest posture in isolation — bundled QuickJS/SES "run this bundled-data script," scoped `chrome.debugger` (CDP) usage with the expected banner, and a stubbed `userScripts` declaration — with a written single-purpose rationale ("AI workspace for building/running browser micro-tools"). (2) In parallel, do a close-read of current MV3 policy + Developer Program Policies against this exact posture and assemble a reviewer appeal packet. Use the MVP's agent-only, no-Tier-2 submission as the *clean first relationship*; this spike de-risks the *V1* Tier-2 submission ahead of time.
- **Scope:** 1 throwaway extension submission + policy analysis; PM/compliance + 1 eng.
- **Success signal:** The minimal posture passes review (or reviewer feedback is specific and addressable), confirming the "data + bundled sandbox" framing reads as compliant.
- **Failure signal:** Rejection citing remote-code/interpreter or CDP misuse with no clear remediation path → Tier-2/CDP posture must change before V1 commitment (resequence or cut, per R4).
- **Time:** 2–4 weeks (review latency dominates; start it early so it runs in the background). **Cost:** $5 dev account + ~0.5 eng-week.

### TIER 1 — Validate during/alongside MVP build

**V-A2 — Gate integrity + injection resilience (validates A2; addresses R2, R15)**
- **Method:** Technical spike + CI red-team corpus.
- **What to do:** Build the confirmation-gate logic and the PageContext injection fence as the *first* correctness paths, with a CI suite that (a) asserts no consequential tool fires without an explicit approval token, including after a forced SW restart mid-run and on a resumed/checkpointed run (idempotency check — no double-execute); and (b) runs a prompt-injection corpus of malicious page-DOM payloads attempting to drive a consequential tool, asserting the gate still fires and instructions-from-content are fenced as data.
- **Scope:** ~30–50 gate/resume cases + ~30 injection payloads in CI; security + agent lead.
- **Success signal:** 100% of consequential actions gated across all cases incl. SW-restart/resume; 0 injection payloads trigger an unapproved action.
- **Failure signal:** Any unauthorized execution or any injection that reaches a consequential tool → hard blocker; MVP cannot exit until green.
- **Time:** ~2 weeks (part of MVP). **Cost:** in-build eng time.

**V-A8 — Shared-registry architecture proof (validates A8; addresses R13, R5)**
- **Method:** Technical spike inside MVP.
- **What to do:** Build the Tool Registry as single source of truth (schema-as-truth) with ~10 tools and prove the *agent* consumes them via per-caller `allowedTools`. Then stub a single Tier-1 app and a single skill that consume the *same* registry entry for one capability (e.g., summarize) — proving "build once, expose three ways" without forking the implementation.
- **Scope:** 1 capability exposed 3 ways; architect + 1 eng.
- **Success signal:** One capability is invoked by agent, app, and skill through one registry definition + whitelist, no duplicated tool logic.
- **Failure signal:** Exposing the capability to a second consumer requires re-implementing it → the three-codebase risk (R13) is materializing; rethink the boundary before V1.
- **Time:** ~1 week (within MVP). **Cost:** in-build eng time.

**V-A10 — DOM-vs-vision coverage measurement (validates A10; addresses R8)**
- **Method:** Instrumentation on the V-A1 spike + MVP.
- **What to do:** During V-A1 and the MVP task suite, log per-task whether DOM-first succeeded or vision fallback was required, plus per-run token/$ and latency. Compute the vision-escalation rate and cost distribution.
- **Scope:** Same task suite as V-A1; no extra build.
- **Success signal:** Vision fallback needed on a minority of tasks (rough target < ~25–30%); per-run cost/latency within budget caps.
- **Failure signal:** Majority of real pages force vision → cost/latency NFRs at risk; revisit perception strategy / budget caps.
- **Time:** free (rides on V-A1/MVP). **Cost:** ~0.

**V-A12 — MicroLabs port time-box (validates A12; addresses R12)**
- **Method:** Technical spike (audit-vs-rebuild decision per module).
- **What to do:** Time-boxed (≤ 1 week) attempt to port the *safe, valued* MicroLabs pieces first — GenericApp templating, page-extraction, renderers — onto the new TS/CI/storage/permissions foundation, while explicitly rebuilding key handling, storage schema, and permissions fresh. Track actual effort vs. a greenfield estimate per module.
- **Scope:** 2–3 modules; tech lead.
- **Success signal:** Reusable pieces port cleanly in well under the greenfield estimate; the gaps are isolatable.
- **Failure signal:** Reuse drags in the security/storage gaps and exceeds greenfield cost → rebuild those modules; correct the MVP schedule.
- **Time:** ≤ 1 week. **Cost:** ~1 eng-week.

### TIER 2 — User/behavioral validation (interviews, prototype usability, landing page)

**V-A3 — Confirmation-gate UX test (validates A3; the most under-evidenced UX assumption)**
- **Method:** Prototype usability test + user interviews.
- **What to do:** Put the clickable MVP (or a faithful prototype of the plan→step-log→inline-confirmation-card flow) in front of target power users running an S1-shaped task. Observe: do they *read* the confirmation payload before approving, or reflexively click? Do they perceive the gate as control or as friction? Probe with interviews after.
- **Scope / sample:** 6–8 target power users (researchers/analysts/sales/ops); moderated sessions.
- **Success signal:** Majority read and engage with payloads, describe the gate as reassuring/in-control, and at least once edit-before-approve; none ask to disable it.
- **Failure signal:** Most reflexively approve without reading (gate is theater) or call it annoying/want it off → redesign gate cadence (e.g., batch low-risk, reserve hard gate for truly consequential) before relying on it as the trust story.
- **Time:** 1–2 weeks. **Cost:** ~$600–1,200 in incentives + research time.

**V-A4 — BYO-key activation test (validates A4; addresses R6, BC4)**
- **Method:** Prototype test + metric #6 baseline + interviews.
- **What to do:** Have target users go through the real BYO-key walkthrough (acquire a Gemini key → paste → live test-call → first task) unaided. Instrument the install→valid-key→first-completed-task funnel. Interview drop-offs.
- **Scope / sample:** 8–12 target power users; instrument every step.
- **Success signal:** A clear majority reach a completed first task; drop-off is on understandable steps with fixable UX, not "I'm not getting an API key."
- **Failure signal:** Heavy drop-off at key acquisition itself → BYO-key friction is structural for the segment; pull the Nano free on-ramp forward (R6 escape valve).
- **Time:** 1 week (rides on MVP onboarding). **Cost:** incentives ~$800.

**V-A7 — AI-generated Tier-1 config quality test (validates A7; addresses R14)**
- **Method:** Technical spike (offline yield measurement).
- **What to do:** Prompt Gemini to generate Tier-1 JSON app-configs for **15–20 realistic NL app descriptions** (e.g., Scenario 3's "pull name/title/company/location"). Run each through the registry-schema + allowedTools validator and the capped auto-repair loop, then execute the resulting app on a real sample page. Measure: % valid after repair, % correctly-scoped (no stripped tools), % producing useful output.
- **Scope:** 15–20 descriptions × 1 page each; 1 eng.
- **Success signal:** A strong majority yield valid, correctly-scoped, useful apps within the repair cap — enough that the "describe it and it appears" moment lands more often than it frustrates.
- **Failure signal:** Frequent invalid/over-scoped/useless output → generation isn't ready as a headline V1 feature; gate it behind the linear field editor or defer.
- **Time:** 1 week. **Cost:** ~1 eng-week + < $30 tokens.

**V-A11 — Lane / message pull test (validates A11; addresses R16, BC1)**
- **Method:** Landing page + competitive analysis + interviews.
- **What to do:** Stand up a landing page leading with the *agent* (not "universal") and the three differentiators (model-transparent, BYO-key/privacy, verified multi-step + memory). Run a small paid traffic test to a waitlist; A/B the headline ("transparent verified agent" vs. "universal AI toolbox"). In interviews, ask target users to rank transparency/privacy/BYO vs. "free and native (Comet/Gemini-in-Chrome)" as switching drivers.
- **Scope:** Landing page + ~$300–500 ad spend; 8–10 interviews.
- **Success signal:** Meaningful waitlist conversion on the agent-led message; interviewees name transparency/privacy/control as decisive, not nice-to-have.
- **Failure signal:** Low conversion and users shrug "I'd just use the free native one" → the lane is a gap without pull; differentiation/positioning needs rework (BC1/R16).
- **Time:** 1–2 weeks (runs in parallel). **Cost:** ~$500 ads + page build.

**V-A9 — Memory-lift validation (validates A9; addresses R10)** — *post-MVP / V1; listed here for completeness.*
- **Method:** Behavioral metric on repeat usage (see Post-MVP).
- **Note:** Cannot be validated pre-build — needs repeat-usage data. Carried to Post-MVP Validation (metric #3). Pre-build, only the *trust-in-remembering* half is probed in the V-A3/V-A4 interviews ("would you want it to remember site flows? what would make that feel safe?").

---

## Kill Criteria

Honest signals that should make the team stop, pivot, or cut scope rather than push through. These are pre-committed so they aren't rationalized away under sunk cost.

| Signal | Threshold | Action |
|--------|-----------|--------|
| **Self-built loop reliability stuck** (V-A1, then MVP VMSTCR) | Completion ≤ 4/10 on the spike, **or** VMSTCR fails to clear the exit bar after **3 focused iteration cycles** on the MVP suite, **or** trails an OSS-engine baseline by a wide non-closing margin | **Pivot the engine decision:** fork Stagehand/browser-use (revisit LOCKED #3) before V1, or stop. Do not ship a worse-than-floor agent. |
| **Web Store rejects the Tier-2 + CDP + userScripts posture** (V-A6) | Rejected **twice** with no specific, addressable remediation path | **Cut Tier-2 (and/or CDP) from the public build.** Ship agent + Tier-1 only; re-scope the self-extension story. Do not bet the launch on an appeal. |
| **Tier-2 sandbox isolation leaks** (V-A5) | **Any** successful escape to page DOM / network / `chrome.*` / storage / sibling app | **Cut Tier-2 from V1** until isolation is provably airtight. Non-negotiable — a self-inflicted RCE-class hole. |
| **Confirmation gate / injection integrity fails** (V-A2) | **Any** unauthorized consequential execution, SW-restart double-execute, or injection payload that reaches a consequential tool, in CI | **Hard block.** MVP cannot exit; no public release. This is the metric-#2 line — one breach kills credibility. |
| **BYO-key activation craters** (V-A4, metric #6) | Power-user install→first-completed-task drop-off **above ~60%**, concentrated at *key acquisition itself* (not fixable UX) | **Pull the Nano free on-ramp forward** (de-scope BYO-key purity for activation), per R6 escape valve. |
| **Confirmation gate is theater / resented** (V-A3) | Majority reflexively approve without reading, **or** majority call it annoying / want it disabled | **Redesign gate cadence** before relying on it as the trust story — batch low-risk, reserve the hard gate. Don't ship a gate users route around. |
| **No lane pull** (V-A11) | Landing-page conversion negligible **and** interviewees consistently prefer "free + native" over transparency/privacy/BYO | **Rework positioning/differentiation.** If transparency isn't a switching driver, the thesis (premise #1 pull) is wrong — reassess before full build. |
| **Shared-registry architecture won't hold** (V-A8) | Exposing one capability to a second consumer requires re-implementing its logic | **Stop scaling exposure.** Rethink the agent/tool boundary before V1; risk of three tangled codebases (R13/R5). |
| **AI-generated configs mostly fail** (V-A7) | Strong majority of generated Tier-1 configs invalid / over-scoped / useless after the repair cap | **Demote generation** from a headline V1 feature to behind the linear editor, or defer. |
| **DOM-first coverage too low** (V-A10) | Majority of real tasks force vision escalation; per-run cost/latency breach budget caps | **Revisit perception strategy / tighten budget caps** before broadening task scope (R8). |
| **MicroLabs reuse is a net drag** (V-A12) | Porting a module exceeds its greenfield estimate because gaps are entangled | **Rebuild that module greenfield;** correct the MVP schedule honestly. |

---

## Pre-Build Validation Sequence

Ordered. The spikes come first — each can kill or reshape the build before production code is written. Several run in parallel; the gating dependency is V-A1.

1. **V-A6 — Web Store policy pre-check** — *kick off Day 1, runs in background.* Submission/review latency is the long pole, so start it before everything else even though results land later. **Method:** Web Store pre-review + policy analysis. **Time:** 2–4 weeks (parallel).
2. **V-A1 — Thin agent-loop spike** — *the gate for the whole build.* If reliability can't be made competitive, the engine decision changes before anything else is built. **Method:** technical spike + OSS baseline comparison. **Time:** 1–2 weeks.
3. **V-A5 — Tier-2 sandbox isolation spike** — *parallel to V-A1.* Proves (or kills) the Tier-2 isolation bet before it's committed to V1 scope. **Method:** technical spike + escape corpus. **Time:** 1 week.
4. **V-A11 — Lane / message pull test** — *parallel, runs alongside the spikes.* Cheap landing page + interviews confirm there's *pull*, not just a gap. **Method:** landing page + competitive analysis + interviews. **Time:** 1–2 weeks.
5. **V-A7 — AI-generated Tier-1 config quality** — *parallel, offline.* Validates the headline V1 generation feature with no UI needed. **Method:** offline yield measurement. **Time:** 1 week.
6. **V-A12 — MicroLabs port time-box** — *at MVP foundation start.* Decides reuse-vs-rebuild per module before the schedule depends on it. **Method:** time-boxed port spike. **Time:** ≤ 1 week.
7. **V-A2 — Gate integrity + injection resilience** — *first correctness paths of the MVP build.* Built and CI-red-teamed before any consequential-action code is trusted. **Method:** spike + CI corpus. **Time:** ~2 weeks (in-build).
8. **V-A8 — Shared-registry architecture proof** — *during MVP.* One capability exposed to agent + a stub app + a stub skill via one registry entry. **Method:** in-build spike. **Time:** ~1 week.
9. **V-A10 — DOM-vs-vision coverage measurement** — *rides on V-A1 + MVP suite.* Free instrumentation. **Method:** logging. **Time:** ~0.
10. **V-A3 — Confirmation-gate UX test** — *once a clickable MVP/prototype exists.* Confirms the gate is welcomed, not theater/friction. **Method:** prototype usability + interviews. **Time:** 1–2 weeks.
11. **V-A4 — BYO-key activation test** — *on the real MVP onboarding.* Baselines metric #6 with target users. **Method:** prototype test + funnel instrumentation + interviews. **Time:** 1 week.

**Gate to start production V1 scope:** V-A1 success (or a made engine decision), V-A5 clean isolation, V-A6 no unaddressable rejection, V-A2 green in CI. The user-behavioral tests (V-A3/V-A4/V-A11) inform but do not block the MVP build — they reshape onboarding/positioning and gate the *public* launch.

---

## Post-MVP Validation

Once the wedge MVP is live (internal → private beta → public V1), shift from "can we build it" to "do they use it, trust it, and does it compound." These metrics also trigger the Phase 2 (full V1) and Phase 3 commitments.

**Behavior & usage to measure:**
- **VMSTCR in the wild** (north star) — does the measured completion rate hold or improve once real users run *their own* messy tasks vs. the curated suite? Watch for a gap between lab and field reliability (the real test of premise #2). Segment by task type to find where the loop breaks.
- **Confirmation-gate behavior at scale** — approval-without-reading rate, edit-before-approve rate, gate-disable requests, and (critically) **0 unauthorized executions sustained in production** (metric #2). Validates A2/A3 with real volume.
- **Activation funnel (metric #6)** — full public install→valid-key→first-completed-task. If power-user activation is healthy but total volume is capped by the key wall, that's the data that triggers the **Nano free on-ramp** (R6) — a Phase 2 prioritization signal.
- **Transparency engagement (metric #4)** — % of sessions where users view model/cost or switch model mid-task. If high, premise #1's "transparency is valued" is confirmed; if ignored, the differentiator is weaker than believed (informs R16 positioning).
- **Vision-fallback frequency & cost** (R8 proxy) — sustained DOM-first share and per-run $; rising vision reliance is an early cost-trap warning.

**The data that triggers Phase 2 (full V1):**
- VMSTCR clears and *holds* the exit bar in private beta, gate integrity is 100%/0, and activation baseline is acceptable → green-light the platform layer (Tier-1/2 apps, generation, skills, workflows, remote registry). The V-A5/V-A6 spike results must also be clean before Tier-2 enters the V1 submission.

**The data that validates the deferred differentiators (post-V1, into Phase 3):**
- **A9 / Memory-assisted lift (metric #3)** — *now testable with repeat-usage data.* Measure step/time/cost reduction and memory-recall hit rate on *repeat* tasks vs. first runs, within 60 days of V1. Lift confirmed → premise #4 is a real moat and justifies FR-MEM-5 (semantic recall/RAG) in Phase 3. No lift → memory is a checkbox; reprioritize.
- **A7 / Self-extension adoption (metric #5)** — N validated user-created/AI-generated apps or skills per active user; import/export volume. Earns (or doesn't) the extensibility complexity.
- **A11 / Competitive pressure (R16)** — monitor Gemini-in-Chrome / Comet feature moves against our differentiators; if they close the transparency/privacy gap, the moat narrows to reliability+memory+trust — sharpen there.

**Feedback channels:**
- In-product: per-run thumbs + a one-tap "what went wrong" on failed/partial runs (feeds the VMSTCR failure taxonomy and self-healing backlog).
- Private-beta cohort interviews (the same V-A3/V-A4 participants) at 30/60-day marks for retention and trust drift.
- The run audit log (FR-HITL-7) as a debugging/forensic source for any gate or injection near-miss.
- A skill/app export-share signal as the early read on the future marketplace (Phase 3).

---

*End of validation plan.*
