// Pure helper: assemble a RunRecord from a finished run's facts. Kept pure so it
// is unit-testable without IndexedDB.
import type { RunRecord } from './types';

export interface RunInput {
  kind: 'chat' | 'agent';
  task: string;
  answer: string;
  outcome?: string;
  tools?: string[];
  provenance?: string[];
  model: string;
  startedAt: number;
  endedAt?: number;
}

let counter = 0;

export function buildRunRecord(input: RunInput): RunRecord {
  const startedAt = input.startedAt;
  const endedAt = input.endedAt ?? Date.now();
  const tools = input.tools ?? [];
  return {
    id: `run_${startedAt}_${(counter++).toString(36)}`,
    kind: input.kind,
    task: input.task.slice(0, 500),
    answer: (input.answer ?? '').slice(0, 4000),
    outcome: input.outcome ?? (input.kind === 'chat' ? 'answered' : 'completed'),
    toolCount: tools.length,
    tools,
    provenance: input.provenance ?? [],
    model: input.model,
    startedAt,
    durationMs: Math.max(0, endedAt - startedAt),
  };
}
