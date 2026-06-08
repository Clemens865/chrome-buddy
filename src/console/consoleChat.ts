// "Chat with the console" — multi-turn Q&A over the live captured log stream.
// The model gets a compact context (error/warning lines + recent activity +
// level counts) plus the conversation so far, then answers the user's question.
//
// buildConsoleContext + buildConsoleChatPrompt are PURE (unit-testable);
// askConsole adds the SW round-trip (the key stays in the SW).

import { generateViaBackground } from '../llm/instance';
import type { LogEntry } from './capture';

export interface ConsoleChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export const CONSOLE_CHAT_SYSTEM =
  'You are a debugging assistant embedded in a browser console viewer. Answer ' +
  'questions about the captured console output concretely: reference the exact ' +
  'messages, explain likely causes, and give actionable fixes with code when ' +
  'useful. Be concise. If the logs do not contain the answer, say so.';

const MAX_ERRORS = 25;
const MAX_RECENT = 30;
const MAX_LINE = 240;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

/** PURE: a compact textual snapshot of the console for the model. */
export function buildConsoleContext(logs: readonly LogEntry[]): string {
  const counts = { error: 0, warn: 0, log: 0, net: 0 } as Record<string, number>;
  for (const l of logs) counts[l.level] = (counts[l.level] ?? 0) + 1;

  const errors = logs.filter((l) => l.level === 'error' || l.level === 'warn').slice(-MAX_ERRORS);
  const recent = logs.slice(-MAX_RECENT);

  const lines: string[] = [];
  lines.push(
    `Captured: ${counts.error ?? 0} error(s), ${counts.warn ?? 0} warning(s), ` +
      `${counts.log ?? 0} log(s), ${counts.net ?? 0} network event(s).`,
  );
  if (errors.length) {
    lines.push('', 'Errors & warnings:');
    for (const e of errors) {
      const src = e.source ? ` @ ${truncate(e.source, 80)}` : '';
      const times = e.count > 1 ? ` [x${e.count}]` : '';
      lines.push(`[${e.level.toUpperCase()}]${times} ${truncate(e.text, MAX_LINE)}${src}`);
    }
  }
  if (recent.length) {
    lines.push('', 'Recent activity:');
    for (const e of recent) lines.push(`[${e.level}] ${truncate(e.text, 160)}`);
  }
  return lines.join('\n');
}

/** PURE: assemble the user-message prompt from context + history + the question. */
export function buildConsoleChatPrompt(
  logs: readonly LogEntry[],
  history: readonly ConsoleChatTurn[],
  question: string,
): string {
  const lines = ['## Current console state', buildConsoleContext(logs), ''];
  if (history.length) {
    lines.push('## Conversation so far');
    for (const t of history) lines.push(`${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`);
    lines.push('');
  }
  lines.push('## Question', question);
  return lines.join('\n');
}

/** Suggested one-tap questions shown above the input. */
export const CONSOLE_QUICK_PROMPTS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: 'Summarize', prompt: 'Summarize the errors and warnings — what are the main issues?' },
  { label: 'Root cause', prompt: 'What is the most likely root cause of these errors? Explain simply.' },
  { label: 'Fix priority', prompt: 'Which errors should I fix first and why? Give a prioritized list.' },
  { label: 'Code fix', prompt: 'Show the code changes to fix the most critical error.' },
];

/** Ask the model a question about the console. Throws on transport failure. */
export async function askConsole(
  logs: readonly LogEntry[],
  history: readonly ConsoleChatTurn[],
  question: string,
  model?: string,
): Promise<string> {
  const prompt = buildConsoleChatPrompt(logs, history, question);
  const result = await generateViaBackground({
    messages: [
      { role: 'system', content: CONSOLE_CHAT_SYSTEM },
      { role: 'user', content: prompt },
    ],
    ...(model ? { model } : {}),
  });
  return result.text.trim() || 'No answer was returned.';
}
