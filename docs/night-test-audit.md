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

### 1. Chat artifacts rendering ✅
- New file: `tests/e2e/chat-artifacts.spec.ts` (8 tests)
- Helper: `tests/e2e/helpers/seed.ts` (shared chat seeding)
- Locks single + multi-language + interleaved prose, ArtifactView open/back/copy, no-code fallback, obscure languages, whitespace preservation
- Commit: `b2a26c2` (8/8 green on first run)
- Screenshots: 200-201-202

### 2. Apps grid launch ✅
- New file: `tests/e2e/apps-grid-launch.spec.ts` (8 tests)
- All 5 openable cards (Console / Image / Audio / Live / Webhook Flows) now have launch coverage; 2 placeholder cards (Scrape / Watch) asserted as non-openable
- First-run failure: strict-mode locator on Console + Image (duplicated in Recents + main grid) — fixed with `.first()`
- Commit: `e7cf998` (8/8 green)
- Screenshot: 210-apps-grid

### 3. Skills CRUD ✅ + REAL BUG FIXED
- **Bug found and fixed**: `SkillEditor` defaulted new skills to `agent` mode instead of `chat`. Chat is the simpler/cheaper kind and shown first in the UI seg control — defaulting to Agent silently opted users into the heavier path.
- Fix: line 175 of `src/views/StubViews.tsx` flipped to `'chat'`.
- New file: `tests/e2e/skills-crud-flow.spec.ts` (2 tests, fulfills "at least two skills")
- Walks empty state → create skill #1 (chat, no inputs) → create skill #2 (agent, `{{competitors}}` input) → edit #1 → delete #2 → reload-persistence check + Save-button gating
- Commit: `b526987` (4/4 green: new + skills-editor + call-skill)
- Screenshot: 220-skills-two-saved

### 4. Workflows CRUD ✅
- New file: `tests/e2e/workflows-crud-flow.spec.ts` (2 tests, fulfills "at least two workflows")
- Two seeded workflows → edit one (add step + move-up + remove-step + switch to schedule trigger) → delete the other → IDB read confirms persistence → Save-button gating
- Commit: `b532576` (2/2 green)
- Screenshots: 230-workflows-two-seeded, 231-workflow-editor-mid

### 5. Generated apps (Tier-1 + Tier-2) ✅
- New file: `tests/e2e/apps-generated-flow.spec.ts` (4 tests, fulfills "importing app prompt + code app")
- Tier-1 prompt app opens form directly; Tier-2 code app shows review gate first (FR-T2-5) → Approve persists `reviewed=true` → second open skips review; delete removes from grid + IDB
- First-run failure: locator used `/Delete|Remove|✕/i` but the aria-label is exactly `Delete <name>` — fixed
- Commit: `cbcc9df` (4/4 green)
- Screenshots: 240-apps-generated-grid, 241-apps-tier2-review

### 6. Composer chips + mode persistence ✅
- New file: `tests/e2e/composer-chips-persistence.spec.ts` (3 tests)
- Locks: "This page" chip toggle + persistence, chat mode chip persistence across reload, "Think harder" chip per-turn (does NOT persist by design)
- First-run failure: regex `/This page/i` matched the greeting suggestion too — tightened to `button.ctx-chip`
- Commit: `aba9467` (3/3 green)
- Screenshot: 250-composer-mode-persisted

### 7. Transcript item rendering ✅
- New file: `tests/e2e/transcript-items.spec.ts` (5 tests)
- Plan numbered intents, tool trace status transitions (running/done/denied), error item rendering, ask_user trace surface, resolved confirm card hides Approve/Cancel
- Commit: `ceb37f3` (5/5 green)
- Screenshots: 260-tool-traces, 261-confirm-resolved

### 8. GitHub fallback + error paths ✅
- New file: `tests/e2e/github-fallback-and-errors.spec.ts` (5 tests)
- Default-repo fallback in TOOL_EXEC path, helpful error when neither arg nor default, 401 surfacing, 404 → `code:'not-found'`, no-token error
- First-run failure: asserted `error.kind` but field is `error.code` per ToolError type — fixed
- Commit: `8843a89` (5/5 green)

### 9. Library docs flow ✅
- New file: `tests/e2e/library-docs-flow.spec.ts` (3 tests)
- Seeded docs render with per-source pill + chunk count, delete removes row + IDB entry, empty state
- (Folder picker uses FSA showDirectoryPicker — not Playwright-drivable; the observable outcome is covered)
- Commit: `9635313` (3/3 green)
- Screenshot: 270-library-docs

### 10. Settings profile switching ✅
- New file: `tests/e2e/settings-profile.spec.ts` (1 test)
- Per-profile field isolation: professional vs personal store independently, both persist across reload
- First-run failure: `getByLabel('Name')` matched both profile + webhook inputs — fixed with placeholder
- Commit: `65edb7d` (1/1 green)
- Screenshot: 280-profile-personal

---

## Tally

### Real bugs found and fixed
1. **SkillEditor default mode was 'agent' instead of 'chat'** — flipped per UI ordering + product intent. (b526987)

### New tests added
- 10 new spec files
- ~40 individual test cases
- 8 new screenshots
- 1 shared helper (`tests/e2e/helpers/seed.ts`)

### Per-feature counts
| Area | Tests added | First-run pass | Failures fixed |
|---|---|---|---|
| Chat artifacts | 8 | 8/8 | 0 |
| Apps grid launch | 8 | 5/8 | 3 (locator strictness) |
| Skills CRUD | 2 | 1/2 | 1 (real bug + locator) |
| Workflows CRUD | 2 | 2/2 | 0 |
| Generated apps | 4 | 3/4 | 1 (locator) |
| Composer chips | 3 | 2/3 | 1 (locator) |
| Transcript items | 5 | 5/5 | 0 |
| GitHub fallback | 5 | 4/5 | 1 (field name) |
| Library docs | 3 | 3/3 | 0 |
| Settings profile | 1 | 0/1 | 1 (locator) |
| **Total** | **41** | **33/41 (80%)** | **7 issues + 1 real bug** |

### Commits in night-suite batch
- `b2a26c2` test(chat): artifact rendering — 8 deterministic e2es
- `e7cf998` test(apps): every built-in app card opens its view + placeholders are inert
- `b526987` fix(skills) + test: new-skill default flipped from 'agent' to 'chat'; multi-skill CRUD
- `b532576` test(workflows): two-workflow CRUD + step add/move/remove + trigger change + persistence
- `cbcc9df` test(apps): Tier-1 prompt + Tier-2 code app lifecycle + review gate + delete
- `aba9467` test(composer): chip toggles + persistence — Tier-1 gaps closed
- `ceb37f3` test(chat): transcript item rendering — plan, tool status, error, ask_user, resolved confirm
- `8843a89` test(github): default-repo fallback + 401/404/no-token error paths
- `9635313` test(library): docs list rendering + per-source pill + delete + empty state
- `65edb7d` test(settings): profile fields stored independently per profile + persist on reload

### Failures that turned out to be locator issues (fixed without code changes)
- Multiple instances of strict-mode locator violations from duplicated UI text (Recent + main grid for apps; profile Name vs webhook Name; "This page" chip vs greeting suggestion)
- Field name mismatch (`error.kind` vs `error.code`)
- All resolved by tightening the locator to match the specific surface intended — no production-code change.

### What we still owe (not done this batch)
- **Tier-2 sandbox execution** — happy path covered indirectly (review gate + reviewed flag), but actual `runInSandbox` execution + permission denial path are unit-test surface, not yet e2e.
- **Voice mic-denied state** — survey flagged as HIGH risk; needs a real getUserMedia rejection.
- **Live MCP tool call against a real hosted server** — Phase 3 OAuth work is a prereq.
- **Theme switching** (slate/cream/graphite) round-trip — quick win, not done.
- **STT mic in composer** — survey flagged as Tier-1; would need a Speech Recognition mock.
- **Workflow due-badge clearing after run** — flagged Tier-2.

These are all noted as candidate follow-ups in a future audit pass.

---

## Final state (end of overnight batch)

- 73 → **83 e2e spec files** (+10 new)
- 519 unit tests, still passing
- 1 real bug fixed (skill default mode)
- Build clean, typecheck clean
- Full regression: **134/134 e2e tests passed (18.9 m)** — every new test + every existing test green, no regressions
- Total tests across the project: **519 unit + 134 e2e = 653 tests** (up from 519 + 92 = 611 yesterday)

