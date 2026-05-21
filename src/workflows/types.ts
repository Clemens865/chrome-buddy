// A Workflow is an ordered list of steps run in sequence, threading each step's
// output into the next.
export interface WorkflowStep {
  id: string;
  /** cheap plain chat, or the agent loop (tools). */
  mode: 'chat' | 'agent';
  prompt: string;
}

/**
 * How a workflow is triggered. `manual` = run from the Workflows list.
 * `schedule` = a recurring chrome.alarm that REMINDS the user it's due (the run
 * itself stays one-tap and user-initiated — agent steps can be consequential, so
 * we never auto-run unattended). `everyMinutes` mirrors alarm periodInMinutes.
 */
export type WorkflowTrigger =
  | { type: 'manual' }
  | { type: 'schedule'; everyMinutes: number };

export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  trigger: WorkflowTrigger;
  createdAt: number;
}
