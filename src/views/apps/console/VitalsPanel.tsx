// VitalsPanel — LCP / FID / CLS / FCP / TTFB via PerformanceObserver. The
// SW returns a verdict (good/needs-improvement/poor/unknown) per metric;
// this panel renders a 2-column card grid with verdict-colored borders.

import { useCallback, useEffect, useState } from 'react';
import { runTool, hostOnly, errNoticeStyle } from './shared';

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

const LABELS: Record<string, string> = {
  lcp: 'Largest Contentful Paint',
  fid: 'First Input Delay',
  cls: 'Cumulative Layout Shift',
  fcp: 'First Contentful Paint',
  ttfb: 'Time to First Byte',
};

export function VitalsPanel() {
  const [data, setData] = useState<VitalsData | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<VitalsData>('web_vitals', {}, { force });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  return (
    <div className="ci-panel" data-testid="ci-panel-vitals">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
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
              <div className="ci-vital-label">{LABELS[k] ?? k}</div>
              <div className="ci-vital-verdict">{v.verdict}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
