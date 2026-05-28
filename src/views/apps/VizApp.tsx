// Data Visualizer: paste CSV/JSON (or pull a table off the current page) and
// render REAL charts in-panel. Unlike emitting matplotlib code or a text
// description (chat already does that), this draws bar / line / pie charts as
// hand-rolled SVG — dependency-free, so it respects the MV3 no-remote-code
// bright line. An optional "Explain" runs the data through the SW LLM for
// insight bullets (key custody preserved).
import { useState } from 'react';
import { AppHeader, appById } from '../AppsView';
import { Ic } from '../../ui/icons';
import { Markdown } from '../../ui/Markdown';
import type { DistilledPage, DistilledTable } from '../../page/types';
import type { LlmGenerateResponse, ErrorResponse } from '../../key/messages';
import {
  type TableData,
  type ChartType,
  parseData,
  numericColumns,
  promoteHeaders,
  buildModel,
  barLayout,
  lineLayout,
  pieLayout,
  color,
} from '../../viz/chart';

/** A page table offered as a chip: a label + the data + how many numeric columns it has. */
interface PageTableOption {
  label: string;
  table: TableData;
  numericCount: number;
}

/** Human label for a page table: caption, else its (promoted) first header, else "Table N". */
function tableLabel(t: DistilledTable, promoted: TableData, index: number): string {
  const head = promoted.headers.find((h) => h.trim()) ?? promoted.rows[0]?.find((c) => c.trim());
  return (t.caption?.trim() || head || `Table ${index + 1}`).slice(0, 40);
}

const W = 360;
const H = 190;

async function send(msg: unknown): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return undefined;
  return chrome.runtime.sendMessage(msg);
}

export function VizApp({ onBack }: { onBack: () => void }) {
  const app = appById('viz');
  const [raw, setRaw] = useState('');
  const [table, setTable] = useState<TableData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labelCol, setLabelCol] = useState(0);
  const [valueCols, setValueCols] = useState<number[]>([]);
  const [type, setType] = useState<ChartType>('bar');
  const [insights, setInsights] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Tables found on the page, ranked numeric-first, shown as pickable chips.
  const [pageTables, setPageTables] = useState<PageTableOption[] | null>(null);
  const [activeTable, setActiveTable] = useState<TableData | null>(null);

  const ingest = (t: TableData) => {
    const nums = numericColumns(t);
    if (nums.length === 0) {
      setError('No numeric columns found — a chart needs at least one number column.');
      setTable(null);
      return;
    }
    // Label = first non-numeric column when present, else the first column.
    const label = t.headers.findIndex((_, i) => !nums.includes(i));
    setTable(t);
    setLabelCol(label >= 0 ? label : 0);
    setValueCols(nums.slice(0, 4));
    setType('bar');
    setInsights(null);
    setError(null);
  };

  const visualize = () => {
    const parsed = parseData(raw);
    if (!parsed || parsed.headers.length === 0) {
      setError('Couldn’t parse that. Paste CSV (with a header row) or JSON.');
      setTable(null);
      return;
    }
    setPageTables(null); // pasted data supersedes any page-table picker
    setActiveTable(null);
    ingest(parsed);
  };

  const readPageTable = async () => {
    setError(null);
    const r = (await send({ type: 'TOOL_EXEC', tool: 'read_dom', args: {} })) as
      | { ok: boolean; result: { ok: boolean; data?: DistilledPage; error?: { message: string } } }
      | undefined;
    const tables = r?.ok && r.result.ok ? r.result.data?.tables ?? [] : [];
    if (tables.length === 0) {
      setPageTables(null);
      setError(r?.result?.error?.message ?? 'No tables found on the current page.');
      return;
    }
    // Pages mix data tables with layout/download/nav tables, and many tables
    // arrive without a marked header row (the header text lands in the body).
    // promoteHeaders fixes that; then we rank numeric-first and surface ALL of
    // them as chips so the user picks — rather than us guessing (the old "most
    // rows" pick grabbed nav tables).
    const options: PageTableOption[] = tables
      .map((t, i) => {
        const table = promoteHeaders({ headers: t.headers, rows: t.rows });
        return { table, label: tableLabel(t, table, i), numericCount: numericColumns(table).length };
      })
      .sort((a, b) => b.numericCount - a.numericCount || b.table.rows.length - a.table.rows.length);
    setPageTables(options);
    const best = options[0];
    if (best && best.numericCount > 0) {
      pickTable(best.table);
    } else {
      setTable(null);
      setActiveTable(null);
      setError(`Found ${options.length} table${options.length === 1 ? '' : 's'} but none has a numeric column — pick one to inspect.`);
    }
  };

  const pickTable = (t: TableData) => {
    setActiveTable(t);
    ingest(t);
  };

  const toggleValue = (c: number) =>
    setValueCols((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c].sort((a, b) => a - b)));

  const explain = async () => {
    if (!model) return;
    setBusy(true);
    setInsights(null);
    try {
      const summary = model.labels
        .map((l, i) => `${l}: ${model.series.map((s) => `${s.name}=${s.values[i]}`).join(', ')}`)
        .join('\n');
      const res = (await send({
        type: 'LLM_GENERATE',
        messages: [
          { role: 'system', content: 'You are a data analyst. Given a small dataset, reply with 3-5 concise insight bullet points. No preamble.' },
          { role: 'user', content: `Dataset:\n${summary}` },
        ],
        params: { temperature: 0.3 },
      })) as LlmGenerateResponse | ErrorResponse | undefined;
      if (!res) setError('No response from background.');
      else if (res.type === 'ERROR' || res.ok !== true) setError(res.type === 'ERROR' ? res.error : 'Analysis failed.');
      else setInsights(res.result.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const model = table && valueCols.length ? buildModel(table, labelCol, valueCols) : null;

  const downloadSvg = () => {
    const svg = document.getElementById('viz-svg');
    if (!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chart.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  const numCols = table ? numericColumns(table) : [];

  return (
    <div className="micro">
      <AppHeader app={app} onBack={onBack} />
      <div className="micro-body">
        <div className="scrape-section">
          <div className="scrape-section-h">Data</div>
          <textarea
            className="settings-input"
            style={{ resize: 'none', fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11.5 }}
            rows={4}
            placeholder={'Paste CSV or JSON, e.g.\nmonth,sales\nJan,120\nFeb,180'}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            aria-label="Data input"
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={!raw.trim()} onClick={visualize}>Visualize</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void readPageTable()}>Use page table</button>
          </div>
        </div>

        {pageTables && pageTables.length > 0 && (
          <div className="scrape-section">
            <div className="scrape-section-h">
              {pageTables.length === 1 ? 'Table on this page' : `${pageTables.length} tables on this page — pick one`}
            </div>
            <div className="scrape-chips" data-testid="viz-page-tables">
              {pageTables.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  className={'scrape-chip' + (activeTable === opt.table ? ' is-on' : '')}
                  aria-pressed={activeTable === opt.table}
                  disabled={opt.numericCount === 0}
                  title={opt.numericCount === 0 ? 'No numeric columns — can’t chart this one' : ''}
                  onClick={() => pickTable(opt.table)}
                >
                  {opt.label} · {opt.table.rows.length}r · {opt.numericCount} num
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <div className="empty-state-desc" style={{ color: '#B91C1C' }}>{error}</div>}

        {table && (
          <>
            <div className="scrape-section">
              <div className="viz-controls">
                <div className="seg" role="group" aria-label="Chart type">
                  {(['bar', 'line', 'pie'] as ChartType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={'seg-btn' + (type === t ? ' is-on' : '')}
                      aria-pressed={type === t}
                      onClick={() => setType(t)}
                    >
                      {t[0].toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
                <label className="viz-field">
                  Label
                  <select className="settings-input" style={{ maxWidth: 120 }} value={labelCol} aria-label="Label column" onChange={(e) => setLabelCol(Number(e.target.value))}>
                    {table.headers.map((h, i) => <option key={i} value={i}>{h || `col ${i + 1}`}</option>)}
                  </select>
                </label>
              </div>
              <div className="scrape-section-h" style={{ marginTop: 8 }}>Values</div>
              <div className="scrape-chips">
                {numCols.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={'scrape-chip' + (valueCols.includes(c) ? ' is-on' : '')}
                    aria-pressed={valueCols.includes(c)}
                    onClick={() => toggleValue(c)}
                  >
                    {table.headers[c] || `col ${c + 1}`}
                  </button>
                ))}
              </div>
            </div>

            {model && (
              <div className="scrape-result">
                <div className="scrape-result-hd">
                  <span>{type[0].toUpperCase() + type.slice(1)} chart · {model.labels.length} point{model.labels.length === 1 ? '' : 's'}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void explain()}>{busy ? 'Analyzing…' : 'Explain'}</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={downloadSvg}><span className="ic ic-sm">{Ic.download}</span>SVG</button>
                  </div>
                </div>
                <Chart model={model} type={type} />
                <div className="viz-legend">
                  {(type === 'pie' ? model.labels : model.series.map((s) => s.name)).map((name, i) => (
                    <span key={i} className="viz-legend-item">
                      <span className="viz-swatch" style={{ background: color(i) }} />{name || `#${i + 1}`}
                    </span>
                  ))}
                </div>
                {insights && <div className="msg-body" style={{ marginTop: 10 }}><Markdown>{insights}</Markdown></div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Chart({ model, type }: { model: { labels: string[]; series: { name: string; values: number[] }[] }; type: ChartType }) {
  if (type === 'pie') {
    const slices = pieLayout(model, W / 2, H / 2, Math.min(W, H) / 2 - 10);
    return (
      <svg id="viz-svg" className="viz-svg" viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Pie chart">
        {slices.map((s) => <path key={s.index} d={s.d} fill={color(s.index)} stroke="var(--panel-bg)" strokeWidth="1" />)}
      </svg>
    );
  }
  if (type === 'line') {
    const { points, max } = lineLayout(model, W, H);
    return (
      <svg id="viz-svg" className="viz-svg" viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Line chart">
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--panel-border)" />
        <text x="2" y="10" className="viz-axis">{max}</text>
        {points.map((p, i) => <polyline key={i} points={p} fill="none" stroke={color(i)} strokeWidth="2" strokeLinejoin="round" />)}
      </svg>
    );
  }
  const { bars, max } = barLayout(model, W, H);
  return (
    <svg id="viz-svg" className="viz-svg" viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bar chart">
      <line x1="0" y1={H} x2={W} y2={H} stroke="var(--panel-border)" />
      <text x="2" y="10" className="viz-axis">{max}</text>
      {bars.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={color(b.series)} rx="1" />)}
    </svg>
  );
}
