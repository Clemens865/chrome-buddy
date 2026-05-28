// Data Visualizer helpers (pure, testable). Unlike a "describe the chart in
// text / emit matplotlib code" approach (which chat already covers), Chrome
// Buddy renders REAL charts in-panel. MV3 forbids remote code, so there is no
// charting dependency: these functions turn tabular data into plain SVG
// geometry (bar rects, line points, pie slices) that the React app draws.
//
// Input parsing is tolerant: CSV (quoted fields, CRLF) or JSON (array-of-objects
// or {headers, rows}). Everything here is side-effect-free.

export interface TableData {
  headers: string[];
  rows: string[][];
}

// ---- input parsing --------------------------------------------------------

/** Parse CSV text (RFC-4180-ish: quoted fields, "" escapes, CR/LF rows). */
export function parseCsv(text: string): TableData {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // swallow; the \n (if any) triggers the row.
      if (text[i + 1] !== '\n') pushRow();
    } else field += c;
  }
  // Trailing field/row (no final newline).
  if (field.length > 0 || row.length > 0) pushRow();

  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const [headers, ...body] = nonEmpty;
  return { headers, rows: body };
}

/** Parse a JSON string into TableData (array-of-objects or {headers, rows}). */
export function parseJsonTable(text: string): TableData | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (Array.isArray(parsed) && parsed.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    const objs = parsed as Record<string, unknown>[];
    const headers: string[] = [];
    for (const o of objs) for (const k of Object.keys(o)) if (!headers.includes(k)) headers.push(k);
    const rows = objs.map((o) => headers.map((h) => cell(o[h])));
    return { headers, rows };
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.headers) && Array.isArray(obj.rows)) {
      return {
        headers: obj.headers.map(String),
        rows: (obj.rows as unknown[]).filter(Array.isArray).map((r) => (r as unknown[]).map(cell)),
      };
    }
  }
  return null;
}

/** Auto-detect CSV vs JSON and parse. Returns null when nothing usable. */
export function parseData(text: string): TableData | null {
  const t = text.trim();
  if (!t) return null;
  if (t[0] === '[' || t[0] === '{') {
    const j = parseJsonTable(t);
    if (j) return j;
  }
  const csv = parseCsv(t);
  return csv.headers.length ? csv : null;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Parse a cell into a number, tolerating $, %, thousands separators. NaN if not numeric. */
export function toNumber(s: string): number {
  if (s == null) return NaN;
  const cleaned = s.replace(/[$£€%,\s]/g, '');
  if (cleaned === '') return NaN;
  return Number(cleaned);
}

/**
 * Rank candidate page tables for charting: most numeric columns first, then
 * most rows. A page often has layout/nav tables alongside the data table —
 * picking purely by row count grabs the wrong one, so numeric density leads.
 */
export function rankTables(tables: TableData[]): { table: TableData; numericCount: number }[] {
  return tables
    .map((table) => ({ table, numericCount: numericColumns(table).length }))
    .sort((a, b) => b.numericCount - a.numericCount || b.table.rows.length - a.table.rows.length);
}

/**
 * Some pages (and our DOM distiller) don't mark a header row — the header text
 * ends up as the first data row, which poisons numeric detection. When a table
 * has no headers, lift the first all-text row out as the headers (provided a
 * later row actually has numbers); otherwise synthesize "Column N" labels.
 */
export function promoteHeaders(table: TableData): TableData {
  if (table.headers.some((h) => h.trim() !== '')) return table;
  const isNum = (c: string) => c.trim() !== '' && !Number.isNaN(toNumber(c));
  const hasNumericRow = table.rows.some((r) => r.some(isNum));
  if (hasNumericRow) {
    const hi = table.rows.findIndex((r) => r.some((c) => c.trim() !== '') && !r.some(isNum));
    if (hi >= 0) {
      return { headers: table.rows[hi], rows: table.rows.filter((_, i) => i !== hi) };
    }
  }
  const n = table.rows.reduce((m, r) => Math.max(m, r.length), 0);
  return { headers: Array.from({ length: n }, (_, i) => `Column ${i + 1}`), rows: table.rows };
}

/**
 * Indices of columns that are mostly numeric. Tolerant of a minority of
 * non-numeric cells (a stray header, a "total"/footnote row, an "n/a") so a
 * single odd cell doesn't disqualify an otherwise-numeric column.
 */
export function numericColumns(table: TableData): number[] {
  const out: number[] = [];
  const cols = table.headers.length || table.rows.reduce((m, r) => Math.max(m, r.length), 0);
  for (let c = 0; c < cols; c++) {
    let seen = 0;
    let numeric = 0;
    for (const r of table.rows) {
      const v = r[c] ?? '';
      if (v.trim() === '') continue;
      seen++;
      if (!Number.isNaN(toNumber(v))) numeric++;
    }
    if (seen > 0 && numeric >= 1 && numeric / seen >= 0.6) out.push(c);
  }
  return out;
}

/**
 * Choose a sensible default set of value columns to chart. Charting columns of
 * wildly different magnitude together (e.g. absolute counts ~1e6 alongside
 * percentages ~1e0) makes the small series invisible. So we anchor on the FIRST
 * numeric column (the leftmost metric, usually primary) and keep only columns
 * within ~1.5 orders of magnitude of it; the rest stay available as toggles.
 * Capped at 4. Returns the original list when there's 0-1 numeric column.
 */
export function defaultValueCols(table: TableData, numericCols: number[]): number[] {
  if (numericCols.length <= 1) return numericCols.slice();
  const logMag = (c: number): number => {
    const vals = table.rows
      .map((r) => Math.abs(toNumber(r[c] ?? '')))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (!vals.length) return 0;
    vals.sort((a, b) => a - b);
    return Math.log10(vals[Math.floor(vals.length / 2)]); // median magnitude
  };
  const anchor = logMag(numericCols[0]);
  const group = numericCols.filter((c) => Math.abs(logMag(c) - anchor) <= 1.5);
  return (group.length ? group : numericCols).slice(0, 4);
}

// ---- chart model + geometry ----------------------------------------------

export type ChartType = 'bar' | 'line' | 'pie';

export interface Series {
  name: string;
  values: number[];
}
export interface ChartModel {
  labels: string[];
  series: Series[];
}

/** Build a chart model from a table: one label column + one or more value cols. */
export function buildModel(table: TableData, labelCol: number, valueCols: number[]): ChartModel {
  const labels = table.rows.map((r) => r[labelCol] ?? '');
  const series = valueCols.map((c) => ({
    name: table.headers[c] ?? `col ${c}`,
    values: table.rows.map((r) => {
      const n = toNumber(r[c] ?? '');
      return Number.isNaN(n) ? 0 : n;
    }),
  }));
  return { labels, series };
}

/** "Nice" axis maximum at/above `max` (1/2/5 × 10ⁿ). 0 → 1 so charts aren't flat. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const frac = max / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * pow;
}

export interface BarRect { x: number; y: number; w: number; h: number; series: number; group: number; }

/** Lay out grouped bars within [0,width]×[0,height] (y grows downward). */
export function barLayout(model: ChartModel, width: number, height: number): { bars: BarRect[]; max: number } {
  const groups = model.labels.length;
  const perGroup = model.series.length || 1;
  const max = niceMax(Math.max(0, ...model.series.flatMap((s) => s.values)));
  const groupW = groups > 0 ? width / groups : width;
  const barW = (groupW * 0.8) / perGroup;
  const pad = groupW * 0.1;
  const bars: BarRect[] = [];
  for (let g = 0; g < groups; g++) {
    for (let s = 0; s < perGroup; s++) {
      const v = model.series[s]?.values[g] ?? 0;
      const h = max > 0 ? (v / max) * height : 0;
      bars.push({ x: g * groupW + pad + s * barW, y: height - h, w: barW, h, series: s, group: g });
    }
  }
  return { bars, max };
}

/** Polyline point strings (one per series) over [0,width]×[0,height]. */
export function lineLayout(model: ChartModel, width: number, height: number): { points: string[]; max: number } {
  const n = model.labels.length;
  const max = niceMax(Math.max(0, ...model.series.flatMap((s) => s.values)));
  const step = n > 1 ? width / (n - 1) : 0;
  const points = model.series.map((s) =>
    s.values
      .map((v, i) => {
        const x = n > 1 ? i * step : width / 2;
        const y = max > 0 ? height - (v / max) * height : height;
        return `${round(x)},${round(y)}`;
      })
      .join(' '),
  );
  return { points, max };
}

export interface PieSlice { d: string; value: number; label: string; percent: number; index: number; }

/** Pie slices (path `d`) for the first series, centered at (cx,cy) radius r. */
export function pieLayout(model: ChartModel, cx: number, cy: number, r: number): PieSlice[] {
  const values = (model.series[0]?.values ?? []).map((v) => (v > 0 ? v : 0));
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const slices: PieSlice[] = [];
  let angle = -Math.PI / 2; // start at 12 o'clock
  values.forEach((v, i) => {
    const frac = v / total;
    const next = angle + frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(next);
    const y2 = cy + r * Math.sin(next);
    const large = frac > 0.5 ? 1 : 0;
    const d = `M${round(cx)},${round(cy)} L${round(x1)},${round(y1)} A${r},${r} 0 ${large} 1 ${round(x2)},${round(y2)} Z`;
    slices.push({ d, value: v, label: model.labels[i] ?? '', percent: frac, index: i });
    angle = next;
  });
  return slices;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Categorical palette (fixed, theme-agnostic) for series/slices. */
export const PALETTE = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#A78BFA', '#EC4899', '#84CC16'];
export function color(i: number): string {
  return PALETTE[i % PALETTE.length];
}
