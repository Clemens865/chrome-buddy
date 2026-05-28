import { describe, it, expect } from 'vitest';
import {
  csvField,
  tableToCsv,
  csvFilename,
  buildExtractMessages,
  parseExtractedTable,
  sortRows,
  filterRows,
} from './extract';

describe('csvField', () => {
  it('leaves plain values untouched', () => {
    expect(csvField('hello')).toBe('hello');
  });
  it('quotes + escapes commas, quotes, newlines', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });
  it('treats null/undefined as empty', () => {
    expect(csvField(undefined as unknown as string)).toBe('');
  });
});

describe('tableToCsv', () => {
  it('serialises headers + rows with CRLF', () => {
    const csv = tableToCsv({ headers: ['Name', 'Price'], rows: [['Pro', '$9, mo'], ['Free', '0']] });
    expect(csv).toBe('Name,Price\r\nPro,"$9, mo"\r\nFree,0');
  });
  it('omits header line when there are no headers', () => {
    expect(tableToCsv({ headers: [], rows: [['a', 'b']] })).toBe('a,b');
  });
});

describe('csvFilename', () => {
  it('slugifies a caption', () => {
    expect(csvFilename('Pricing Plans!')).toBe('pricing-plans.csv');
  });
  it('falls back to table.csv', () => {
    expect(csvFilename(undefined)).toBe('table.csv');
    expect(csvFilename('   ')).toBe('table.csv');
  });
});

describe('buildExtractMessages', () => {
  it('fences page content as untrusted and carries the instruction', () => {
    const msgs = buildExtractMessages('name, price', 'Plan A $10');
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toContain('name, price');
    expect(msgs[1].content).toContain('<<UNTRUSTED_PAGE_DATA>>');
    expect(msgs[1].content).toContain('Plan A $10');
  });
  it('truncates very long page text', () => {
    const msgs = buildExtractMessages('x', 'a'.repeat(30_000));
    expect(String(msgs[1].content)).toContain('[truncated]');
    expect(String(msgs[1].content).length).toBeLessThan(25_500);
  });
});

describe('parseExtractedTable', () => {
  it('parses the requested {headers, rows} shape', () => {
    const t = parseExtractedTable('{"headers":["A","B"],"rows":[["1","2"],["3","4"]]}');
    expect(t).toEqual({ headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] });
  });
  it('strips a ```json fence', () => {
    const t = parseExtractedTable('```json\n{"headers":["A"],"rows":[["1"]]}\n```');
    expect(t?.headers).toEqual(['A']);
  });
  it('salvages JSON embedded in prose', () => {
    const t = parseExtractedTable('Sure! Here you go: {"headers":["A"],"rows":[["x"]]} Done.');
    expect(t?.rows).toEqual([['x']]);
  });
  it('derives headers from an array of row-objects', () => {
    const t = parseExtractedTable('[{"name":"Pro","price":"9"},{"name":"Free"}]');
    expect(t?.headers).toEqual(['name', 'price']);
    expect(t?.rows).toEqual([['Pro', '9'], ['Free', '']]);
  });
  it('coerces non-string cells', () => {
    const t = parseExtractedTable('{"headers":["n"],"rows":[[42],[true]]}');
    expect(t?.rows).toEqual([['42'], ['true']]);
  });
  it('returns null for junk', () => {
    expect(parseExtractedTable('not json at all')).toBeNull();
    expect(parseExtractedTable('')).toBeNull();
  });
});

describe('sortRows', () => {
  it('sorts numerically when both cells are numeric (incl. $/%, commas)', () => {
    const rows = [['a', '$1,000'], ['b', '$200'], ['c', '$30']];
    expect(sortRows(rows, 1, 'asc').map((r) => r[0])).toEqual(['c', 'b', 'a']);
    expect(sortRows(rows, 1, 'desc').map((r) => r[0])).toEqual(['a', 'b', 'c']);
  });
  it('sorts text case-insensitively', () => {
    const rows = [['Banana'], ['apple'], ['Cherry']];
    expect(sortRows(rows, 0, 'asc').map((r) => r[0])).toEqual(['apple', 'Banana', 'Cherry']);
  });
  it('does not mutate the input', () => {
    const rows = [['2'], ['1']];
    sortRows(rows, 0, 'asc');
    expect(rows.map((r) => r[0])).toEqual(['2', '1']);
  });
});

describe('filterRows', () => {
  it('keeps rows where any cell matches (case-insensitive)', () => {
    const rows = [['Pro', 'paid'], ['Free', 'free']];
    expect(filterRows(rows, 'PAID')).toEqual([['Pro', 'paid']]);
  });
  it('returns all rows for an empty query', () => {
    const rows = [['a'], ['b']];
    expect(filterRows(rows, '  ')).toBe(rows);
  });
});
