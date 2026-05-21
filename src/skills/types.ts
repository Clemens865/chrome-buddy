// A Skill is DATA, not code (MV3 / Web Store compliant): a saved, named,
// parameterized request the user can re-run. (PRD FR-SKILL-1.)
export interface Skill {
  id: string;
  name: string;
  description: string;
  /** How to run it: cheap plain chat, or the agent loop. */
  kind: 'chat' | 'agent';
  /** The task/prompt to run. */
  prompt: string;
  /** Optional whitelist of tools the agent may use for this skill. */
  allowedTools?: string[];
  createdAt: number;
}

export const SKILL_SCHEMA_VERSION = 1;

/** Portable export envelope (import/export as JSON). */
export interface SkillBundle {
  schemaVersion: number;
  skills: Skill[];
}
