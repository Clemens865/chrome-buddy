import { describe, it, expect } from 'vitest';
import { BudgetLedger } from './budget-ledger';

const usage = (n: number) => ({ inputTokens: n, outputTokens: n, totalTokens: 2 * n });
const limits = { costCeiling: 0.5, callCeiling: 5, wallClockMs: 10_000 };

describe('BudgetLedger', () => {
  it('accumulates cost, calls, and tokens across record()', () => {
    const l = new BudgetLedger(limits, 0);
    l.record(0.1, usage(100));
    l.record(0.2, usage(50));
    expect(l.spend).toBeCloseTo(0.3);
    expect(l.callCount).toBe(2);
    const snap = l.snapshot(0);
    expect(snap.usage).toEqual({ inputTokens: 150, outputTokens: 150, totalTokens: 300 });
  });

  it('is shared by reference — a "child" debiting the same instance is visible to the parent', () => {
    const shared = new BudgetLedger(limits, 0);
    shared.record(0.2, usage(10)); // parent
    const child = shared; // nested runs receive the SAME instance
    child.record(0.2, usage(10));
    child.record(0.2, usage(10));
    // Parent's view now reflects the child's spend → the leak is closed.
    expect(shared.spend).toBeCloseTo(0.6);
    expect(shared.exceeded(0)).toMatch(/Cost budget reached/);
  });

  it('flags the cost ceiling once reached', () => {
    const l = new BudgetLedger(limits, 0);
    expect(l.exceeded(0)).toBeNull();
    l.record(0.5, usage(1));
    expect(l.exceeded(0)).toMatch(/Cost budget reached \(\$0\.5000\)/);
  });

  it('flags the call ceiling as a runaway backstop', () => {
    const l = new BudgetLedger({ ...limits, costCeiling: 999 }, 0);
    for (let i = 0; i < 5; i++) l.record(0.001, usage(1));
    expect(l.exceeded(0)).toMatch(/Model-call budget reached \(5 calls\)/);
  });

  it('flags the absolute wall-clock deadline (never refreshed by activity)', () => {
    const l = new BudgetLedger({ ...limits, costCeiling: 999, callCeiling: 999 }, 1_000);
    l.record(0.001, usage(1)); // activity does not push the deadline out
    expect(l.exceeded(10_999)).toBeNull(); // 1000 + 10000 = 11000 deadline
    expect(l.exceeded(11_000)).toMatch(/Time budget reached \(10s\)/);
  });
});
