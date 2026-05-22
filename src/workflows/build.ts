// Pure helpers for building workflows. The NL→steps generation calls the LLM
// (in the view); here we keep the JSON parser pure + unit-testable.
import type { Workflow, WorkflowBundle, WorkflowStep } from './types';
import { WORKFLOW_SCHEMA_VERSION } from './types';

let counter = 0;
export function newWorkflowId(prefix = 'wf'): string {
  return `${prefix}_${Date.now()}_${(counter++).toString(36)}`;
}
function newId(prefix: string): string {
  return newWorkflowId(prefix);
}

/** True when an event-trigger urlPattern (with * wildcards) matches a URL. */
export function matchesEventTrigger(urlPattern: string, url: string): boolean {
  const p = (urlPattern ?? '').trim();
  if (!p || !url) return false;
  const re = new RegExp(
    '^' + p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
    'i',
  );
  return re.test(url) || url.includes(p.replace(/\*/g, ''));
}

/** Export workflows as a portable, re-validatable bundle (FR-WF-7). */
export function toWorkflowBundle(workflows: Workflow[]): WorkflowBundle {
  return { schemaVersion: WORKFLOW_SCHEMA_VERSION, workflows };
}

/** Parse + validate an imported workflow bundle (FR-WF-7). Drops bad entries. */
export function parseWorkflowBundle(json: string): Workflow[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const raw = (data as { workflows?: unknown }).workflows;
  if (!Array.isArray(raw)) return [];
  const out: Workflow[] = [];
  for (const w of raw as Record<string, unknown>[]) {
    if (!w || typeof w.name !== 'string' || !Array.isArray(w.steps)) continue;
    const steps = (w.steps as Record<string, unknown>[])
      .filter((s) => s && typeof s.prompt === 'string' && (s.prompt as string).trim())
      .map((s) => ({ id: newId('step'), mode: s.mode === 'agent' ? ('agent' as const) : ('chat' as const), prompt: (s.prompt as string).trim() }));
    if (steps.length === 0) continue;
    out.push({
      id: newId('wf'),
      name: (w.name as string).slice(0, 80),
      steps,
      trigger: { type: 'manual' },
      createdAt: Date.now(),
    });
  }
  return out;
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
