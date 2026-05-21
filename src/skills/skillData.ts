// Pure helpers for building/validating skills (no IndexedDB) — unit-testable.
import type { RunRecord } from '../memory/types';
import type { Skill, SkillBundle } from './types';
import { SKILL_SCHEMA_VERSION } from './types';

let counter = 0;
function newId(): string {
  return `skill_${Date.now()}_${(counter++).toString(36)}`;
}

/** Promote a completed run into a reusable skill (PRD FR-SKILL-3). */
export function skillFromRun(run: RunRecord, name?: string): Skill {
  return {
    id: newId(),
    name: (name ?? run.task).slice(0, 80),
    description: run.kind === 'agent' ? 'Agent task' : 'Chat prompt',
    kind: run.kind,
    prompt: run.task,
    allowedTools: run.tools.length ? Array.from(new Set(run.tools)) : undefined,
    createdAt: Date.now(),
  };
}

function isSkill(v: unknown): v is Skill {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.name === 'string' &&
    typeof s.prompt === 'string' &&
    (s.kind === 'chat' || s.kind === 'agent')
  );
}

/** Validate + normalize an imported bundle, assigning fresh ids/timestamps. */
export function parseSkillBundle(json: string): Skill[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const raw = (data as SkillBundle | undefined)?.skills;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSkill).map((s) => ({
    id: newId(),
    name: s.name.slice(0, 80),
    description: typeof s.description === 'string' ? s.description : '',
    kind: s.kind,
    prompt: s.prompt,
    allowedTools: Array.isArray(s.allowedTools) ? s.allowedTools : undefined,
    createdAt: Date.now(),
  }));
}

export function toSkillBundle(skills: Skill[]): SkillBundle {
  return { schemaVersion: SKILL_SCHEMA_VERSION, skills };
}
