import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { skillFromRun, parseSkillBundle, toSkillBundle } from './skillData';
import { saveSkill, listSkills, deleteSkill } from './store';
import type { RunRecord } from '../memory/types';

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'r1', kind: 'agent', task: 'summarize the page', answer: 'ok', outcome: 'completed',
  toolCount: 1, tools: ['read_dom'], provenance: [], model: 'm', startedAt: 0, durationMs: 10, ...over,
});

afterEach(async () => {
  for (const s of await listSkills()) await deleteSkill(s.id);
});

describe('skillFromRun', () => {
  it('promotes a run to a skill', () => {
    const s = skillFromRun(run());
    expect(s.kind).toBe('agent');
    expect(s.prompt).toBe('summarize the page');
    expect(s.allowedTools).toEqual(['read_dom']);
  });
});

describe('parseSkillBundle', () => {
  it('imports valid skills and rejects junk', () => {
    const bundle = toSkillBundle([skillFromRun(run({ kind: 'chat', task: 'hi' }))]);
    const parsed = parseSkillBundle(JSON.stringify(bundle));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].prompt).toBe('hi');
    expect(parseSkillBundle('not json')).toHaveLength(0);
    expect(parseSkillBundle(JSON.stringify({ skills: [{ bad: true }] }))).toHaveLength(0);
  });
});

describe('skill store', () => {
  it('saves, lists, deletes', async () => {
    const s = skillFromRun(run());
    await saveSkill(s);
    let all = await listSkills();
    expect(all).toHaveLength(1);
    await deleteSkill(s.id);
    all = await listSkills();
    expect(all).toHaveLength(0);
  });
});
