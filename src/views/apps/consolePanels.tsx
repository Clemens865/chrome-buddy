// Console Inspector — non-Console panels (Errors / Network / Vitals / Security).
// Each panel calls the corresponding SW tool handler via TOOL_EXEC and renders
// the structured result. Keeps ConsoleApp.tsx itself focused on the live capture.

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Ic } from '../../ui/icons';
import type { ToolResult } from '../../types';
import type { ErrorMatch } from '../../console/errorPatterns';
import type { SensitiveHit } from '../../console/sensitivePatterns';
import type { TechMatch } from '../../console/techStack';
import type { A11yReport } from '../../console/a11y';
import type { StorageReport } from '../../console/storageSummary';
import {
  buildFixPrompt,
  buildSingleFixPrompt,
  buildBuddyChatPrompt,
  buildFindingsPrompt,
  buildBuddyFindingsPrompt,
  type Finding,
  type FixPromptContext,
} from '../../console/fixPrompt';
import type { SeoReport, SeoIssue } from '../../console/seo';

// --- Shared TOOL_EXEC bridge ----------------------------------------------

async function runTool<T>(tool: string, args: Record<string, unknown> = {}): Promise<ToolResult<T>> {
  const r = (await chrome.runtime.sendMessage({ type: 'TOOL_EXEC', tool, args })) as
    | { type: 'TOOL_EXEC'; ok: true; result: ToolResult<T> }
    | undefined;
  if (!r || !r.ok) {
    return { ok: false, error: { code: 'runtime-error', message: 'No response from background.' } };
  }
  return r.result;
}

// --- ErrorsPanel -----------------------------------------------------------

interface AnalyzeData {
  scanned: number;
  matchCount: number;
  matches: ErrorMatch[];
  hint?: string;
}

/** Callback the panel calls when the user wants to hand off a fix request to
 * Buddy chat. PanelApp wires this to setPendingRun + setView('chat'). */
export type OnHandoff = (req: { prompt: string; mode: 'ask' | 'agent' }) => void;

/** Copy `text` to the clipboard and surface a transient "Copied!" state for
 * the calling button. Falls back gracefully when navigator.clipboard is gated
 * (older Chromes / iframe contexts) by selecting + execCommand. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function ErrorsPanel({
  capturing,
  onHandoff,
}: {
  capturing: boolean;
  onHandoff?: OnHandoff;
}) {
  const [data, setData] = useState<AnalyzeData | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Per-card copy feedback: index → 'copied' | undefined.
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  // Tech-stack context — fetched lazily once, used to enrich the fix prompt.
  const [techContext, setTechContext] = useState<FixPromptContext | undefined>();

  const run = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<AnalyzeData>('analyze_errors', { limit: 200 });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);

  // Auto-refresh while capturing so the list stays live.
  useEffect(() => {
    if (!capturing) return;
    run();
    const id = setInterval(run, 1500);
    return () => clearInterval(id);
  }, [capturing, run]);

  // Fetch detected tech stack once so the IDE prompt can mention the framework.
  useEffect(() => {
    let active = true;
    void (async () => {
      const r = await runTool<{ url: string; matches: TechMatch[] }>('detect_tech_stack');
      if (!active) return;
      if (r.ok) {
        setTechContext({
          url: r.data.url,
          techStack: r.data.matches.map((m) => m.name),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const flash = (key: string) => {
    setCopied((s) => ({ ...s, [key]: true }));
    window.setTimeout(() => setCopied((s) => ({ ...s, [key]: false })), 1400);
  };

  const copyAll = async () => {
    if (!data) return;
    const md = buildFixPrompt({ matches: data.matches, context: techContext });
    const ok = await copyToClipboard(md);
    if (ok) flash('all');
  };

  const copyOne = async (m: ErrorMatch, idx: number) => {
    const md = buildSingleFixPrompt(m, techContext);
    const ok = await copyToClipboard(md);
    if (ok) flash(String(idx));
  };

  const sendToBuddy = () => {
    if (!data || !onHandoff) return;
    const prompt = buildBuddyChatPrompt({ matches: data.matches, context: techContext });
    onHandoff({ prompt, mode: 'agent' });
  };

  const hasMatches = !!data && data.matches.length > 0;

  return (
    <div className="ci-panel" data-testid="ci-panel-errors">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={run} disabled={busy}>
          {busy ? 'Scanning…' : 'Scan errors'}
        </button>
        {hasMatches && (
          <>
            <button
              type="button"
              className="btn btn-sm"
              onClick={copyAll}
              data-testid="ci-errors-copy-all"
              title="Copy a paste-ready fix prompt for your coding IDE (Cursor, Claude Code, …)."
            >
              {copied.all ? 'Copied ✓' : 'Copy fix prompt'}
            </button>
            {onHandoff && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={sendToBuddy}
                data-testid="ci-errors-send-buddy"
                title="Open a Buddy chat that uses list_files + read_file + write_file to find and fix the code in your root folder."
              >
                Send to Buddy
              </button>
            )}
          </>
        )}
        {data && (
          <span className="ci-panel-meta">
            {data.matchCount} matched · {data.scanned} scanned
          </span>
        )}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data?.hint && <div className="console-notice" role="status" style={noticeStyle}>{data.hint}</div>}
      {hasMatches ? (
        <div className="ci-cards">
          {data!.matches.map((m, i) => (
            <div key={i} className={'ci-card ci-sev-' + m.severity}>
              <div className="ci-card-hd">
                <span className={'ci-sev-pill ci-sev-pill-' + m.severity}>{m.severity}</span>
                <span className="ci-card-cat">{m.framework ? `${m.framework} · ${m.category}` : m.category}</span>
                {m.count > 1 && <span className="ci-card-count">×{m.count}</span>}
                <button
                  type="button"
                  className="ci-card-copy"
                  onClick={() => copyOne(m, i)}
                  data-testid={`ci-errors-copy-${i}`}
                  title="Copy a fix prompt for just this error."
                >
                  {copied[String(i)] ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <div className="ci-card-desc">{m.description}</div>
              <div className="ci-card-fix">
                <strong>Fix:</strong> {m.suggestion}
              </div>
              {m.docUrl && (
                <a href={m.docUrl} target="_blank" rel="noreferrer" className="ci-card-doc">
                  Docs ↗
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        data && !data.hint && (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
            <div className="empty-state-title">No known patterns detected</div>
            <div className="empty-state-desc">Capture some console activity, then scan again.</div>
          </div>
        )
      )}
    </div>
  );
}

// --- NetworkPanel ----------------------------------------------------------

interface NetEntry {
  level: string;
  text: string;
  source?: string;
  ts: number;
  count: number;
}
interface NetworkData {
  count: number;
  requests: NetEntry[];
  hint?: string;
}

export function NetworkPanel({ capturing }: { capturing: boolean }) {
  const [data, setData] = useState<NetworkData | undefined>();
  const [filter, setFilter] = useState<'all' | 'failed' | 'errors'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<NetworkData>('read_network', { filter: filter === 'all' ? '' : filter, limit: 100 });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, [filter]);

  useEffect(() => {
    if (!capturing) return;
    run();
    const id = setInterval(run, 1200);
    return () => clearInterval(id);
  }, [capturing, run]);

  return (
    <div className="ci-panel" data-testid="ci-panel-network">
      <div className="ci-panel-bar">
        {(['all', 'failed', 'errors'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={'console-chip' + (filter === k ? ' is-on' : '')}
            onClick={() => setFilter(k)}
          >
            <span className="console-chip-l">{k}</span>
          </button>
        ))}
        <span className="console-spacer" />
        <button type="button" className="btn btn-sm btn-primary" onClick={run} disabled={busy}>
          {busy ? 'Reading…' : 'Refresh'}
        </button>
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data?.hint && <div className="console-notice" role="status" style={noticeStyle}>{data.hint}</div>}
      {data && data.requests.length > 0 ? (
        <div className="console-list" data-testid="ci-network-list">
          {data.requests.map((r, i) => (
            <div key={i} className={'console-row' + (/\b(4\d\d|5\d\d)\b/.test(r.text) ? ' console-error' : '')}>
              <span className="console-lvl console-lvl-net">net</span>
              <span className="console-text" title={r.text}>{r.text}</span>
              <span className="console-src" title={r.source}>{shortHost(r.source)}</span>
              {r.count > 1 ? <span className="console-count">{r.count}</span> : <span />}
            </div>
          ))}
        </div>
      ) : (
        data && !data.hint && (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
            <div className="empty-state-title">No requests captured</div>
            <div className="empty-state-desc">Start capture, then reload the page.</div>
          </div>
        )
      )}
    </div>
  );
}

// --- VitalsPanel -----------------------------------------------------------

interface Vital {
  value?: number;
  unit: string;
  verdict: 'good' | 'needs-improvement' | 'poor' | 'unknown';
}
interface VitalsData {
  url: string;
  title: string;
  vitals: Record<string, Vital>;
}

export function VitalsPanel() {
  const [data, setData] = useState<VitalsData | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<VitalsData>('web_vitals');
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const labels: Record<string, string> = {
    lcp: 'Largest Contentful Paint',
    fid: 'First Input Delay',
    cls: 'Cumulative Layout Shift',
    fcp: 'First Contentful Paint',
    ttfb: 'Time to First Byte',
  };

  return (
    <div className="ci-panel" data-testid="ci-panel-vitals">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={run} disabled={busy}>
          {busy ? 'Measuring…' : 'Measure'}
        </button>
        {data && <span className="ci-panel-meta" title={data.url}>{data.title || hostOnly(data.url)}</span>}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-vitals" data-testid="ci-vitals">
          {Object.entries(data.vitals).map(([k, v]) => (
            <div key={k} className={'ci-vital ci-verdict-' + v.verdict}>
              <div className="ci-vital-key">{k.toUpperCase()}</div>
              <div className="ci-vital-val">
                {v.value === undefined ? '—' : k === 'cls' ? v.value.toFixed(3) : Math.round(v.value)}
                {v.value !== undefined && v.unit && <span className="ci-vital-unit"> {v.unit}</span>}
              </div>
              <div className="ci-vital-label">{labels[k] ?? k}</div>
              <div className="ci-vital-verdict">{v.verdict}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- SecurityPanel ---------------------------------------------------------

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

  const run = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<SecurityData>('scan_security');
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const findings: Finding[] = data ? securityFindings(data) : [];

  return (
    <div className="ci-panel" data-testid="ci-panel-security">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={run} disabled={busy}>
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

// --- styling helpers -------------------------------------------------------

const noticeStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  fontSize: 11.5,
  lineHeight: 1.4,
  color: 'var(--panel-muted)',
  background: 'var(--panel-elev)',
  borderBottom: '1px solid var(--panel-border-soft)',
};
const errNoticeStyle: CSSProperties = {
  ...noticeStyle,
  color: '#B91C1C',
  background: 'color-mix(in srgb, #EF4444 8%, transparent)',
};

function shortHost(s: string | undefined): string {
  if (!s) return '';
  try {
    const u = new URL(s);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    return last ? `${u.host}/${last}` : u.host;
  } catch {
    return s;
  }
}
function hostOnly(s: string | undefined): string {
  if (!s) return '';
  try {
    return new URL(s).host;
  } catch {
    return s;
  }
}

// --- StoragePanel ----------------------------------------------------------

export function StoragePanel() {
  const [data, setData] = useState<StorageReport | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<StorageReport>('read_storage', { limit: 10 });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  return (
    <div className="ci-panel" data-testid="ci-panel-storage">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={run} disabled={busy}>
          {busy ? 'Reading…' : 'Refresh'}
        </button>
        {data && (
          <span className="ci-panel-meta">
            {data.total.keys} key(s) · {formatBytes(data.total.bytes)}
          </span>
        )}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-storage" data-testid="ci-storage">
          <div className="ci-storage-totals">
            {(['localStorage', 'sessionStorage', 'cookies'] as const).map((area) => (
              <div key={area} className="ci-storage-area">
                <div className="ci-storage-area-key">{area}</div>
                <div className="ci-storage-area-val">
                  {data.byArea[area].keys} · {formatBytes(data.byArea[area].bytes)}
                </div>
              </div>
            ))}
          </div>
          {data.flagged.length > 0 && (
            <div className="ci-storage-flagged">
              <div className="ci-storage-hd">Flagged keys</div>
              {data.flagged.map((f, i) => (
                <div key={i} className="ci-storage-flag-row">
                  <span className="ci-sev-pill ci-sev-pill-high">{f.area}</span>
                  <code>{f.key}</code>
                  <span className="ci-storage-flag-why">{f.reason}</span>
                </div>
              ))}
            </div>
          )}
          <div className="ci-storage-hd">Top entries</div>
          <div className="ci-storage-list">
            {data.top.length === 0 ? (
              <div className="empty-state-desc">No storage on this origin.</div>
            ) : (
              data.top.map((e, i) => (
                <div key={i} className="ci-storage-row">
                  <span className="console-lvl console-lvl-net">{e.area === 'localStorage' ? 'local' : e.area === 'sessionStorage' ? 'session' : 'cookie'}</span>
                  <code className="ci-storage-key" title={e.key}>{e.key}</code>
                  <span className="ci-storage-preview" title={e.preview}>{e.preview}</span>
                  <span className="ci-storage-bytes">{formatBytes(e.bytes)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- SensitivePanel --------------------------------------------------------

export function SensitivePanel() {
  const [data, setData] = useState<{ url?: string; hits: SensitiveHit[]; scanned: number } | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<{ url?: string; hits: SensitiveHit[]; scanned: number }>('scan_sensitive_data');
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  return (
    <div className="ci-panel" data-testid="ci-panel-sensitive">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={run} disabled={busy}>
          {busy ? 'Scanning…' : 'Re-scan'}
        </button>
        {data && (
          <span className="ci-panel-meta">
            {data.hits.length} hit(s) across {data.scanned} source(s)
          </span>
        )}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-cards" data-testid="ci-sensitive">
          {data.hits.length === 0 ? (
            <div className="empty-state">
              <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
              <div className="empty-state-title">No leaked secrets detected</div>
              <div className="empty-state-desc">
                Scanned storage + visible page text. Re-run after the user signs in or after a
                state change to recheck.
              </div>
            </div>
          ) : (
            data.hits.map((h, i) => (
              <div key={i} className={'ci-card ci-sev-' + h.severity}>
                <div className="ci-card-hd">
                  <span className={'ci-sev-pill ci-sev-pill-' + h.severity}>{h.severity}</span>
                  <span className="ci-card-cat">{h.category}</span>
                  {h.count > 1 && <span className="ci-card-count">×{h.count}</span>}
                </div>
                <div className="ci-card-desc">{h.description}</div>
                <div className="ci-card-fix">
                  <strong>Found in:</strong> <code>{h.source}</code> — <code>{h.preview}</code>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// --- TechStackPanel --------------------------------------------------------

export function TechStackPanel() {
  const [data, setData] = useState<{ url: string; matches: TechMatch[] } | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<{ url: string; matches: TechMatch[]; count: number }>('detect_tech_stack');
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  // Group matches by category for the list.
  const grouped = data
    ? data.matches.reduce<Record<string, TechMatch[]>>((acc, m) => {
        (acc[m.category] ??= []).push(m);
        return acc;
      }, {})
    : {};

  return (
    <div className="ci-panel" data-testid="ci-panel-tech">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={run} disabled={busy}>
          {busy ? 'Detecting…' : 'Re-detect'}
        </button>
        {data && <span className="ci-panel-meta">{data.matches.length} detected</span>}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-tech" data-testid="ci-tech">
          {data.matches.length === 0 ? (
            <div className="empty-state">
              <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
              <div className="empty-state-title">No known frameworks detected</div>
              <div className="empty-state-desc">
                The page may be plain HTML, or uses a stack outside our fingerprint set.
              </div>
            </div>
          ) : (
            Object.entries(grouped).map(([cat, items]) => (
              <div key={cat} className="ci-tech-group">
                <div className="ci-tech-cat">{cat}</div>
                {items.map((m, i) => (
                  <div key={i} className="ci-tech-row" title={m.evidence.join('\n')}>
                    <span className="ci-tech-name">{m.name}</span>
                    <span className="ci-tech-ev">{m.evidence.length} signal(s)</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// --- Shared copy / send-to-Buddy toolbar used by the analytical panels -----

function CopyHandoffButtons({
  topic,
  findings,
  context,
  onHandoff,
  testid,
}: {
  topic: string;
  findings: ReadonlyArray<Finding>;
  context?: FixPromptContext;
  onHandoff?: OnHandoff;
  /** Optional test-id stem ("ci-a11y", "ci-sec", "ci-seo"). */
  testid: string;
}) {
  const [copied, setCopied] = useState(false);
  if (findings.length === 0) return null;
  const flash = () => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        data-testid={`${testid}-copy`}
        title="Copy a paste-ready fix prompt for your coding IDE (Cursor, Claude Code, …)."
        onClick={async () => {
          const md = buildFindingsPrompt(topic, findings, context);
          if (await copyToClipboard(md)) flash();
        }}
      >
        {copied ? 'Copied ✓' : 'Copy fix prompt'}
      </button>
      {onHandoff && (
        <button
          type="button"
          className="btn btn-sm"
          data-testid={`${testid}-send-buddy`}
          title="Open a Buddy chat that uses list_files + read_file + write_file to find and fix the code in your root folder."
          onClick={() => {
            const prompt = buildBuddyFindingsPrompt(topic, findings, context);
            onHandoff({ prompt, mode: 'agent' });
          }}
        >
          Send to Buddy
        </button>
      )}
    </>
  );
}

/** Fetch detected tech stack once for use in fix-prompt context. */
function useTechContext(): FixPromptContext | undefined {
  const [ctx, setCtx] = useState<FixPromptContext | undefined>();
  useEffect(() => {
    let active = true;
    void (async () => {
      const r = await runTool<{ url: string; matches: TechMatch[] }>('detect_tech_stack');
      if (!active) return;
      if (r.ok) {
        setCtx({
          url: r.data.url,
          techStack: r.data.matches.map((m) => m.name),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  return ctx;
}

// --- A11yPanel -------------------------------------------------------------

export function A11yPanel({ onHandoff }: { onHandoff?: OnHandoff } = {}) {
  const [data, setData] = useState<A11yReport | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const techCtx = useTechContext();

  const run = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<A11yReport>('analyze_a11y');
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  const findings: Finding[] = (data?.issues ?? []).map((i) => ({
    rule: i.rule,
    description: i.description,
    suggestion: i.suggestion,
    severity: i.severity,
    count: i.count,
  }));

  return (
    <div className="ci-panel" data-testid="ci-panel-a11y">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={run} disabled={busy}>
          {busy ? 'Auditing…' : 'Re-audit'}
        </button>
        <CopyHandoffButtons topic="Accessibility" findings={findings} context={techCtx} onHandoff={onHandoff} testid="ci-a11y" />
        {data && (
          <span className="ci-panel-meta">
            {data.issues.length} rule(s) · {data.total} element(s)
          </span>
        )}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-cards" data-testid="ci-a11y">
          {data.issues.length === 0 ? (
            <div className="empty-state">
              <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
              <div className="empty-state-title">No accessibility issues detected</div>
              <div className="empty-state-desc">
                This is a light audit — for a full WCAG pass, run axe-core or Lighthouse.
              </div>
            </div>
          ) : (
            data.issues.map((i, idx) => (
              <div key={idx} className={'ci-card ci-sev-' + i.severity}>
                <div className="ci-card-hd">
                  <span className={'ci-sev-pill ci-sev-pill-' + i.severity}>{i.severity}</span>
                  <span className="ci-card-cat">{i.rule}</span>
                  {i.count > 1 && <span className="ci-card-count">×{i.count}</span>}
                </div>
                <div className="ci-card-desc">{i.description}</div>
                <div className="ci-card-fix">
                  <strong>Fix:</strong> {i.suggestion}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// --- SeoPanel --------------------------------------------------------------

interface SeoPanelData extends SeoReport {
  url: string;
  h1Text?: string;
}

export function SeoPanel({ onHandoff }: { onHandoff?: OnHandoff } = {}) {
  const [data, setData] = useState<SeoPanelData | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const techCtx = useTechContext();

  const run = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<SeoPanelData>('analyze_seo');
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  const findings: Finding[] = (data?.issues ?? []).map((i: SeoIssue) => ({
    rule: i.rule,
    description: i.description,
    suggestion: i.suggestion,
    severity: i.severity,
    detail: i.detail,
  }));

  return (
    <div className="ci-panel" data-testid="ci-panel-seo">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={run} disabled={busy}>
          {busy ? 'Auditing…' : 'Re-audit'}
        </button>
        <CopyHandoffButtons
          topic="SEO"
          findings={findings}
          context={{ ...techCtx, url: data?.url, title: data?.h1Text }}
          onHandoff={onHandoff}
          testid="ci-seo"
        />
        {data && <span className="ci-panel-meta" title={data.url}>Score: {data.score}/100</span>}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-seo" data-testid="ci-seo">
          <div className="ci-seo-score" data-score-class={seoScoreClass(data.score)}>
            <div className={'ci-seo-score-ring ci-seo-score-' + seoScoreClass(data.score)}>{data.score}</div>
            <div className="ci-seo-score-facts">
              <div className="ci-seo-fact"><span>Title</span> {data.facts.titleLength} chars</div>
              <div className="ci-seo-fact"><span>Description</span> {data.facts.descriptionLength} chars</div>
              <div className="ci-seo-fact"><span>OG tags</span> {data.facts.ogKeys}</div>
              <div className="ci-seo-fact"><span>Twitter tags</span> {data.facts.twitterKeys}</div>
              <div className="ci-seo-fact"><span>Structured data</span> {data.facts.structuredData} block(s)</div>
              <div className="ci-seo-fact"><span>Canonical</span> {data.facts.canonical ? '✓' : '—'}</div>
            </div>
          </div>
          {data.issues.length === 0 ? (
            <div className="empty-state">
              <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
              <div className="empty-state-title">No SEO issues detected</div>
              <div className="empty-state-desc">This audit covers basic meta tags + heading structure.</div>
            </div>
          ) : (
            <div className="ci-cards">
              {data.issues.map((i, idx) => (
                <div key={idx} className={'ci-card ci-sev-' + i.severity}>
                  <div className="ci-card-hd">
                    <span className={'ci-sev-pill ci-sev-pill-' + i.severity}>{i.severity}</span>
                    <span className="ci-card-cat">{i.rule}</span>
                    {i.detail && <span className="ci-card-count">{i.detail}</span>}
                  </div>
                  <div className="ci-card-desc">{i.description}</div>
                  <div className="ci-card-fix">
                    <strong>Fix:</strong> {i.suggestion}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function seoScoreClass(score: number): 'good' | 'needs-improvement' | 'poor' {
  if (score >= 90) return 'good';
  if (score >= 70) return 'needs-improvement';
  return 'poor';
}

// --- helpers ---------------------------------------------------------------

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
