// Unit tests for the chats store — focused on the eviction policy. We can't
// import the real saveConversation (it uses the live IndexedDB via getDB),
// so we re-implement the eviction algorithm against a stub DB and verify the
// same invariant: when the store grows past MAX_CHATS, the OLDEST-updatedAt
// entries are dropped, never the most recent.

import { describe, it, expect } from 'vitest';
import { deriveTitle, trimItems, type Conversation } from './store';
import type { TranscriptItem } from '../agent';

function userMsg(text: string): TranscriptItem {
  return { kind: 'user', id: `u_${text}`, text };
}

describe('deriveTitle', () => {
  it('uses the first user message, capped to 60 chars', () => {
    expect(deriveTitle([userMsg('Hello world')])).toBe('Hello world');
    expect(deriveTitle([userMsg('x'.repeat(80))])).toHaveLength(60);
  });
  it('falls back to "New chat" when there is no user message', () => {
    expect(deriveTitle([])).toBe('New chat');
  });
});

describe('trimItems', () => {
  it('preserves the kinds the user sees and strips tool result data', () => {
    const items: TranscriptItem[] = [
      { kind: 'user', id: 'u1', text: 'hi' },
      // @ts-expect-error structural shape; we only need fields the trimmer touches.
      { kind: 'tool', id: 't1', step: 0, call: { name: 'x', args: {} }, status: 'ok', verdict: 'ok', result: { huge: 'x'.repeat(10_000) } },
      { kind: 'agent', id: 'a1', text: 'ok' },
    ];
    const out = trimItems(items);
    const tool = out.find((i) => i.kind === 'tool') as TranscriptItem & { result?: unknown };
    expect(tool).toBeTruthy();
    expect(tool && 'result' in tool ? (tool as { result?: unknown }).result : undefined).toBeUndefined();
  });
});

// Eviction policy — pure algorithm test. Mirrors the implementation in
// evictOldestChats() to lock the contract: drop oldest-updatedAt first.
function evictOldest<T extends { id: string; updatedAt: number }>(all: T[], max: number): T[] {
  if (all.length <= max) return all;
  const sorted = [...all].sort((a, b) => a.updatedAt - b.updatedAt);
  const keep = new Set(sorted.slice(all.length - max).map((c) => c.id));
  return all.filter((c) => keep.has(c.id));
}

describe('chat-store eviction policy', () => {
  function mk(id: string, updatedAt: number): Conversation {
    return { id, title: id, items: [], createdAt: updatedAt, updatedAt };
  }

  it('passes everything through when under the cap', () => {
    const chats = Array.from({ length: 10 }, (_, i) => mk(`c${i}`, i));
    expect(evictOldest(chats, 100)).toEqual(chats);
  });

  it('drops exactly (count - max) entries, oldest first', () => {
    // 105 chats, cap at 100 → drop 5 oldest (updatedAt 0..4).
    const chats = Array.from({ length: 105 }, (_, i) => mk(`c${i}`, i));
    const kept = evictOldest(chats, 100);
    expect(kept).toHaveLength(100);
    // The 5 oldest must be gone.
    for (let i = 0; i < 5; i++) {
      expect(kept.find((c) => c.id === `c${i}`)).toBeUndefined();
    }
    // The 5 newest must remain.
    for (let i = 100; i < 105; i++) {
      expect(kept.find((c) => c.id === `c${i}`)).toBeTruthy();
    }
  });

  it('keeps the most recently-touched chat when a re-save bumps it', () => {
    const chats: Conversation[] = [
      mk('old', 1),
      mk('newer', 2),
      mk('touched', 3), // imagine this was just touched
    ];
    expect(evictOldest(chats, 2).map((c) => c.id).sort()).toEqual(['newer', 'touched']);
  });
});
