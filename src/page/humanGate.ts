// Detect CAPTCHA / bot-check / login / 2FA walls (FR-HITL-8). When the agent
// hits one of these it must PAUSE and hand control to the human ("solve this,
// then Resume") rather than attempt to bypass it (anti-goal #4). Pure + tested;
// the background attaches the result to page reads, the runtime acts on it.
export type HumanGate = 'captcha' | 'login';

// Conservative signals — strong phrasing only, to avoid pausing on every page
// that merely has a "Sign in" link in its header.
const CAPTCHA =
  /(recaptcha|hcaptcha|cf-turnstile|i'?m not a robot|are you a human|verify (?:you'?re|you are|that you are) (?:a )?human|complete the (?:captcha|security )?challenge|unusual traffic from your (?:computer )?network|press (?:and hold|& hold) to confirm)/i;

const LOGIN =
  /(enter your password|two[- ]factor|2[- ]?fa\b|verification code|one[- ]time (?:code|password)|authenticator app|sign in to continue|please (?:sign|log) ?in to (?:continue|view)|your session has expired)/i;

/** Returns the kind of human gate detected on the page, or null. */
export function detectHumanGate(p: { url?: string; title?: string; text?: string }): HumanGate | null {
  const hay = `${p.title ?? ''}\n${p.text ?? ''}`;
  if (CAPTCHA.test(hay)) return 'captcha';
  if (LOGIN.test(hay)) return 'login';
  return null;
}
