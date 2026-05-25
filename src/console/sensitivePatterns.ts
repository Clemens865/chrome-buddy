// Sensitive-data pattern table. Used by the scan_sensitive_data tool and the
// Console Inspector Security panel. Pure regex matching with light, deliberate
// false-positive guards — no chrome, no I/O, so it unit-tests in isolation.
//
// Categories follow the upstream Console-Buddy SecurityScanner module: API
// keys (provider-specific), JWTs, AWS access keys, private keys, generic
// "token=" / "key=" form encodings, credit cards (with Luhn), emails, phone
// numbers (US-style). Severity is conservative — "critical" only for things
// that can be used to impersonate or spend money.

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface SensitivePattern {
  /** Stable id used in tests + result rendering. */
  id: string;
  category: string;
  pattern: RegExp;
  severity: Severity;
  /** Human-readable description of what was found. */
  description: string;
  /** Optional extra check applied to the matched substring (e.g. Luhn). */
  validate?: (match: string) => boolean;
}

export interface SensitiveHit {
  id: string;
  category: string;
  severity: Severity;
  description: string;
  /** Redacted preview (first 4 + last 4 chars, never the middle). */
  preview: string;
  /** Where the hit was found: e.g. "localStorage:auth_token" or "dom". */
  source: string;
  count: number;
}

export const SENSITIVE_PATTERNS: SensitivePattern[] = [
  // --- Provider-specific API keys (high-confidence prefixes) ---------------
  {
    id: 'openai-key',
    category: 'API Key',
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/,
    severity: 'critical',
    description: 'OpenAI / similar "sk-" prefixed API key.',
  },
  {
    id: 'google-api-key',
    category: 'API Key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
    severity: 'critical',
    description: 'Google API key (AIza prefix).',
  },
  {
    id: 'stripe-key',
    category: 'API Key',
    pattern: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
    severity: 'critical',
    description: 'Stripe API key (live or test).',
  },
  {
    id: 'github-pat',
    category: 'API Key',
    pattern: /\bghp_[A-Za-z0-9]{36}\b/,
    severity: 'critical',
    description: 'GitHub Personal Access Token (ghp_).',
  },
  {
    id: 'slack-token',
    category: 'API Key',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
    severity: 'critical',
    description: 'Slack bot/user token (xox*).',
  },
  // --- AWS ----------------------------------------------------------------
  {
    id: 'aws-access-key',
    category: 'Cloud Credential',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    severity: 'critical',
    description: 'AWS access-key id (AKIA / ASIA).',
  },
  // --- JWTs ---------------------------------------------------------------
  {
    id: 'jwt',
    category: 'Auth Token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    severity: 'high',
    description: 'JSON Web Token (eyJ… header).',
  },
  // --- Private keys -------------------------------------------------------
  {
    id: 'pem-private',
    category: 'Private Key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    severity: 'critical',
    description: 'PEM-formatted private key.',
  },
  // --- Credit cards (Luhn-validated) --------------------------------------
  {
    id: 'cc-number',
    category: 'PII',
    pattern: /\b(?:\d[ -]?){13,19}\b/,
    severity: 'high',
    description: 'Credit-card number candidate (Luhn-validated).',
    validate: luhn,
  },
  // --- PII ----------------------------------------------------------------
  {
    id: 'email',
    category: 'PII',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    severity: 'low',
    description: 'Email address.',
  },
  {
    id: 'us-phone',
    category: 'PII',
    pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/,
    severity: 'low',
    description: 'US-style phone number.',
  },
  // --- Generic encoded secrets in URL/form bodies -------------------------
  {
    id: 'generic-token-param',
    category: 'Auth Token',
    // Match `(api_key|access_token|secret|password)=<value>` shapes in URLs /
    // bodies. Value chunk must be at least 12 chars to avoid noise.
    pattern: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)=[^\s&"]{12,}/i,
    severity: 'medium',
    description: 'Token / secret embedded in a URL or form body.',
  },
];

/**
 * Run all patterns against a single text. Returns the matched substrings
 * paired with the pattern entry. Each unique pattern fires at most once per
 * text (we group across many texts in `scanSensitive`).
 */
export function matchSensitive(text: string): { pattern: SensitivePattern; match: string }[] {
  if (!text) return [];
  const out: { pattern: SensitivePattern; match: string }[] = [];
  for (const p of SENSITIVE_PATTERNS) {
    const m = p.pattern.exec(text);
    if (!m) continue;
    if (p.validate && !p.validate(m[0])) continue;
    out.push({ pattern: p, match: m[0] });
  }
  return out;
}

/**
 * Scan a labeled corpus (source → text) and return a grouped, severity-sorted
 * list of hits with redacted previews. Designed for the agent tool result
 * shape — never returns the raw secret in cleartext.
 */
export function scanSensitive(sources: ReadonlyArray<{ source: string; text: string }>): SensitiveHit[] {
  const byKey = new Map<string, SensitiveHit>();
  for (const { source, text } of sources) {
    for (const { pattern, match } of matchSensitive(text)) {
      const key = `${pattern.id}|${source}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byKey.set(key, {
          id: pattern.id,
          category: pattern.category,
          severity: pattern.severity,
          description: pattern.description,
          preview: redact(match),
          source,
          count: 1,
        });
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

/** Redact a matched value to first 4 + last 4 chars; never expose the middle. */
export function redact(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function severityRank(s: Severity): number {
  return s === 'critical' ? 0 : s === 'high' ? 1 : s === 'medium' ? 2 : 3;
}

/** Luhn checksum — drops formatting first, then validates the digit run. */
export function luhn(digits: string): boolean {
  const s = digits.replace(/[^\d]/g, '');
  if (s.length < 13 || s.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = s.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}
