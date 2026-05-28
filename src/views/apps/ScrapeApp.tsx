// Scrape to Table: read the active page, surface any real <table>s for one-tap
// CSV export, and let the user AI-extract arbitrary columns from unstructured
// pages. Earns its own surface (vs. chat) via the table output UI + CSV
// download — chat can't render or download a sortable/filterable grid.
//
// Reads run through the shared PageContext service (TOOL_EXEC read_dom), which
// already returns structurally-parsed tables; the AI path posts LLM_GENERATE to
// the SW (key custody preserved — the key never reaches this view).
import { useEffect, useState } from 'react';
import { AppHeader, appById } from '../AppsView';
import { Ic } from '../../ui/icons';
import type { DistilledPage, DistilledTable } from '../../page/types';
import type { LlmGenerateResponse, ErrorResponse } from '../../key/messages';
import {
  type TableData,
  tableToCsv,
  csvFilename,
  buildExtractMessages,
  parseExtractedTable,
  sortRows,
  filterRows,
} from '../../scrape/extract';

type PageState =
  | { kind: 'loading' }
  | { kind: 'ready'; tables: DistilledTable[]; text: string; title: string }
  | { kind: 'undriveable'; message: string };

async function send(msg: unknown): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return undefined;
  return chrome.runtime.sendMessage(msg);
}

export function ScrapeApp({ onBack }: { onBack: () => void }) {
  const app = appById('scrape');
  const [page, setPage] = useState<PageState>({ kind: 'loading' });
  const [table, setTable] = useState<TableData | null>(null);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ col: number; dir: 'asc' | 'desc' } | null>(null);
  const [filter, setFilter] = useState('');

  const readPage = async () => {
    setPage({ kind: 'loading' });
    setTable(null);
    setError(null);
    const r = (await send({ type: 'TOOL_EXEC', tool: 'read_dom', args: {} })) as
      | { ok: boolean; result: { ok: boolean; data?: DistilledPage; error?: { message: string } } }
      | undefined;
    if (!r || !r.ok) {
      setPage({ kind: 'undriveable', message: 'Could not read the page (extension messaging unavailable).' });
      return;
    }
    if (!r.result.ok || !r.result.data) {
      setPage({ kind: 'undriveable', message: r.result.error?.message ?? 'This page can’t be read.' });
      return;
    }
    const d = r.result.data;
    setPage({ kind: 'ready', tables: d.tables ?? [], text: d.text ?? '', title: d.title ?? '' });
  };

  useEffect(() => { void readPage(); }, []);

  const showTable = (t: TableData) => {
    setTable(t);
    setSort(null);
    setFilter('');
  };

  const pickPageTable = (t: DistilledTable) =>
    showTable({ headers: t.headers, rows: t.rows, caption: t.caption ?? `Table ${t.id}` });

  const extract = async () => {
    if (page.kind !== 'ready' || !instruction.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = (await send({
        type: 'LLM_GENERATE',
        messages: buildExtractMessages(instruction.trim(), page.text),
        params: { jsonMode: true, temperature: 0 },
      })) as LlmGenerateResponse | ErrorResponse | undefined;
      if (!res) {
        setError('No response from background.');
      } else if (res.type === 'ERROR' || res.ok !== true) {
        setError(res.type === 'ERROR' ? res.error : 'Extraction failed.');
      } else {
        const parsed = parseExtractedTable(res.result.text);
        if (!parsed || (parsed.rows.length === 0 && parsed.headers.length === 0)) {
          setError('Couldn’t find matching data on this page. Try different columns.');
        } else {
          showTable({ ...parsed, caption: instruction.trim() });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Derived view: filter, then sort. Source rows stay pristine for CSV export.
  const viewRows = table ? (sort ? sortRows(filterRows(table.rows, filter), sort.col, sort.dir) : filterRows(table.rows, filter)) : [];

  const toggleSort = (col: number) =>
    setSort((s) => (s && s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));

  const downloadCsv = () => {
    if (!table) return;
    const blob = new Blob([tableToCsv(table)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFilename(table.caption);
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyCsv = () => {
    if (table) void navigator.clipboard?.writeText(tableToCsv(table)).catch(() => {});
  };

  return (
    <div className="micro">
      <AppHeader app={app} onBack={onBack} />
      <div className="micro-body">
        {page.kind === 'loading' && <div className="empty-state-desc">Reading the page…</div>}

        {page.kind === 'undriveable' && (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.scrape}</span>
            <div className="empty-state-title">Can’t read this page</div>
            <div className="empty-state-desc">{page.message}</div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void readPage()}>Retry</button>
          </div>
        )}

        {page.kind === 'ready' && (
          <>
            {/* Tables the page already exposes — one-tap, zero LLM cost. */}
            {page.tables.length > 0 && (
              <div className="scrape-section">
                <div className="scrape-section-h">Tables on this page</div>
                <div className="scrape-chips">
                  {page.tables.map((t) => (
                    <button key={t.id} type="button" className="scrape-chip" onClick={() => pickPageTable(t)}>
                      {(t.caption ?? `Table ${t.id}`)} · {t.rows.length} row{t.rows.length === 1 ? '' : 's'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* AI extraction for unstructured pages. */}
            <div className="scrape-section">
              <div className="scrape-section-h">
                {page.tables.length > 0 ? 'Or extract specific columns' : 'Extract columns from this page'}
              </div>
              <textarea
                className="settings-input"
                style={{ resize: 'none' }}
                rows={2}
                placeholder="Columns to extract, e.g. product name, price, rating"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                aria-label="Columns to extract"
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ marginTop: 6 }}
                disabled={busy || !instruction.trim()}
                onClick={() => void extract()}
              >
                {busy ? 'Extracting…' : 'Extract to table'}
              </button>
            </div>

            {error && <div className="empty-state-desc" style={{ color: '#B91C1C' }}>{error}</div>}

            {table && (
              <div className="scrape-result">
                <div className="scrape-result-hd">
                  <span>{table.caption || 'Table'} · {table.rows.length} row{table.rows.length === 1 ? '' : 's'}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={copyCsv}>Copy</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={downloadCsv}>
                      <span className="ic ic-sm">{Ic.download}</span>CSV
                    </button>
                  </div>
                </div>
                <input
                  className="settings-input"
                  style={{ margin: '6px 0' }}
                  placeholder="Filter rows…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="Filter rows"
                />
                <div className="scrape-table-wrap">
                  <table className="scrape-table">
                    {table.headers.length > 0 && (
                      <thead>
                        <tr>
                          {table.headers.map((h, i) => (
                            <th key={i} onClick={() => toggleSort(i)} title="Sort">
                              {h}
                              {sort?.col === i ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                            </th>
                          ))}
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {viewRows.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((cell, ci) => <td key={ci}>{cell}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {viewRows.length === 0 && <div className="empty-state-desc" style={{ padding: 8 }}>No rows match the filter.</div>}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
