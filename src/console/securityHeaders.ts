// Security response-header analysis + CSP generation. The page-side probe can
// only see a <meta> CSP; the REAL security posture lives in HTTP response
// headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy),
// which the SW reads by fetching the page. This module turns those headers +
// the page's observed resource origins into findings and a ready-to-paste CSP.
//
// Pure — no chrome, no I/O — fully unit-testable.

import type { Finding } from './fixPrompt';

export interface SecurityHeaders {
  csp?: string;
  hsts?: string;
  xFrameOptions?: string;
  xContentTypeOptions?: string;
  referrerPolicy?: string;
  permissionsPolicy?: string;
}

/** Origins the page actually loaded resources from, grouped by CSP directive. */
export interface ResourceOrigins {
  script: string[];
  style: string[];
  img: string[];
  connect: string[];
  font: string[];
}

export interface HeaderAnalysisInput {
  /** Parsed response headers (undefined entries = header absent). */
  headers?: SecurityHeaders;
  /** <meta http-equiv="Content-Security-Policy"> content, if any. */
  metaCsp?: string | null;
  isHttps: boolean;
  /** False when the header fetch failed — header-only rules are then skipped. */
  headersReadable: boolean;
}

/** Run the response-header ruleset. Returns generic Findings (severity-sorted). */
export function analyzeSecurityHeaders(input: HeaderAnalysisInput): Finding[] {
  const out: Finding[] = [];
  const h = input.headers ?? {};
  const effectiveCsp = h.csp || input.metaCsp || '';

  // CSP — the single highest-leverage header. Header beats meta.
  if (!effectiveCsp.trim()) {
    out.push({
      rule: 'Content-Security-Policy',
      severity: 'high',
      description: 'No Content-Security-Policy via header or <meta>. CSP is the primary defense against XSS and data exfiltration.',
      suggestion: 'Set a Content-Security-Policy response header. Use the "Generate CSP" button below for a starting policy from this page\'s real origins.',
    });
  } else {
    // Clickjacking: need frame-ancestors in CSP OR an X-Frame-Options header.
    const hasFrameAncestors = /frame-ancestors/i.test(effectiveCsp);
    if (input.headersReadable && !hasFrameAncestors && !h.xFrameOptions) {
      out.push({
        rule: 'Clickjacking protection',
        severity: 'medium',
        description: 'No frame-ancestors directive and no X-Frame-Options header — the page can be framed by any site (clickjacking risk).',
        suggestion: "Add `frame-ancestors 'none'` (or your allowed parents) to the CSP, or send `X-Frame-Options: DENY`.",
      });
    }
  }

  // The remaining checks are header-only; skip them when the fetch failed.
  if (input.headersReadable) {
    if (input.isHttps && !h.hsts) {
      out.push({
        rule: 'Strict-Transport-Security',
        severity: 'medium',
        description: 'No HSTS header — a network attacker can downgrade the first request to HTTP.',
        suggestion: 'Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` (add `preload` once verified).',
      });
    }
    if (!/nosniff/i.test(h.xContentTypeOptions ?? '')) {
      out.push({
        rule: 'X-Content-Type-Options',
        severity: 'low',
        description: 'No `X-Content-Type-Options: nosniff` — browsers may MIME-sniff responses, enabling some content-type attacks.',
        suggestion: 'Send `X-Content-Type-Options: nosniff` on all responses.',
      });
    }
    if (!h.referrerPolicy) {
      out.push({
        rule: 'Referrer-Policy',
        severity: 'low',
        description: 'No Referrer-Policy header — full URLs (with paths/queries) may leak to third-party origins via the Referer header.',
        suggestion: 'Send `Referrer-Policy: strict-origin-when-cross-origin` (or stricter).',
      });
    }
  }

  return out.sort((a, b) => rank(a.severity) - rank(b.severity));
}

function rank(s: Finding['severity']): number {
  const order: Record<string, number> = { critical: 0, high: 1, serious: 2, moderate: 3, medium: 4, minor: 5, low: 6 };
  return order[s] ?? 9;
}

const CSP_DIRECTIVES: { key: keyof ResourceOrigins; name: string; base: string[] }[] = [
  { key: 'script', name: 'script-src', base: ["'self'"] },
  { key: 'style', name: 'style-src', base: ["'self'", "'unsafe-inline'"] },
  { key: 'img', name: 'img-src', base: ["'self'", 'data:'] },
  { key: 'font', name: 'font-src', base: ["'self'"] },
  { key: 'connect', name: 'connect-src', base: ["'self'"] },
];

/**
 * PURE: generate a starter Content-Security-Policy from the origins the page
 * actually loaded resources from. Drops the page's own origin ('self' covers
 * it), dedupes + sorts, and locks down the dangerous defaults (object-src,
 * base-uri, frame-ancestors). It is a STARTING POINT — the user reviews it.
 */
export function generateCsp(origins: ResourceOrigins, selfOrigin?: string): string {
  const clean = (list: string[]): string[] =>
    [...new Set(list.filter((o) => o && o !== selfOrigin && o !== 'null'))].sort();

  const lines: string[] = ["default-src 'self'"];
  for (const d of CSP_DIRECTIVES) {
    const extra = clean(origins[d.key] ?? []);
    lines.push(`${d.name} ${[...d.base, ...extra].join(' ')}`);
  }
  lines.push("object-src 'none'");
  lines.push("base-uri 'self'");
  lines.push("frame-ancestors 'none'");
  return lines.join('; ') + ';';
}
