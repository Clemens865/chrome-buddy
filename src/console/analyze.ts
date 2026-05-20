// AI analysis of captured console logs.
//
// `buildAnalysisPrompt` is PURE (no chrome, no network) so it is unit-testable.
// `analyzeLogs` adds the side-effecting call to the background service worker
// via generateViaBackground — the UI never talks to the LLM directly, the SW
// holds the key (PRD NFR-SEC-1/2).

import { generateViaBackground } from '../llm/instance';
import { countByLevel, mostFrequentError } from './capture';
import type { LogEntry } from './capture';

/** Outcome of an analysis run. */
export interface AnalysisResult {
  /** The error the analysis focused on, if any was present. */
  focus?: LogEntry;
  /** The model's explanation / suggested fix. */
  explanation: string;
}

/** How many context log lines to include around the focused error. */
const MAX_CONTEXT_LINES = 20;

const SYSTEM_PREFIX =
  'You are Console Buddy, a browser dev-tools assistant. ' +
  'Given captured console output, explain the most important error in plain ' +
  'language: its likely cause and a concrete fix. Be concise (a short ' +
  'paragraph). If no real error is present, say the console looks healthy.';

/** PURE: format a single entry as a prompt line. */
function formatLine(e: LogEntry): string {
  const tag = e.level.toUpperCase();
  const where = e.source ? ` (${e.source})` : '';
  const times = e.count > 1 ? ` [x${e.count}]` : '';
  return `[${tag}]${times} ${e.text}${where}`;
}

/**
 * PURE: build the analysis prompt from a deduped log list. Surfaces the most
 * frequent error first (with its occurrence count), then a bounded slice of
 * surrounding context. Deterministic — no clock, no randomness.
 */
export function buildAnalysisPrompt(logs: readonly LogEntry[]): string {
  const counts = countByLevel(logs);
  const focus = mostFrequentError(logs);
  const lines: string[] = [SYSTEM_PREFIX, ''];

  lines.push(
    `Captured: ${counts.error} error(s), ${counts.warn} warning(s), ` +
      `${counts.log} log(s), ${counts.net} network event(s).`,
  );
  lines.push('');

  if (focus) {
    lines.push(`Most frequent error (seen ${focus.count}x):`);
    lines.push(formatLine(focus));
    lines.push('');
  }

  const context = logs.filter((e) => e !== focus).slice(0, MAX_CONTEXT_LINES);
  if (context.length > 0) {
    lines.push('Other context:');
    for (const e of context) lines.push(formatLine(e));
  }

  if (!focus && context.length === 0) {
    lines.push('No console output was captured.');
  }

  return lines.join('\n');
}

/**
 * Analyze captured logs via the background SW and return the explanation of the
 * most frequent error. Throws on transport/model failure (the UI surfaces it).
 */
export async function analyzeLogs(logs: readonly LogEntry[]): Promise<AnalysisResult> {
  const prompt = buildAnalysisPrompt(logs);
  const result = await generateViaBackground({
    messages: [{ role: 'user', content: prompt }],
  });
  return {
    focus: mostFrequentError(logs),
    explanation: result.text.trim() || 'No analysis was returned.',
  };
}
