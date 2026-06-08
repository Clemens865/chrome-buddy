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
import { scanSensitive } from '../console/sensitivePatterns';
import { detectTech } from '../console/techStack';
import { analyzeA11y } from '../console/a11y';
import { mapAxeViolations } from '../console/axeMap';
import { analyzeSeo } from '../console/seo';
import { analyzeAeo, parseBlockedAiCrawlers } from '../console/aeo';
import type { SecurityHeaders } from '../console/securityHeaders';
import { summarizeStorage } from '../console/storageSummary';
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

// ---- probe_network (Performance Resource Timing snapshot) ------------------
//
// Structured network records straight from the page's Performance timeline — no
// debugger needed. Powers the waterfall + HAR export + copy-as-cURL. Method +
// headers aren't exposed by the timing API (method defaults to GET).

async function probeNetworkTimings(tabId: number) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const out: Array<Record<string, unknown>> = [];
      try {
        for (const e of performance.getEntriesByType('resource')) {
          const r = e as PerformanceResourceTiming & { responseStatus?: number };
          let host = '';
          try { host = new URL(r.name).host; } catch { /* keep empty */ }
          out.push({
            url: r.name,
            host,
            type: r.initiatorType || 'other',
            method: 'GET',
            status: typeof r.responseStatus === 'number' ? r.responseStatus : 0,
            protocol: r.nextHopProtocol || '',
            startMs: Math.round(r.startTime),
            durationMs: Math.round(r.duration),
            sizeBytes: Math.round(r.transferSize || 0),
          });
        }
      } catch { /* Performance API unavailable */ }
      return { url: location.href, requests: out.slice(0, 300) };
    },
  });
  return res?.[0]?.result as { url: string; requests: unknown[] } | undefined;
}

export async function executeProbeNetwork(): Promise<ToolResult> {
  const tabId = await resolveActiveTabId();
  if (typeof tabId !== 'number') return err('undriveable', 'No active web tab to inspect.');
  try {
    const probe = await probeNetworkTimings(tabId);
    if (!probe) return err('runtime-error', 'Could not read network timings on the active page.');
    return ok({ url: probe.url, count: probe.requests.length, requests: probe.requests });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
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
      // Resource origins actually loaded (for CSP generation), grouped by the
      // CSP directive each initiator type maps to.
      const buckets = { script: new Set<string>(), style: new Set<string>(), img: new Set<string>(), connect: new Set<string>(), font: new Set<string>() };
      try {
        for (const e of performance.getEntriesByType('resource')) {
          const r = e as PerformanceResourceTiming;
          let origin = '';
          try { origin = new URL(r.name).origin; } catch { continue; }
          if (!origin || origin === 'null') continue;
          switch (r.initiatorType) {
            case 'script': buckets.script.add(origin); break;
            case 'link': case 'css': buckets.style.add(origin); break;
            case 'img': case 'image': case 'imageset': buckets.img.add(origin); break;
            case 'fetch': case 'xmlhttprequest': case 'beacon': buckets.connect.add(origin); break;
            case 'font': buckets.font.add(origin); break;
          }
        }
      } catch { /* performance API unavailable; origins stay empty */ }
      const resourceOrigins = {
        script: [...buckets.script], style: [...buckets.style], img: [...buckets.img],
        connect: [...buckets.connect], font: [...buckets.font],
      };
      return { url: location.href, origin: location.origin, isHttps, mixed: mixed.slice(0, 50), cspMeta, resourceOrigins };
    },
  });
  return res?.[0]?.result as
    | { url: string; origin: string; isHttps: boolean; mixed: string[]; cspMeta: string | null; resourceOrigins: import('../console/securityHeaders').ResourceOrigins }
    | undefined;
}

/** Read the security-relevant response headers by fetching the page from the
 *  SW (host_permissions cover all origins). Resilient: returns unreadable when
 *  the fetch fails so the analyzer skips header-only rules. */
async function fetchSecurityHeaders(url: string): Promise<{ readable: boolean; headers?: SecurityHeaders }> {
  try {
    const resp = await fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit' });
    const h = resp.headers;
    return {
      readable: true,
      headers: {
        csp: h.get('content-security-policy') ?? undefined,
        hsts: h.get('strict-transport-security') ?? undefined,
        xFrameOptions: h.get('x-frame-options') ?? undefined,
        xContentTypeOptions: h.get('x-content-type-options') ?? undefined,
        referrerPolicy: h.get('referrer-policy') ?? undefined,
        permissionsPolicy: h.get('permissions-policy') ?? undefined,
      },
    };
  } catch {
    return { readable: false };
  }
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
    // Real response headers (the meta CSP only tells half the story).
    const hdr = await fetchSecurityHeaders(page.url);
    const effectiveCsp = hdr.headers?.csp || page.cspMeta || undefined;
    return ok({
      url: page.url,
      tls: { https: page.isHttps },
      csp: {
        metaPolicy: page.cspMeta,
        present: !!effectiveCsp,
        source: hdr.headers?.csp ? 'header' : page.cspMeta ? 'meta' : null,
        policy: effectiveCsp ?? null,
      },
      headers: hdr.headers ?? {},
      headersReadable: hdr.readable,
      resourceOrigins: page.resourceOrigins,
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

// ---- read_storage ---------------------------------------------------------

async function probeStorage(tabId: number) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const local: { key: string; value: string }[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k == null) continue;
          local.push({ key: k, value: localStorage.getItem(k) ?? '' });
        }
      } catch {
        /* sandboxed iframes can throw on storage access; ignore */
      }
      const session: { key: string; value: string }[] = [];
      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k == null) continue;
          session.push({ key: k, value: sessionStorage.getItem(k) ?? '' });
        }
      } catch {
        /* same */
      }
      const cookies: { name: string; value: string }[] = (document.cookie || '')
        .split(/;\s*/)
        .filter(Boolean)
        .map((pair) => {
          const idx = pair.indexOf('=');
          return idx === -1
            ? { name: pair, value: '' }
            : { name: pair.slice(0, idx), value: pair.slice(idx + 1) };
        });
      return { url: location.href, localStorage: local, sessionStorage: session, cookies };
    },
  });
  return res?.[0]?.result as
    | {
        url: string;
        localStorage: { key: string; value: string }[];
        sessionStorage: { key: string; value: string }[];
        cookies: { name: string; value: string }[];
      }
    | undefined;
}

export async function executeReadStorage(args: Record<string, unknown>): Promise<ToolResult> {
  const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 10;
  const tabId = await resolveActiveTabId();
  if (typeof tabId !== 'number') return err('undriveable', 'No active web tab to inspect.');
  try {
    const snap = await probeStorage(tabId);
    if (!snap) return err('runtime-error', 'Could not read storage on the active page.');
    const report = summarizeStorage(snap, limit);
    return ok(report);
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

// ---- scan_sensitive_data --------------------------------------------------

export async function executeScanSensitive(): Promise<ToolResult> {
  const tabId = await resolveActiveTabId();
  if (typeof tabId !== 'number') return err('undriveable', 'No active web tab to inspect.');
  try {
    const snap = await probeStorage(tabId);
    // Collect the corpus: every storage value + the page's visible text.
    const sources: { source: string; text: string }[] = [];
    if (snap) {
      for (const e of snap.localStorage) sources.push({ source: `localStorage:${e.key}`, text: e.value });
      for (const e of snap.sessionStorage) sources.push({ source: `sessionStorage:${e.key}`, text: e.value });
      for (const e of snap.cookies) sources.push({ source: `cookie:${e.name}`, text: e.value });
    }
    // Visible body text (capped) so we catch leaked secrets rendered inline.
    const bodyText = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => (document.body?.innerText ?? '').slice(0, 50_000),
    });
    const dom = bodyText?.[0]?.result as string | undefined;
    if (dom) sources.push({ source: 'dom', text: dom });
    const hits = scanSensitive(sources);
    return ok({ url: snap?.url, hits, scanned: sources.length });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

// ---- detect_tech_stack ----------------------------------------------------

async function probeTechStack(tabId: number) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      // Probe a small fixed set of well-known globals. Scanning ALL window
      // props is expensive and would leak too many noisy names.
      const CANDIDATES = [
        'React', '__NEXT_DATA__', '__NUXT__', 'Vue', 'ng', 'angular', 'Svelte',
        'Ember', 'jQuery', '$', '__REDUX_DEVTOOLS_EXTENSION__', 'Shopify',
        'gtag', 'analytics', 'mixpanel', 'hj', 'dataLayer',
      ];
      const w = window as unknown as Record<string, unknown>;
      const globals = CANDIDATES.filter((k) => typeof w[k] !== 'undefined');
      const scripts = Array.from(document.querySelectorAll('script[src]'))
        .map((s) => (s as HTMLScriptElement).src)
        .filter(Boolean);
      const links = Array.from(document.querySelectorAll('link[href]'))
        .map((s) => (s as HTMLLinkElement).href)
        .filter(Boolean);
      const metaGenerator = document.querySelector('meta[name="generator" i]')?.getAttribute('content') ?? undefined;
      const cookies = (document.cookie || '')
        .split(/;\s*/)
        .map((pair) => pair.split('=')[0])
        .filter(Boolean);
      return { url: location.href, globals, scripts, links, metaGenerator, cookies };
    },
  });
  return res?.[0]?.result as
    | {
        url: string;
        globals: string[];
        scripts: string[];
        links: string[];
        metaGenerator?: string;
        cookies: string[];
      }
    | undefined;
}

export async function executeDetectTechStack(): Promise<ToolResult> {
  const tabId = await resolveActiveTabId();
  if (typeof tabId !== 'number') return err('undriveable', 'No active web tab to inspect.');
  try {
    const probe = await probeTechStack(tabId);
    if (!probe) return err('runtime-error', 'Could not inspect the active page.');
    const matches = detectTech(probe);
    return ok({ url: probe.url, count: matches.length, matches });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

// ---- analyze_a11y ---------------------------------------------------------

async function probeA11y(tabId: number) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const images = Array.from(document.images).map((img) => ({
        src: img.src,
        // Distinguish "alt missing entirely" from alt="" (decorative).
        alt: img.hasAttribute('alt') ? img.getAttribute('alt') ?? '' : undefined,
        role: img.getAttribute('role') ?? undefined,
      }));
      const controls = Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'),
      ).map((el) => {
        const id = el.id || undefined;
        // <label for="id"> reference OR a wrapping <label>.
        const refLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        const wrap = el.closest('label');
        return {
          tag: el.tagName.toLowerCase() as 'input' | 'select' | 'textarea',
          type: (el as HTMLInputElement).type,
          id,
          name: (el as HTMLInputElement).name || undefined,
          ariaLabel: el.getAttribute('aria-label') ?? undefined,
          hasLabel: !!(refLabel || wrap),
        };
      });
      const headingLevels = Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).map(
        (h) => Number(h.tagName.slice(1)),
      );
      const htmlLang = document.documentElement.getAttribute('lang') || undefined;
      const title = document.title || undefined;
      const unlabeledButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(
        (b) => !b.textContent?.trim() && !b.getAttribute('aria-label'),
      ).length;
      const unlabeledLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a')).filter(
        (a) => !a.textContent?.trim() && !a.getAttribute('aria-label'),
      ).length;
      return { images, controls, headingLevels, htmlLang, title, unlabeledButtons, unlabeledLinks };
    },
  });
  return res?.[0]?.result;
}

export async function executeAnalyzeA11y(): Promise<ToolResult> {
  const tabId = await resolveActiveTabId();
  if (typeof tabId !== 'number') return err('undriveable', 'No active web tab to inspect.');
  try {
    const sig = await probeA11y(tabId);
    if (!sig) return err('runtime-error', 'Could not inspect the active page.');
    const report = analyzeA11y(sig);
    return ok(report);
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

// ---- analyze_a11y_axe (bundled axe-core, ~90 WCAG rules) -------------------
//
// axe-core ships in the extension (public/vendor/axe.min.js). We inject it into
// the page's isolated content-script world, then run axe.run() there — no remote
// code, no eval. The two injections share the isolated world so `window.axe`
// from the first is visible to the second.

export async function executeAnalyzeA11yAxe(): Promise<ToolResult> {
  const tabId = await resolveActiveTabId();
  if (typeof tabId !== 'number') return err('undriveable', 'No active web tab to inspect.');
  try {
    // 1. Load the bundled axe-core into the page's isolated world.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['vendor/axe.min.js'] });
    // 2. Run it and return the raw results (+ the page URL).
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const axe = (globalThis as unknown as { axe?: { run: (ctx: unknown, opts: unknown) => Promise<unknown> } }).axe;
        if (!axe) return { error: 'axe-core failed to load on this page.' };
        try {
          const r = (await axe.run(document, { resultTypes: ['violations'], reporter: 'v2' })) as {
            violations: unknown[];
            testEngine?: { name?: string; version?: string };
          };
          return { url: location.href, violations: r.violations, testEngine: r.testEngine };
        } catch (e) {
          return { error: e instanceof Error ? e.message : 'axe.run failed.' };
        }
      },
    });
    const out = res?.[0]?.result as
      | { url?: string; violations?: unknown[]; testEngine?: { version?: string }; error?: string }
      | undefined;
    if (!out || out.error || !Array.isArray(out.violations)) {
      return err('runtime-error', out?.error ?? 'axe did not return results (the page may block injection).');
    }
    const report = mapAxeViolations({ violations: out.violations as never, testEngine: out.testEngine });
    return ok({ url: out.url, ...report });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

// ---- analyze_seo ----------------------------------------------------------

async function probeSeo(tabId: number) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const title = document.title || undefined;
      const metaContent = (sel: string): string | undefined =>
        document.querySelector(sel)?.getAttribute('content') ?? undefined;
      const metaDescription = metaContent('meta[name="description" i]');
      const metaViewport = metaContent('meta[name="viewport" i]');
      const metaRobots = metaContent('meta[name="robots" i]');
      const canonicalEl = document.querySelector('link[rel="canonical" i]');
      const canonical = canonicalEl?.getAttribute('href') ?? undefined;
      // Open Graph: meta[property^="og:"]
      const openGraph: Record<string, string> = {};
      Array.from(document.querySelectorAll('meta[property]')).forEach((el) => {
        const p = (el as HTMLMetaElement).getAttribute('property') ?? '';
        const c = (el as HTMLMetaElement).getAttribute('content') ?? '';
        if (p.toLowerCase().startsWith('og:') && c) openGraph[p.toLowerCase()] = c;
      });
      // Twitter Card: meta[name^="twitter:"]
      const twitterCard: Record<string, string> = {};
      Array.from(document.querySelectorAll('meta[name]')).forEach((el) => {
        const n = (el as HTMLMetaElement).getAttribute('name') ?? '';
        const c = (el as HTMLMetaElement).getAttribute('content') ?? '';
        if (n.toLowerCase().startsWith('twitter:') && c) twitterCard[n.toLowerCase()] = c;
      });
      const h1s = document.querySelectorAll('h1');
      const h1Count = h1s.length;
      const h1Text = h1s[0]?.textContent?.trim() || undefined;
      const imgsMissingAlt = Array.from(document.images).filter((img) => !img.hasAttribute('alt')).length;
      // Structured data: try to parse each ld+json block.
      let structuredDataBlocks = 0;
      let structuredDataValid = true;
      Array.from(document.querySelectorAll('script[type="application/ld+json" i]')).forEach((s) => {
        structuredDataBlocks += 1;
        try {
          JSON.parse((s as HTMLScriptElement).textContent ?? '');
        } catch {
          structuredDataValid = false;
        }
      });
      // If we have zero blocks, validity is irrelevant — set true to skip the rule.
      if (structuredDataBlocks === 0) structuredDataValid = true;
      const htmlLang = document.documentElement.getAttribute('lang') || undefined;
      const isHttps = location.protocol === 'https:';
      return {
        url: location.href,
        title,
        metaDescription,
        metaViewport,
        metaRobots,
        canonical,
        openGraph,
        twitterCard,
        h1Count,
        h1Text,
        imgsMissingAlt,
        structuredDataBlocks,
        structuredDataValid,
        htmlLang,
        isHttps,
      };
    },
  });
  return res?.[0]?.result;
}

export async function executeAnalyzeSeo(): Promise<ToolResult> {
  const tabId = await resolveActiveTabId();
  if (typeof tabId !== 'number') return err('undriveable', 'No active web tab to inspect.');
  try {
    const probe = await probeSeo(tabId);
    if (!probe) return err('runtime-error', 'Could not inspect the active page.');
    const report = analyzeSeo(probe);
    return ok({ url: probe.url, h1Text: probe.h1Text, ...report });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

// ---- analyze_aeo (Answer Engine Optimization) -----------------------------

async function probeAeo(tabId: number) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const metaContent = (sel: string): string | undefined =>
        document.querySelector(sel)?.getAttribute('content') ?? undefined;
      const title = document.title || undefined;
      const metaDescription = metaContent('meta[name="description" i]');
      const htmlLang = document.documentElement.getAttribute('lang') || undefined;

      const headingEls = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      const headings = headingEls
        .map((h) => (h.textContent || '').trim())
        .filter(Boolean)
        .slice(0, 20);
      const h1Count = document.querySelectorAll('h1').length;
      const headingCount = headingEls.length;
      const questionHeadings = headings.filter((t) => t.endsWith('?')).length;

      const paragraphs = Array.from(document.querySelectorAll('p'))
        .map((p) => (p.textContent || '').trim())
        .filter(Boolean);
      const paragraphCount = paragraphs.length;
      const totalParaChars = paragraphs.reduce((n, p) => n + p.length, 0);
      const avgParagraphChars = paragraphCount ? Math.round(totalParaChars / paragraphCount) : 0;
      const bodyText = (document.body?.innerText || '').trim();
      const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;
      const listOrTableCount = document.querySelectorAll('ul,ol,table').length;

      // Structured data: collect @type across blocks (incl. arrays + @graph).
      const schemaTypes: string[] = [];
      let structuredDataBlocks = 0;
      let structuredDataValid = true;
      const collectTypes = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        const t = obj['@type'];
        if (typeof t === 'string') schemaTypes.push(t);
        else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && schemaTypes.push(x));
        const graph = obj['@graph'];
        if (Array.isArray(graph)) graph.forEach(collectTypes);
      };
      Array.from(document.querySelectorAll('script[type="application/ld+json" i]')).forEach((s) => {
        structuredDataBlocks += 1;
        try {
          const parsed = JSON.parse((s as HTMLScriptElement).textContent ?? '');
          if (Array.isArray(parsed)) parsed.forEach(collectTypes);
          else collectTypes(parsed);
        } catch {
          structuredDataValid = false;
        }
      });
      if (structuredDataBlocks === 0) structuredDataValid = true;

      // Attribution signals.
      const hasAuthor =
        !!metaContent('meta[name="author" i]') ||
        !!metaContent('meta[property="article:author" i]') ||
        !!document.querySelector('[rel="author"], [itemprop="author"], .author, [class*="byline" i]') ||
        /"author"\s*:/i.test(
          Array.from(document.querySelectorAll('script[type="application/ld+json" i]'))
            .map((s) => (s as HTMLScriptElement).textContent || '')
            .join(' '),
        );
      const hasDate =
        !!metaContent('meta[property="article:published_time" i]') ||
        !!document.querySelector('time[datetime]') ||
        /"datePublished"\s*:/i.test(
          Array.from(document.querySelectorAll('script[type="application/ld+json" i]'))
            .map((s) => (s as HTMLScriptElement).textContent || '')
            .join(' '),
        );

      return {
        url: location.href,
        origin: location.origin,
        title,
        metaDescription,
        htmlLang,
        headings,
        h1Count,
        headingCount,
        questionHeadings,
        wordCount,
        paragraphCount,
        avgParagraphChars,
        listOrTableCount,
        schemaTypes,
        structuredDataBlocks,
        structuredDataValid,
        hasAuthor,
        hasDate,
      };
    },
  });
  return res?.[0]?.result;
}

/** Fetch a same-origin file; resolve true/false for existence, text when ok. */
async function fetchOrigin(origin: string, path: string): Promise<{ ok: boolean; text: string }> {
  try {
    const r = await fetch(`${origin}${path}`, { method: 'GET', redirect: 'follow' });
    if (!r.ok) return { ok: false, text: '' };
    return { ok: true, text: await r.text() };
  } catch {
    return { ok: false, text: '' };
  }
}

export async function executeAnalyzeAeo(): Promise<ToolResult> {
  const tabId = await resolveActiveTabId();
  if (typeof tabId !== 'number') return err('undriveable', 'No active web tab to inspect.');
  try {
    const probe = await probeAeo(tabId);
    if (!probe) return err('runtime-error', 'Could not inspect the active page.');
    // Origin-level signals: /llms.txt presence + AI-crawler rules in robots.txt.
    const [llms, robots] = await Promise.all([
      fetchOrigin(probe.origin, '/llms.txt'),
      fetchOrigin(probe.origin, '/robots.txt'),
    ]);
    const signal = {
      url: probe.url,
      title: probe.title,
      metaDescription: probe.metaDescription,
      htmlLang: probe.htmlLang,
      h1Count: probe.h1Count,
      headingCount: probe.headingCount,
      questionHeadings: probe.questionHeadings,
      wordCount: probe.wordCount,
      paragraphCount: probe.paragraphCount,
      avgParagraphChars: probe.avgParagraphChars,
      listOrTableCount: probe.listOrTableCount,
      schemaTypes: probe.schemaTypes,
      structuredDataBlocks: probe.structuredDataBlocks,
      structuredDataValid: probe.structuredDataValid,
      hasAuthor: probe.hasAuthor,
      hasDate: probe.hasDate,
      hasLlmsTxt: llms.ok,
      blockedAiCrawlers: robots.ok ? parseBlockedAiCrawlers(robots.text) : undefined,
    };
    const report = analyzeAeo(signal);
    return ok({
      url: probe.url,
      title: probe.title,
      metaDescription: probe.metaDescription,
      headings: probe.headings,
      ...report,
    });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}
