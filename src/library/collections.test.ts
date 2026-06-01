import { describe, it, expect } from 'vitest';
import {
  slugify,
  makeCollectionId,
  validateCollectionName,
  isProtectedCollection,
  DEFAULT_COLLECTIONS,
  DEFAULT_COLLECTION_ID,
  PROFILE_COLLECTION_ID,
  type Collection,
} from './collections';

describe('slugify', () => {
  it('lowercases, trims, and dashes non-alphanumerics', () => {
    expect(slugify('  Acme Redesign 2026!  ')).toBe('acme-redesign-2026');
  });
  it('strips quotes and collapses runs of separators', () => {
    expect(slugify(`John's  "Work"  Notes`)).toBe('johns-work-notes');
  });
  it('returns empty for symbol-only names', () => {
    expect(slugify('!!!')).toBe('');
  });
  it('caps length at 48 chars', () => {
    expect(slugify('a'.repeat(80)).length).toBe(48);
  });
});

describe('makeCollectionId', () => {
  it('uses the slug when non-empty', () => {
    expect(makeCollectionId('Work Stuff')).toBe('work-stuff');
  });
  it('falls back to a deterministic col- id when the slug is empty', () => {
    expect(makeCollectionId('###', 'abc')).toBe('col-abc');
  });
});

describe('validateCollectionName', () => {
  const existing: Collection[] = [
    { id: 'work', name: 'Work', description: '', kind: 'project', autoContext: 'active', createdAt: 0, updatedAt: 0 },
  ];
  it('rejects too-short and too-long names', () => {
    expect(validateCollectionName('a')).toMatch(/at least 2/);
    expect(validateCollectionName('x'.repeat(61))).toMatch(/60 characters/);
  });
  it('rejects a name that collides with an existing collection id', () => {
    expect(validateCollectionName('work', existing)).toMatch(/already exists/);
    expect(validateCollectionName('WORK', existing)).toMatch(/already exists/);
  });
  it('accepts a fresh, valid name', () => {
    expect(validateCollectionName('Competitors', existing)).toBeNull();
  });
});

describe('default collections', () => {
  it('seeds General + Personal Profile with the right auto-context modes', () => {
    const general = DEFAULT_COLLECTIONS.find((c) => c.id === DEFAULT_COLLECTION_ID);
    const profile = DEFAULT_COLLECTIONS.find((c) => c.id === PROFILE_COLLECTION_ID);
    expect(general?.autoContext).toBe('manual');
    expect(profile?.autoContext).toBe('always');
    expect(profile?.kind).toBe('profile');
  });
  it('protects the two default collections from deletion', () => {
    expect(isProtectedCollection(DEFAULT_COLLECTION_ID)).toBe(true);
    expect(isProtectedCollection(PROFILE_COLLECTION_ID)).toBe(true);
    expect(isProtectedCollection('work')).toBe(false);
  });
});
