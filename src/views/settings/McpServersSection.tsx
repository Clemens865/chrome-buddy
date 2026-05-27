// Settings → MCP Servers section. Add / list / test / delete + Phase 2
// routing controls (per-server enable toggle + per-tool include checkboxes
// + per-tool 'Always trust' toggle). Keys never enter React state beyond
// the momentary "Add" form; on Save we hand them to chrome.storage.session
// via the SW-side keys module.
import { useEffect, useState } from 'react';
import {
  listServers,
  saveServer,
  deleteServer,
  setServerEnabled,
  setToolEnabled,
  setToolTrust,
  hostOf,
  isAllowedUrl,
  type AuthKind,
  type McpServer,
} from '../../mcp/store';
import { setKey, clearKey } from '../../mcp/keys';
import type { McpTestResponse } from '../../key/messages';

export function McpServersSection() {
  const [items, setItems] = useState<McpServer[]>([]);
  const [adding, setAdding] = useState(false);

  const refresh = async () => setItems(await listServers());
  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="mcp-editor" data-testid="mcp-editor">
      {items.length === 0 && !adding && (
        <div className="mcp-empty">
          No servers yet. Add an MCP-compatible HTTP endpoint to expose its tools
          to the agent.
        </div>
      )}
      {items.map((srv) => (
        <McpRow key={srv.id} server={srv} onChanged={refresh} />
      ))}
      {adding ? (
        <AddForm
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      ) : (
        <button
          className="btn-ghost mcp-add-btn"
          onClick={() => setAdding(true)}
          data-testid="mcp-add-toggle"
        >
          + Add MCP server
        </button>
      )}
    </div>
  );
}

// ----- Row ----------------------------------------------------------------

function McpRow({ server, onChanged }: { server: McpServer; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [resultLine, setResultLine] = useState<string | undefined>(server.lastTestMessage);
  const [resultKind, setResultKind] = useState<'ok' | 'err' | 'idle'>(
    server.lastTestStatus === 'ok' ? 'ok' : server.lastTestStatus === 'error' ? 'err' : 'idle',
  );
  const [showTools, setShowTools] = useState(false);

  const test = async () => {
    setBusy(true);
    setResultKind('idle');
    setResultLine('Connecting…');
    try {
      const r = (await chrome.runtime.sendMessage({
        type: 'MCP_TEST',
        serverId: server.id,
      })) as McpTestResponse | undefined;
      if (!r) {
        setResultKind('err');
        setResultLine('No response from background.');
      } else if (!r.ok) {
        setResultKind('err');
        setResultLine(r.error);
      } else {
        setResultKind('ok');
        setResultLine(`${r.serverName} ${r.serverVersion} · ${r.toolCount} tool${r.toolCount === 1 ? '' : 's'}`);
      }
    } catch (e) {
      setResultKind('err');
      setResultLine(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await onChanged();
    }
  };

  const del = async () => {
    if (!confirm(`Delete server "${server.name}"?`)) return;
    await deleteServer(server.id);
    await onChanged();
  };

  const enabled = !!server.enabledInAgent;
  const toolEnabled = (name: string) => server.toolFilter?.[name] !== false;
  const isTrusted = (name: string) => server.trust?.[name] === 'always';
  const enabledCount = (server.tools ?? []).filter((t) => toolEnabled(t.name)).length;

  return (
    <div className={`mcp-row ${enabled ? 'is-enabled' : ''}`} data-testid={`mcp-row-${server.name}`}>
      <div className="mcp-row-l">
        <div className="mcp-row-head">
          <div className="mcp-row-name">{server.name}</div>
          <label className="mcp-enable" data-testid={`mcp-enable-${server.name}`}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={async (e) => {
                await setServerEnabled(server.id, e.target.checked);
                await onChanged();
              }}
            />
            <span>Enable in agent</span>
          </label>
        </div>
        <div className="mcp-row-meta">
          {hostOf(server.url)} · {server.authKind === 'bearer' ? 'bearer key' : 'no auth'}
          {server.tools && server.tools.length > 0 && (
            <>
              {' · '}
              {enabled
                ? `${enabledCount}/${server.tools.length} tools exposed`
                : `${server.tools.length} tools (off)`}
            </>
          )}
        </div>
        {resultLine && (
          <div className={`mcp-row-result is-${resultKind}`} data-testid={`mcp-row-result-${server.name}`}>
            {resultKind === 'ok' ? '✓ ' : resultKind === 'err' ? '✗ ' : ''}
            {resultLine}
          </div>
        )}
        {server.tools && server.tools.length > 0 && (
          <button
            className="mcp-tools-toggle"
            onClick={() => setShowTools((s) => !s)}
            data-testid={`mcp-tools-toggle-${server.name}`}
          >
            {showTools ? 'Hide' : 'Manage'} {server.tools.length} tool{server.tools.length === 1 ? '' : 's'}
          </button>
        )}
        {showTools && server.tools && (
          <ul className="mcp-tools-list">
            {server.tools.map((t) => (
              <li key={t.name} className="mcp-tool-item" data-testid={`mcp-tool-item-${t.name}`}>
                <label className="mcp-tool-row">
                  <input
                    type="checkbox"
                    checked={toolEnabled(t.name)}
                    disabled={!enabled}
                    onChange={async (e) => {
                      await setToolEnabled(server.id, t.name, e.target.checked);
                      await onChanged();
                    }}
                    data-testid={`mcp-tool-toggle-${t.name}`}
                  />
                  <div className="mcp-tool-text">
                    <code>{t.name}</code>
                    {t.description && <span className="mcp-tool-desc"> — {t.description}</span>}
                  </div>
                </label>
                {enabled && toolEnabled(t.name) && (
                  <label className="mcp-tool-trust" title="Skip HITL confirm for this tool">
                    <input
                      type="checkbox"
                      checked={isTrusted(t.name)}
                      onChange={async (e) => {
                        await setToolTrust(server.id, t.name, e.target.checked ? 'always' : 'confirm');
                        await onChanged();
                      }}
                      data-testid={`mcp-tool-trust-${t.name}`}
                    />
                    <span>Trust</span>
                  </label>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mcp-row-actions">
        <button
          className="btn-ghost"
          onClick={test}
          disabled={busy}
          data-testid={`mcp-row-test-${server.name}`}
        >
          {busy ? 'Testing…' : 'Test'}
        </button>
        <button className="btn-ghost" onClick={del} disabled={busy} aria-label={`Delete ${server.name}`}>
          ✕
        </button>
      </div>
    </div>
  );
}

// ----- Add form -----------------------------------------------------------

function AddForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authKind, setAuthKind] = useState<AuthKind>('bearer');
  const [token, setToken] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const urlOk = url.trim().length > 0 && isAllowedUrl(url.trim());
  const tokenNeeded = authKind === 'bearer';
  const tokenOk = !tokenNeeded || token.trim().length > 0;
  const canSave = name.trim().length > 0 && urlOk && tokenOk && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(undefined);
    try {
      const srv = await saveServer({ name, url, authKind, note });
      if (authKind === 'bearer') {
        await setKey(srv.id, token.trim());
      } else {
        await clearKey(srv.id);
      }
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mcp-add" data-testid="mcp-add-form">
      <label className="mcp-field">
        <span className="mcp-field-l">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="GitHub (Composio)"
          data-testid="mcp-name"
        />
      </label>
      <label className="mcp-field">
        <span className="mcp-field-l">Endpoint URL</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://mcp.example.com/sse"
          data-testid="mcp-url"
        />
        {url && !urlOk && (
          <span className="mcp-field-err">
            Must be https:// (http allowed for localhost only).
          </span>
        )}
      </label>
      <div className="mcp-field">
        <span className="mcp-field-l">Auth</span>
        <div className="mcp-radios">
          <label className="mcp-radio">
            <input
              type="radio"
              checked={authKind === 'bearer'}
              onChange={() => setAuthKind('bearer')}
              data-testid="mcp-auth-bearer"
            />
            <span>Bearer / API key</span>
          </label>
          <label className="mcp-radio">
            <input
              type="radio"
              checked={authKind === 'none'}
              onChange={() => setAuthKind('none')}
              data-testid="mcp-auth-none"
            />
            <span>None (public / dev server)</span>
          </label>
        </div>
      </div>
      {authKind === 'bearer' && (
        <label className="mcp-field">
          <span className="mcp-field-l">Bearer token</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="paste your API key"
            data-testid="mcp-token"
            autoComplete="off"
          />
          <span className="mcp-field-hint">
            Stored only in <code>chrome.storage.session</code>. Cleared on browser
            restart. Never sent to the model.
          </span>
        </label>
      )}
      <label className="mcp-field">
        <span className="mcp-field-l">Note (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. read-only token, expires 2026-08"
          data-testid="mcp-note"
        />
      </label>
      {error && <div className="mcp-field-err">{error}</div>}
      <div className="mcp-add-actions">
        <button className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={save}
          disabled={!canSave}
          data-testid="mcp-save"
        >
          {busy ? 'Saving…' : 'Save server'}
        </button>
      </div>
    </div>
  );
}

