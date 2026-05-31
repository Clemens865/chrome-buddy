// Unit tests for the background TOOL_EXEC page-tool executor.
// Mocks chrome.tabs.query (active-tab resolution) and the src/page services so
// no real scripting happens. Asserts: restricted URL → undriveable error;
// read_dom → calls PageContext; click → routes to Browser Control.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getContext = vi.fn();
const screenshot = vi.fn();
const act = vi.fn();

vi.mock('../page', () => ({
  getContext: (...a: unknown[]) => getContext(...a),
  screenshot: (...a: unknown[]) => screenshot(...a),
  act: (...a: unknown[]) => act(...a),
  isUndriveableSignal: (v: { undriveable?: boolean }) => v?.undriveable === true,
  isActUndriveable: (v: { undriveable?: boolean }) => v?.undriveable === true,
}));

import { executePageTool } from './pageTools';

beforeEach(() => {
  getContext.mockReset();
  screenshot.mockReset();
  act.mockReset();
  // Active tab id 7 in the focused window.
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: { query: vi.fn(async () => [{ id: 7 }]) },
  };
});

describe('executePageTool', () => {
  it('read_dom calls PageContext.getContext and wraps the page with provenance', async () => {
    getContext.mockResolvedValue({ url: 'https://acme.com', title: 'Acme', text: 'hi', interactiveElements: [], tables: [], provenance: { url: 'https://acme.com', distilledAt: 0 } });
    const res = await executePageTool('read_dom', {});
    expect(getContext).toHaveBeenCalledWith(7);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.meta?.provenance).toEqual(['https://acme.com']);
  });

  it('returns a structured undriveable error for a restricted URL', async () => {
    getContext.mockResolvedValue({
      undriveable: true,
      reason: 'browser-internal',
      url: 'chrome://settings',
      message: 'This is a browser-internal page; extensions cannot read or act on it.',
    });
    const res = await executePageTool('read_dom', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('undriveable');
  });

  it('click routes to Browser Control act()', async () => {
    act.mockResolvedValue({ ok: true, engine: 'scripting', note: 'clicked selector' });
    const res = await executePageTool('click', { selector: '#go' });
    expect(act).toHaveBeenCalledWith(7, { type: 'click', selector: '#go', text: undefined }, {});
    expect(res.ok).toBe(true);
  });

  it('maps an undriveable act result to an undriveable error', async () => {
    act.mockResolvedValue({ undriveable: true, reason: 'web-store', url: 'x', message: 'blocked' });
    const res = await executePageTool('navigate', { url: 'https://chromewebstore.google.com' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('undriveable');
  });

  it('screenshot calls captureVisibleTab via PageContext.screenshot', async () => {
    screenshot.mockResolvedValue({ dataUrl: 'data:image/png;base64,xx', mimeType: 'image/png', tabId: 7, capturedAt: 0 });
    const res = await executePageTool('screenshot', {});
    expect(screenshot).toHaveBeenCalledWith(7);
    expect(res.ok).toBe(true);
  });

  it('rejects an unknown / non-page tool', async () => {
    const res = await executePageTool('send_webhook', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('not-found');
  });

  it('list_tabs enumerates the open http(s) tabs with parsed host (no active tab needed)', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      tabs: {
        query: vi.fn(async () => [
          { id: 7, title: 'Acme', url: 'https://www.acme.com/pricing', active: true },
          { id: 8, title: 'Docs', url: 'https://docs.example.org/x' },
        ]),
      },
    };
    const res = await executePageTool('list_tabs', {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      const tabs = (res.data as { tabs: { tabId: number; host: string; active: boolean }[] }).tabs;
      expect(tabs).toHaveLength(2);
      expect(tabs[0]).toMatchObject({ tabId: 7, host: 'acme.com', active: true });
      expect(tabs[1]).toMatchObject({ tabId: 8, host: 'docs.example.org' });
    }
  });

  it('read_tab reads a SPECIFIC tab by id (not the active one) with provenance', async () => {
    getContext.mockResolvedValue({ url: 'https://docs.example.org/x', title: 'Docs', text: 'content', interactiveElements: [], tables: [], provenance: { url: 'https://docs.example.org/x', distilledAt: 0 } });
    const res = await executePageTool('read_tab', { tabId: 8 });
    expect(getContext).toHaveBeenCalledWith(8); // the requested tab, not active id 7
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.meta?.provenance).toEqual(['https://docs.example.org/x']);
  });

  it('read_tab rejects a missing/non-numeric tabId', async () => {
    const res = await executePageTool('read_tab', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('invalid-args');
  });

  it('errors with undriveable when there is no active tab', async () => {
    (globalThis as unknown as { chrome: { tabs: { query: () => Promise<unknown[]> } } }).chrome = {
      tabs: { query: async () => [] },
    };
    const res = await executePageTool('read_dom', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('undriveable');
  });
});
