import { describe, it, expect } from 'vitest';
import { alarmName, workflowIdFromAlarm, alarmSpecsFor } from './schedule';
import type { Workflow } from './types';

const wf = (id: string, trigger: Workflow['trigger']): Workflow => ({
  id,
  name: id,
  steps: [{ id: 's1', mode: 'chat', prompt: 'hi' }],
  trigger,
  createdAt: 1,
});

describe('alarm naming', () => {
  it('round-trips a workflow id', () => {
    expect(workflowIdFromAlarm(alarmName('abc'))).toBe('abc');
  });
  it('ignores foreign alarm names', () => {
    expect(workflowIdFromAlarm('some-other-alarm')).toBeNull();
  });
});

describe('alarmSpecsFor', () => {
  it('emits a spec per scheduled workflow and skips manual ones', () => {
    const specs = alarmSpecsFor([
      wf('a', { type: 'manual' }),
      wf('b', { type: 'schedule', everyMinutes: 30 }),
      wf('c', { type: 'schedule', everyMinutes: 0 }),
    ]);
    expect(specs).toEqual([{ name: alarmName('b'), periodInMinutes: 30 }]);
  });
});
