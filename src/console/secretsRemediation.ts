// Secrets remediation: per-provider rotation playbooks, a stable signature for
// the allowlist (dismiss false positives), and a redacted compliance CSV export.
// Pure — no chrome, no I/O — fully unit-testable.

import type { SensitiveHit } from './sensitivePatterns';

export interface Rotation {
  label: string;
  /** Where to rotate the credential, when there's a provider console. */
  url?: string;
  /** One-line how-to. */
  steps: string;
}

/** Per-pattern rotation guidance. Provider keys link to their console. */
const ROTATION: Record<string, Rotation> = {
  'openai-key': { label: 'Rotate OpenAI key', url: 'https://platform.openai.com/api-keys', steps: 'Revoke this key, create a new one, and move it server-side (never ship it to the browser).' },
  'google-api-key': { label: 'Rotate Google API key', url: 'https://console.cloud.google.com/apis/credentials', steps: 'Regenerate the key and add HTTP-referrer / API restrictions so a leaked key is unusable.' },
  'stripe-key': { label: 'Roll Stripe key', url: 'https://dashboard.stripe.com/apikeys', steps: 'Roll the key immediately. A leaked SECRET (sk_) key can move money — treat as an incident.' },
  'github-pat': { label: 'Revoke GitHub token', url: 'https://github.com/settings/tokens', steps: 'Revoke the token now and issue a fine-grained one with the minimum scopes.' },
  'slack-token': { label: 'Rotate Slack token', url: 'https://api.slack.com/apps', steps: 'Revoke the token in your app settings and reinstall to mint a new one.' },
  'aws-access-key': { label: 'Disable AWS key', url: 'https://console.aws.amazon.com/iam/', steps: 'Deactivate then delete this access key in IAM and issue a new one; audit CloudTrail for misuse.' },
  'pem-private': { label: 'Replace key pair', steps: 'Generate a fresh key pair, deploy the new public key, and revoke the leaked private key everywhere.' },
  'jwt': { label: 'Invalidate session', steps: "Treat the JWT as compromised: rotate the signing secret (invalidates all tokens) and re-issue the user's session." },
};

/** Generic advice by category for non-provider PII (email, phone, card…). */
const CATEGORY_ADVICE: Record<string, string> = {
  'API Key': 'Move the key server-side and rotate it at the provider.',
  Credential: 'Rotate the credential and stop exposing it to the client.',
  PII: 'Do not render this in client-readable storage or page text; keep it server-side.',
};

/** Rotation guidance for a hit, or undefined when none applies. */
export function getRotation(hit: Pick<SensitiveHit, 'id' | 'category'>): Rotation | undefined {
  if (ROTATION[hit.id]) return ROTATION[hit.id];
  const advice = CATEGORY_ADVICE[hit.category];
  return advice ? { label: 'How to handle', steps: advice } : undefined;
}

/** Stable signature for the allowlist — identifies a specific finding so the
 *  user can dismiss exactly it (a known-safe email) without muting the rule. */
export function hitSignature(hit: Pick<SensitiveHit, 'id' | 'source' | 'preview'>): string {
  return `${hit.id}|${hit.source}|${hit.preview}`;
}

function csvCell(s: string | number): string {
  const v = String(s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Build a redacted compliance CSV (previews are already redacted upstream). */
export function buildSecretsCsv(hits: ReadonlyArray<SensitiveHit>): string {
  const header = ['category', 'id', 'severity', 'source', 'redacted_preview', 'count'];
  const rows = hits.map((h) => [h.category, h.id, h.severity, h.source, h.preview, h.count].map(csvCell).join(','));
  return [header.join(','), ...rows].join('\n') + '\n';
}
