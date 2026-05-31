import { describe, expect, it } from 'vitest';
import { buildContextBlock, buildMultiPageContextBlock, hasProfile } from './context';

describe('buildContextBlock', () => {
  it('returns empty when nothing to attach', () => {
    expect(buildContextBlock(null, null)).toBe('');
    expect(buildContextBlock({ url: '', title: '', text: '' }, {})).toBe('');
  });

  it('includes page content', () => {
    const out = buildContextBlock({ url: 'https://a.com', title: 'Aurora', text: 'Pricing details' }, null);
    expect(out).toContain('# Current page');
    expect(out).toContain('https://a.com');
    expect(out).toContain('Pricing details');
  });

  it('includes profile fields', () => {
    const out = buildContextBlock(null, { name: 'Alex', role: 'PM', about: 'likes brevity' });
    expect(out).toContain('# About the user');
    expect(out).toContain('Name: Alex');
    expect(out).toContain('Role: PM');
    expect(out).toContain('likes brevity');
  });

  it('joins page and profile with a separator', () => {
    const out = buildContextBlock(
      { url: 'https://a.com', title: 'A', text: 'x' },
      { name: 'Alex' },
    );
    expect(out).toContain('# Current page');
    expect(out).toContain('# About the user');
    expect(out).toContain('---');
  });
});

describe('buildMultiPageContextBlock', () => {
  it('returns empty for no usable pages', () => {
    expect(buildMultiPageContextBlock([])).toBe('');
    expect(buildMultiPageContextBlock([{ url: 'https://a.com', title: '', text: '   ' }])).toBe('');
  });
  it('headers each tab and counts them', () => {
    const out = buildMultiPageContextBlock([
      { url: 'https://a.com', title: 'Aurora', text: 'alpha' },
      { url: 'https://b.com', title: 'Bravo', text: 'beta' },
    ]);
    expect(out).toContain('# Selected tabs (2)');
    expect(out).toContain('## Aurora');
    expect(out).toContain('## Bravo');
    expect(out).toContain('alpha');
    expect(out).toContain('---');
  });
  it('falls back to the url as heading when title is empty', () => {
    expect(buildMultiPageContextBlock([{ url: 'https://a.com', title: '', text: 'x' }])).toContain('## https://a.com');
  });
});

describe('hasProfile', () => {
  it('detects content', () => {
    expect(hasProfile(null)).toBe(false);
    expect(hasProfile({})).toBe(false);
    expect(hasProfile({ name: '  ' })).toBe(false);
    expect(hasProfile({ role: 'PM' })).toBe(true);
  });
});
