// Network analysis from a Performance Resource Timing snapshot. Unlike the live
// CDP capture (which needs the debugger attached), this reads the timings the
// page already recorded — so it works on any page, instantly, and gives a real
// waterfall (start + duration), transfer size, type, protocol, and status.
//
// From it we build the artifacts: a valid HAR file + a copy-as-cURL per request.
// Pure — no chrome, no I/O — fully unit-testable.

export interface NetRequest {
  url: string;
  host: string;
  /** initiatorType (script/link/img/fetch/xmlhttprequest/css/font/…). */
  type: string;
  /** HTTP method — Performance timing doesn't expose it, so callers pass 'GET'. */
  method: string;
  /** responseStatus (Chrome 109+); 0 when unknown. */
  status: number;
  /** nextHopProtocol, e.g. "h2", "http/1.1". */
  protocol: string;
  /** ms from navigation start. */
  startMs: number;
  /** ms duration (responseEnd - startTime). */
  durationMs: number;
  /** transferSize in bytes (0 when served from cache / cross-origin opaque). */
  sizeBytes: number;
}

export type NetFilter = 'all' | 'slow' | 'failed';

/** A request is "slow" past this many ms. */
export const SLOW_MS = 500;

export function isFailed(r: NetRequest): boolean {
  return r.status >= 400 || r.status === 0 && r.durationMs === 0;
}
export function isSlow(r: NetRequest): boolean {
  return r.durationMs >= SLOW_MS;
}

export function filterRequests(reqs: readonly NetRequest[], filter: NetFilter): NetRequest[] {
  if (filter === 'slow') return reqs.filter(isSlow);
  if (filter === 'failed') return reqs.filter((r) => r.status >= 400);
  return [...reqs];
}

export interface NetSummary {
  total: number;
  totalBytes: number;
  failed: number;
  slow: number;
  /** End of the latest request (ms) — the waterfall's total width. */
  spanMs: number;
}

export function summarizeNetwork(reqs: readonly NetRequest[]): NetSummary {
  let totalBytes = 0;
  let failed = 0;
  let slow = 0;
  let spanMs = 0;
  for (const r of reqs) {
    totalBytes += r.sizeBytes;
    if (r.status >= 400) failed += 1;
    if (isSlow(r)) slow += 1;
    spanMs = Math.max(spanMs, r.startMs + r.durationMs);
  }
  return { total: reqs.length, totalBytes, failed, slow, spanMs: Math.max(1, Math.round(spanMs)) };
}

/** A copy-pasteable cURL for a request (no captured headers, so URL + method). */
export function toCurl(r: NetRequest): string {
  const m = r.method && r.method !== 'GET' ? `-X ${r.method} ` : '';
  return `curl ${m}'${r.url}'`;
}

/** Build a HAR 1.2 log from the snapshot. Minimal-but-valid: fields the
 *  Performance API can't supply are emitted as empty/-1 per the HAR spec. */
export function buildHar(reqs: readonly NetRequest[], pageUrl: string, startedDateTime: string, creatorVersion = '0'): object {
  return {
    log: {
      version: '1.2',
      creator: { name: 'Chrome Buddy', version: creatorVersion },
      pages: [
        { startedDateTime, id: 'page_1', title: pageUrl, pageTimings: { onContentLoad: -1, onLoad: -1 } },
      ],
      entries: reqs.map((r) => ({
        pageref: 'page_1',
        startedDateTime,
        time: Math.round(r.durationMs),
        request: {
          method: r.method,
          url: r.url,
          httpVersion: r.protocol || 'HTTP/1.1',
          headers: [],
          queryString: [],
          cookies: [],
          headersSize: -1,
          bodySize: -1,
        },
        response: {
          status: r.status,
          statusText: '',
          httpVersion: r.protocol || 'HTTP/1.1',
          headers: [],
          cookies: [],
          content: { size: r.sizeBytes, mimeType: '' },
          redirectURL: '',
          headersSize: -1,
          bodySize: r.sizeBytes,
        },
        cache: {},
        timings: { send: 0, wait: Math.round(r.durationMs), receive: 0 },
        _resourceType: r.type,
        serverIPAddress: '',
      })),
    },
  };
}
