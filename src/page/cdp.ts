// CDP (chrome.debugger) trusted-input engine (FR-BC-2/3). The default control
// path uses chrome.scripting synthetic events (no banner). When a site rejects
// synthetic events (hardened/isTrusted checks), the agent can escalate to this
// path, which dispatches OS-level trusted input through the DevTools protocol.
//
// COST: attaching surfaces the un-hideable "extension started debugging this
// browser" banner — callers MUST warn the user (the SW emits a notification on
// first attach; the agent surfaces a note). We attach lazily and keep the
// session for the tab, detaching when the tab closes or another tab is driven.
import type { ActResult, BrowserAction } from './types';

type ChromeLike = typeof chrome | undefined;

function api(): ChromeLike {
  return typeof chrome !== 'undefined' ? chrome : undefined;
}

export function isCdpAvailable(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.debugger !== 'undefined';
}

/**
 * PURE: build a JS expression that resolves to the target element (or null),
 * matching by CSS selector first, then by visible text (same rule as the
 * scripting engine). Values are JSON-encoded so they're injection-safe.
 */
export function cdpLocatorExpression(selector?: string, text?: string): string {
  const parts: string[] = [];
  if (selector) parts.push(`document.querySelector(${JSON.stringify(selector)})`);
  if (text) {
    const t = JSON.stringify(text);
    parts.push(
      `Array.from(document.querySelectorAll('a,button,[role="button"],input,summary'))` +
        `.find((c) => (c.innerText || c.getAttribute('value') || '').trim() === ${t}.trim())`,
    );
  }
  return parts.length ? parts.join(' || ') : 'null';
}

// --- session (one attached tab at a time) ---------------------------------

let attachedTab: number | null = null;
let warned = false;

/** Whether a CDP attach has happened this session (for the one-time banner warning). */
export function cdpHasWarned(): boolean {
  return warned;
}

function bindDetachCleanup(): void {
  const c = api();
  if (!c?.debugger?.onDetach) return;
  c.debugger.onDetach.addListener((src: chrome.debugger.Debuggee) => {
    if ((src as { tabId?: number }).tabId === attachedTab) attachedTab = null;
  });
}
let cleanupBound = false;

async function ensureAttached(tabId: number): Promise<void> {
  const c = api();
  if (!c?.debugger) throw new Error('chrome.debugger is unavailable.');
  if (!cleanupBound) {
    bindDetachCleanup();
    cleanupBound = true;
  }
  if (attachedTab === tabId) return;
  if (attachedTab != null) {
    try {
      await c.debugger.detach({ tabId: attachedTab });
    } catch {
      /* already gone */
    }
    attachedTab = null;
  }
  await c.debugger.attach({ tabId }, '1.3');
  attachedTab = tabId;
  warned = true; // first attach: the Chrome banner is now showing
}

// --- coordinate-based actions for Vision Mode (Computer Use) --------------
// Computer Use returns 0–999 normalized coords; we denormalize to CSS px in
// the caller (we need the tab viewport size) and dispatch trusted input here.

export async function cdpClickAtCoord(tabId: number, cssX: number, cssY: number): Promise<void> {
  await ensureAttached(tabId);
  const base = { x: cssX, y: cssY, button: 'left' as const, clickCount: 1 };
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
}

export async function cdpTypeAtCoord(
  tabId: number,
  cssX: number,
  cssY: number,
  text: string,
  opts: { pressEnter?: boolean; clearBeforeTyping?: boolean } = {},
): Promise<void> {
  await ensureAttached(tabId);
  await cdpClickAtCoord(tabId, cssX, cssY); // focus the input
  if (opts.clearBeforeTyping !== false) {
    // Ctrl/Cmd+A then Delete — clears most text inputs.
    const a = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 };
    await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 4, ...a });
    await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 4, ...a });
    const del = { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 };
    await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...del });
    await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...del });
  }
  await send(tabId, 'Input.insertText', { text });
  if (opts.pressEnter !== false) {
    const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
    await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...enter });
    await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
  }
}

export async function cdpScrollAtCoord(
  tabId: number,
  cssX: number,
  cssY: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  await ensureAttached(tabId);
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: cssX, y: cssY, deltaX, deltaY });
}

/** Read the target tab's CSS viewport size — needed to denormalize 0–999 coords. */
export async function cdpViewport(tabId: number): Promise<{ width: number; height: number }> {
  await ensureAttached(tabId);
  const v = await evalJson<{ w: number; h: number }>(
    tabId,
    `({ w: window.innerWidth, h: window.innerHeight })`,
  );
  return { width: v?.w ?? 1280, height: v?.h ?? 800 };
}

/** Detach the CDP session (drops the banner). Safe to call when not attached. */
export async function cdpDetach(): Promise<void> {
  const c = api();
  if (attachedTab != null && c?.debugger?.detach) {
    try {
      await c.debugger.detach({ tabId: attachedTab });
    } catch {
      /* ignore */
    }
  }
  attachedTab = null;
}

async function send<T = unknown>(tabId: number, method: string, params?: object): Promise<T> {
  const c = api();
  if (!c?.debugger) throw new Error('chrome.debugger is unavailable.');
  return (await c.debugger.sendCommand({ tabId }, method, params)) as T;
}

async function evalJson<T>(tabId: number, expression: string): Promise<T | null> {
  const res = await send<{ result?: { value?: T } }>(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  return res?.result?.value ?? null;
}

/** Apply an action via trusted CDP input. Attaches lazily; returns an ActResult. */
export async function actViaCdp(tabId: number, action: BrowserAction): Promise<ActResult> {
  if (!isCdpAvailable()) {
    return { ok: false, reason: 'chrome-unavailable', message: 'chrome.debugger (CDP) unavailable — the "debugger" permission is required.' };
  }
  try {
    await ensureAttached(tabId);

    if (action.type === 'click') {
      const loc = await evalJson<{ x: number; y: number }>(
        tabId,
        `(() => { const el = ${cdpLocatorExpression(action.selector, action.text)};` +
          ` if (!el) return null; el.scrollIntoView({ block: 'center' });` +
          ` const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
      );
      if (!loc) return { ok: false, reason: 'not-found', message: 'Element not found for CDP click.' };
      const base = { x: loc.x, y: loc.y, button: 'left' as const, clickCount: 1 };
      await send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
      await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
      return { ok: true, engine: 'cdp', note: 'trusted click (CDP)' };
    }

    if (action.type === 'type') {
      const focused = await evalJson<boolean>(
        tabId,
        `(() => { const el = ${cdpLocatorExpression(action.selector)}; if (!el) return false; el.focus(); return true; })()`,
      );
      if (!focused) return { ok: false, reason: 'not-found', message: 'Input not found for CDP type.' };
      await send(tabId, 'Input.insertText', { text: action.text });
      if (action.submit) {
        const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
        await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...key });
        await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...key });
      }
      return { ok: true, engine: 'cdp', note: action.submit ? 'trusted type + Enter (CDP)' : 'trusted type (CDP)' };
    }

    if (action.type === 'scroll') {
      const dy = action.direction === 'up' ? -(action.amount ?? 600) : action.amount ?? 600;
      await evalJson(tabId, `(window.scrollBy(0, ${Number(dy)}), true)`);
      return { ok: true, engine: 'cdp', note: 'scrolled (CDP)' };
    }

    return { ok: false, reason: 'error', message: `CDP cannot perform "${action.type}".` };
  } catch (e) {
    attachedTab = null;
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
