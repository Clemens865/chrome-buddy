import { describe, it, expect } from 'vitest';
import { buildCollectionsBlock, autoContextCollectionIds, type CollectionSummary } from './context';

const cols: CollectionSummary[] = [
  { id: 'personal-profile', name: 'Personal Profile', description: 'Facts about the user', autoContext: 'always' },
  { id: 'acme', name: 'Acme Project', description: 'Redesign docs', autoContext: 'active' },
  { id: 'general', name: 'General', description: '', autoContext: 'manual' },
];

describe('buildCollectionsBlock', () => {
  it('lists ids the model can pass to search_library, with descriptions', () => {
    const block = buildCollectionsBlock(cols);
    expect(block).toContain('# Knowledge collections');
    expect(block).toContain('search_library(query, collection)');
    expect(block).toContain('`acme`: Acme Project — Redesign docs');
    expect(block).toContain('`general`: General'); // empty description omitted cleanly
  });
  it('flags always-on collections as already in context', () => {
    expect(buildCollectionsBlock(cols)).toMatch(/`personal-profile`.*\(already in context\)/);
  });
  it('returns empty when there are no usable collections', () => {
    expect(buildCollectionsBlock([])).toBe('');
    expect(buildCollectionsBlock([{ id: '', name: '', description: '', autoContext: 'manual' }])).toBe('');
  });
});

describe('autoContextCollectionIds', () => {
  it('always includes always-on collections, never manual ones', () => {
    expect(autoContextCollectionIds(cols, new Set())).toEqual(['personal-profile']);
  });
  it('adds active collections only when toggled on this session', () => {
    expect(autoContextCollectionIds(cols, new Set(['acme'])).sort()).toEqual(['acme', 'personal-profile']);
  });
  it('ignores a toggled id that is not an active-mode collection', () => {
    // 'general' is manual → toggling it on does nothing.
    expect(autoContextCollectionIds(cols, new Set(['general']))).toEqual(['personal-profile']);
  });
});
