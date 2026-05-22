import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { saveCheckpoint, loadCheckpoint, clearCheckpoint } from './checkpoint';
import type { RunState } from './types';

const state: RunState = {
  runId: 'r1',
  scratchpad: { task: 't', plan: [{ index: 1, intent: 'a' }], actions: [], notes: [], provenance: [], completedSteps: [] },
  stepsUsed: 0,
  costUsed: 0,
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
};

afterEach(async () => {
  await clearCheckpoint();
});

describe('run checkpoint store', () => {
  it('saves, loads, and clears the active checkpoint', async () => {
    expect(await loadCheckpoint()).toBeNull();
    await saveCheckpoint('my task', state);
    const cp = await loadCheckpoint();
    expect(cp?.task).toBe('my task');
    expect(cp?.state.runId).toBe('r1');
    await clearCheckpoint();
    expect(await loadCheckpoint()).toBeNull();
  });

  it('overwrites the single active checkpoint', async () => {
    await saveCheckpoint('first', state);
    await saveCheckpoint('second', { ...state, runId: 'r2' });
    const cp = await loadCheckpoint();
    expect(cp?.task).toBe('second');
    expect(cp?.state.runId).toBe('r2');
  });
});
