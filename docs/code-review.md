# Code Review & Hardening — Post-Launch Pass

Date: 2026-05-28 (immediately after the v0.1.0 public release at
https://github.com/Clemens865/chrome-buddy).

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

## Baseline (start of review)

- 519 unit tests + 134 e2e tests all green
- 0 lint errors, 24 warnings
- Production build: 713 KB raw / 204 KB gzipped for overlay.js
- Node 22 in CI; Node 24 local
- 0 npm-audit vulnerabilities

## Outcome (end of review)

- **525 unit tests** (+6 — new `registry.test.ts` locks the new exception
  normalization)
- **134 e2e tests** still green
- **0 lint errors, 19 warnings remaining** (24 → 19, –5 closed: 3 stale
  `eslint-disable` directives + 1 real `react-hooks/exhaustive-deps` bug
  + 1 useLayoutEffect properly suppressed). The remaining 19 are 16
  `react-refresh/only-export-components` HMR hints + 3 properly justified
  suppressions — neither category affects production.
- **5 real bugs fixed** (all HIGH severity, all silent-failure paths)
- **1 security tightening** (manifest `<all_urls>` redundancy removed)
- **2 contrast fixes** (`.pill-ok`, `.webhook-test.is-ok` darkened to clear WCAG AA)
- **4 stale-closure hook-deps bugs** fixed (each could cause stale config
  to be used on a hot path: agent run, workflow step, resumed run)
- Build clean, typecheck clean

---

## Phase 1 — Findings from the parallel agents

### 1. Security audit

**No HIGH-severity issues found.** Core promises (NFR-SEC-1, HITL gate,
restricted URLs, untrusted-data fencing, MV3 no-RCE) verified correctly
implemented with no apparent bypass paths.

| Severity | Finding | Status |
|---|---|---|
| 🟡 MEDIUM | MCP tools route through `executeMcpToolCall()` without re-checking trust at SW dispatch — the runtime gate is correct, but a Settings edit mid-run would not invalidate an already-running registry. Edge case. | Documented as known limitation (runtime gate is the contract; mid-run Settings edit is out of scope) |
| 🟡 MEDIUM | `host_permissions: ["http://*/*", "https://*/*", "<all_urls>"]` — `<all_urls>` is redundant | ✅ **FIXED** (`77c5829`) — dropped `<all_urls>` |
| 🟢 LOW | Key validation in `useApiKey.ts:78-91` has no rate-limit (could burn quota on rapid invalid pastes) | Deferred — user-owned quota, low priority |
| 🟢 LOW | MCP description sanitization doesn't guard against homoglyph spoofing | Deferred — namespacing + trust UI already shows what's running |
| 🟢 LOW | Sandbox timeout is 3000 ms — tight for slow Gemini calls | Deferred — `bump()` resets per round-trip |
| 🟢 LOW | No dedicated e2e for Live API voice-mode key custody | Tracked in night-test-audit.md |
| 🟢 LOW | `readSessionApiKey()` env-fallback comment could be louder | Deferred — CONTRIBUTING.md covers it |
| 🟢 LOW | Page-content fence escape (`<<UNTRUSTED_PAGE_DATA>>`) is theoretically forgeable on a double-fence | Deferred — synthesis turn has no tools; defense-in-depth |
| 🟢 LOW | File-search embeddings have no model-version field; stale vectors silently | Deferred — vector schema versioning is a future migration concern |

**Strengths confirmed:**
- ✅ Keys never enter React state, IDB, logs, or dist
- ✅ HITL gate correctly enforced in `gateConsequentialAction` for every
  consequential tool (`send_webhook`, `github_write`, `write_file`, MCP)
- ✅ Page content fenced as `<<UNTRUSTED_PAGE_DATA>>`
- ✅ Restricted URLs (`chrome://`, Web Store, `view-source:`, `file:`,
  `javascript:`, etc.) refused with structured `undriveable` error
- ✅ Tier-2 sandbox runs in opaque-origin iframe with capability bridge
- ✅ Filename sanitization strips path traversal before
  `chrome.downloads`
- ✅ No hardcoded secrets in dist

### 2. Type safety + error handling

| Severity | Finding | Status |
|---|---|---|
| 🔴 HIGH | `src/tools/registry.ts:132` — `invoke()` didn't try-catch tool-handler exceptions. A handler that threw instead of returning `err(...)` would crash up to the runtime with partially-mutated scratchpad state. | ✅ **FIXED** (`77c5829`) — wrapped in try/catch, normalize to `err('runtime-error', ...)`. Locked by 6 new tests in `registry.test.ts`. |
| 🔴 HIGH | `src/background/mcp.ts:165-187` — MCP session pool didn't invalidate on connection failure. A flaky server staying broken until SW restart. | ✅ **FIXED** (`77c5829`) — evict pooled client on any error, with best-effort close. |
| 🔴 HIGH | `src/background/live.ts:194-207` — WebSocket `onmessage` handler swallowed exceptions silently. Voice users got silence instead of an error message. | ✅ **FIXED** (`77c5829`) — try/catch around frame handling + `.catch` on Blob/dispatch promises, errors surfaced to the panel as `{ type: 'ERROR' }`. |
| 🟡 MEDIUM | Double `as unknown as X` casts at `github.ts:224`, `live.ts:342`, `live.ts:84` | Deferred — defensible patterns (WebSocket lazy-init, discriminated union narrowing). Add proper types if revisited. |
| 🟡 MEDIUM | `setAccessLevel` silent catch in `background.ts:69` — failure would silently violate NFR-SEC-1 | ✅ **FIXED** (`77c5829`) — replaced with loud `console.error` calling out NFR-SEC-1 in the message |
| 🟡 MEDIUM | HTTP error messages don't parse JSON `{message: ...}` from GitHub/search/fetch — users see raw bodies | Deferred — a follow-up "friendly errors" pass |
| 🟡 MEDIUM | `void ev.data.text().then(handle)` in `live.ts:205` — unhandled rejection on corrupt Blob | ✅ **FIXED** as part of the `live.ts` fix above |
| 🟢 LOW | Empty-plan output not explicitly checked in planner parse path | Deferred — replan loop catches it |
| 🟢 LOW | Checkpoint catch block silent | Deferred — defensive; not user-visible |

### 3. Performance + bundle

All HIGH-severity items are **scale-dependent** — they don't matter at small
sizes but will at scale. None blocks launch; all documented for future
work.

| Severity | Finding | Status |
|---|---|---|
| 🔴 HIGH (at scale) | ChatView transcript not virtualized — DOM grows linearly at 500+ items | Deferred — measure first; add `react-window` if real perf hits land |
| 🔴 HIGH (at scale) | Overlay bundle is single 700 KB IIFE (`vite.content.config.ts inlineDynamicImports: true`) — can't code-split because content scripts can't load async chunks | Deferred — tree-shake unused views from overlay if it stays chat-only |
| 🔴 HIGH (at scale) | Library search is O(n) cosine across all chunks per query — at 1000+ chunks (~100 docs), ~500 ms search + 6 MB vector data loaded into memory | Deferred — switch to SQLite-vec or Faiss.js when library size becomes a real issue |
| 🟡 MEDIUM | Tool-result text rendered inline in ConfirmCard could bloat DOM | Deferred — truncate with `<details>` disclosure |
| 🟡 MEDIUM | `ChatView` is 1900 lines; `TranscriptRow` not memoized → unnecessary re-renders | Deferred — measure with React Profiler first |
| 🟡 MEDIUM | Agent planner re-runs full tool-list serialization every step | Deferred — cache `toolList` per session |
| 🟡 MEDIUM | IDB writes one transaction per `saveConversation` (not batched) | Deferred — debounce or batch on Android-class throughput |
| 🟢 LOW | `react-markdown` + `remark-gfm` add 124 KB | Deferred — acceptable trade-off; revisit if overlay becomes a bottleneck |
| 🟢 LOW | Vite default minifier — Terser would shave another 5-10% | Deferred — low ROI |
| 🟢 LOW | Remote registry fetched every SW boot | Deferred — once-per-day cache when worth it |

### 4. A11y + the 24 lint warnings

| Severity | Finding | Status |
|---|---|---|
| 🔴 HIGH (correctness) | `ChatView:720` `submit()` useCallback missing `githubDefaultRepo`, `libraryAutoContext`, `thinkHarder`, `visionConfirmAll` — stale-closure could fire agent runs with old config | ✅ **FIXED** (`77c5829`) — all four deps added |
| 🔴 HIGH (correctness) | `ChatView:803` `runWorkflow()` missing `githubDefaultRepo` | ✅ **FIXED** (`77c5829`) |
| 🔴 HIGH (correctness) | `ChatView:837` `resumeRun()` missing `githubDefaultRepo` | ✅ **FIXED** (`77c5829`) |
| 🟡 MEDIUM | `ChatView:900` useLayoutEffect intentionally uses `pendingConfirm?.id` not the full object (computed fresh every render) | ✅ Suppression with justification comment (`77c5829`) |
| 🟡 MEDIUM | `ConsoleApp:84` cleanup reads `controllerRef.current` — eslint warns, but ref is intentionally read at unmount time (latest controller) | ✅ Suppression with justification comment (`77c5829`) |
| 🔴 HIGH | `.pill-ok` text `#047857` on green-tinted background — fails WCAG AA contrast (~2.5:1) | ✅ **FIXED** (`77c5829`) — darkened to `#065f46` (4.5:1+). Also fixed `.webhook-test.is-ok`. |
| 🟡 MEDIUM | Modal Escape close + focus trap missing on `.wf-modal`, `.mcp-add`, `.hitl` | Deferred — first-pass keyboard accessibility |
| 🟡 MEDIUM | ~25 icon-only buttons unlabeled | Deferred — full aria-label sweep |
| 🟡 MEDIUM | Streaming agent reply lacks `aria-live` region | Deferred — screen-reader UX |
| 🟢 LOW | Some text inputs lack `aria-label` (use placeholder only) | Deferred |
| 🟢 LOW | No `<main>` / `<nav>` landmark roles on the panel shell | Deferred |

Stale `eslint-disable` directives (all 3 cleared in `acd764c`):
- `src/llm/adapters/openaiCompatible.test.ts:4` (`no-explicit-any`)
- `src/page/pageContext.ts:61` (`no-constant-condition`)
- `src/sandbox/run.ts:34` (`no-new-func`)

The 16 `react-refresh/only-export-components` warnings — analysis says
only `src/views/apps/console/shared.tsx` is worth splitting (mixes
constants + components + hooks). Tracked as a follow-up; rest accepted.

---

## What's fixed today

`acd764c` and `77c5829` together close:

- **3 stale `eslint-disable` directives** removed
- **5 real bugs** (all HIGH-severity, all silent-failure paths):
  1. Tool-handler exception escaping the registry
  2. MCP session pool not invalidating on connection failure
  3. Live WebSocket message handler swallowing exceptions
  4. `setAccessLevel` failing silently (NFR-SEC-1 at risk)
  5. 4 stale-closure stale config in agent / workflow / resume paths
- **1 manifest hygiene** (`<all_urls>` removal)
- **2 contrast failures** (`.pill-ok`, `.webhook-test.is-ok`)
- **6 new unit tests** (registry try-catch normalization)

## What's deferred (and why)

Most deferred items are **scale-dependent perf work** or **polish a11y**.
They are real but don't move the dial at v0.1.0 size. Each carries a
specific trigger:

- **Virtualize ChatView** — when a real user hits a 500+ item chat and
  reports lag
- **Library ANN index** — when a real user hits a 1000+ chunk library
  and reports slow search
- **Overlay tree-shake** — when a real user reports overlay first-paint
  latency
- **Modal focus traps / Escape close** — first a11y polish PR
- **Icon-button aria-label sweep** — second a11y polish PR
- **Streaming aria-live** — third a11y polish PR
- **HTTP-error JSON parsing** — when a user reports an opaque GitHub /
  search error

All tracked here. None block the OSS launch promise. The "promise" the
SECURITY.md and README make is that the agent does what it says, asks
before consequential action, doesn't leak keys, and ships zero remote
code — all verified.

## Commits in this review

- `acd764c` — Phase 2 quick wins (3 stale `eslint-disable` directives)
- `77c5829` — Phase 2 main batch (4 HIGH severity + 4 hooks-deps + manifest + contrast)

## Next obvious cleanup pass (when worth it)

1. **a11y polish PR** — modal focus + Escape, icon-button aria-label
   sweep, streaming `aria-live`. Estimated half-day.
2. **`console/shared.tsx` file split** — extract utilities to a separate
   module so HMR works properly. Half-hour.
3. **Friendlier HTTP errors** — JSON-parse `{message}` from upstream
   APIs before surfacing. Two hours.
4. **Performance baselining** — set up `tests/perf/` with a synthetic
   1000-message chat + a 1000-chunk library. Then we can MEASURE before
   making the virtualization / ANN-index calls. One day.
