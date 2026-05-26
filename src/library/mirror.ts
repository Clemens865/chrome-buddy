// Auto-mirror hooks — UI-side. Call these AFTER saveConversation / saveNote
// to push the same content into the library RAG index. The SW side
// (executeIndexDoc) is idempotent (contentHash skip), so calling on every
// save is cheap when nothing changed.
//
// Fire-and-forget by design: if embedding fails (no API key, offline, rate
// limit), the chat / note was still saved successfully — the library just
// won't have it yet. The next save with changed content will retry.

import type { Conversation } from '../chat/store';
import type { Note } from '../notes/store';
import type { TranscriptItem } from '../agent';

/** Render a conversation transcript into a single markdown blob suitable for
 * chunking + embedding. Tool calls are skipped (too noisy for RAG); plans
 * surface as a single-line marker; errors surface as "Error:" lines. */
export function renderConversationAsMarkdown(conv: Conversation): string {
  const lines: string[] = [];
  lines.push(`# ${conv.title || 'Untitled chat'}`);
  lines.push('');
  for (const item of conv.items) {
    const md = itemToMarkdown(item);
    if (md) {
      lines.push(md);
      lines.push('');
    }
  }
  return lines.join('\n').trim();
}

function itemToMarkdown(item: TranscriptItem): string | null {
  switch (item.kind) {
    case 'user':
      return `**You:** ${item.text}`;
    case 'agent':
      return `**Buddy:** ${item.text}`;
    case 'error':
      return `_Error: ${item.text}_`;
    case 'plan':
      // Plans hold a `plan` array of PlanStep; render as a compact summary.
      return `_Plan with ${item.plan?.length ?? 0} step(s)._`;
    case 'tool':
      // Skip tool calls — they're operational noise for RAG.
      return null;
    default:
      return null;
  }
}

/** Fire-and-forget mirror of a conversation into the library. */
export function mirrorChat(conv: Conversation): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  const content = renderConversationAsMarkdown(conv);
  if (!content.trim()) return;
  // Drop the response — we don't need to block the UI on indexing.
  void chrome.runtime.sendMessage({
    type: 'LIBRARY_INDEX',
    source: 'chat',
    sourceRef: conv.id,
    title: conv.title || 'Untitled chat',
    content,
  });
}

/** Fire-and-forget mirror of a note into the library. */
export function mirrorNote(note: Note): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  if (!note.content?.trim()) return;
  void chrome.runtime.sendMessage({
    type: 'LIBRARY_INDEX',
    source: 'note',
    sourceRef: note.key,
    title: note.key,
    content: note.content,
  });
}
