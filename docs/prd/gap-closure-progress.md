# PRD Gap-Closure Progress

Tracking the work to close the gaps found in the PRD audit (see `requirements.md`).
Each item: plan → build → test → validate (screenshot) → confirm → push. Updated as work lands.

Legend: ✅ done · 🚧 in progress · ⬜ not started

## Already shipped before this push (prior sessions)
Agent loop · tool registry · HITL gate · DOM-first control · skills (promote/export/import/run) ·
workflows (NL build, manual+schedule triggers) · Tier-1 app gen · Tier-2 sandbox (pure compute) ·
model picker · memory/history · learned-flow recall · STT/TTS · image gen · side-panel UI/artifacts ·
**File System Access root folder (read_file/write_file)** ✅

## Gap-closure queue

| # | Item | PRD refs | Status | Commit | Proof |
|---|------|----------|--------|--------|-------|
| 28 | Key custody → `chrome.storage.session` | NFR-SEC-1 | ✅ | (this push) | screenshot 35; e2e key-custody |
| 29 | Live cost display in UI | FR-LLM-10, NFR-COST-2, FR-UI-5 | ✅ | (this push) | screenshot 36; e2e cost |
| 30 | Spend caps + budget settings | NFR-COST-1, FR-SET-1 | ✅ | (this push) | screenshots 37-38; e2e budget |
| 31 | Onboarding: BYO-key walkthrough + gating | FR-ONB-1..4 | ✅ | (this push) | screenshot 39; e2e onboarding |
| 32 | Plan approve/edit/let-run gate | FR-AGENT-3 | ✅ | (this push) | screenshots 40-41; e2e plan-gate |
| 33 | `ask_user` tool wired | FR-TOOLS-11 | ⬜ | — | — |
| 34 | Prompt-injection guards | NFR-SEC-6 | ⬜ | — | — |
| 35 | CAPTCHA/login pause-and-handoff | FR-HITL-8 | ⬜ | — | — |
| 36 | Agent resumability across SW restart | FR-AGENT-8, NFR-REL-3 | ⬜ | — | — |
| 37 | Computer Use vision fallback | FR-BC-5, FR-LLM-9, FR-AGENT-13 | ⬜ | — | — |
| 38 | Skills editor + import consent | FR-SKILL-4,5,6,9,10 | ⬜ | — | — |
| 39 | Workflows: event trigger + export/import + editor | FR-WF-2,4,7 | ⬜ | — | — |
| 40 | Model registry: Test + editor + add provider | FR-MR-8,10,12,13 | ⬜ | — | — |
| 41 | Signed remote registry update | FR-MR-5,6, NFR-SEC-5 | ⬜ | — | — |
| 42 | Tier-2 capability bridge + code-review gate | FR-T2-3,4,5 | ⬜ | — | — |
| 43 | Gemini Nano on-device path | FR-LLM-8, NFR-PRIV-2 | ⬜ | — | — |

## Log
_(newest first — one entry per landed item)_

### #32 — Plan approve/edit/let-run gate (FR-AGENT-3) ✅
- **Was:** the plan was rendered then auto-executed; no approval step.
- **Now:** the runtime takes an optional `planApprove` hook; after planning it surfaces the plan and waits. The UI shows a plan-review card (steps + Approve & run / Cancel) before any step runs; Cancel ends the run ("Plan cancelled before execution"). A Settings → Permissions toggle "Review plans before running" (default on) lets power users disable the gate (the "let-run" mode). The runtime also accepts an `editedPlan` from the gate (engine wired + unit-tested); inline editing UI is a follow-up.
- **Proof:** 2 runtime unit tests (deny → nothing runs; edited plan re-emitted + used) → 8 runtime tests; live e2e plan-gate (cancel before execution; approve → runs). Screenshots 40-41.

### #31 — Onboarding + key gating (FR-ONB-1..4) ✅
- **Was:** no first-run flow; the key was only reachable via Settings.
- **Now:** `src/views/Onboarding.tsx` takes over on first run (PanelApp gates on a persisted `onboardingDone`). It links to get a key, accepts + **live-validates** a pasted key (KEY_VALIDATE) before saving, explains the key is kept in memory for the session only and the free-tier training caveat (FR-ONB-4), and offers Skip. When a key is already configured it collapses to a one-click "Get started".
- **Test plumbing:** the shared e2e fixture seeds `onboardingDone=true` so feature specs land on the panel; the onboarding spec opts back in.
- **Proof:** e2e `onboarding` (walkthrough shows, storage note visible, panel hidden until dismissed → usable after); screenshot 39. Regression: smoke + cost specs still green.
- **Limitation:** the paste/validate branch renders only when no key exists; the test env always has a key, so the screenshot shows the "already configured" branch. The KEY_VALIDATE handler is covered by keystore unit tests.

### #30 — Spend caps + budget settings (NFR-COST-1, FR-SET-1) ✅
- **Was:** only hardcoded step/cost defaults in the runtime; no user control, no daily ledger.
- **Now:** Settings → Budget exposes per-run cap ($), daily cap ($), and step budget. Per-run cap + step budget flow into `runAgentTask` (the runtime already hard-stops on either). A persistent daily spend ledger (`src/cost/budget.ts`) accumulates per call; when today's spend reaches the daily cap, new runs are **hard-stopped** with a notice (raising the cap is the explicit continue). `0` = no cap.
- **Proof:** 6 budget unit tests (137 total); e2e: Settings shows the caps (37); seeding the ledger over-cap blocks a run before any model call, input preserved (38).

### #29 — Live cost display (FR-LLM-10, NFR-COST-2) ✅
- **Was:** cost was metered in the LLM client + runtime (`costUsed`) but never surfaced in the UI.
- **Now:** `runPlainChat` returns its call cost; ChatView accumulates a `sessionCost` across plain-chat, agent, and workflow runs and shows a running `≈ $x` chip in the composer footer (updates the moment a call completes; `< $0.0001` for sub-penny turns).
- **Proof:** 131 unit tests green; live e2e `cost` (no chip before a call → `$`-figure chip after); screenshot 36.
- **Note:** still open as separate items — per-run cost on the done card (FR-UI-9) and per-day aggregation + caps (#30).

### #28 — Key custody → `chrome.storage.session` (NFR-SEC-1) ✅
- **Was:** the API key was written to `chrome.storage.local` (persisted to disk) — a direct NFR-SEC-1 violation.
- **Now:** `KEY_SET` and the resolver use `chrome.storage.session` (in-memory, cleared at browser-session end). Set `session.setAccessLevel('TRUSTED_CONTEXTS')` at SW init so content scripts can't read it. Updated Settings copy ("Kept in memory for this browser session — never written to disk").
- **Tradeoff:** the key must be re-entered after a full browser restart — exactly what the PRD mandates for key hygiene.
- **Proof:** keystore unit tests updated (8 pass, 131 total); live e2e `key-custody` confirms the key is in `session` and **absent from `local`** in a real browser; screenshot 35.
