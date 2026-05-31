import { describe, it, expect } from 'vitest';
import {
  parseDecomposition,
  drainSubtasks,
  composeContext,
  MAX_SUBTASKS,
  type SubTask,
  type SubtaskEvent,
} from './decompose';

const st = (id: string, goal: string): SubTask => ({ id, goal, role: 'general', status: 'pending' });

describe('parseDecomposition', () => {
  it('returns sub-tasks with stable ids + validated roles', () => {
    const r = parseDecomposition(
      '{"subtasks":[{"goal":"Research pricing on 3 sites","role":"researcher"},{"goal":"Compile a table","role":"summarizer"}]}',
    );
    expect(r).toEqual([
      { id: 'st1', goal: 'Research pricing on 3 sites', role: 'researcher', status: 'pending' },
      { id: 'st2', goal: 'Compile a table', role: 'summarizer', status: 'pending' },
    ]);
  });

  it('floor: opting out ({"subtasks":[]}) → null (run the single loop)', () => {
    expect(parseDecomposition('{"subtasks":[]}')).toBeNull();
  });

  it('floor: a single sub-task is pointless → null', () => {
    expect(parseDecomposition('{"subtasks":[{"goal":"Summarize this page"}]}')).toBeNull();
  });

  it('caps fan-out at MAX_SUBTASKS (the "spawn 100" guard)', () => {
    const many = Array.from({ length: 30 }, (_, i) => `{"goal":"task ${i}"}`).join(',');
    const r = parseDecomposition(`{"subtasks":[${many}]}`);
    expect(r).toHaveLength(MAX_SUBTASKS);
    expect(r?.[MAX_SUBTASKS - 1].id).toBe(`st${MAX_SUBTASKS}`);
  });

  it('defaults an unknown/missing role to general', () => {
    const r = parseDecomposition('{"subtasks":[{"goal":"a","role":"hacker"},{"goal":"b"}]}');
    expect(r?.map((s) => s.role)).toEqual(['general', 'general']);
  });

  it('drops goalless entries, then re-applies the floor', () => {
    // Two entries but one has no goal → only 1 usable → floor → null.
    expect(parseDecomposition('{"subtasks":[{"goal":"a"},{"role":"researcher"}]}')).toBeNull();
  });

  it('tolerates a ```json fence and prose around the JSON', () => {
    const r = parseDecomposition('```json\n{"subtasks":[{"goal":"a"},{"goal":"b"}]}\n```');
    expect(r).toHaveLength(2);
    expect(parseDecomposition('Sure! {"subtasks":[{"goal":"a"},{"goal":"b"}]} done')).toHaveLength(2);
  });

  it('returns null for junk / non-JSON', () => {
    expect(parseDecomposition('not json')).toBeNull();
    expect(parseDecomposition('')).toBeNull();
    expect(parseDecomposition('{"nope":1}')).toBeNull();
  });
});

describe('drainSubtasks', () => {
  it('runs sequentially and hands each sub-task the prior digests', async () => {
    const seen: string[] = [];
    const out = await drainSubtasks([st('st1', 'research'), st('st2', 'compile')], {
      runSubtask: async (s, prior) => {
        seen.push(`${s.id}:${prior}`);
        return { digest: `${s.id}-done`, ok: true };
      },
    });
    expect(out.map((s) => s.status)).toEqual(['done', 'done']);
    expect(out[1].digest).toBe('st2-done');
    // st1 sees empty context; st2 sees st1's digest folded in.
    expect(seen[0]).toBe('st1:');
    expect(seen[1]).toContain('st1-done');
    expect(seen[1]).toContain('research');
  });

  it('a failed sub-task does not abort the drain (graceful partial)', async () => {
    const out = await drainSubtasks([st('st1', 'a'), st('st2', 'b')], {
      runSubtask: async (s) => (s.id === 'st1' ? { digest: 'boom', ok: false } : { digest: 'ok', ok: true }),
    });
    expect(out.map((s) => s.status)).toEqual(['failed', 'done']);
  });

  it('a thrown sub-task is captured as failed, drain continues', async () => {
    const out = await drainSubtasks([st('st1', 'a'), st('st2', 'b')], {
      runSubtask: async (s) => {
        if (s.id === 'st1') throw new Error('kaboom');
        return { digest: 'ok', ok: true };
      },
    });
    expect(out[0]).toMatchObject({ status: 'failed', digest: 'kaboom' });
    expect(out[1].status).toBe('done');
  });

  it('a tripped budget skips the remaining sub-tasks without running them', async () => {
    let ran = 0;
    const out = await drainSubtasks([st('st1', 'a'), st('st2', 'b'), st('st3', 'c')], {
      runSubtask: async () => {
        ran += 1;
        return { digest: 'ok', ok: true };
      },
      checkStop: () => (ran >= 1 ? 'Cost budget reached.' : null),
    });
    expect(ran).toBe(1);
    expect(out.map((s) => s.status)).toEqual(['done', 'failed', 'failed']);
    expect(out[1].digest).toContain('skipped');
  });

  it('emits start + result events per sub-task in order', async () => {
    const events: SubtaskEvent[] = [];
    await drainSubtasks([st('st1', 'a'), st('st2', 'b')], {
      runSubtask: async () => ({ digest: 'd', ok: true }),
      onEvent: (e) => events.push(e),
    });
    expect(events.map((e) => `${e.type}:${e.id}`)).toEqual([
      'subtask_start:st1',
      'subtask_result:st1',
      'subtask_start:st2',
      'subtask_result:st2',
    ]);
  });

  it('composeContext joins completed digests under their goals', () => {
    const done: SubTask[] = [
      { id: 'st1', goal: 'research', role: 'researcher', status: 'done', digest: 'found X' },
      { id: 'st2', goal: 'compile', role: 'summarizer', status: 'failed' },
    ];
    expect(composeContext(done)).toBe('## research\nfound X');
  });
});
