import { describe, it, expect } from 'vitest';
import { cdpLocatorExpression, isCdpAvailable } from './cdp';

describe('cdpLocatorExpression', () => {
  it('uses querySelector for a selector', () => {
    const expr = cdpLocatorExpression('input[name="q"]');
    expect(expr).toContain('document.querySelector("input[name=\\"q\\"]")');
    expect(expr).not.toContain('||');
  });

  it('falls back to text matching, JSON-escaped (injection-safe)', () => {
    const expr = cdpLocatorExpression(undefined, 'Submit");evil()//');
    expect(expr).toContain('querySelectorAll');
    // The text is JSON-encoded so it cannot break out of the string literal.
    expect(expr).toContain(JSON.stringify('Submit");evil()//'));
  });

  it('combines selector OR text', () => {
    const expr = cdpLocatorExpression('#go', 'Go');
    expect(expr).toContain('document.querySelector("#go")');
    expect(expr).toContain(' || ');
  });

  it('returns null when neither is given', () => {
    expect(cdpLocatorExpression()).toBe('null');
  });
});

describe('isCdpAvailable', () => {
  it('is false without chrome.debugger', () => {
    expect(isCdpAvailable()).toBe(false);
  });
});
