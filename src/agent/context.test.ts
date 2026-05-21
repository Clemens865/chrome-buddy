import { describe, expect, it } from 'vitest';
import { buildContextBlock, hasProfile } from './context';

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

describe('hasProfile', () => {
  it('detects content', () => {
    expect(hasProfile(null)).toBe(false);
    expect(hasProfile({})).toBe(false);
    expect(hasProfile({ name: '  ' })).toBe(false);
    expect(hasProfile({ role: 'PM' })).toBe(true);
  });
});
