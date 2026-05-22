// Skill authoring/editing helpers (FR-SKILL-4/5/6) + import consent (FR-SKILL-9/10).
// Pure + dependency-free so they're unit-tested; the SkillsView UI uses them.
import type { Skill } from './types';

/** Tools an imported skill may legitimately request (for unknown-tool flagging). */
export const KNOWN_TOOLS: readonly string[] = [
  'navigate',
  'click',
  'type',
  'scroll',
  'read_dom',
  'extract',
  'screenshot',
  'search_web',
  'send_webhook',
  'write_file',
  'read_file',
  'ask_user',
  'call_skill',
  'summarize',
];

/** Detect {{variable}} placeholders in a prompt, in first-seen order (FR-SKILL-5). */
export function detectSkillInputs(prompt: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([a-zA-Z][\w]*)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Substitute {{name}} with provided values (missing → left as-is). */
export function fillSkillPrompt(prompt: string, values: Record<string, string>): string {
  return prompt.replace(/\{\{\s*([a-zA-Z][\w]*)\s*\}\}/g, (whole, name: string) =>
    values[name] !== undefined ? values[name] : whole,
  );
}

const idOf = () => `skill_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Build/normalize a skill from editor fields (re-detects inputs from the prompt). */
export function makeSkill(fields: {
  id?: string;
  name: string;
  description?: string;
  kind: 'chat' | 'agent';
  prompt: string;
  allowedTools?: string[];
  createdAt?: number;
}): Skill {
  return {
    id: fields.id ?? idOf(),
    name: fields.name.trim() || 'Untitled skill',
    description: (fields.description ?? '').trim(),
    kind: fields.kind,
    prompt: fields.prompt,
    allowedTools: fields.allowedTools?.filter(Boolean),
    inputs: detectSkillInputs(fields.prompt),
    createdAt: fields.createdAt ?? Date.now(),
  };
}

export interface ImportReview {
  skill: Skill;
  /** Tools the skill requests (its allowedTools). */
  tools: string[];
  /** Requested tools we don't recognize (flagged for the user — FR-SKILL-10). */
  unknownTools: string[];
}

/** Summarize an imported bundle for the consent screen (FR-SKILL-9/10). */
export function reviewImport(skills: Skill[]): ImportReview[] {
  const known = new Set(KNOWN_TOOLS);
  return skills.map((skill) => {
    const tools = skill.allowedTools ?? [];
    return { skill, tools, unknownTools: tools.filter((t) => !known.has(t)) };
  });
}
