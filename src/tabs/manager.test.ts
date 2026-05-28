import { describe, it, expect } from 'vitest';
import {
  hostOf,
  normalizeUrl,
  findDuplicateTabIds,
  filterTabs,
  groupByWindow,
  toSession,
  parseTabGroups,
  type TabLite,
} from './manager';

const tab = (id: number, url: string, title = `t${id}`, windowId = 1, active = false): TabLite =>
  ({ id, url, title, windowId, active });

describe('hostOf', () => {
  it('strips www + scheme', () => {
    expect(hostOf('https://www.example.com/path')).toBe('example.com');
  });
  it('returns empty for non-http', () => {
    expect(hostOf('chrome://extensions')).toBe('');
    expect(hostOf('not a url')).toBe('');
  });
});

describe('normalizeUrl', () => {
  it('drops hash + trailing slash', () => {
    expect(normalizeUrl('https://x.com/a/#frag')).toBe('https://x.com/a');
    expect(normalizeUrl('https://x.com/')).toBe('https://x.com');
  });
});

describe('findDuplicateTabIds', () => {
  it('keeps the first of each url, closes the rest', () => {
    const tabs = [tab(1, 'https://a.com'), tab(2, 'https://b.com'), tab(3, 'https://a.com/#x')];
    expect(findDuplicateTabIds(tabs)).toEqual([3]);
  });
  it('prefers keeping the active tab', () => {
    const tabs = [tab(1, 'https://a.com'), tab(2, 'https://a.com', 't2', 1, true)];
    expect(findDuplicateTabIds(tabs)).toEqual([1]);
  });
  it('returns nothing when all unique', () => {
    expect(findDuplicateTabIds([tab(1, 'https://a.com'), tab(2, 'https://b.com')])).toEqual([]);
  });
});

describe('filterTabs', () => {
  it('matches title or url, case-insensitive', () => {
    const tabs = [tab(1, 'https://github.com', 'Repo'), tab(2, 'https://news.com', 'Headlines')];
    expect(filterTabs(tabs, 'GIT').map((t) => t.id)).toEqual([1]);
    expect(filterTabs(tabs, 'head').map((t) => t.id)).toEqual([2]);
  });
  it('returns all for empty query', () => {
    const tabs = [tab(1, 'https://a.com')];
    expect(filterTabs(tabs, ' ')).toBe(tabs);
  });
});

describe('groupByWindow', () => {
  it('buckets tabs by window in first-seen order', () => {
    const tabs = [tab(1, 'a', 't1', 5), tab(2, 'b', 't2', 9), tab(3, 'c', 't3', 5)];
    const g = groupByWindow(tabs);
    expect(g.map((w) => w.windowId)).toEqual([5, 9]);
    expect(g[0].tabs.map((t) => t.id)).toEqual([1, 3]);
  });
});

describe('toSession', () => {
  it('keeps title+url, drops ids', () => {
    const s = toSession('s1', 'Work', 1000, [tab(1, 'https://a.com', 'A')]);
    expect(s).toEqual({ id: 's1', name: 'Work', createdAt: 1000, tabs: [{ title: 'A', url: 'https://a.com' }] });
  });
});

describe('parseTabGroups', () => {
  it('parses {groups:[{name,tabIndices}]}', () => {
    const g = parseTabGroups('{"groups":[{"name":"Docs","tabIndices":[0,2]},{"name":"News","tabIndices":[1]}]}', 3);
    expect(g).toEqual([
      { name: 'Docs', tabIndices: [0, 2] },
      { name: 'News', tabIndices: [1] },
    ]);
  });
  it('strips a fence and drops out-of-range indices', () => {
    const g = parseTabGroups('```json\n{"groups":[{"name":"X","tabIndices":[0,5,-1]}]}\n```', 3);
    expect(g).toEqual([{ name: 'X', tabIndices: [0] }]);
  });
  it('accepts a bare array of groups', () => {
    const g = parseTabGroups('[{"name":"X","tabIndices":[1]}]', 2);
    expect(g).toEqual([{ name: 'X', tabIndices: [1] }]);
  });
  it('drops empty/nameless groups and returns [] for junk', () => {
    expect(parseTabGroups('{"groups":[{"name":"","tabIndices":[0]},{"name":"Y","tabIndices":[]}]}', 3)).toEqual([]);
    expect(parseTabGroups('nope', 3)).toEqual([]);
  });
});
