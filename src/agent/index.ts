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

export { runAgentTask, runPlainChat, PAGE_TOOLS, PLAIN_CHAT_MODEL } from './runner';
export type {
  RunAgentTaskOptions,
  RunAgentTaskResult,
  ConfirmHandler,
  PlainChatResult,
} from './runner';

export { classifyIntent, resolveIntent } from './route';
export type { ChatMode, Intent } from './route';

export { buildContextBlock, buildMultiPageContextBlock, hasProfile, EMPTY_PROFILES } from './context';
export type { UserProfile, PageSummaryLite, ProfileKind, Profiles } from './context';

export {
  reduceTranscript,
  resolveConfirmation,
  userItem,
  agentItem,
} from './transcript';
export type { TranscriptItem } from './transcript';

export { computerUseStub } from './computerUse';
export type {
  ComputerUseHook,
  ComputerUseRequest,
  ComputerUseAction,
} from './computerUse';
