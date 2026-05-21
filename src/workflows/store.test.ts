import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { parseWorkflowSteps, makeWorkflow } from './build';
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

describe('workflow store', () => {
  it('saves, lists, deletes', async () => {
    const wf = makeWorkflow('Test', parseWorkflowSteps('{"steps":[{"prompt":"hi"}]}'));
    await saveWorkflow(wf);
    expect(await listWorkflows()).toHaveLength(1);
    await deleteWorkflow(wf.id);
    expect(await listWorkflows()).toHaveLength(0);
  });
});
