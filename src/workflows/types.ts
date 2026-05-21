// A Workflow is an ordered list of steps run in sequence, threading each step's
// output into the next. Trigger is manual for v1 (schedule/event to follow).
export interface WorkflowStep {
  id: string;
  /** cheap plain chat, or the agent loop (tools). */
  mode: 'chat' | 'agent';
  prompt: string;
}

export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  trigger: { type: 'manual' };
  createdAt: number;
}
