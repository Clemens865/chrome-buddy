# Blueprint — Bounded Sub-Agents / Task Decomposition

> Produced by the idea-forge adversarial design pass (Critic · Architect · Researcher → Evaluator · Devil's Advocate → Synthesizer), grounded in the live codebase. Status: **design approved, not yet built.**

---

## 1. Executive Summary

**The problem.** Chrome Buddy's single agent loop handles complex, multi-part tasks in one ever-growing context, which bloats tokens and loses focus; we want the agent to decompose a big task into focused sub-tasks with clean, isolated contexts — without unbounded cost (Agent Zero's confessed failure, issue #1088) and without losing our HITL / zero-RCE / bounded-cost guarantees.

**The chosen approach.** A **hybrid**: a **flat planner–worker queue** as the resumable spine (one top-level loop drains a serializable `subtasks[]` array inside the existing `Scratchpad`; each sub-task runs sequentially with an isolated digest-only context against one shared budget), plus a tightly-capped, **read-only-by-default `delegate` tool** as an opt-in escape hatch for the rare task that needs one extra level of decomposition (multi-level read-research).

**Why it won.** The diverge round established the load-bearing fact that the agent loop runs in the **side-panel document, not the service worker** — so the real killable context is the *panel closing*, and the existing single-key checkpoint **cannot represent a recursive call stack**. The flat queue (scored 49/60) resumes for free via the existing checkpoint with no migration, is sequential (so it never triggers the existing concurrent-confirm collision or the shared-tab race), and caps prompt-injection fan-out post-parse. The literal recursive child-agent (37/60) would double-fire consequential actions on resume and walk into a live HITL keying bug.

**Key risk & mitigation.** Resume re-firing a consequential action that already ran: mitigated by **checkpoint-before-side-effect** (mark the action `pending` before invoking, `done` after) plus the existing `completedSteps` skip-on-resume. Budget runaway: mitigated by a **shared `BudgetLedger` threaded by reference** (never refreshed), hard `maxSubtasks`/`maxDelegates` caps enforced *before* execution, and a no-decomposition floor for trivial asks.

---

## 2. Concepts Explored

| Concept | One-liner | Score | Verdict |
|---|---|---|---|
| **A — Recursive sub-runs + shared BudgetLedger** | A `delegate` tool spawns a recursive `runAgentTask` child with narrowed tools + shared ledger + decrementing depth; generalizes `buildCallSkillTool`. | **37/60** | **Rejected as standalone** — resumability 3/10: subtree lives on the JS await-stack, dies on panel close, and the flat checkpoint can't hold it → double-fires consequential actions on resume. Larger injection surface (model-callable spawn). **Kept** as a bounded, read-only opt-in inside the hybrid. |
| **B — Flat planner–worker queue** | One top loop drains a serializable `subtasks[]` inside the existing `Scratchpad`; isolated digest contexts; one shared budget; resumable via the existing single-key checkpoint; no migration. | **49/60 — WINNER** | **Selected as the spine.** Highest reuse of the battle-tested path; sequential → no tab race, no confirm collision; injection fan-out capped post-parse. Limit: flat 1-level decomposition (covered by the `delegate` opt-in). |
| **C — Checkpoint-native DAG state machine** | Persisted node DAG in IndexedDB (keyed store + migration), one ready node per wakeup; per-node + persisted mid-run daily cap; survives any eviction; arbitrary DAGs. | **38/60** | **Deferred.** Strongest durability but largest surface + a real IDB migration, and the alarm-driven variant risks the SW 5-min-ceiling trap. Revisit only if real workloads need arbitrary-depth DAGs surviving a mid-sub-task panel close. |

---

## 3. Architecture

```
 ┌─────────────────────────── SIDE PANEL (the only long-lived JS context) ───────────────────────────┐
 │                                                                                                     │
 │   runAgentTask (runner.ts)                                                                          │
 │        │  constructs ONE shared BudgetLedger (cost / tokens / wall-clock / call-ceiling, by ref)    │
 │        ▼                                                                                            │
 │   AgentRuntime.run (runtime.ts)                                                                     │
 │        │                                                                                            │
 │        ├── planTask() ──► DECOMPOSE phase ──► Scratchpad.subtasks: SubTask[]   (≤ maxSubtasks=8)    │
 │        │                     │  no-decomposition floor: ≤1 tool-call task ⇒ single-step plan        │
 │        │                     ▼                                                                       │
 │        └── drain loop:  for each SubTask (SEQUENTIAL):                                              │
 │                 isolated digest-only context ─► runStep() ─► proposeToolCalls ─► executeCalls       │
 │                      │                                  │                                            │
 │                      │   checkBudgets(state, ledger) ◄──┘  (BOTH shared ledger + local caps)        │
 │                      │                                                                               │
 │                      │   consequential tool?  ─► gateConsequentialAction (hitl.ts)                  │
 │                      │        │  checkpoint(pending) BEFORE invoke ─► confirm card (runId+step+id)  │
 │                      │        ▼  invoke ─► checkpoint(done) AFTER                                    │
 │                      │                                                                               │
 │                      └── OPT-IN: `delegate` tool  ─► one extra level, READ-ONLY by default,         │
 │                              maxDepth=1, maxDelegatesPerRun=3 (enforced IN HANDLER, pre-call),      │
 │                              draws from the SAME ledger, returns a 1–2k-token digest,               │
 │                              NON-resumable (parent sub-task re-runs whole on resume — safe          │
 │                              because read-only)                                                      │
 │                                                                                                     │
 │   saveCheckpoint(state) ──► IndexedDB 'active' (Scratchpad incl. subtasks[], rehydrate ?? [])       │
 └─────────────────────────────────────────────────────────────────────────────────────────────────┘
                    │  short LLM_GENERATE / TOOL_EXEC round-trips only
                    ▼
   SERVICE WORKER (stateless broker; holds the session key; runs fetch + page tools)
```

**Component inventory**
- **DECOMPOSE phase** (`runtime.ts`) — after `planTask`, optionally split into `SubTask[]`; honors the no-decomposition floor and `maxSubtasks`.
- **Sub-task drain loop** (`runtime.ts`) — sequential `for` over `Scratchpad.subtasks`, wrapping the existing `runStep`; reuses `checkBudgets` / `compressEvidence` / `synthesizeAnswer`.
- **`BudgetLedger`** (new `src/agent/budget-ledger.ts`) — by-reference, never-refreshed accumulator (cost, tokens, wall-clock deadline, call ceiling), modeled on `src/sandbox/host.ts`. Shared across the run + any `delegate` child. Adds a mid-run daily-cap consult.
- **`delegate` tool** (`src/tools/defs.ts`) — read/search-only `allowedTools` by default; handler enforces depth/sub-count caps *before* the recursive `runAgentTask`; threads the same ledger + `onConfirm` + `onEvent`.
- **Transcript tree** (`transcript.ts`) — `subtask_start`/`subtask_result` events render as indented groups; `confirmKey` gains `runId`; global monotonic step counter.
- **Role presets** (`runner.ts`) — `researcher` / `summarizer` map to `systemPrefix` + narrowed `allowedTools`, usable as sub-task roles and `delegate` profiles.

**Data flow.** task → plan → `subtasks[]` (persisted) → sequential digest-context execution → per-step `checkBudgets(shared ledger + local caps)` → consequential actions gated + checkpoint-bracketed → each sub-task returns a 1–2k-token digest into the shared `Scratchpad` → final `synthesizeAnswer` over compressed evidence.

**Integration points.** `runAgentTask`/`AgentRuntime.run`; `checkBudgets`/`account`; `gateConsequentialAction` + `ApprovalResolver`; `ToolRegistry.list(allowedTools)`; `saveCheckpoint`/`loadCheckpoint`; `ChatView` resume-on-open + `pendingRef`.

---

## 4. Implementation Roadmap

### Phase 1 — Cross-cutting correctness fixes *(ship independently; valuable without sub-agents)*
- **Build:** (1) `BudgetLedger` by-reference + thread into nested `runAgentTask`; fold child cost back (fix `runner.ts:286`); add mid-run daily-cap consult. (2) HITL correlation: add `runId` to `confirmKey` (`transcript.ts:40`); key `pendingRef` by `runId+globalStep+real call.id` (not `req.summary`, `ChatView.tsx`); never stub a child `onEvent`. (3) Tab lease/lock for page actions. (4) Checkpoint-before-side-effect bracket.
- **Files:** `src/agent/budget-ledger.ts` (new), `runner.ts`, `runtime.ts`, `transcript.ts`, `src/views/ChatView.tsx`.
- **Validation:** unit — ledger accumulates across nested runs & blocks at ceiling; two confirms at same step index get distinct keys. e2e — existing agent + skill flows green; a consequential action interrupted by panel close does not re-fire on resume.
- **Complexity:** **M**.

### Phase 2 — Flat planner–worker queue (the spine)
- **Build:** DECOMPOSE phase + `subtasks[]` drain loop; isolated digest context per sub-task; `maxSubtasks=8` (post-parse, pre-exec); no-decomposition floor; shared budget via Phase-1 ledger; transcript tree.
- **Files:** `runtime.ts`, `types.ts` (additive `SubTask`, `Scratchpad.subtasks`, `AgentEvent` variants `decompose`/`subtask_start`/`subtask_result`), `transcript.ts`, `checkpoint.ts` (rehydrate `subtasks ?? []`), `runner.ts` (role presets).
- **Validation:** unit — planner parse caps at 8; trivial task → single-step (no decomposition); resume rehydrates `subtasks[]` and skips completed. e2e — stub-LLM decomposes a task into N sub-tasks, runs sequentially, shared budget enforced, resume-after-close does not double-fire.
- **Complexity:** **M–L**.

### Phase 3 — `delegate` opt-in (read-only escape hatch)
- **Build:** `delegate` `ToolDefinition`; handler enforces `maxDepth=1`, `maxDelegatesPerRun=3` *before* the call; read/search-only `allowedTools` default; same shared ledger + resolvers; returns a 1–2k-token digest; non-resumable (parent sub-task re-runs whole on resume).
- **Files:** `src/tools/defs.ts`, `runner.ts` (wiring + profiles), `runtime.ts`.
- **Validation:** unit — handler rejects the 4th delegate and any depth-2; read-only child rejects a consequential tool. e2e — injected "spawn 100 researchers" is capped; delegated read-research returns a digest and never fires a consequential action.
- **Complexity:** **M**.

### Phase 4 — Hardening & roles
- **Build:** finalize tab-lease semantics under sub-tasks; checkpoint-before-side-effect across the whole spine; expose `researcher`/`summarizer` as delegatable profiles in the UI; transcript polish.
- **Files:** `runtime.ts`, `transcript.ts`, `runner.ts`, `ChatView.tsx`.
- **Validation:** e2e — concurrent page-action attempts serialize via the lease; profile selection narrows tools.
- **Complexity:** **S–M**.

> **Sequencing note:** do **not** build the planned extension hook bus first. Extract it later (rule of three) from the 3–4 callbacks Phase 2 introduces (`onDecompose`, `onSubtaskStart/Result`, ledger injection). The by-reference `BudgetLedger` is the one foundational refactor, and it's correct on its own.

---

## 5. Test Specifications

**Unit**
- `budget-ledger.ts`: nested debits accumulate into one shared total; `check()` blocks once cost/token/wall-clock/call-ceiling exceeded; never refreshes on sub-activity.
- `parsePlannerOutput`: caps sub-tasks at 8; drops malformed entries; emits a single-step plan for ≤1-tool-call tasks (no-decomposition floor).
- `confirmKey(runId, step, callId)`: two sub-tasks at the same local step index produce distinct keys (no collision).
- `delegate` handler: rejects 4th delegate in a run; rejects depth-2; read-only child registry rejects `send_webhook`/`write_file`/`github_write`.
- `checkpoint`: `Scratchpad` with `subtasks[]` round-trips; legacy checkpoint without the field rehydrates via `?? []`.

**Integration / e2e (Playwright, stubbed LLM)**
- **Resume-no-double-fire:** sub-task 3 of 6 completes a consequential action; panel closed before/after the bracket; on reopen + resume the action is **not** re-invoked.
- **Shared-budget-enforced:** a plan whose sub-tasks would individually fit but collectively exceed the ceiling halts at the cap (not N× the cap).
- **Injection-cap:** a page injecting "spawn 100 sub-agents/researchers" yields ≤ `maxSubtasks` / ≤ `maxDelegatesPerRun`, enforced before execution.
- **Read-only-delegate-rejects-consequential:** a delegated child attempting a consequential tool is refused.
- **No-decomp-floor:** a trivial prompt ("what time is it") runs single-shot, not decomposed.
- **Confirm-key-no-collision:** sequential sub-tasks each surface their own confirm card; the right resolver receives the right approval.
- **HITL-in-sub-task:** a consequential action inside a sub-task renders a confirm card (child `onEvent` not stubbed) and blocks until approved.

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Resume re-fires a consequential action | Med | High | Checkpoint-before-side-effect bracket + `completedSteps` skip; v1 `delegate` non-resumable & read-only |
| Budget leak across nesting (today's bug) | High (exists) | High | Shared `BudgetLedger` by reference; fold child cost; ceiling never refreshed |
| Concurrent confirm cards collide (today's bug) | Med | High | `runId` in `confirmKey`; `pendingRef` keyed by real `call.id`; sequential spine avoids concurrency entirely |
| Over-decomposition of trivial tasks → token blowup | Med | Med | No-decomposition floor + `maxSubtasks=8` |
| Prompt-injection fan-out | Med | High | Caps enforced post-parse / in-handler before execution; no model-callable spawn in the spine |
| Mid-sub-task budget exhaustion leaves half-mutated page | Med | Med | Pre-action checkpoint; surface partial state; (no rollback today — see Open Questions) |
| Shared-tab page-action race | Low (spine sequential) | Med | Tab lease/lock; sequential execution |
| Checkpoint bloat (base64 screenshots × sub-tasks) | Med | Med | Store digests not raw traces; cap evidence; consider screenshot eviction |
| Digest drops a load-bearing fact | Med | Med | Spine keeps all sub-task `actions[]` in the one shared scratchpad (recoverable); delegate is read-only so lower stakes |

---

## 7. Open Questions

1. **Page-action rollback.** No mechanism exists to undo a half-completed page mutation when budget/wall-clock trips mid-action. Acceptable for v1 (surface partial state) or do we need a compensating action model?
2. **Daily-cap mid-run gate.** Where exactly to consult `cost/budget.ts` inside `checkBudgets` without a per-step IDB read on the hot path — cache the day total in the ledger at run start and decrement?
3. **Digest sizing.** Is a fixed 1–2k-token sub-task summary right, or should it scale with the parent's remaining budget?
4. **Delegate widening.** When a user genuinely needs a delegated child to perform a consequential action, what's the explicit per-call opt-in UX (and does it stay HITL-gated)?
5. **When to revisit Concept C.** Define the trigger (e.g., telemetry showing tasks that need arbitrary-depth DAGs surviving mid-sub-task panel close) that would justify the DAG state machine + IDB migration.
6. **Checkpoint size ceiling.** At what serialized size do we evict screenshots / compress, given IDB quota and per-step write latency?
