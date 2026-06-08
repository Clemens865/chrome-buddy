import { describe, it, expect } from 'vitest';
import { buildConsoleContext, buildConsoleChatPrompt } from './consoleChat';
import type { LogEntry } from './capture';

const logs: LogEntry[] = [
  { level: 'error', text: "TypeError: Cannot read properties of undefined (reading 'x')", source: 'https://app.test/main.js:10', ts: 1, count: 3 },
  { level: 'warn', text: 'Deprecated API used', source: 'https://app.test/a.js:2', ts: 2, count: 1 },
  { level: 'log', text: 'app booted', ts: 3, count: 1 },
  { level: 'net', text: 'GET /api 200', ts: 4, count: 1 },
];

describe('buildConsoleContext', () => {
  it('summarizes counts and surfaces errors with source + repeat count', () => {
    const ctx = buildConsoleContext(logs);
    expect(ctx).toContain('1 error(s), 1 warning(s), 1 log(s), 1 network event(s)');
    expect(ctx).toContain('[ERROR] [x3] TypeError: Cannot read properties');
    expect(ctx).toContain('main.js:10');
    expect(ctx).toContain('Recent activity:');
  });

  it('is deterministic', () => {
    expect(buildConsoleContext(logs)).toBe(buildConsoleContext(logs));
  });
});

describe('buildConsoleChatPrompt', () => {
  it('includes context, prior turns, and the question', () => {
    const p = buildConsoleChatPrompt(
      logs,
      [{ role: 'user', content: 'what broke?' }, { role: 'assistant', content: 'a null deref' }],
      'how do I fix it?',
    );
    expect(p).toContain('## Current console state');
    expect(p).toContain('## Conversation so far');
    expect(p).toContain('User: what broke?');
    expect(p).toContain('Assistant: a null deref');
    expect(p).toContain('## Question\nhow do I fix it?');
  });

  it('omits the conversation section on the first turn', () => {
    const p = buildConsoleChatPrompt(logs, [], 'hi');
    expect(p).not.toContain('## Conversation so far');
  });
});
