// Unit tests for the PURE page-domain logic (no chrome.*, no DOM/jsdom).
// Covers isUndriveable (restricted.ts) and the pure distillers (distill.ts),
// which operate on plain DomNodeLike trees built in-test.

import { describe, expect, it } from 'vitest';
import { describeUndriveable, isUndriveable } from './restricted';
import {
  distillText,
  distillTree,
  extractInteractive,
  extractTables,
  interactiveKind,
  labelFor,
  normalizeText,
  selectorFor,
  type DomNodeLike,
} from './distill';

// --- restricted.ts ---------------------------------------------------------

describe('isUndriveable', () => {
  it('treats ordinary http(s) pages as driveable', () => {
    expect(isUndriveable('https://example.com/path?q=1')).toBeNull();
    expect(isUndriveable('http://localhost:3000/')).toBeNull();
  });

  it('flags browser-internal schemes', () => {
    expect(isUndriveable('chrome://settings')).toBe('browser-internal');
    expect(isUndriveable('edge://flags')).toBe('browser-internal');
    expect(isUndriveable('about:blank')).toBe('browser-internal');
    expect(isUndriveable('devtools://devtools/bundled/x.html')).toBe(
      'browser-internal',
    );
  });

  it('flags the web store / add-on galleries', () => {
    expect(isUndriveable('https://chromewebstore.google.com/detail/x')).toBe(
      'web-store',
    );
    expect(isUndriveable('https://chrome.google.com/webstore/category/extensions')).toBe(
      'web-store',
    );
    expect(isUndriveable('https://addons.mozilla.org/en-US/firefox/')).toBe(
      'web-store',
    );
  });

  it('flags view-source, extension pages, and local/data schemes', () => {
    expect(isUndriveable('view-source:https://example.com')).toBe('view-source');
    expect(isUndriveable('chrome-extension://abc/page.html')).toBe('extension-page');
    expect(isUndriveable('moz-extension://abc/page.html')).toBe('extension-page');
    expect(isUndriveable('file:///Users/me/file.txt')).toBe('local-or-data');
    expect(isUndriveable('data:text/html,<h1>x</h1>')).toBe('local-or-data');
  });

  it('rejects empty / unsupported input', () => {
    expect(isUndriveable('')).toBe('unsupported-scheme');
    expect(isUndriveable('   ')).toBe('unsupported-scheme');
    expect(isUndriveable('mailto:a@b.com')).toBe('unsupported-scheme');
  });

  it('every reason has a human description', () => {
    for (const r of [
      'browser-internal',
      'web-store',
      'view-source',
      'extension-page',
      'local-or-data',
      'unsupported-scheme',
    ] as const) {
      expect(describeUndriveable(r).length).toBeGreaterThan(0);
    }
  });
});

// --- helpers ---------------------------------------------------------------

const el = (
  tagName: string,
  attributes: Record<string, string> = {},
  children: DomNodeLike[] = [],
  textContent?: string,
): DomNodeLike => ({ tagName, attributes, children, textContent });

describe('normalizeText', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeText('  a\n  b\t c ')).toBe('a b c');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});

describe('interactiveKind', () => {
  it('classifies common interactive tags', () => {
    expect(interactiveKind(el('a', { href: '#' }))).toBe('link');
    expect(interactiveKind(el('button'))).toBe('button');
    expect(interactiveKind(el('input', { type: 'checkbox' }))).toBe('checkbox');
    expect(interactiveKind(el('input', { type: 'submit' }))).toBe('button');
    expect(interactiveKind(el('input'))).toBe('input');
    expect(interactiveKind(el('textarea'))).toBe('textarea');
    expect(interactiveKind(el('select'))).toBe('select');
  });

  it('honors ARIA roles on generic tags', () => {
    expect(interactiveKind(el('div', { role: 'button' }))).toBe('button');
    expect(interactiveKind(el('span', { role: 'tab' }))).toBe('tab');
    expect(interactiveKind(el('li', { role: 'menuitem' }))).toBe('menuitem');
  });

  it('returns null for non-interactive content', () => {
    expect(interactiveKind(el('div'))).toBeNull();
    expect(interactiveKind(el('p'))).toBeNull();
  });
});

describe('labelFor / selectorFor', () => {
  it('prefers aria-label, then text/placeholder/value', () => {
    expect(labelFor(el('button', { 'aria-label': 'Close' }, [], 'X'))).toBe('Close');
    expect(labelFor(el('button', {}, [], 'Buy now'))).toBe('Buy now');
    expect(labelFor(el('input', { placeholder: 'Email' }))).toBe('Email');
    expect(labelFor(el('input', { value: 'v', name: 'q' }))).toBe('v');
  });

  it('builds selectors from id/data-testid/name', () => {
    expect(selectorFor(el('div', { id: 'main' }))).toBe('#main');
    expect(selectorFor(el('button', { 'data-testid': 'go' }))).toBe(
      '[data-testid="go"]',
    );
    expect(selectorFor(el('input', { name: 'email' }))).toBe('input[name="email"]');
    expect(selectorFor(el('a'))).toBe('a');
  });
});

describe('extractInteractive', () => {
  it('assigns sequential integer ids in document order', () => {
    const tree = el('html', {}, [
      el('body', {}, [
        el('a', { href: '/x' }, [], 'Link'),
        el('div', {}, [el('button', {}, [], 'Click')]),
        el('script', {}, [], 'ignored'),
        el('input', { type: 'email', name: 'em', disabled: '' }),
      ]),
    ]);
    const refs = extractInteractive(tree);
    expect(refs.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(refs[0]).toMatchObject({ kind: 'link', href: '/x', label: 'Link', tag: 'a' });
    expect(refs[1]).toMatchObject({ kind: 'button', label: 'Click' });
    expect(refs[2]).toMatchObject({ kind: 'input', inputType: 'email', disabled: true });
  });

  it('skips pruned subtrees (script/style/svg)', () => {
    const tree = el('div', {}, [
      el('svg', {}, [el('a', { href: '#' }, [], 'inside svg')]),
      el('button', {}, [], 'real'),
    ]);
    const refs = extractInteractive(tree);
    expect(refs).toHaveLength(1);
    expect(refs[0].label).toBe('real');
  });
});

describe('extractTables', () => {
  it('parses headers and body rows with a stable id + selector', () => {
    const table = el('table', { id: 'prices' }, [
      el('caption', {}, [], 'Plans'),
      el('thead', {}, [
        el('tr', {}, [el('th', {}, [], 'Plan'), el('th', {}, [], 'Price')]),
      ]),
      el('tbody', {}, [
        el('tr', {}, [el('td', {}, [], 'Pro'), el('td', {}, [], '$10')]),
        el('tr', {}, [el('td', {}, [], 'Team'), el('td', {}, [], '$30')]),
      ]),
    ]);
    const tree = el('body', {}, [table]);
    const tables = extractTables(tree);
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({
      id: 1,
      caption: 'Plans',
      headers: ['Plan', 'Price'],
      selector: '#prices',
    });
    expect(tables[0].rows).toEqual([
      ['Pro', '$10'],
      ['Team', '$30'],
    ]);
  });
});

describe('distillText / distillTree', () => {
  it('joins visible leaf text and skips pruned nodes', () => {
    const tree = el('body', {}, [
      el('h1', {}, [], 'Title'),
      el('style', {}, [], '.x{color:red}'),
      el('p', {}, [], 'Hello world'),
    ]);
    const text = distillText(tree);
    expect(text).toContain('Title');
    expect(text).toContain('Hello world');
    expect(text).not.toContain('color:red');
  });

  it('composes a DistilledPage with provenance', () => {
    const tree = el('html', {}, [
      el('body', {}, [el('a', { href: '/y' }, [], 'Go')]),
    ]);
    const page = distillTree(tree, {
      url: 'https://ex.com',
      title: '  Demo  ',
      tabId: 7,
    });
    expect(page.title).toBe('Demo');
    expect(page.url).toBe('https://ex.com');
    expect(page.interactiveElements).toHaveLength(1);
    expect(page.provenance.tabId).toBe(7);
    expect(typeof page.provenance.distilledAt).toBe('number');
  });
});
