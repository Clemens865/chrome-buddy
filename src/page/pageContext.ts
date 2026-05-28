// PageContext service — the ONLY page reader (FR-TOOLS-4, FR-APP-6, FR-BC-7).
//
// getContext(tabId): waits for the tab to be stable, injects a page-side walker
// via chrome.scripting.executeScript, then runs the PURE distillers on the
// returned tree. screenshot(tabId): captures the visible viewport via
// chrome.tabs.captureVisibleTab for vision analysis (FR-BC-4).
//
// All chrome.* access is guarded behind hasChrome() so this module can be
// imported in non-extension contexts (and tests) without throwing at load.

import { buildPageTreePayload, distillTree, type DomNodeLike } from './distill';
import { isUndriveable, describeUndriveable } from './restricted';
import type {
  DistilledPage,
  ScreenshotResult,
  UndriveableSignal,
} from './types';

/** Narrow guard: are the chrome.* APIs PageContext needs available? */
function hasChrome(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.tabs !== 'undefined' &&
    typeof chrome.scripting !== 'undefined'
  );
}

/** Options for a page read. */
export interface GetContextOptions {
  /** Max millis to wait for the tab to reach a stable (complete) state. */
  stabilityTimeoutMs?: number;
  /** Poll interval while waiting for stability. */
  pollIntervalMs?: number;
}

const DEFAULT_STABILITY_TIMEOUT = 8000;
const DEFAULT_POLL_INTERVAL = 150;

/** Resolve a tab's current URL (or '' if unavailable). */
async function getTabUrl(tabId: number): Promise<string> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url ?? tab.pendingUrl ?? '';
  } catch {
    return '';
  }
}

/**
 * Wait until the tab reports `status === 'complete'`, or the timeout elapses.
 * Resolves regardless (best-effort stability) so we still attempt a read of a
 * slow page rather than hanging forever (FR-BC-7, lazy/async content).
 */
async function waitForStable(
  tabId: number,
  timeoutMs: number,
  pollMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Loop polls chrome.tabs.get; cheap and avoids holding a webNavigation listener.
  while (true) {
    let complete = true;
    try {
      const tab = await chrome.tabs.get(tabId);
      complete = tab.status === 'complete';
    } catch {
      return; // tab gone; let the caller's read fail with a clear error
    }
    if (complete) return;
    if (Date.now() >= deadline) return;
    await delay(pollMs);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read and distill a tab into a DistilledPage. Returns an UndriveableSignal for
 * contexts the extension cannot script (chrome://, Web Store, …) instead of
 * throwing, so callers degrade gracefully.
 */
export async function getContext(
  tabId: number,
  options: GetContextOptions = {},
): Promise<DistilledPage | UndriveableSignal> {
  if (!hasChrome()) {
    throw new Error('PageContext.getContext requires chrome.tabs + chrome.scripting');
  }

  const url = await getTabUrl(tabId);
  const reason = isUndriveable(url);
  if (reason) {
    return {
      undriveable: true,
      reason,
      url,
      message: describeUndriveable(reason),
    };
  }

  await waitForStable(
    tabId,
    options.stabilityTimeoutMs ?? DEFAULT_STABILITY_TIMEOUT,
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL,
  );

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: buildPageTreePayload,
  });

  const payload = results?.[0]?.result as
    | { tree: DomNodeLike; url: string; title: string }
    | undefined;

  if (!payload || !payload.tree) {
    throw new Error(`PageContext: no DOM payload returned for tab ${tabId}`);
  }

  return distillTree(payload.tree, {
    url: payload.url || url,
    title: payload.title,
    tabId,
  });
}

/** Capture a screenshot of the tab's visible viewport (FR-BC-4). */
export async function screenshot(tabId: number): Promise<ScreenshotResult> {
  if (!hasChrome()) {
    throw new Error('PageContext.screenshot requires chrome.tabs');
  }

  // captureVisibleTab targets a window, not a tab id directly. Resolve the tab's
  // window, then capture its visible (active) tab. The caller is expected to
  // pass the active tab of its window.
  let windowId: number | undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    windowId = tab.windowId;
  } catch {
    windowId = undefined;
  }

  const dataUrl =
    windowId !== undefined
      ? await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
      : await chrome.tabs.captureVisibleTab({ format: 'png' });

  return {
    dataUrl,
    mimeType: 'image/png',
    tabId,
    capturedAt: Date.now(),
  };
}

/** Type guard: did a getContext call return an undriveable signal? */
export function isUndriveableSignal(
  value: DistilledPage | UndriveableSignal,
): value is UndriveableSignal {
  return (value as UndriveableSignal).undriveable === true;
}
