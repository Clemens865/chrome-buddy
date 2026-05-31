// Phase 2 — flat planner-worker spine (pure, testable; no I/O here).
//
// The DECOMPOSER turns a genuinely multi-phase task into a SHORT, ORDERED list
// of focused sub-tasks. Each runs sequentially with its own clean context and
// hands a short digest to the next — keeping any single context lean so the
// agent doesn't drift or bloat on long tasks. Two guards bound it:
//   • no-decomposition FLOOR — anything needing <2 genuine sub-tasks is NOT
//     decomposed (returns null), so simple asks stay on the cheap single loop
//     and never pay the multi-phase token tax.
//   • MAX_SUBTASKS cap — bounds fan-out (prompt-injection "spawn 100" guard,
//     enforced here AFTER the model replies, BEFORE anything executes).

/** Hard cap on sub-tasks per run (fan-out backstop). */
export const MAX_SUBTASKS = 8;

/** Preset personas a sub-task can run under (maps to a system prefix later). */
export type SubTaskRole = 'researcher' | 'summarizer' | 'general';
const ROLES: readonly SubTaskRole[] = ['researcher', 'summarizer', 'general'];

export type SubTaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface SubTask {
  /** Stable within a run: 'st1', 'st2', … (used as a correlation key). */
  id: string;
  /** The focused sub-goal, as a concise imperative. */
  goal: string;
  /** Which preset persona runs it. */
  role: SubTaskRole;
  status: SubTaskStatus;
  /** Short result summary handed to later sub-tasks + the final synthesis. */
  digest?: string;
}

export const DECOMPOSE_SYSTEM =
  'You are the Decomposer of a browser agent. Split the task into a SHORT, ORDERED ' +
  'list of focused sub-tasks ONLY when it genuinely needs multiple independent ' +
  'phases (e.g. research several sources, then compile the findings). Each sub-task ' +
  'runs with its own clean context and hands a short result to the next. ' +
  'If the task is simple, single-phase, or needs at most one tool action, DO NOT ' +
  'decompose — return {"subtasks":[]} and the agent will handle it directly. ' +
  'For research across the user\'s OPEN TABS or authenticated pages, prefer ' +
  'sub-tasks that sweep those tabs (list_tabs + read_tab) over generic web search. ' +
  `Never exceed ${MAX_SUBTASKS} sub-tasks. ` +
  'Each sub-task is {"goal":"concise imperative","role":"researcher|summarizer|general"}. ' +
  'Respond ONLY with JSON: {"subtasks":[...]}.';

const isRole = (v: unknown): v is SubTaskRole => typeof v === 'string' && ROLES.includes(v as SubTaskRole);

/** Tolerant extraction of the first JSON object/array from possibly-fenced prose. */
function extractJson(text: string): unknown {
  if (!text) return null;
  let raw = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  if (raw[0] !== '{' && raw[0] !== '[') {
    const start = raw.search(/[[{]/);
    if (start < 0) return null;
    raw = raw.slice(start);
  }
  try {
    return JSON.parse(raw);
  } catch {
    const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
    if (end < 0) return null;
    try {
      return JSON.parse(raw.slice(0, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Parse the decomposer reply into sub-tasks, or null to NOT decompose.
 *
 * The no-decomposition floor: fewer than 2 usable sub-tasks (the model opted
 * out, replied with junk, or surfaced only one phase) → null, so the caller runs
 * the normal single loop unchanged. With ≥2, the list is capped at `max` and
 * each entry gets a stable id + a validated role (unknown roles → 'general').
 */
export function parseDecomposition(text: string, max = MAX_SUBTASKS): SubTask[] | null {
  const parsed = extractJson(text);
  const arr = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).subtasks)
      ? ((parsed as Record<string, unknown>).subtasks as unknown[])
      : null;
  if (!arr) return null;

  const goals = arr
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const o = s as Record<string, unknown>;
      const goal = typeof o.goal === 'string' ? o.goal.trim() : '';
      if (!goal) return null;
      return { goal, role: isRole(o.role) ? o.role : ('general' as SubTaskRole) };
    })
    .filter((g): g is { goal: string; role: SubTaskRole } => g !== null);

  // Floor: decomposing into 0 or 1 sub-task is pointless — keep the single loop.
  if (goals.length < 2) return null;

  return goals.slice(0, Math.max(1, max)).map((g, i) => ({
    id: `st${i + 1}`,
    goal: g.goal,
    role: g.role,
    status: 'pending' as SubTaskStatus,
  }));
}

// --- Sequential drain (pure orchestration; the runner injects the I/O) -------

/** The outcome of running one sub-task: its result digest + whether it succeeded. */
export interface SubtaskOutcome {
  digest: string;
  ok: boolean;
}

/** Events the drain emits so the transcript can render the sub-task tree. */
export type SubtaskEvent =
  | { type: 'subtask_start'; id: string; goal: string; role: SubTaskRole }
  | { type: 'subtask_result'; id: string; status: SubTaskStatus; digest: string };

export interface DrainHooks {
  /** Execute one sub-task given the accumulated digests of the prior ones;
   *  returns this sub-task's own result digest. The runner wires this to a
   *  bounded, isolated-context runAgentTask sharing the run's BudgetLedger. */
  runSubtask: (subtask: SubTask, priorContext: string) => Promise<SubtaskOutcome>;
  /** Surfaced to the transcript (start/result per sub-task). */
  onEvent?: (event: SubtaskEvent) => void;
  /** Returns a reason when the shared budget/cancel is tripped, else null.
   *  Checked BEFORE each sub-task so a drained-dry budget stops cleanly. */
  checkStop?: () => string | null;
}

/**
 * Drain sub-tasks SEQUENTIALLY (never concurrent — the safety property that
 * avoids tab races + HITL collisions). Each sub-task receives the accumulated
 * digests of the ones before it (isolated-context-with-handoff), and its own
 * digest is appended for the next. A failed sub-task does NOT abort the drain
 * (graceful partial); a tripped budget/cancel marks the remaining sub-tasks
 * skipped without spending. Pure: all I/O is injected via hooks.
 */
export async function drainSubtasks(subtasks: SubTask[], hooks: DrainHooks): Promise<SubTask[]> {
  const results: SubTask[] = [];
  let context = '';
  for (const st of subtasks) {
    const stop = hooks.checkStop?.();
    if (stop) {
      results.push({ ...st, status: 'failed', digest: `(skipped — ${stop})` });
      continue;
    }
    hooks.onEvent?.({ type: 'subtask_start', id: st.id, goal: st.goal, role: st.role });
    let outcome: SubtaskOutcome;
    try {
      outcome = await hooks.runSubtask(st, context);
    } catch (e) {
      outcome = { digest: e instanceof Error ? e.message : String(e), ok: false };
    }
    const status: SubTaskStatus = outcome.ok ? 'done' : 'failed';
    results.push({ ...st, status, digest: outcome.digest });
    if (outcome.digest) {
      context += `${context ? '\n\n' : ''}[Result of sub-task "${st.goal}":\n${outcome.digest}\n]`;
    }
    hooks.onEvent?.({ type: 'subtask_result', id: st.id, status, digest: outcome.digest });
  }
  return results;
}

/** Join completed sub-task digests into the context block for a final compose. */
export function composeContext(results: SubTask[]): string {
  return results
    .filter((s) => s.digest)
    .map((s) => `## ${s.goal}\n${s.digest}`)
    .join('\n\n');
}
