import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAppConfig, renderTemplate } from './build';
import { saveApp, listApps, deleteApp } from './store';

afterEach(async () => {
  for (const a of await listApps()) await deleteApp(a.id);
});

describe('parseAppConfig', () => {
  it('parses a valid config and defaults input type', () => {
    const cfg = parseAppConfig(
      '{"name":"Toner","description":"d","inputs":[{"id":"text","label":"Text","type":"textarea"},{"id":"tone","label":"Tone"}],"promptTemplate":"Rewrite {{text}} in a {{tone}} tone."}',
    );
    expect(cfg).not.toBeNull();
    expect(cfg!.inputs).toHaveLength(2);
    expect(cfg!.inputs[1].type).toBe('text');
  });

  it('rejects configs with no inputs, name, or template', () => {
    expect(parseAppConfig('nope')).toBeNull();
    expect(parseAppConfig('{"name":"x","promptTemplate":"y","inputs":[]}')).toBeNull();
    expect(parseAppConfig('{"name":"","promptTemplate":"y","inputs":[{"id":"a","label":"A"}]}')).toBeNull();
  });
});

describe('renderTemplate', () => {
  it('substitutes placeholders and tolerates spaces / missing keys', () => {
    expect(renderTemplate('Hi {{ name }}, {{missing}}!', { name: 'Ada' })).toBe('Hi Ada, !');
  });
});

describe('app store', () => {
  it('saves, lists, deletes', async () => {
    const cfg = parseAppConfig(
      '{"name":"T","description":"d","inputs":[{"id":"a","label":"A"}],"promptTemplate":"{{a}}"}',
    )!;
    await saveApp(cfg);
    expect(await listApps()).toHaveLength(1);
    await deleteApp(cfg.id);
    expect(await listApps()).toHaveLength(0);
  });
});
