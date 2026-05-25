// SecurityPanel — HTTPS · CSP · mixed content · cookie flags. The 4 rows
// each render an ok/bad state; the same data is mapped into the generic
// Finding[] shape so CopyHandoffButtons can produce an IDE prompt.

import { useCallback, useEffect, useState } from 'react';
import type { Finding } from '../../../console/fixPrompt';
import {
  runTool,
  shortHost,
  hostOnly,
  errNoticeStyle,
  CopyHandoffButtons,
  type OnHandoff,
} from './shared';

interface CookieIssue {
  name: string;
  domain: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  issues: string[];
}
interface SecurityData {
  url: string;
  tls: { https: boolean };
  csp: { metaPolicy: string | null; present: boolean };
  mixedContent: string[];
  cookies: { total: number; flagged: CookieIssue[] };
}

export function SecurityPanel({ onHandoff }: { onHandoff?: OnHandoff } = {}) {
  const [data, setData] = useState<SecurityData | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<SecurityData>('scan_security', {}, { force });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  const findings: Finding[] = data ? securityFindings(data) : [];

  return (
    <div className="ci-panel" data-testid="ci-panel-security">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Scanning…' : 'Re-scan'}
        </button>
        <CopyHandoffButtons
          topic="Security"
          findings={findings}
          context={data ? { url: data.url } : undefined}
          onHandoff={onHandoff}
          testid="ci-sec"
        />
        {data && <span className="ci-panel-meta" title={data.url}>{hostOnly(data.url)}</span>}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-sec" data-testid="ci-sec">
          <SecRow
            label="HTTPS"
            ok={data.tls.https}
            okText="Encrypted (https)"
            badText="Not encrypted — the page is served over plain HTTP."
          />
          <SecRow
            label="Content-Security-Policy"
            ok={data.csp.present}
            okText="A CSP meta tag is set."
            badText="No CSP meta tag — page-level policy may still be set via headers."
          />
          <SecRow
            label="Mixed content"
            ok={data.mixedContent.length === 0}
            okText="No http:// resources on this HTTPS page."
            badText={`${data.mixedContent.length} insecure resource(s) on an HTTPS page.`}
          >
            {data.mixedContent.length > 0 && (
              <ul className="ci-sec-list">
                {data.mixedContent.slice(0, 10).map((u, i) => (
                  <li key={i} title={u}>{shortHost(u)}</li>
                ))}
              </ul>
            )}
          </SecRow>
          <SecRow
            label="Cookies"
            ok={data.cookies.flagged.length === 0}
            okText={`${data.cookies.total} cookie(s) — none missing security attributes.`}
            badText={`${data.cookies.flagged.length} of ${data.cookies.total} cookie(s) missing security attributes.`}
          >
            {data.cookies.flagged.length > 0 && (
              <ul className="ci-sec-list">
                {data.cookies.flagged.slice(0, 8).map((c, i) => (
                  <li key={i}>
                    <code>{c.name}</code> ({c.domain}) — {c.issues.join('; ')}
                  </li>
                ))}
              </ul>
            )}
          </SecRow>
        </div>
      )}
    </div>
  );
}

/** Map the SecurityData shape into the generic Finding[] used by the fix-
 * prompt builder. Only emits Finding entries for the "bad" rows — the "ok"
 * rows have nothing to fix. */
function securityFindings(d: SecurityData): Finding[] {
  const out: Finding[] = [];
  if (!d.tls.https) {
    out.push({
      rule: 'HTTPS',
      severity: 'critical',
      description: 'The page is served over plain HTTP — credentials and cookies are visible to any network observer.',
      suggestion: 'Redirect HTTP → HTTPS at the edge / server and serve all resources over HTTPS.',
    });
  }
  if (!d.csp.present) {
    out.push({
      rule: 'Content-Security-Policy',
      severity: 'medium',
      description: 'No CSP meta tag found (the policy may still be set via response headers).',
      suggestion: 'Set a Content-Security-Policy header that constrains scripts, frames, and connect-src to known origins.',
    });
  }
  if (d.mixedContent.length > 0) {
    out.push({
      rule: 'Mixed content',
      severity: 'high',
      description: `${d.mixedContent.length} insecure http:// resource(s) on an HTTPS page.`,
      suggestion: 'Replace each http:// URL with https:// (or use protocol-relative URLs).',
      count: d.mixedContent.length,
    });
  }
  for (const c of d.cookies.flagged) {
    out.push({
      rule: `Cookie ${c.name}`,
      severity: 'medium',
      description: `Cookie "${c.name}" on ${c.domain} is missing: ${c.issues.join(', ')}.`,
      suggestion: 'Set the missing attribute(s) when the cookie is issued (Secure, HttpOnly, SameSite=Lax|Strict).',
    });
  }
  return out;
}

function SecRow({
  label,
  ok,
  okText,
  badText,
  children,
}: {
  label: string;
  ok: boolean;
  okText: string;
  badText: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={'ci-sec-row ' + (ok ? 'ci-sec-ok' : 'ci-sec-bad')}>
      <div className="ci-sec-label">{label}</div>
      <div className="ci-sec-state">{ok ? '✓ ' + okText : '⚠ ' + badText}</div>
      {children}
    </div>
  );
}
