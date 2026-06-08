// VitalsPanel — Core Web Vitals via PerformanceObserver: LCP / INP / CLS / FCP /
// TTFB, each with a budget target + verdict. Adds ATTRIBUTION (which element
// caused LCP, the top CLS source) and a copyable summary. INP supersedes the
// deprecated FID (FID is still computed for the Health aggregator).

import { useCallback, useEffect, useState } from 'react';
import { runTool, copyToClipboard, hostOnly, shortHost, errNoticeStyle, noticeStyle } from './shared';

interface Vital {
  value?: number;
  unit: string;
  verdict: 'good' | 'needs-improvement' | 'poor' | 'unknown';
  target?: number;
}
interface VitalsData {
  url: string;
  title: string;
  vitals: Record<string, Vital>;
  attribution?: { lcpElement?: string; lcpUrl?: string; clsSource?: string };
}

const ORDER = ['lcp', 'inp', 'cls', 'fcp', 'ttfb'] as const;
const LABELS: Record<string, string> = {
  lcp: 'Largest Contentful Paint',
  inp: 'Interaction to Next Paint',
  cls: 'Cumulative Layout Shift',
  fcp: 'First Contentful Paint',
  ttfb: 'Time to First Byte',
};

const fmt = (k: string, v?: number) => (v === undefined ? '—' : k === 'cls' ? v.toFixed(3) : String(Math.round(v)));
const fmtTarget = (k: string, t?: number) => (t === undefined ? '' : k === 'cls' ? `≤ ${t}` : `≤ ${t}ms`);

export function VitalsPanel() {
  const [data, setData] = useState<VitalsData | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<VitalsData>('web_vitals', {}, { force });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  const copySummary = async () => {
    if (!data) return;
    const a = data.attribution ?? {};
    const lines = [`Web Vitals — ${data.title || hostOnly(data.url)}`, data.url, ''];
    for (const k of ORDER) {
      const v = data.vitals[k];
      if (!v) continue;
      let line = `${k.toUpperCase()}: ${fmt(k, v.value)}${v.unit ? ' ' + v.unit : ''} (${v.verdict}) — target ${fmtTarget(k, v.target)}`;
      if (k === 'lcp' && a.lcpElement) line += ` · element: ${a.lcpElement}${a.lcpUrl ? ' (' + a.lcpUrl + ')' : ''}`;
      if (k === 'cls' && a.clsSource) line += ` · top shift: ${a.clsSource}`;
      lines.push(line);
    }
    if (await copyToClipboard(lines.join('\n'))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  };

  const a = data?.attribution ?? {};

  return (
    <div className="ci-panel" data-testid="ci-panel-vitals">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Measuring…' : 'Measure'}
        </button>
        {data && (
          <button type="button" className="btn btn-sm" onClick={copySummary} data-testid="ci-vitals-copy" title="Copy a Web Vitals summary with attribution.">
            {copied ? 'Copied ✓' : 'Copy summary'}
          </button>
        )}
        {data && <span className="ci-panel-meta" title={data.url}>{data.title || hostOnly(data.url)}</span>}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && data.vitals.inp?.value === undefined && (
        <div className="console-notice" role="status" style={noticeStyle}>
          INP needs an interaction — click or type on the page, then press Measure.
        </div>
      )}
      {data && (
        <div className="ci-vitals" data-testid="ci-vitals">
          {ORDER.map((k) => {
            const v = data.vitals[k];
            if (!v) return null;
            const attrib = k === 'lcp' ? (a.lcpElement && `🎯 ${a.lcpElement}${a.lcpUrl ? ' · ' + shortHost(a.lcpUrl) : ''}`)
              : k === 'cls' ? (a.clsSource && `🎯 ${a.clsSource}`)
              : undefined;
            return (
              <div key={k} className={'ci-vital ci-verdict-' + v.verdict}>
                <div className="ci-vital-key">{k.toUpperCase()}</div>
                <div className="ci-vital-val">
                  {fmt(k, v.value)}
                  {v.value !== undefined && v.unit && <span className="ci-vital-unit"> {v.unit}</span>}
                </div>
                <div className="ci-vital-label">{LABELS[k] ?? k}</div>
                <div className="ci-vital-foot">
                  <span className="ci-vital-verdict">{v.verdict}</span>
                  {v.target !== undefined && <span className="ci-vital-target">{fmtTarget(k, v.target)}</span>}
                </div>
                {attrib && <div className="ci-vital-attrib" title={k === 'lcp' ? a.lcpUrl : a.clsSource}>{attrib}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
