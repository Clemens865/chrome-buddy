// Run history record (PRD FR-MEM-1/3). One per completed chat or agent run.
export interface RunRecord {
  id: string;
  /** 'chat' = plain tool-less answer; 'agent' = plan/act/observe loop. */
  kind: 'chat' | 'agent';
  /** The user's request. */
  task: string;
  /** Buddy's final answer (may be empty if the run errored). */
  answer: string;
  /** Outcome label: 'answered' for chat, or the agent RunOutcome. */
  outcome: string;
  /** Number of tool calls made (agent runs). */
  toolCount: number;
  /** Tool names used, in order (agent runs). */
  tools: string[];
  /** Source URLs gathered (provenance). */
  provenance: string[];
  model: string;
  startedAt: number;
  durationMs: number;
}
