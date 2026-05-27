# Night-Test Audit & Hardening Log

Date started: 2026-05-27

Owner asked for: comprehensive e2e coverage of every feature, basic + advanced
workloads, real bug-fixing where tests reveal gaps, screenshots throughout,
notes on every problem found and resolved.

This document is the audit's single source of truth. Each feature area has:
- A short feature inventory (what we promised the user)
- Existing test coverage (what was already there)
- Gaps identified
- New test files added
- Bugs found and how they were fixed
- Screenshots produced

## Method

Phase 1 — parallel investigation: spawned sub-agents to survey the codebase
in parallel and surface gaps without context-thrashing.

Phase 2 — sequential execution: one feature area at a time, write tests, run,
fix any code path that breaks the promise of the test, commit, screenshot.

Phase 3 — aggregate summary at the end of the log.

## Conventions

- Every new test goes in `tests/e2e/`.
- Every screenshot goes in `screenshots/`.
- A test is "good" only when it asserts a concrete behavior the user can see.
- A test failure is fixed by changing the code, NOT by weakening the test.
- Live tests gated on env vars (GEMINI key, GITHUB_TEST_PAT) skip cleanly.

## Feature areas

1. Chat — composer, modes, attachments, artifacts, history
2. Apps — built-in apps + Tier-1 (form) + Tier-2 (code) generation + import
3. Skills — create from run, run from Skills view
4. Workflows — build, edit, run, schedule, event-trigger
5. Library — folder import, indexing, search, auto-context
6. Settings — profile, theme, budget, model, keys, webhooks, MCP, GitHub
7. Background tools — page tools, web search, fetch_url, file_search, notes,
   webhooks, github
8. HITL — confirm card, pending banner, plan approval, ask_user, resume
9. Voice — STT, Gemini Live voice mode
10. Brand — icons, logo

---

## Baseline (before this audit)

- **Unit tests:** 519 passing across 69 files
- **E2E tests:** 111 listed in 72 files (~92 typically pass; rest are env-gated live tests)
- **Recent fixes in scope of audit:**
  - 8551c82 — deterministic confirm-card scroll + tool-name hallucination guard
  - c24dd82 — default-repo fallback
  - 0a83b55 — confirm-card live-render race
  - 7a2c3cb — composer paperclip wired
  - 6312bc2 — composer textarea auto-grows to 50vh
  - 9a6c4bf — flat-cream SVG icon
  - 652e42c — live github_write e2e
  - d9b91de — MCP Phase 2 (agent integration)
  - b55a158 — MCP Phase 1 (Settings + transport)

## Phase 1 findings (parallel investigation, 4 agents)

### Top gaps surfaced (highest risk first)

**Chat / composer:**
- "This page" chip — persistence + effect (untested)
- "Think harder" toggle — propagation to options + auto-reset (untested)
- Chat mode persistence across reload (untested)
- Composer STT mic behavior (untested)
- Attachment count/size cap enforcement (untested in real UI)
- Transcript item rendering: tool status transitions, plan items, error items, ask_user free-text variant (untested)
- Artifact card close/back flow (open is live-tested, close is not)
- Library audit card collapse (untested)

**Apps:**
- 6 of 7 built-in app cards untested for grid-launch (only Console covered)
- Tier-2 code review gate (FR-T2-5) — UI exists, never E2E-verified
- Tier-2 permission-aware bridge — bridge.gemini() with/without permission untested
- Generated app deletion (untested)
- Tier-1 generator failure modes ("junk in" → graceful error) untested

**Skills:**
- Direct Run from SkillsView (only `call_skill` from chat tested)
- Skill edit (open → change → save → list updates)
- Skill delete + persistence
- Multi-skill creation (user explicitly asked for two)
- Export round-trip

**Workflows:**
- Step add / remove / reorder mechanics
- Multiple workflows (user explicitly asked for two)
- Step output threading deterministically (only live-tested)
- Schedule edge cases (0 / negative intervals)
- Event trigger pattern matching against real navigation

**Library:**
- Folder-import progress state machine
- LibraryView delete + re-render
- Auto-context end-to-end

**Settings / GitHub / MCP:**
- GitHub error paths (401 / 403 / 422 / rate-limit)
- Profile switching persistence per profile
- Theme + accent picker round-trip
- MCP per-tool trust → consequential=false in agent (only unit-tested)
- Library backfill result modal

Total ~50 gaps surfaced. Phase 2 execution starts now — prioritizing the user's explicit list (artifacts / apps / skills / workflows / folder import) then chasing Tier-1 risk.

---

## Phase 2 execution log

Each feature gets its own subsection. Tests committed in batches as each area completes.
