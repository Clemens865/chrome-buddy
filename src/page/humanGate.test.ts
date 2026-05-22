import { describe, it, expect } from 'vitest';
import { detectHumanGate } from './humanGate';

describe('detectHumanGate', () => {
  it('flags CAPTCHA challenges', () => {
    expect(detectHumanGate({ text: "Please verify you are human. I'm not a robot." })).toBe('captcha');
    expect(detectHumanGate({ text: 'We detected unusual traffic from your computer network.' })).toBe('captcha');
  });

  it('flags login / 2FA walls', () => {
    expect(detectHumanGate({ text: 'Enter your password to continue.' })).toBe('login');
    expect(detectHumanGate({ title: 'Two-factor authentication', text: 'Enter the verification code.' })).toBe('login');
    expect(detectHumanGate({ text: 'Please sign in to continue.' })).toBe('login');
  });

  it('does not flag ordinary pages with a Sign in link', () => {
    expect(detectHumanGate({ title: 'Acme Blog', text: 'Top stories today. Sign in · About · Contact' })).toBeNull();
    expect(detectHumanGate({ text: 'An article about CAPTCHAs in general security research.' })).toBeNull();
  });
});
