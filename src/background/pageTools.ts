// Background-side page-tool executor (FR-TOOLS-2..6; DOM-first architecture).
//
// The agent loop runs in the UI but MUST NOT touch chrome.scripting /
// chrome.tabs.captureVisibleTab or read the page directly. Instead it posts a
// TOOL_EXEC message; this module runs the requested tool HERE, in the
// privileged service-worker context, against the ACTIVE tab, using the shared
// src/page services (PageContext for reads, Browser Control for actions).
//
// SECURITY:
//   • Restricted / undriveable URLs (chrome://, Web Store, view-source, …) are
//     refused with a structured `undriveable` error — never silently scripted.
//   • Page-derived content returned here is UNTRUSTED data; it is handed back as
//     a ToolResult and never executed. The HITL gate on consequential tools
//     lives in the runtime (UI side) and fires before TOOL_EXEC is ever posted
//     for such a tool.
//   • This module executes only DOM read/act tools. Consequential side-effecting
//     tools (send_webhook, write_file) are not routed here.

import { ok, err, type ToolResult } from '../types';
import {
  getContext,
  screenshot as capturePage,
  isUndriveableSignal,
  act,
  isActUndriveable,
} from '../page';
import type { BrowserAction } from '../page';

/** Page-read/act tool names this executor knows how to run in the SW. */
const PAGE_TOOLS = new Set([
  'read_dom',
  'extract',
  'screenshot',
  'navigate',
  'click',
  'type',
  'scroll',
]);

/** Whether a tool name is a background-executable page tool. */
export function isPageTool(tool: string): boolean {
  return PAGE_TOOLS.has(tool);
}

/**
 * Resolve the web tab the user means. The active tab in the focused window is
 * preferred — but when that is a restricted/extension page (e.g. the side panel
 * itself is focused, or a chrome:// page), fall back to the most recently
 * accessed http(s) tab so read_dom/screenshot operate on a real page.
 */
export async function resolveActiveTabId(): Promise<number | undefined> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return undefined;
  const active = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (active?.id != null && typeof active.url === 'string' && /^https?:/i.test(active.url)) {
    return active.id;
  }
  const web = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  web.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  if (typeof web[0]?.id === 'number') return web[0].id;
  return typeof active?.id === 'number' ? active.id : undefined;
}

export interface PageContextSummary {
  url: string;
  title: string;
  text: string;
}

/**
 * Capture a compact summary of the active page for attaching to a chat message
 * (so plain chat can answer about the page without an agentic read_dom round-trip).
 * Returns null when there is no driveable active tab.
 */
export async function capturePageContext(maxChars = 8000): Promise<PageContextSummary | null> {
  const tabId = await resolveActiveTabId();
  if (tabId === undefined) return null;
  try {
    const page = await getContext(tabId);
    if (isUndriveableSignal(page)) return null;
    return {
      url: page.url ?? '',
      title: page.title ?? '',
      text: (page.text ?? '').slice(0, maxChars),
    };
  } catch {
    return null;
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Execute one page tool against the active tab. Always resolves to a
 * discriminated ToolResult — restricted URLs, missing tabs, and runtime faults
 * are returned as typed errors rather than thrown.
 */
export async function executePageTool(
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!isPageTool(tool)) {
    return err('not-found', `Tool "${tool}" is not a background page tool.`);
  }

  const tabId = await resolveActiveTabId();
  if (tabId === undefined) {
    return err('undriveable', 'No active tab to operate on.');
  }

  try {
    switch (tool) {
      // --- reads (PageContext) ---------------------------------------------
      case 'read_dom':
      case 'extract': {
        const page = await getContext(tabId);
        if (isUndriveableSignal(page)) {
          return err('undriveable', page.message);
        }
        return ok(page, { provenance: [page.url] });
      }

      // --- screenshot (captureVisibleTab) ----------------------------------
      case 'screenshot': {
        const shot = await capturePage(tabId);
        return ok(shot);
      }

      // --- actions (Browser Control) ---------------------------------------
      case 'navigate':
      case 'click':
      case 'type':
      case 'scroll': {
        const action = buildAction(tool, args);
        if (!action) {
          return err('invalid-args', `Missing required arguments for "${tool}".`);
        }
        const result = await act(tabId, action);
        if (isActUndriveable(result)) {
          return err('undriveable', result.message);
        }
        if (!result.ok) {
          const code = result.reason === 'not-found' ? 'not-found' : 'runtime-error';
          return err(code, result.message);
        }
        return ok({ engine: result.engine, note: result.note });
      }

      default:
        return err('not-found', `Tool "${tool}" is not a background page tool.`);
    }
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

/** Map tool name + args into a typed BrowserAction (or null if invalid). */
function buildAction(tool: string, args: Record<string, unknown>): BrowserAction | null {
  switch (tool) {
    case 'navigate': {
      const url = asString(args.url);
      const query = asString(args.query);
      const target = url ?? (query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : undefined);
      if (!target) return null;
      return { type: 'navigate', url: target, newTab: args.newTab === true };
    }
    case 'click':
      return { type: 'click', selector: asString(args.selector), text: asString(args.text) };
    case 'type': {
      const text = asString(args.text);
      if (text === undefined) return null;
      return { type: 'type', text, selector: asString(args.selector), submit: args.submit === true };
    }
    case 'scroll': {
      const dir = asString(args.direction);
      if (dir !== 'up' && dir !== 'down' && dir !== 'top' && dir !== 'bottom') return null;
      const amount = typeof args.amount === 'number' ? args.amount : undefined;
      return { type: 'scroll', direction: dir, selector: asString(args.selector), amount };
    }
    default:
      return null;
  }
}
