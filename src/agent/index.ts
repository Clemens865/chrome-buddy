// Barrel exports for the Agent Runtime (PRD component #2).
//
// Public surface for the panel/background to drive a plan→act→observe→reflect
// run, gate consequential actions, and consume the live event stream — without
// reaching into runtime internals.

export * from './types';

export { AgentRuntime } from './runtime';
export type { RuntimeLlm, RuntimeDeps } from './runtime';

export {
  gateConsequentialAction,
  summarizeAction,
} from './hitl';
export type { ApprovalResolver, GateOutcome } from './hitl';

export { computerUseStub } from './computerUse';
export type {
  ComputerUseHook,
  ComputerUseRequest,
  ComputerUseAction,
} from './computerUse';
