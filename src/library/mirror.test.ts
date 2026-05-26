import { describe, it, expect } from 'vitest';
import { renderConversationAsMarkdown } from './mirror';
import type { Conversation } from '../chat/store';
import type { TranscriptItem } from '../agent';

function user(text: string): TranscriptItem {
  return { kind: 'user', id: `u_${text}`, text };
}
function agent(text: string): TranscriptItem {
  return { kind: 'agent', id: `a_${text}`, text };
}
function tool(): TranscriptItem {
  // @ts-expect-error structural — only the kind is checked by the renderer
  return { kind: 'tool', id: 't1', step: 0, call: { name: 'x', args: {} }, status: 'ok', verdict: 'ok' };
}
function err(text: string): TranscriptItem {
  return { kind: 'error', id: `e_${text}`, text };
}

const mkConv = (items: TranscriptItem[], title = 'My chat'): Conversation => ({
  id: 'c1',
  title,
  items,
  createdAt: 0,
  updatedAt: 0,
});

describe('renderConversationAsMarkdown', () => {
  it('headers the doc with the chat title', () => {
    const md = renderConversationAsMarkdown(mkConv([user('hi')], 'Project planning'));
    expect(md.startsWith('# Project planning')).toBe(true);
  });

  it('renders user + agent turns as labeled lines', () => {
    const md = renderConversationAsMarkdown(mkConv([user('hello'), agent('hi back')]));
    expect(md).toContain('**You:** hello');
    expect(md).toContain('**Buddy:** hi back');
  });

  it('skips tool calls entirely (operational noise)', () => {
    const md = renderConversationAsMarkdown(mkConv([user('q'), tool(), agent('a')]));
    expect(md).not.toMatch(/tool/i);
    // But the surrounding user/agent are still there.
    expect(md).toContain('**You:** q');
    expect(md).toContain('**Buddy:** a');
  });

  it('falls back to "Untitled chat" header when title is empty', () => {
    const md = renderConversationAsMarkdown(mkConv([user('hi')], ''));
    expect(md).toContain('# Untitled chat');
  });

  it('surfaces errors with an italic prefix', () => {
    const md = renderConversationAsMarkdown(mkConv([err('boom')]));
    expect(md).toContain('_Error: boom_');
  });
});
