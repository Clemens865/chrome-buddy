import { describe, it, expect } from 'vitest';
import { filterRequests, summarizeNetwork, toCurl, buildHar, type NetRequest } from './network';

const reqs: NetRequest[] = [
  { url: 'https://x.test/app.js', host: 'x.test', type: 'script', method: 'GET', status: 200, protocol: 'h2', startMs: 0, durationMs: 120, sizeBytes: 45000 },
  { url: 'https://x.test/slow.json', host: 'x.test', type: 'fetch', method: 'GET', status: 200, protocol: 'h2', startMs: 130, durationMs: 800, sizeBytes: 2000 },
  { url: 'https://x.test/missing.png', host: 'x.test', type: 'img', method: 'GET', status: 404, protocol: 'h2', startMs: 50, durationMs: 30, sizeBytes: 0 },
];

describe('filterRequests', () => {
  it('all returns everything; failed = status>=400; slow = duration>=500ms', () => {
    expect(filterRequests(reqs, 'all')).toHaveLength(3);
    expect(filterRequests(reqs, 'failed').map((r) => r.status)).toEqual([404]);
    expect(filterRequests(reqs, 'slow').map((r) => r.url)).toEqual(['https://x.test/slow.json']);
  });
});

describe('summarizeNetwork', () => {
  it('totals bytes, counts failed/slow, and computes the waterfall span', () => {
    const s = summarizeNetwork(reqs);
    expect(s.total).toBe(3);
    expect(s.totalBytes).toBe(47000);
    expect(s.failed).toBe(1);
    expect(s.slow).toBe(1);
    expect(s.spanMs).toBe(930); // max(start+duration) = 130 + 800
  });
});

describe('toCurl', () => {
  it('quotes the URL and only adds -X for non-GET', () => {
    expect(toCurl(reqs[0])).toBe("curl 'https://x.test/app.js'");
    expect(toCurl({ ...reqs[0], method: 'POST' })).toBe("curl -X POST 'https://x.test/app.js'");
  });
});

describe('buildHar', () => {
  it('produces a valid HAR 1.2 log with one entry per request', () => {
    const har = buildHar(reqs, 'https://x.test/', '2026-06-08T00:00:00.000Z', '0.5.8') as {
      log: { version: string; creator: { name: string }; entries: { request: { url: string }; response: { status: number } }[] };
    };
    expect(har.log.version).toBe('1.2');
    expect(har.log.creator.name).toBe('Chrome Buddy');
    expect(har.log.entries).toHaveLength(3);
    expect(har.log.entries[0].request.url).toBe('https://x.test/app.js');
    expect(har.log.entries[2].response.status).toBe(404);
    // round-trips through JSON (it's a downloadable artifact)
    expect(() => JSON.parse(JSON.stringify(har))).not.toThrow();
  });
});
