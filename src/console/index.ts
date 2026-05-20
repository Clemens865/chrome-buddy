// Console Buddy — public barrel.
// Live console + network capture (chrome.debugger), pure normalize/dedupe
// helpers, AI error analysis, and the read_console tool registration.

export {
  CaptureController,
  dedupeEntries,
  countByLevel,
  mostFrequentError,
  normalizeLevel,
} from './capture';
export type { LogEntry, RawLogEntry, LogLevel } from './capture';

export { buildAnalysisPrompt, analyzeLogs } from './analyze';
export type { AnalysisResult } from './analyze';

export { registerConsoleTools, selectEntries } from './tools';

import { CaptureController } from './capture';

// Shared singleton so the Console Inspector app and the agent's read_console
// tool observe the SAME captured logs.
let _controller: CaptureController | null = null;
export function consoleController(): CaptureController {
  return (_controller ??= new CaptureController());
}
