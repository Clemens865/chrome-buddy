import { describe, it, expect } from 'vitest';
import { analyzeSecurityHeaders, generateCsp, type ResourceOrigins } from './securityHeaders';

const secure = {
  headers: {
    csp: "default-src 'self'; frame-ancestors 'none'",
    hsts: 'max-age=31536000',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
  },
  metaCsp: null,
  isHttps: true,
  headersReadable: true,
};

describe('analyzeSecurityHeaders', () => {
  it('returns no findings when all headers are present + safe', () => {
    expect(analyzeSecurityHeaders(secure)).toHaveLength(0);
  });

  it('flags a missing CSP as high and points at the generator', () => {
    const f = analyzeSecurityHeaders({ headers: {}, metaCsp: null, isHttps: true, headersReadable: true });
    const csp = f.find((x) => x.rule === 'Content-Security-Policy');
    expect(csp?.severity).toBe('high');
    expect(csp?.suggestion).toMatch(/Generate CSP/);
  });

  it('accepts a meta CSP in place of a header CSP', () => {
    const f = analyzeSecurityHeaders({ headers: {}, metaCsp: "default-src 'self'; frame-ancestors 'none'", isHttps: true, headersReadable: true });
    expect(f.find((x) => x.rule === 'Content-Security-Policy')).toBeFalsy();
  });

  it('flags clickjacking when CSP lacks frame-ancestors and no XFO header', () => {
    const f = analyzeSecurityHeaders({ headers: { csp: "default-src 'self'", hsts: 'x', xContentTypeOptions: 'nosniff', referrerPolicy: 'no-referrer' }, metaCsp: null, isHttps: true, headersReadable: true });
    expect(f.find((x) => x.rule === 'Clickjacking protection')?.severity).toBe('medium');
  });

  it('does NOT flag clickjacking when X-Frame-Options is set', () => {
    const f = analyzeSecurityHeaders({ headers: { csp: "default-src 'self'", xFrameOptions: 'DENY', hsts: 'x', xContentTypeOptions: 'nosniff', referrerPolicy: 'no-referrer' }, metaCsp: null, isHttps: true, headersReadable: true });
    expect(f.find((x) => x.rule === 'Clickjacking protection')).toBeFalsy();
  });

  it('flags missing HSTS / nosniff / referrer-policy', () => {
    const f = analyzeSecurityHeaders({ headers: { csp: "default-src 'self'; frame-ancestors 'none'" }, metaCsp: null, isHttps: true, headersReadable: true });
    expect(f.find((x) => x.rule === 'Strict-Transport-Security')).toBeTruthy();
    expect(f.find((x) => x.rule === 'X-Content-Type-Options')).toBeTruthy();
    expect(f.find((x) => x.rule === 'Referrer-Policy')).toBeTruthy();
  });

  it('skips header-only rules when headers were unreadable (only CSP/meta judged)', () => {
    const f = analyzeSecurityHeaders({ headers: undefined, metaCsp: null, isHttps: true, headersReadable: false });
    expect(f.map((x) => x.rule)).toEqual(['Content-Security-Policy']);
  });

  it('does not flag HSTS on http pages', () => {
    const f = analyzeSecurityHeaders({ headers: { csp: "default-src 'self'; frame-ancestors 'none'", xContentTypeOptions: 'nosniff', referrerPolicy: 'no-referrer' }, metaCsp: null, isHttps: false, headersReadable: true });
    expect(f.find((x) => x.rule === 'Strict-Transport-Security')).toBeFalsy();
  });
});

describe('generateCsp', () => {
  const origins: ResourceOrigins = {
    script: ['https://example.com', 'https://cdn.jsdelivr.net', 'https://example.com'],
    style: ['https://fonts.googleapis.com'],
    img: ['https://example.com', 'https://images.cdn.com'],
    connect: ['https://api.example.com'],
    font: ['https://fonts.gstatic.com'],
  };

  it('builds directives from observed origins, dropping self + duplicates', () => {
    const csp = generateCsp(origins, 'https://example.com');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' https://cdn.jsdelivr.net");
    expect(csp).not.toContain('script-src \'self\' https://example.com'); // self dropped
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("img-src 'self' data: https://images.cdn.com");
    expect(csp).toContain('connect-src \'self\' https://api.example.com');
    expect(csp).toContain('font-src \'self\' https://fonts.gstatic.com');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp.endsWith(';')).toBe(true);
  });

  it('falls back to just self for directives with no extra origins', () => {
    const csp = generateCsp({ script: [], style: [], img: [], connect: [], font: [] });
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("connect-src 'self';");
  });
});
