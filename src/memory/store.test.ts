// Store tests run against fake-indexeddb (no browser needed).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRunRecord } from './buildRecord';
import { saveRun, listRuns, clearRuns } from './store';

afterEach(async () => {
  await clearRuns();
});

describe('buildRunRecord', () => {
  it('builds a chat record with sensible defaults', () => {
    const r = buildRunRecord({ kind: 'chat', task: 'hi', answer: 'hello', model: 'm', startedAt: 1000, endedAt: 1500 });
    expect(r.kind).toBe('chat');
    expect(r.outcome).toBe('answered');
    expect(r.toolCount).toBe(0);
    expect(r.durationMs).toBe(500);
    expect(r.id).toContain('run_1000');
  });

  it('captures tools + provenance for agent runs', () => {
    const r = buildRunRecord({
      kind: 'agent',
      task: 'read the page',
      answer: 'it is about X',
      outcome: 'completed',
      tools: ['read_dom'],
      provenance: ['https://x.com'],
      model: 'm',
      startedAt: 0,
    });
    expect(r.toolCount).toBe(1);
    expect(r.tools).toEqual(['read_dom']);
    expect(r.provenance).toEqual(['https://x.com']);
  });
});

describe('store (fake-indexeddb)', () => {
  it('saves and lists runs newest-first', async () => {
    await saveRun(buildRunRecord({ kind: 'chat', task: 'a', answer: '1', model: 'm', startedAt: 100 }));
    await saveRun(buildRunRecord({ kind: 'chat', task: 'b', answer: '2', model: 'm', startedAt: 200 }));
    const runs = await listRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0].task).toBe('b'); // newest first
    expect(runs[1].task).toBe('a');
  });

  it('clears runs', async () => {
    await saveRun(buildRunRecord({ kind: 'chat', task: 'a', answer: '1', model: 'm', startedAt: 100 }));
    await clearRuns();
    expect(await listRuns()).toHaveLength(0);
  });
});
