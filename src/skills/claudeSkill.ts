// Import an Anthropic "Agent Skill" (a SKILL.md: YAML frontmatter + markdown
// instructions) as a Chrome Buddy agent skill. We import the INSTRUCTIONAL part
// only — bundled scripts/resources are NOT executed (MV3 no-remote-code), and
// any `allowed-tools` are carried through the existing import review so unknown
// tools are flagged. Pure + testable; no I/O.
import { makeSkill } from './edit';
import type { Skill } from './types';

/** Read a top-level `key: value` from YAML frontmatter (quotes stripped). */
function frontValue(front: string, key: string): string {
  const m = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'mi').exec(front);
  return m ? m[1].trim().replace(/^["']|["']$/g, '').trim() : '';
}

/** Split a comma/newline/bracket list of tool names from frontmatter. */
function parseToolList(raw: string): string[] {
  return raw
    .replace(/^\[|\]$/g, '')
    .split(/[,\n]/)
    .map((s) => s.replace(/^[-\s]+/, '').replace(/["']/g, '').trim())
    .filter(Boolean);
}

/**
 * Parse a SKILL.md into a Chrome Buddy agent skill, or null if there's no
 * usable name + instruction body. Frontmatter `name`/`description` map to the
 * skill's fields; the markdown body becomes the prompt; `allowed-tools`/`tools`
 * carry through to the review gate.
 */
export function parseClaudeSkill(md: string): Skill | null {
  if (typeof md !== 'string' || !md.trim()) return null;
  const text = md.replace(/\r\n/g, '\n').trim();

  let name = '';
  let description = '';
  let body = text;
  let allowedTools: string[] | undefined;

  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) {
    const front = fm[1];
    body = text.slice(fm[0].length).trim();
    name = frontValue(front, 'name');
    description = frontValue(front, 'description');
    const toolsRaw = frontValue(front, 'allowed-tools') || frontValue(front, 'tools');
    if (toolsRaw) {
      const list = parseToolList(toolsRaw);
      if (list.length) allowedTools = list;
    }
  }

  // Fall back to the first markdown H1 for the name when no frontmatter name.
  if (!name) {
    const h1 = /^#\s+(.+)$/m.exec(body);
    if (h1) name = h1[1].trim();
  }

  if (!name || !body) return null;
  return makeSkill({ name, description, kind: 'agent', prompt: body, allowedTools });
}

/** True if a file's text looks like a Claude SKILL.md (frontmatter or an H1). */
export function looksLikeClaudeSkill(text: string): boolean {
  const t = text.replace(/\r\n/g, '\n').trimStart();
  return t.startsWith('---\n') || /^#\s+\S/m.test(t);
}
