import { describe, it, expect } from 'vitest';
import { parseDecomposition, MAX_SUBTASKS } from './decompose';

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
