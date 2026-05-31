// BudgetLedger — a single, mutable spend ledger shared BY REFERENCE across an
// agent run and any nested child runs (sub-agents / call_skill). Because the
// parent and every child debit the SAME instance, nested cost is visible to the
// top-level ceiling — closing the leak where buildCallSkillTool discarded a
// child run's cost (runner.ts) and budgets silently multiplied across nesting.
//
// Modeled on src/sandbox/host.ts: the wall-clock deadline is ABSOLUTE (set once
// at creation) and is never refreshed by sub-activity, and a model-call ceiling
// is a hard runaway backstop. `now` is injected into exceeded()/snapshot() so
// the ledger is pure and unit-testable without faking the clock.

export interface BudgetLedgerLimits {
  /** Shared USD ceiling across a run AND its nested children. */
  costCeiling: number;
  /** Max model calls across the whole tree — a runaway backstop. */
  callCeiling: number;
  /** Absolute wall-clock budget (ms) from creation; never refreshed. */
  wallClockMs: number;
}

interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LedgerSnapshot {
  costUsed: number;
  calls: number;
  usage: CallUsage;
  elapsedMs: number;
}

export class BudgetLedger {
  private cost = 0;
  private calls = 0;
  private readonly usageAcc: CallUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private readonly deadline: number;

  constructor(private readonly limits: BudgetLedgerLimits, createdAtMs: number) {
    this.deadline = createdAtMs + limits.wallClockMs;
  }

  /** Debit one model call's cost + tokens into the shared total. */
  record(cost: number, usage: CallUsage): void {
    this.cost += cost;
    this.calls += 1;
    this.usageAcc.inputTokens += usage.inputTokens;
    this.usageAcc.outputTokens += usage.outputTokens;
    this.usageAcc.totalTokens += usage.totalTokens;
  }

  /** A reason string if any shared ceiling is hit at `nowMs`, else null. */
  exceeded(nowMs: number): string | null {
    if (this.cost >= this.limits.costCeiling) {
      return `Cost budget reached ($${this.limits.costCeiling.toFixed(4)}).`;
    }
    if (this.calls >= this.limits.callCeiling) {
      return `Model-call budget reached (${this.limits.callCeiling} calls).`;
    }
    if (nowMs >= this.deadline) {
      return `Time budget reached (${Math.round(this.limits.wallClockMs / 1000)}s).`;
    }
    return null;
  }

  get spend(): number {
    return this.cost;
  }

  get callCount(): number {
    return this.calls;
  }

  snapshot(nowMs: number): LedgerSnapshot {
    return {
      costUsed: this.cost,
      calls: this.calls,
      usage: { ...this.usageAcc },
      elapsedMs: this.limits.wallClockMs - (this.deadline - nowMs),
    };
  }
}
