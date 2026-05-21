// Pure helpers for building workflows. The NL→steps generation calls the LLM
// (in the view); here we keep the JSON parser pure + unit-testable.
import type { Workflow, WorkflowStep } from './types';

let counter = 0;
function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${(counter++).toString(36)}`;
}

interface RawStep {
  mode?: unknown;
  prompt?: unknown;
}

/** Parse the LLM's JSON ({"steps":[{mode,prompt}]}) into validated WorkflowSteps. */
export function parseWorkflowSteps(json: string): WorkflowStep[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const raw = (data as { steps?: unknown }).steps;
  if (!Array.isArray(raw)) return [];
  return (raw as RawStep[])
    .filter((s) => typeof s.prompt === 'string' && (s.prompt as string).trim().length > 0)
    .map((s) => ({
      id: newId('step'),
      mode: s.mode === 'agent' ? 'agent' : 'chat',
      prompt: (s.prompt as string).trim(),
    }));
}

export function makeWorkflow(name: string, steps: WorkflowStep[]): Workflow {
  return {
    id: newId('wf'),
    name: name.slice(0, 80) || 'Untitled workflow',
    steps,
    trigger: { type: 'manual' },
    createdAt: Date.now(),
  };
}

/** System prompt that asks the model to emit a workflow plan as strict JSON. */
export const WORKFLOW_BUILDER_SYSTEM =
  'You design a browser-assistant workflow from the user description. Output ONLY ' +
  'JSON: {"steps":[{"mode":"chat|agent","prompt":"..."}]}. Use "agent" for steps ' +
  'that must read/act on a web page, navigate, or search the web; use "chat" for ' +
  'pure reasoning/formatting. Keep it to 2-5 concrete steps.';
