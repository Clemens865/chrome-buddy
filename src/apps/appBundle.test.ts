import { describe, it, expect } from 'vitest';
import { toAppBundle, parseAppBundle } from './appBundle';
import { APP_SCHEMA_VERSION, type AppConfig } from './types';

const tier3: AppConfig = {
  id: 'a1', name: 'Counter', description: 'c', inputs: [], tier: 3,
  html: '<button id="b">0</button>', css: '', ui: "root.querySelector('#b')", permissions: ['gemini'], reviewed: true, createdAt: 1,
};
const tier1: AppConfig = {
  id: 'a2', name: 'Rewriter', description: 'r', inputs: [{ id: 'text', label: 'Text', type: 'textarea' }], tier: 1,
  promptTemplate: 'Rewrite {{text}}', createdAt: 2,
};

describe('toAppBundle', () => {
  it('wraps apps with the current schema version', () => {
    const b = toAppBundle([tier3]);
    expect(b.schemaVersion).toBe(APP_SCHEMA_VERSION);
    expect(b.apps).toHaveLength(1);
  });
});

describe('parseAppBundle', () => {
  it('round-trips tier-3 + tier-1 apps, forcing reviewed:false + fresh ids', () => {
    const json = JSON.stringify(toAppBundle([tier3, tier1]));
    const r = parseAppBundle(json);
    expect(r.apps).toHaveLength(2);
    const ui = r.apps.find((a) => a.tier === 3)!;
    expect(ui.name).toBe('Counter');
    expect(ui.reviewed).toBe(false); // import always re-gates
    expect(ui.id).not.toBe('a1'); // fresh id
    expect(r.fromNewerVersion).toBe(false);
  });
  it('drops malformed entries instead of throwing', () => {
    const json = JSON.stringify({ schemaVersion: APP_SCHEMA_VERSION, apps: [{ tier: 3, name: '' }, { junk: true }, tier3] });
    const r = parseAppBundle(json);
    expect(r.apps).toHaveLength(1);
    expect(r.dropped).toBe(2);
  });
  it('allowlists capabilities on import (drops unknown/consequential)', () => {
    const evil = { ...tier3, permissions: ['gemini', 'github_write', 'fetch'] };
    const r = parseAppBundle(JSON.stringify(toAppBundle([evil as AppConfig])));
    expect(r.apps[0].permissions).toEqual(['gemini']); // github_write + fetch stripped
  });
  it('flags a bundle from a newer schema version', () => {
    const json = JSON.stringify({ schemaVersion: APP_SCHEMA_VERSION + 1, apps: [tier3] });
    expect(parseAppBundle(json).fromNewerVersion).toBe(true);
  });
  it('returns empty on invalid JSON', () => {
    expect(parseAppBundle('not json').apps).toEqual([]);
  });
});
