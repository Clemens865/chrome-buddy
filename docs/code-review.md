# Code Review & Hardening — Post-Launch Pass

Date: 2026-05-28 (immediately after the v0.1.0 public release).

## Scope

Comprehensive review across four axes, executed by four parallel sub-agents
plus a sequential fix pass:

1. **Security** — NFR-SEC-1 (key custody), HITL gate path coverage, MV3
   bright line, prompt-injection surface, IDB exposure
2. **Type safety + error handling** — `any` usage, double-casts, silent
   `catch {}`, `@ts-ignore`/`@ts-expect-error`, tool-error contract
3. **Performance + bundle** — bundle composition, re-render hotspots,
   lazy-loading opportunities, perf at scale
4. **Accessibility + the 21 remaining lint warnings** — aria coverage,
   focus management, keyboard nav, theme contrast, hooks-deps correctness

## Baseline

- **519 unit tests** + **134 e2e tests** all green
- **0 lint errors**, **21 warnings remaining** (down from 24 — 3 stale
  `eslint-disable` directives cleared in `7d6cc9b`-prep work)
- Production build: 713 KB raw / 204 KB gzipped for `dist/assets/overlay.js`
- Node 22 in CI; Node 24 local
- 0 npm-audit vulnerabilities

## Phase 1 findings (parallel agents)

(populated as each agent reports back)

### Security
(TBD — agent in flight)

### Type safety + error handling
(TBD)

### Performance + bundle
(TBD)

### A11y + lint warnings detail
(TBD)

## Phase 2 fixes

(committed in batches as the findings come in)

### Trivial wins already applied
- Removed 3 stale `eslint-disable` directives:
  - `src/llm/adapters/openaiCompatible.test.ts:4` (no-explicit-any) — file had no `any` usage
  - `src/page/pageContext.ts:61` (no-constant-condition) — `while (true)` is allowed in current config
  - `src/sandbox/run.ts:34` (no-new-func) — `AsyncFunction(...)` constructor pattern; rule not active

## Phase 3 residuals

(populated at the end)
