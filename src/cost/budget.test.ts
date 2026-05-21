import { describe, it, expect } from 'vitest';
import { applySpend, isOverDailyCap, todayKey } from './budget';

describe('todayKey', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(todayKey(new Date(2026, 4, 21))).toBe('2026-05-21');
  });
});

describe('applySpend', () => {
  it('starts a fresh ledger when none exists', () => {
    expect(applySpend(null, 0.12, '2026-05-21')).toEqual({ date: '2026-05-21', total: 0.12 });
  });
  it('accumulates within the same day', () => {
    const a = applySpend({ date: '2026-05-21', total: 0.1 }, 0.05, '2026-05-21');
    expect(a.total).toBeCloseTo(0.15);
  });
  it('resets when the day rolls over', () => {
    expect(applySpend({ date: '2026-05-20', total: 9 }, 0.2, '2026-05-21')).toEqual({
      date: '2026-05-21',
      total: 0.2,
    });
  });
});

describe('isOverDailyCap', () => {
  it('treats cap<=0 as no cap', () => {
    expect(isOverDailyCap(100, 0)).toBe(false);
  });
  it('trips at or above the cap', () => {
    expect(isOverDailyCap(5, 5)).toBe(true);
    expect(isOverDailyCap(4.99, 5)).toBe(false);
  });
});
