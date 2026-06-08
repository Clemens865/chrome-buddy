import { describe, it, expect } from 'vitest';
import { getRotation, hitSignature, buildSecretsCsv } from './secretsRemediation';
import type { SensitiveHit } from './sensitivePatterns';

const hit = (over: Partial<SensitiveHit>): SensitiveHit => ({
  id: 'openai-key', category: 'API Key', severity: 'critical', description: 'OpenAI key', preview: 'sk-1…6789', source: 'localStorage:key', count: 1, ...over,
});

describe('getRotation', () => {
  it('returns provider-specific rotation with a console URL', () => {
    const r = getRotation(hit({ id: 'stripe-key' }))!;
    expect(r.url).toContain('dashboard.stripe.com');
    expect(r.steps).toMatch(/Roll the key/i);
  });

  it('handles keys with no provider console (pem/jwt) — steps, no url', () => {
    expect(getRotation(hit({ id: 'pem-private' }))!.url).toBeUndefined();
    expect(getRotation(hit({ id: 'jwt' }))!.steps).toMatch(/signing secret/i);
  });

  it('falls back to category advice for PII', () => {
    const r = getRotation(hit({ id: 'email', category: 'PII' }))!;
    expect(r.steps).toMatch(/server-side/i);
    expect(r.url).toBeUndefined();
  });

  it('returns undefined when nothing applies', () => {
    expect(getRotation(hit({ id: 'mystery', category: 'Unknown' }))).toBeUndefined();
  });
});

describe('hitSignature', () => {
  it('is stable + distinguishes by id/source/preview', () => {
    const a = hitSignature(hit({}));
    expect(a).toBe('openai-key|localStorage:key|sk-1…6789');
    expect(hitSignature(hit({ source: 'dom' }))).not.toBe(a);
  });
});

describe('buildSecretsCsv', () => {
  it('emits a header + one redacted row per hit, CSV-escaped', () => {
    const csv = buildSecretsCsv([
      hit({}),
      hit({ id: 'email', category: 'PII', severity: 'low', source: 'dom', preview: 'a@b.com', count: 3, description: 'has, comma' }),
    ]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('category,id,severity,source,redacted_preview,count');
    expect(lines[1]).toContain('openai-key');
    expect(lines[2]).toContain('a@b.com');
    expect(lines[2]).toContain('3');
  });
});
