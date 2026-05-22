// Hybrid Browser Control layer (FR-BC-1..8, LOCKED #3).
//
// act() applies click/type/scroll/navigate. By default it uses
// chrome.scripting.executeScript synthetic events — no debugger banner, weaker
// on hardened sites (FR-BC-1). A CDP path (chrome.debugger) for trusted input is
// stubbed with a clear TODO (FR-BC-2/3). Undriveable contexts are detected via
// restricted.ts and returned as a structured signal instead of acting (FR-BC-6).
//
// All chrome.* access is guarded so this module imports cleanly outside an
// extension (and in tests).

import { isUndriveable, describeUndriveable } from './restricted';
import type { ActResult, BrowserAction, ControlEngine } from './types';
import { actViaCdp } from './cdp';

function hasTabs(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.tabs !== 'undefined';
}

function hasScripting(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.scripting !== 'undefined';
}

/** Per-call options for Browser Control. */
export interface ActOptions {
  /**
   * Preferred engine. 'scripting' (default) avoids the debugger banner.
   * 'cdp' requests trusted-input via chrome.debugger (currently a stub) — the
   * caller is responsible for having warned the user about the banner first.
   */
  engine?: ControlEngine;
}

async function getTabUrl(tabId: number): Promise<string> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url ?? tab.pendingUrl ?? '';
  } catch {
    return '';
  }
}

/**
 * Apply a single browser action to a tab. Returns a discriminated ActResult:
 * success (with the engine used), an UndriveableSignal, or a typed failure.
 */
export async function act(
  tabId: number,
  action: BrowserAction,
  options: ActOptions = {},
): Promise<ActResult> {
  // navigate uses chrome.tabs and has its own undriveable check on the target.
  if (action.type === 'navigate') {
    return navigate(tabId, action.url, action.newTab ?? false);
  }

  if (!hasTabs()) {
    return { ok: false, reason: 'chrome-unavailable', message: 'chrome.tabs unavailable' };
  }

  // Block acting on undriveable contexts up front (FR-BC-6).
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

  const engine = options.engine ?? 'scripting';
  if (engine === 'cdp') return actViaCdp(tabId, action);
  return actViaScripting(tabId, action);
}

/** Open or navigate a tab (FR-TOOLS-2). */
async function navigate(
  tabId: number,
  url: string,
  newTab: boolean,
): Promise<ActResult> {
  if (!hasTabs()) {
    return { ok: false, reason: 'chrome-unavailable', message: 'chrome.tabs unavailable' };
  }
  const reason = isUndriveable(url);
  if (reason) {
    return { undriveable: true, reason, url, message: describeUndriveable(reason) };
  }
  try {
    if (newTab) {
      await chrome.tabs.create({ url });
    } else {
      await chrome.tabs.update(tabId, { url });
    }
    return { ok: true, engine: 'scripting', note: newTab ? 'opened new tab' : 'navigated' };
  } catch (e) {
    return { ok: false, reason: 'error', message: String(e) };
  }
}

// --- scripting (synthetic events) engine -----------------------------------

/**
 * Page-side actor. Serialised by chrome.scripting.executeScript({ func, args }),
 * so it must be self-contained (no closures over imports). Dispatches synthetic
 * events. Returns a small result object the SW side maps to an ActResult.
 */
function applyActionInPage(action: BrowserAction): {
  ok: boolean;
  reason?: 'not-found' | 'no-target' | 'error';
  note?: string;
} {
  try {
    const resolve = (): HTMLElement | null => {
      if (action.type === 'navigate') return null;
      const sel = (action as { selector?: string }).selector;
      if (sel) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) return el;
      }
      const text = (action as { text?: string }).text;
      // For click-by-text only; type uses `text` as input value, not a locator.
      if (action.type === 'click' && text) {
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>('a,button,[role="button"],input,summary'),
        );
        const match = candidates.find(
          (c) => (c.innerText || c.getAttribute('value') || '').trim() === text.trim(),
        );
        if (match) return match;
      }
      return null;
    };

    if (action.type === 'click') {
      const el = resolve();
      if (!el) return { ok: false, reason: 'not-found' };
      el.scrollIntoView({ block: 'center' });
      el.focus?.();
      ['mousedown', 'mouseup', 'click'].forEach((t) =>
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true })),
      );
      return { ok: true, note: action.text ? 'matched by text' : 'clicked selector' };
    }

    if (action.type === 'type') {
      const el = resolve() as
        | (HTMLInputElement | HTMLTextAreaElement)
        | null;
      if (!el) return { ok: false, reason: 'not-found' };
      el.focus?.();
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(el),
        'value',
      )?.set;
      if (setter) setter.call(el, action.text);
      else (el as HTMLInputElement).value = action.text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (action.submit) {
        el.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        const form = (el as HTMLInputElement).form;
        form?.requestSubmit?.();
      }
      return { ok: true, note: action.submit ? 'typed + submitted' : 'typed' };
    }

    if (action.type === 'scroll') {
      const target = action.selector
        ? document.querySelector<HTMLElement>(action.selector)
        : null;
      if (action.selector && !target) return { ok: false, reason: 'not-found' };
      const scroller: { scrollTo: typeof window.scrollTo; scrollHeight?: number } =
        (target as unknown as { scrollTo: typeof window.scrollTo }) ?? window;
      const amount = action.amount ?? window.innerHeight;
      const here = target ? target.scrollTop : window.scrollY;
      switch (action.direction) {
        case 'up':
          (target ?? window).scrollBy({ top: -amount });
          break;
        case 'down':
          (target ?? window).scrollBy({ top: amount });
          break;
        case 'top':
          (scroller as Window | HTMLElement).scrollTo?.({ top: 0 });
          break;
        case 'bottom':
          (target ?? window).scrollTo({
            top: target ? target.scrollHeight : document.body.scrollHeight,
          });
          break;
      }
      void here;
      return { ok: true, note: `scrolled ${action.direction}` };
    }

    return { ok: false, reason: 'no-target' };
  } catch (e) {
    return { ok: false, reason: 'error', note: String(e) };
  }
}

async function actViaScripting(
  tabId: number,
  action: BrowserAction,
): Promise<ActResult> {
  if (!hasScripting()) {
    return { ok: false, reason: 'chrome-unavailable', message: 'chrome.scripting unavailable' };
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: applyActionInPage,
      args: [action],
    });
    const r = results?.[0]?.result as
      | { ok: boolean; reason?: 'not-found' | 'no-target' | 'error'; note?: string }
      | undefined;
    if (!r) {
      return { ok: false, reason: 'error', message: 'no result from injected actor' };
    }
    if (r.ok) {
      const out: ActResult = { ok: true, engine: 'scripting' };
      if (r.note) out.note = r.note;
      return out;
    }
    return {
      ok: false,
      reason: r.reason ?? 'error',
      message: r.note ?? `action failed: ${action.type}`,
    };
  } catch (e) {
    return { ok: false, reason: 'error', message: String(e) };
  }
}

// --- CDP (trusted input) engine (FR-BC-2/3) --------------------------------
// Implemented in ./cdp (chrome.debugger). Used only when the caller requests
// engine:'cdp' — e.g. a hardened site rejected synthetic events.

/** Type guard for an undriveable ActResult. */
export function isActUndriveable(
  result: ActResult,
): result is Extract<ActResult, { undriveable: true }> {
  return (result as { undriveable?: true }).undriveable === true;
}
