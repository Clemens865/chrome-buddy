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
| 29 | Live cost display in UI | FR-LLM-10, NFR-COST-2, FR-UI-5 | ⬜ | — | — |
| 30 | Spend caps + budget settings | NFR-COST-1, FR-SET-1 | ⬜ | — | — |
| 31 | Onboarding: BYO-key walkthrough + gating | FR-ONB-1..4 | ⬜ | — | — |
| 32 | Plan approve/edit/let-run gate | FR-AGENT-3 | ⬜ | — | — |
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

### #28 — Key custody → `chrome.storage.session` (NFR-SEC-1) ✅
- **Was:** the API key was written to `chrome.storage.local` (persisted to disk) — a direct NFR-SEC-1 violation.
- **Now:** `KEY_SET` and the resolver use `chrome.storage.session` (in-memory, cleared at browser-session end). Set `session.setAccessLevel('TRUSTED_CONTEXTS')` at SW init so content scripts can't read it. Updated Settings copy ("Kept in memory for this browser session — never written to disk").
- **Tradeoff:** the key must be re-entered after a full browser restart — exactly what the PRD mandates for key hygiene.
- **Proof:** keystore unit tests updated (8 pass, 131 total); live e2e `key-custody` confirms the key is in `session` and **absent from `local`** in a real browser; screenshot 35.
