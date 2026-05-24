import { describe, it, expect } from 'vitest';
import { requiresConfirmation } from './visionLoop';

describe('requiresConfirmation', () => {
  it('gates when the model marks safety_decision.decision = require_confirmation', () => {
    const out = requiresConfirmation(
      { x: 100, y: 200, safety_decision: { decision: 'require_confirmation', explanation: 'CAPTCHA detected' } },
      false,
    );
    expect(out).toEqual({ gated: true, explanation: 'CAPTCHA detected' });
  });

  it('does NOT gate a regular action when confirmAll is off', () => {
    expect(requiresConfirmation({ x: 100, y: 200 }, false)).toEqual({ gated: false });
  });

  it('gates every action when confirmAll is on (no explanation set)', () => {
    expect(requiresConfirmation({ x: 100, y: 200 }, true)).toEqual({ gated: true });
  });

  it('prefers the safety_decision explanation over confirmAll', () => {
    const out = requiresConfirmation(
      { url: 'https://shop/checkout', safety_decision: { decision: 'require_confirmation', explanation: 'about to purchase' } },
      true,
    );
    expect(out.gated).toBe(true);
    expect(out.explanation).toBe('about to purchase');
  });

  it('does not gate when safety_decision exists but decision is not require_confirmation', () => {
    expect(
      requiresConfirmation({ x: 0, y: 0, safety_decision: { decision: 'allow' } as { decision: string } }, false),
    ).toEqual({ gated: false });
  });
});
