// Tab Manager: list every open tab (across windows), search, activate, close,
// close duplicates, pin, suspend (free memory), move to a new window, copy all
// URLs, AI-group by topic, and organize tabs into Spaces (named workspaces you
// switch between). Earns a dedicated surface via the chrome.tabs device API +
// stateful Spaces — neither is chat-coverable.
//
// v1 uses only the existing "tabs" permission (no chrome.tabGroups, which would
// grow the Web Store review footprint). Spaces persist in chrome.storage.local;
// AI grouping is rendered in our UI, not the browser tab strip. The optional
// "Group" action posts LLM_GENERATE to the SW (key custody preserved).
import { useEffect, useState } from 'react';
import { AppHeader, appById } from '../AppsView';
import { Ic } from '../../ui/icons';
import type { LlmGenerateResponse, ErrorResponse } from '../../key/messages';
import {
  type TabLite,
  type TabSession,
  type TabGroupResult,
  type UrlFormat,
  hostOf,
  filterTabs,
  groupByWindow,
  findDuplicateTabIds,
  toSession,
  formatTabUrls,
  parseTabGroups,
} from '../../tabs/manager';

// Spaces persist under the original key so existing saved sets carry over; the
// on-disk shape is unchanged (id/name/createdAt/tabs) — only the UI evolved.
const SPACES_KEY = 'tabSessions';

async function send(msg: unknown): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return undefined;
  return chrome.runtime.sendMessage(msg);
}

async function loadSpaces(): Promise<TabSession[]> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return [];
  const r = await chrome.storage.local.get(SPACES_KEY);
  return (r[SPACES_KEY] as TabSession[]) ?? [];
}

export function TabManagerApp({ onBack }: { onBack: () => void }) {
  const app = appById('tabs');
  const [tabs, setTabs] = useState<TabLite[]>([]);
  const [filter, setFilter] = useState('');
  const [spaces, setSpaces] = useState<TabSession[]>([]);
  const [spaceName, setSpaceName] = useState('');
  const [copyFmt, setCopyFmt] = useState<UrlFormat>('markdown');
  const [copied, setCopied] = useState(false);
  const [groups, setGroups] = useState<TabGroupResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
    const all = await chrome.tabs.query({});
    setTabs(
      all
        .filter((t): t is chrome.tabs.Tab & { id: number } => t.id !== undefined)
        .map((t) => ({
          id: t.id,
          title: t.title ?? t.url ?? '(untitled)',
          url: t.url ?? '',
          windowId: t.windowId,
          favIconUrl: t.favIconUrl,
          active: t.active,
          pinned: t.pinned,
          discarded: t.discarded,
        })),
    );
    setGroups(null);
  };

  useEffect(() => {
    void refresh();
    void loadSpaces().then(setSpaces);
  }, []);

  const activate = async (t: TabLite) => {
    await chrome.tabs?.update(t.id, { active: true });
    await chrome.windows?.update(t.windowId, { focused: true });
  };

  const close = async (id: number) => {
    await chrome.tabs?.remove(id);
    await refresh();
  };

  const togglePin = async (t: TabLite) => {
    await chrome.tabs?.update(t.id, { pinned: !t.pinned });
    await refresh();
  };

  const suspend = async (t: TabLite) => {
    if (t.active) { setError('Switch away from a tab before suspending it.'); return; }
    if (t.discarded) return;
    try {
      await chrome.tabs?.discard(t.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not suspend that tab.');
    }
  };

  const moveToNewWindow = async (t: TabLite) => {
    await chrome.windows?.create({ tabId: t.id });
    await refresh();
  };

  const closeDuplicates = async () => {
    const dupes = findDuplicateTabIds(tabs);
    if (dupes.length) {
      await chrome.tabs?.remove(dupes);
      await refresh();
    } else {
      setError('No duplicate tabs found.');
    }
  };

  const copyUrls = async () => {
    const text = formatTabUrls(shown, copyFmt);
    if (!text) { setError('No tabs to copy.'); return; }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Clipboard blocked — could not copy.');
    }
  };

  const saveSpace = async () => {
    const name = spaceName.trim() || `Space ${spaces.length + 1}`;
    // Date.now is fine here (app runtime, not a workflow script).
    const space = toSession(`space_${Date.now()}`, name, Date.now(), tabs);
    const next = [space, ...spaces];
    await chrome.storage?.local?.set({ [SPACES_KEY]: next });
    setSpaces(next);
    setSpaceName('');
  };

  // Open a space's tabs in the current window (additive).
  const openSpace = async (s: TabSession) => {
    for (const t of s.tabs) {
      if (t.url && /^https?:/.test(t.url)) await chrome.tabs?.create({ url: t.url, active: false });
    }
    await refresh();
  };

  // Switch to a space: open all its tabs in a fresh window.
  const openSpaceInNewWindow = async (s: TabSession) => {
    const urls = s.tabs.map((t) => t.url).filter((u) => u && /^https?:/.test(u));
    if (!urls.length) { setError('This Space has no openable tabs.'); return; }
    await chrome.windows?.create({ url: urls });
    await refresh();
  };

  // Re-snapshot the current tabs into an existing space (keeps id + name).
  const updateSpace = async (s: TabSession) => {
    const updated = toSession(s.id, s.name, s.createdAt, tabs);
    const next = spaces.map((x) => (x.id === s.id ? updated : x));
    await chrome.storage?.local?.set({ [SPACES_KEY]: next });
    setSpaces(next);
  };

  const deleteSpace = async (id: string) => {
    const next = spaces.filter((s) => s.id !== id);
    await chrome.storage?.local?.set({ [SPACES_KEY]: next });
    setSpaces(next);
  };

  const groupByTopic = async () => {
    setBusy(true);
    setError(null);
    try {
      const list = tabs.map((t, i) => `${i}: ${t.title} (${hostOf(t.url)})`).join('\n');
      const res = (await send({
        type: 'LLM_GENERATE',
        messages: [
          { role: 'system', content: 'You organize browser tabs into 2-6 topical groups. Reply ONLY with JSON {"groups":[{"name":"short label","tabIndices":[…]}]} using the given indices. Every tab should appear in exactly one group.' },
          { role: 'user', content: `Tabs:\n${list}` },
        ],
        params: { jsonMode: true, temperature: 0.2 },
      })) as LlmGenerateResponse | ErrorResponse | undefined;
      if (!res) setError('No response from background.');
      else if (res.type === 'ERROR' || res.ok !== true) setError(res.type === 'ERROR' ? res.error : 'Grouping failed.');
      else {
        const parsed = parseTabGroups(res.result.text, tabs.length);
        if (parsed.length) setGroups(parsed);
        else setError('Couldn’t group these tabs.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = filterTabs(tabs, filter);
  const windows = groupByWindow(shown);

  const TabRow = ({ t }: { t: TabLite }) => (
    <div className={'tab-row' + (t.active ? ' is-active' : '') + (t.discarded ? ' is-suspended' : '')}>
      <button type="button" className="tab-row-main" onClick={() => void activate(t)} title={t.url}>
        {t.favIconUrl ? <img className="tab-fav" src={t.favIconUrl} alt="" /> : <span className="tab-fav tab-fav-empty" />}
        <span className="tab-row-text">
          <span className="tab-row-title">{t.title}</span>
          <span className="tab-row-host">{hostOf(t.url) || t.url}</span>
        </span>
      </button>
      <div className="tab-row-actions">
        <button type="button" className={'tab-row-act' + (t.pinned ? ' is-on' : '')} aria-label={t.pinned ? `Unpin ${t.title}` : `Pin ${t.title}`} title={t.pinned ? 'Unpin' : 'Pin'} onClick={() => void togglePin(t)}><span className="ic ic-sm">{Ic.pin}</span></button>
        <button type="button" className="tab-row-act" aria-label={`Suspend ${t.title}`} title="Suspend (free memory)" disabled={t.active || t.discarded} onClick={() => void suspend(t)}><span className="ic ic-sm">{Ic.suspend}</span></button>
        <button type="button" className="tab-row-act" aria-label={`Move ${t.title} to a new window`} title="Move to new window" onClick={() => void moveToNewWindow(t)}><span className="ic ic-sm">{Ic.popout}</span></button>
        <button type="button" className="tab-row-close" aria-label={`Close ${t.title}`} onClick={() => void close(t.id)}>✕</button>
      </div>
    </div>
  );

  return (
    <div className="micro" data-testid="tab-manager-app">
      <AppHeader app={app} onBack={onBack} />
      <div className="micro-body">
        <div className="tab-toolbar">
          <input
            className="settings-input"
            placeholder="Search tabs…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Search tabs"
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh()} aria-label="Refresh tabs">Refresh</button>
        </div>
        <div className="tab-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void closeDuplicates()}>Close duplicates</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy || tabs.length === 0} onClick={() => void groupByTopic()}>{busy ? 'Grouping…' : 'Group by topic'}</button>
          <span className="tab-copy">
            <select className="tab-copy-fmt" value={copyFmt} onChange={(e) => setCopyFmt(e.target.value as UrlFormat)} aria-label="Copy format">
              <option value="markdown">Markdown</option>
              <option value="text">Plain</option>
              <option value="json">JSON</option>
            </select>
            <button type="button" className="btn btn-ghost btn-sm" disabled={shown.length === 0} onClick={() => void copyUrls()}><span className="ic ic-sm">{Ic.copy}</span> {copied ? 'Copied' : 'Copy URLs'}</button>
          </span>
          <span className="tab-count">{tabs.length} tab{tabs.length === 1 ? '' : 's'}</span>
        </div>

        {error && <div className="empty-state-desc" style={{ color: '#B91C1C' }}>{error}</div>}

        <div className="tab-save">
          <input
            className="settings-input"
            placeholder="Save these tabs as a Space…"
            value={spaceName}
            onChange={(e) => setSpaceName(e.target.value)}
            aria-label="Space name"
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={tabs.length === 0} onClick={() => void saveSpace()}>Save</button>
        </div>

        {spaces.length > 0 && (
          <div className="scrape-section">
            <div className="scrape-section-h">Spaces</div>
            {spaces.map((s) => (
              <div key={s.id} className="tab-space-row">
                <span className="tab-space-name">{s.name} · {s.tabs.length} tab{s.tabs.length === 1 ? '' : 's'}</span>
                <button type="button" className="btn btn-ghost btn-sm" title="Open these tabs in the current window" onClick={() => void openSpace(s)}>Open</button>
                <button type="button" className="tab-row-act" aria-label={`Open ${s.name} in a new window`} title="Open in new window" onClick={() => void openSpaceInNewWindow(s)}><span className="ic ic-sm">{Ic.popout}</span></button>
                <button type="button" className="tab-row-act" aria-label={`Update ${s.name} with current tabs`} title="Update with current tabs" onClick={() => void updateSpace(s)}><span className="ic ic-sm">{Ic.copy}</span></button>
                <button type="button" className="tab-row-close" aria-label={`Delete ${s.name}`} onClick={() => void deleteSpace(s.id)}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Either AI-grouped view or per-window listing. */}
        {groups ? (
          <div className="scrape-section">
            <div className="scrape-section-h">By topic <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGroups(null)}>Clear</button></div>
            {groups.map((g, gi) => (
              <div key={gi} className="tab-group">
                <div className="tab-group-h">{g.name} · {g.tabIndices.length}</div>
                {g.tabIndices.map((i) => tabs[i] && <TabRow key={tabs[i].id} t={tabs[i]} />)}
              </div>
            ))}
          </div>
        ) : (
          windows.map((w, wi) => (
            <div key={w.windowId} className="scrape-section">
              {windows.length > 1 && <div className="scrape-section-h">Window {wi + 1}</div>}
              {w.tabs.map((t) => <TabRow key={t.id} t={t} />)}
            </div>
          ))
        )}

        {tabs.length === 0 && <div className="empty-state-desc">No open tabs to manage.</div>}
      </div>
    </div>
  );
}
