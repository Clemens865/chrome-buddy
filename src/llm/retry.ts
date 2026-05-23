// Retry wrapper for Gemini fetch sites.
// (See /Users/clemenshoenig/Documents/Software-Projects/Google_Geminin_documentation/troubleshooting.md
//  L20-29; rate-limits.md; flex-inference.md L482-503 for the recommended pattern.)
//
// - Retries 429 (rate limit), 503 (overloaded), 504 (timeout), and transient
//   network errors (TypeError from fetch).
// - Honors `Retry-After` (seconds or HTTP-date) when present.
// - Otherwise: exponential backoff with full jitter: delay ∈ [0, base * 2^attempt],
//   capped at maxDelayMs.
// - Does NOT retry 4xx other than 429 (those are caller bugs, not transient).
// - Pure modulo `fetch`/`setTimeout`/`Math.random` — `now`/`rand`/`sleep` are
//   injectable so the helper is fully unit-testable without real timers.

export interface RetryOptions {
  /** Max attempts including the first try. Default 4. */
  maxAttempts?: number;
  /** Exponential backoff base in ms (first retry wait ≈ baseMs). Default 500. */
  baseMs?: number;
  /** Cap per-attempt wait. Default 30_000 ms. */
  maxDelayMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
  now?: () => number;
}

const RETRY_STATUSES = new Set([429, 503, 504]);

/** Parse a Retry-After header value into milliseconds, or null if unusable. */
export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const epoch = Date.parse(value);
  if (!Number.isNaN(epoch)) return Math.max(0, epoch - nowMs);
  return null;
}

/** Compute the wait before the next retry. */
export function backoffDelay(attempt: number, baseMs: number, maxDelayMs: number, rand: () => number): number {
  const ceiling = Math.min(maxDelayMs, baseMs * 2 ** attempt);
  return Math.floor(rand() * ceiling);
}

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  reason: string;
}

/** Decide what to do after one attempt — pure, easy to unit-test. */
export function decideRetry(
  attempt: number,
  result: { kind: 'ok'; status: number; retryAfter?: string | null } | { kind: 'error'; error: unknown },
  opts: { maxAttempts: number; baseMs: number; maxDelayMs: number; rand: () => number; now: () => number },
): RetryDecision {
  const last = attempt + 1 >= opts.maxAttempts;
  if (result.kind === 'error') {
    if (last) return { retry: false, delayMs: 0, reason: 'network-error (no attempts left)' };
    return { retry: true, delayMs: backoffDelay(attempt, opts.baseMs, opts.maxDelayMs, opts.rand), reason: 'network-error' };
  }
  if (!RETRY_STATUSES.has(result.status)) return { retry: false, delayMs: 0, reason: `status ${result.status} not retryable` };
  if (last) return { retry: false, delayMs: 0, reason: `status ${result.status} (no attempts left)` };
  const fromHeader = parseRetryAfter(result.retryAfter ?? null, opts.now());
  const delayMs =
    fromHeader !== null ? Math.min(fromHeader, opts.maxDelayMs) : backoffDelay(attempt, opts.baseMs, opts.maxDelayMs, opts.rand);
  return { retry: true, delayMs, reason: `status ${result.status}` };
}

/** Drop-in for `fetch` that retries 429/503/504 + transient network errors. */
export async function retryFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  opts: RetryOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseMs = opts.baseMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const rand = opts.rand ?? Math.random;
  const now = opts.now ?? Date.now;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await fetch(input, init);
      const decision = decideRetry(attempt, { kind: 'ok', status: resp.status, retryAfter: resp.headers.get('Retry-After') }, {
        maxAttempts,
        baseMs,
        maxDelayMs,
        rand,
        now,
      });
      if (!decision.retry) return resp;
      // Drain the body to free the connection before sleeping.
      try {
        await resp.text();
      } catch {
        /* ignore */
      }
      await sleep(decision.delayMs);
    } catch (e) {
      lastError = e;
      const decision = decideRetry(attempt, { kind: 'error', error: e }, { maxAttempts, baseMs, maxDelayMs, rand, now });
      if (!decision.retry) throw e;
      await sleep(decision.delayMs);
    }
  }
  // Should be unreachable — the last iteration either returns or throws.
  throw lastError ?? new Error('retryFetch: exhausted attempts');
}
