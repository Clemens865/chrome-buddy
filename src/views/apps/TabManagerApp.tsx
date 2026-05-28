// Tab Manager: list every open tab (across windows), search, activate, close,
// close duplicates, save/restore sessions, and AI-group by topic. Earns a
// dedicated surface via the chrome.tabs device API + stateful sessions —
// neither is chat-coverable.
//
// v1 uses only the existing "tabs" permission (no chrome.tabGroups, which would
// grow the Web Store review footprint). Sessions persist in chrome.storage.local;
// AI grouping is rendered in our UI, not the browser tab strip. The optional
// "Group" action posts LLM_GENERATE to the SW (key custody preserved).
import { useEffect, useState } from 'react';
import { AppHeader, appById } from '../AppsView';
import type { LlmGenerateResponse, ErrorResponse } from '../../key/messages';
import {
  type TabLite,
  type TabSession,
  type TabGroupResult,
  hostOf,
  filterTabs,
  groupByWindow,
  findDuplicateTabIds,
  toSession,
  parseTabGroups,
} from '../../tabs/manager';

const SESSIONS_KEY = 'tabSessions';

async function send(msg: unknown): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return undefined;
  return chrome.runtime.sendMessage(msg);
}

async function loadSessions(): Promise<TabSession[]> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return [];
  const r = await chrome.storage.local.get(SESSIONS_KEY);
  return (r[SESSIONS_KEY] as TabSession[]) ?? [];
}

export function TabManagerApp({ onBack }: { onBack: () => void }) {
  const app = appById('tabs');
  const [tabs, setTabs] = useState<TabLite[]>([]);
  const [filter, setFilter] = useState('');
  const [sessions, setSessions] = useState<TabSession[]>([]);
  const [sessionName, setSessionName] = useState('');
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
        })),
    );
    setGroups(null);
  };

  useEffect(() => {
    void refresh();
    void loadSessions().then(setSessions);
  }, []);

  const activate = async (t: TabLite) => {
    await chrome.tabs?.update(t.id, { active: true });
    await chrome.windows?.update(t.windowId, { focused: true });
  };

  const close = async (id: number) => {
    await chrome.tabs?.remove(id);
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

  const saveSession = async () => {
    const name = sessionName.trim() || `Session ${sessions.length + 1}`;
    // Date.now is fine here (app runtime, not a workflow script).
    const session = toSession(`sess_${Date.now()}`, name, Date.now(), tabs);
    const next = [session, ...sessions];
    await chrome.storage?.local?.set({ [SESSIONS_KEY]: next });
    setSessions(next);
    setSessionName('');
  };

  const restoreSession = async (s: TabSession) => {
    for (const t of s.tabs) {
      if (t.url && /^https?:/.test(t.url)) await chrome.tabs?.create({ url: t.url, active: false });
    }
    await refresh();
  };

  const deleteSession = async (id: string) => {
    const next = sessions.filter((s) => s.id !== id);
    await chrome.storage?.local?.set({ [SESSIONS_KEY]: next });
    setSessions(next);
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
    <div className={'tab-row' + (t.active ? ' is-active' : '')}>
      <button type="button" className="tab-row-main" onClick={() => void activate(t)} title={t.url}>
        {t.favIconUrl ? <img className="tab-fav" src={t.favIconUrl} alt="" /> : <span className="tab-fav tab-fav-empty" />}
        <span className="tab-row-text">
          <span className="tab-row-title">{t.title}</span>
          <span className="tab-row-host">{hostOf(t.url) || t.url}</span>
        </span>
      </button>
      <button type="button" className="tab-row-close" aria-label={`Close ${t.title}`} onClick={() => void close(t.id)}>✕</button>
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
          <span className="tab-count">{tabs.length} tab{tabs.length === 1 ? '' : 's'}</span>
        </div>

        {error && <div className="empty-state-desc" style={{ color: '#B91C1C' }}>{error}</div>}

        <div className="tab-save">
          <input
            className="settings-input"
            placeholder="Save these tabs as a session…"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            aria-label="Session name"
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={tabs.length === 0} onClick={() => void saveSession()}>Save</button>
        </div>

        {sessions.length > 0 && (
          <div className="scrape-section">
            <div className="scrape-section-h">Saved sessions</div>
            {sessions.map((s) => (
              <div key={s.id} className="tab-session-row">
                <span className="tab-session-name">{s.name} · {s.tabs.length} tab{s.tabs.length === 1 ? '' : 's'}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void restoreSession(s)}>Restore</button>
                <button type="button" className="tab-row-close" aria-label={`Delete ${s.name}`} onClick={() => void deleteSession(s.id)}>✕</button>
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
