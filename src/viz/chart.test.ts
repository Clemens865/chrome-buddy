import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  parseJsonTable,
  parseData,
  toNumber,
  numericColumns,
  promoteHeaders,
  rankTables,
  buildModel,
  niceMax,
  barLayout,
  lineLayout,
  pieLayout,
  color,
} from './chart';

describe('parseCsv', () => {
  it('parses headers + rows', () => {
    const t = parseCsv('a,b\n1,2\n3,4');
    expect(t.headers).toEqual(['a', 'b']);
    expect(t.rows).toEqual([['1', '2'], ['3', '4']]);
  });
  it('handles quoted fields with commas, quotes, CRLF', () => {
    const t = parseCsv('name,note\r\n"Pro, plan","say ""hi"""\r\nFree,ok');
    expect(t.rows[0]).toEqual(['Pro, plan', 'say "hi"']);
    expect(t.rows[1]).toEqual(['Free', 'ok']);
  });
  it('drops blank trailing line', () => {
    const t = parseCsv('a\n1\n');
    expect(t.rows).toEqual([['1']]);
  });
});

describe('parseJsonTable', () => {
  it('parses array-of-objects with key union', () => {
    const t = parseJsonTable('[{"x":1,"y":2},{"x":3}]');
    expect(t?.headers).toEqual(['x', 'y']);
    expect(t?.rows).toEqual([['1', '2'], ['3', '']]);
  });
  it('parses {headers, rows}', () => {
    const t = parseJsonTable('{"headers":["a"],"rows":[["1"]]}');
    expect(t?.headers).toEqual(['a']);
  });
  it('returns null for non-tabular json', () => {
    expect(parseJsonTable('42')).toBeNull();
  });
});

describe('parseData', () => {
  it('auto-detects JSON', () => {
    expect(parseData('[{"a":1}]')?.headers).toEqual(['a']);
  });
  it('auto-detects CSV', () => {
    expect(parseData('a,b\n1,2')?.headers).toEqual(['a', 'b']);
  });
  it('returns null for empty', () => {
    expect(parseData('   ')).toBeNull();
  });
});

describe('toNumber', () => {
  it('strips currency/percent/commas', () => {
    expect(toNumber('$1,234')).toBe(1234);
    expect(toNumber('45%')).toBe(45);
    expect(toNumber('3.5')).toBe(3.5);
  });
  it('returns NaN for non-numbers', () => {
    expect(Number.isNaN(toNumber('abc'))).toBe(true);
    expect(Number.isNaN(toNumber(''))).toBe(true);
  });
});

describe('numericColumns', () => {
  it('flags columns that are entirely numeric', () => {
    const t = { headers: ['name', 'qty', 'price'], rows: [['a', '2', '$5'], ['b', '3', '$6']] };
    expect(numericColumns(t)).toEqual([1, 2]);
  });
  it('ignores empty cells but rejects mostly-text columns', () => {
    const t = { headers: ['v'], rows: [['1'], [''], ['x']] };
    expect(numericColumns(t)).toEqual([]); // 1/2 numeric < 0.6
  });
  it('tolerates a minority of non-numeric cells (stray header / total row)', () => {
    // Header text "Arrivals" sits in the body (10 numbers + 1 word = 91%).
    const rows = [['Arrivals'], ...Array.from({ length: 10 }, (_, i) => [String(i)])];
    expect(numericColumns({ headers: ['x'], rows })).toEqual([0]);
  });
});

describe('promoteHeaders', () => {
  it('lifts the first all-text row out as headers when none are marked', () => {
    // Mirrors statistik.at: total row first, header row second, then data.
    const t = {
      headers: [],
      rows: [
        ['Austria total', '3 459 758', '-1.6'],
        ['Federal province', 'Arrivals', 'Change'],
        ['Burgenland', '65 619', '8.3'],
      ],
    };
    const p = promoteHeaders(t);
    expect(p.headers).toEqual(['Federal province', 'Arrivals', 'Change']);
    expect(p.rows).toEqual([['Austria total', '3 459 758', '-1.6'], ['Burgenland', '65 619', '8.3']]);
    // And the value columns are now detected as numeric.
    expect(numericColumns(p)).toEqual([1, 2]);
  });
  it('keeps existing headers untouched', () => {
    const t = { headers: ['a'], rows: [['1']] };
    expect(promoteHeaders(t)).toBe(t);
  });
  it('synthesizes Column N when every row has numbers', () => {
    const p = promoteHeaders({ headers: [], rows: [['1', '2'], ['3', '4']] });
    expect(p.headers).toEqual(['Column 1', 'Column 2']);
    expect(p.rows).toHaveLength(2);
  });
});

describe('rankTables', () => {
  it('ranks numeric-dense tables above bigger non-numeric ones', () => {
    // A long nav/downloads table (no numbers) vs a smaller data table.
    const nav = { headers: ['Date', 'Title'], rows: Array.from({ length: 20 }, (_, i) => [`2026-0${i % 9}`, `Doc ${i}`]) };
    const data = { headers: ['Region', 'Arrivals', 'Change'], rows: [['A', '65 619', '8.3'], ['B', '139 427', '2.1']] };
    const ranked = rankTables([nav, data]);
    expect(ranked[0].table).toBe(data); // data wins despite far fewer rows
    expect(ranked[0].numericCount).toBe(2);
    expect(ranked[1].numericCount).toBe(0);
  });
  it('breaks numeric ties by row count', () => {
    const small = { headers: ['x'], rows: [['1'], ['2']] };
    const big = { headers: ['x'], rows: [['1'], ['2'], ['3']] };
    expect(rankTables([small, big])[0].table).toBe(big);
  });
});

describe('buildModel', () => {
  it('maps label col + value cols, coercing non-numerics to 0', () => {
    const t = { headers: ['m', 'a', 'b'], rows: [['Jan', '10', 'x'], ['Feb', '20', '5']] };
    const m = buildModel(t, 0, [1, 2]);
    expect(m.labels).toEqual(['Jan', 'Feb']);
    expect(m.series).toEqual([
      { name: 'a', values: [10, 20] },
      { name: 'b', values: [0, 5] },
    ]);
  });
});

describe('niceMax', () => {
  it('rounds up to 1/2/5 × 10ⁿ', () => {
    expect(niceMax(7)).toBe(10);
    expect(niceMax(11)).toBe(20);
    expect(niceMax(45)).toBe(50);
    expect(niceMax(150)).toBe(200);
  });
  it('guards zero/negative', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
  });
});

describe('barLayout', () => {
  it('scales the tallest bar to full height and stays within width', () => {
    const m = { labels: ['a', 'b'], series: [{ name: 's', values: [5, 10] }] };
    const { bars, max } = barLayout(m, 200, 100);
    expect(max).toBe(10);
    expect(bars).toHaveLength(2);
    // value 10 → full height; y at top (0), h = 100.
    const tall = bars[1];
    expect(tall.h).toBeCloseTo(100);
    expect(tall.y).toBeCloseTo(0);
    // value 5 → half height.
    expect(bars[0].h).toBeCloseTo(50);
    for (const b of bars) expect(b.x + b.w).toBeLessThanOrEqual(200.01);
  });
});

describe('lineLayout', () => {
  it('emits one polyline per series spanning the width', () => {
    const m = { labels: ['a', 'b', 'c'], series: [{ name: 's', values: [0, 5, 10] }] };
    const { points } = lineLayout(m, 100, 100);
    const coords = points[0].split(' ');
    expect(coords).toHaveLength(3);
    expect(coords[0]).toBe('0,100'); // first point, value 0 → bottom
    expect(coords[2]).toBe('100,0'); // last point, max value → top-right
  });
});

describe('pieLayout', () => {
  it('produces one slice per positive value summing to the whole', () => {
    const m = { labels: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 1, 2] }] };
    const slices = pieLayout(m, 50, 50, 40);
    expect(slices).toHaveLength(3);
    expect(slices.map((s) => Math.round(s.percent * 100))).toEqual([25, 25, 50]);
    expect(slices.reduce((t, s) => t + s.percent, 0)).toBeCloseTo(1);
    for (const s of slices) expect(s.d.startsWith('M50,50')).toBe(true);
  });
  it('returns nothing when the total is zero', () => {
    const m = { labels: ['a'], series: [{ name: 's', values: [0] }] };
    expect(pieLayout(m, 50, 50, 40)).toEqual([]);
  });
});

describe('color', () => {
  it('cycles the palette', () => {
    expect(color(0)).toBe(color(8));
    expect(color(1)).not.toBe(color(0));
  });
});
