import { describe, it, expect } from 'vitest';
import { scanSensitive, matchSensitive, luhn, redact, SENSITIVE_PATTERNS } from './sensitivePatterns';

describe('matchSensitive', () => {
  it('flags provider-prefixed API keys', () => {
    const hits = matchSensitive('auth: sk-1234567890abcdef1234567890abcdef');
    expect(hits.map((h) => h.pattern.id)).toContain('openai-key');
  });

  it('flags AWS access keys and JWTs separately', () => {
    const aws = matchSensitive('AKIAIOSFODNN7EXAMPLE');
    expect(aws.map((h) => h.pattern.id)).toContain('aws-access-key');
    const jwt = matchSensitive(
      'token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    );
    expect(jwt.map((h) => h.pattern.id)).toContain('jwt');
  });

  it('Luhn-validates credit-card candidates (rejects junk digit runs)', () => {
    expect(luhn('4242 4242 4242 4242')).toBe(true);
    expect(luhn('1234 5678 9012 3456')).toBe(false);
    const valid = matchSensitive('Pay with 4242 4242 4242 4242');
    expect(valid.map((h) => h.pattern.id)).toContain('cc-number');
    const invalid = matchSensitive('order id 1234 5678 9012 3456');
    expect(invalid.map((h) => h.pattern.id)).not.toContain('cc-number');
  });

  it('does NOT misfire on plain prose', () => {
    expect(matchSensitive('Just a normal sentence with no secrets.')).toHaveLength(0);
  });
});

describe('scanSensitive', () => {
  it('groups identical pattern hits within the same source', () => {
    const out = scanSensitive([
      { source: 'localStorage:tok', text: 'sk-1234567890abcdef1234567890abcdef' },
      { source: 'localStorage:tok', text: 'sk-1234567890abcdef1234567890abcdef' },
      { source: 'dom', text: 'user@example.com' },
    ]);
    const sk = out.find((h) => h.id === 'openai-key' && h.source === 'localStorage:tok');
    expect(sk?.count).toBe(2);
    const email = out.find((h) => h.id === 'email');
    expect(email?.source).toBe('dom');
  });

  it('redacts the value (no cleartext in preview)', () => {
    const out = scanSensitive([{ source: 'storage', text: 'AKIAIOSFODNN7EXAMPLE' }]);
    const aws = out.find((h) => h.id === 'aws-access-key');
    expect(aws?.preview).toBe('AKIA…MPLE');
    expect(aws?.preview).not.toContain('IOSFO');
  });

  it('orders results by severity (critical → low)', () => {
    const out = scanSensitive([
      { source: 'a', text: 'user@example.com' }, // low
      { source: 'b', text: 'sk-1234567890abcdef1234567890abcdef' }, // critical
      {
        source: 'c',
        text: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      }, // high
    ]);
    expect(out.map((h) => h.severity)).toEqual(['critical', 'high', 'low']);
  });
});

describe('redact', () => {
  it('keeps first-4 + last-4 and asterisks short strings', () => {
    expect(redact('abc')).toBe('****');
    expect(redact('abcdefghij')).toBe('abcd…ghij');
  });
});

describe('pattern table', () => {
  it('covers the headline categories', () => {
    const cats = new Set(SENSITIVE_PATTERNS.map((p) => p.category));
    for (const c of ['API Key', 'Cloud Credential', 'Auth Token', 'Private Key', 'PII']) {
      expect(cats.has(c)).toBe(true);
    }
  });
});
