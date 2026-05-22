import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { parseWorkflowSteps, makeWorkflow, toWorkflowBundle, parseWorkflowBundle, matchesEventTrigger } from './build';
import { saveWorkflow, listWorkflows, deleteWorkflow } from './store';

afterEach(async () => {
  for (const w of await listWorkflows()) await deleteWorkflow(w.id);
});

describe('parseWorkflowSteps', () => {
  it('parses steps and defaults mode to chat', () => {
    const steps = parseWorkflowSteps('{"steps":[{"mode":"agent","prompt":"search the web"},{"prompt":"summarize"}]}');
    expect(steps).toHaveLength(2);
    expect(steps[0].mode).toBe('agent');
    expect(steps[1].mode).toBe('chat');
  });

  it('rejects junk and empty prompts', () => {
    expect(parseWorkflowSteps('nope')).toHaveLength(0);
    expect(parseWorkflowSteps('{"steps":[{"prompt":"  "}]}')).toHaveLength(0);
  });
});

describe('matchesEventTrigger', () => {
  it('matches with * wildcards', () => {
    expect(matchesEventTrigger('https://example.com/*', 'https://example.com/pricing')).toBe(true);
    expect(matchesEventTrigger('https://other.com/*', 'https://example.com/pricing')).toBe(false);
  });
  it('matches by substring without wildcards', () => {
    expect(matchesEventTrigger('github.com', 'https://github.com/foo')).toBe(true);
  });
});

describe('workflow bundle export/import (FR-WF-7)', () => {
  it('round-trips a bundle, resetting trigger to manual and dropping bad entries', () => {
    const wf = makeWorkflow('Round trip', parseWorkflowSteps('{"steps":[{"mode":"agent","prompt":"a"},{"prompt":"b"}]}'));
    const json = JSON.stringify(toWorkflowBundle([wf]));
    const back = parseWorkflowBundle(json);
    expect(back).toHaveLength(1);
    expect(back[0].name).toBe('Round trip');
    expect(back[0].steps).toHaveLength(2);
    expect(back[0].trigger).toEqual({ type: 'manual' });
    // junk / no-steps entries are dropped
    expect(parseWorkflowBundle('{"workflows":[{"name":"x"},{"steps":[]}]}')).toHaveLength(0);
    expect(parseWorkflowBundle('nope')).toHaveLength(0);
  });
});

describe('workflow store', () => {
  it('saves, lists, deletes', async () => {
    const wf = makeWorkflow('Test', parseWorkflowSteps('{"steps":[{"prompt":"hi"}]}'));
    await saveWorkflow(wf);
    expect(await listWorkflows()).toHaveLength(1);
    await deleteWorkflow(wf.id);
    expect(await listWorkflows()).toHaveLength(0);
  });
});
