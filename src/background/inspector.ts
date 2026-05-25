// Page-inspection executors for the Tier-1 Console-Buddy parity tools:
//   - web_vitals      — LCP / FID / CLS / FCP / TTFB via PerformanceObserver
//   - read_network    — recent CDP-captured requests (status / timing / type)
//   - scan_security   — TLS · cookies · response headers · mixed content
//   - analyze_errors  — pattern-match the live console buffer (errorPatterns.ts)
//
// Page-context probes run via chrome.scripting.executeScript; the function
// passed to `func:` is serialised — keep it self-contained (no closure refs).
import { ok, err, type ToolResult } from '../types';
import { matchErrors } from '../console/errorPatterns';
import { consoleController } from '../console';
import { resolveActiveTabId } from './pageTools';

// ---- web_vitals -----------------------------------------------------------

/** Page-side probe: read the Web Vitals captured so far on this load. */
async function probeWebVitals(tabId: number) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      // PerformanceObserver entries that fired before we attach are still in
      // the buffer (browsers expose them via getEntriesByType for the matching
      // types: 'paint', 'navigation', 'largest-contentful-paint', 'layout-shift',
      // 'first-input').
      const paints = performance.getEntriesByType('paint') as PerformanceEntry[];
      const fcp = paints.find((e) => e.name === 'first-contentful-paint')?.startTime;
      const lcpEntries = (performance.getEntriesByType('largest-contentful-paint') as PerformanceEntry[]) ?? [];
      const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1].startTime : undefined;
      const nav = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined);
      const ttfb = nav ? nav.responseStart - nav.startTime : undefined;
      const lsEntries = (performance.getEntriesByType('layout-shift') as PerformanceEntry[]) ?? [];
      let cls = 0;
      for (const e of lsEntries) {
        const ls = e as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!ls.hadRecentInput && typeof ls.value === 'number') cls += ls.value;
      }
      const fiEntries = (performance.getEntriesByType('first-input') as PerformanceEntry[]) ?? [];
      const fi = fiEntries[0] as (PerformanceEntry & { processingStart?: number }) | undefined;
      const fid = fi && typeof fi.processingStart === 'number' ? fi.processingStart - fi.startTime : undefined;
      return {
        url: location.href,
        title: document.title,
        lcp,
        fid,
        cls: Number(cls.toFixed(4)),
        fcp,
        ttfb,
      };
    },
  });
  return res?.[0]?.result as
    | { url: string; title: string; lcp?: number; fid?: number; cls: number; fcp?: number; ttfb?: number }
    | undefined;
}

const VITAL_THRESHOLDS: Record<string, [number, number]> = {
  lcp: [2500, 4000],
  fid: [100, 300],
  cls: [0.1, 0.25],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
};
function verdict(key: string, value: number | undefined): 'good' | 'needs-improvement' | 'poor' | 'unknown' {
  if (value === undefined) return 'unknown';
  const t = VITAL_THRESHOLDS[key];
  if (!t) return 'unknown';
  if (value <= t[0]) return 'good';
  if (value <= t[1]) return 'needs-improvement';
  return 'poor';
}

export async function executeWebVitals(): Promise<ToolResult> {
  const tabId = await resolveActiveTabId();
  if (typeof tabId !== 'number') return err('undriveable', 'No active web tab to inspect.');
  try {
    const v = await probeWebVitals(tabId);
    if (!v) return err('runtime-error', 'Could not read PerformanceTiming on the active page.');
    return ok({
      url: v.url,
      title: v.title,
      vitals: {
        lcp: { value: v.lcp, unit: 'ms', verdict: verdict('lcp', v.lcp) },
        fid: { value: v.fid, unit: 'ms', verdict: verdict('fid', v.fid) },
        cls: { value: v.cls, unit: '', verdict: verdict('cls', v.cls) },
        fcp: { value: v.fcp, unit: 'ms', verdict: verdict('fcp', v.fcp) },
        ttfb: { value: v.ttfb, unit: 'ms', verdict: verdict('ttfb', v.ttfb) },
      },
    });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

// ---- read_network ---------------------------------------------------------

/** Surface the current CDP-captured Network entries from the console module. */
export async function executeReadNetwork(args: Record<string, unknown>): Promise<ToolResult> {
  const filter = typeof args.filter === 'string' ? args.filter.toLowerCase() : '';
  const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
  const ctrl = consoleController();
  if (!ctrl.isCapturing) {
    // Don't silently attach the debugger — it shows the yellow "this browser is
    // being debugged" banner and would be a surprise side-effect of a read tool.
    return ok({
      count: 0,
      requests: [],
      hint: 'Console capture is not running. Open the Console Inspector app and click "Start" to enable network capture, then retry.',
    });
  }
  // Pull the snapshot and filter to net entries.
  const snap = ctrl.snapshot();
  let net = snap.filter((e) => e.level === 'net');
  if (filter === 'failed') net = net.filter((e) => /\b(4\d\d|5\d\d)\b/.test(e.text));
  if (filter === 'errors') net = net.filter((e) => /\b(4\d\d|5\d\d|err|fail)\b/i.test(e.text));
  net = net.slice(-limit);
  return ok({ count: net.length, requests: net });
}

// ---- scan_security --------------------------------------------------------

/** Page-side probe: HTTPS, mixed-content elements, meta CSP. */
async function probeSecurityPage(tabId: number) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const isHttps = location.protocol === 'https:';
      const mixed: string[] = [];
      if (isHttps) {
        const selectors = ['img[src^="http:"]', 'script[src^="http:"]', 'link[href^="http:"]', 'iframe[src^="http:"]'];
        for (const sel of selectors) {
          for (const el of Array.from(document.querySelectorAll(sel))) {
            const anyEl = el as HTMLElement & { src?: string; href?: string };
            const u = anyEl.src || anyEl.href || '';
            if (u && u.startsWith('http:')) mixed.push(u);
          }
        }
      }
      const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy" i]')?.getAttribute('content') || null;
      return { url: location.href, isHttps, mixed: mixed.slice(0, 50), cspMeta };
    },
  });
  return res?.[0]?.result as { url: string; isHttps: boolean; mixed: string[]; cspMeta: string | null } | undefined;
}

export async function executeScanSecurity(): Promise<ToolResult> {
  const tabId = await resolveActiveTabId();
  if (typeof tabId !== 'number') return err('undriveable', 'No active web tab to scan.');
  try {
    const page = await probeSecurityPage(tabId);
    if (!page) return err('runtime-error', 'Could not inspect the active page.');
    // Cookies for the URL (chrome.cookies, requires the 'cookies' permission —
    // already in our manifest).
    const cookies = await chrome.cookies.getAll({ url: page.url }).catch(() => []);
    const flagged = cookies
      .map((c) => {
        const issues: string[] = [];
        if (!c.secure && page.isHttps) issues.push('not Secure');
        if (!c.httpOnly) issues.push('not HttpOnly');
        if (!c.sameSite || c.sameSite === 'unspecified') issues.push('SameSite unspecified');
        return { name: c.name, domain: c.domain, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, issues };
      })
      .filter((c) => c.issues.length > 0);
    return ok({
      url: page.url,
      tls: { https: page.isHttps },
      csp: { metaPolicy: page.cspMeta, present: !!page.cspMeta },
      mixedContent: page.mixed,
      cookies: { total: cookies.length, flagged },
    });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

// ---- analyze_errors -------------------------------------------------------

export async function executeAnalyzeErrors(args: Record<string, unknown>): Promise<ToolResult> {
  const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 200;
  const ctrl = consoleController();
  if (!ctrl.isCapturing) {
    // Same as read_network — don't silently attach the debugger.
    return ok({
      scanned: 0,
      matchCount: 0,
      matches: [],
      hint: 'Console capture is not running. Open the Console Inspector app and click "Start" to begin recording, then retry.',
    });
  }
  const snap = ctrl.snapshot();
  // Match against ANY console line (errors and warnings include 'log' text too —
  // upstream's recognizer is non-strict, so we mirror that).
  const texts = snap.slice(-limit).map((e) => e.text);
  const matches = matchErrors(texts);
  return ok({
    scanned: texts.length,
    matchCount: matches.length,
    matches,
  });
}
