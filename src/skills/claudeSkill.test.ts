import { describe, it, expect } from 'vitest';
import { parseClaudeSkill, looksLikeClaudeSkill } from './claudeSkill';

const SKILL_MD = `---
name: PDF Filler
description: Fills a PDF form from structured data
allowed-tools: read_file, write_file, frobnicate
---

# PDF Filler

Given a {{form}} and {{data}}, fill the fields and return the result.
Use the tools as needed.`;

describe('parseClaudeSkill', () => {
  it('maps frontmatter + body into an agent skill', () => {
    const s = parseClaudeSkill(SKILL_MD)!;
    expect(s.name).toBe('PDF Filler');
    expect(s.description).toBe('Fills a PDF form from structured data');
    expect(s.kind).toBe('agent');
    expect(s.prompt).toContain('fill the fields');
    expect(s.prompt).not.toContain('name: PDF Filler'); // frontmatter stripped
  });
  it('carries allowed-tools (for the review gate to flag unknowns)', () => {
    expect(parseClaudeSkill(SKILL_MD)!.allowedTools).toEqual(['read_file', 'write_file', 'frobnicate']);
  });
  it('detects {{inputs}} from the body', () => {
    expect(parseClaudeSkill(SKILL_MD)!.inputs).toEqual(['form', 'data']);
  });
  it('falls back to the first H1 when frontmatter has no name', () => {
    const s = parseClaudeSkill('# Quick Summary\n\nSummarize the input.')!;
    expect(s.name).toBe('Quick Summary');
    expect(s.kind).toBe('agent');
  });
  it('parses a bracketed/quoted tools list', () => {
    const s = parseClaudeSkill('---\nname: X\ntools: ["a", "b"]\n---\nbody')!;
    expect(s.allowedTools).toEqual(['a', 'b']);
  });
  it('returns null without a name or body', () => {
    expect(parseClaudeSkill('---\ndescription: no name\n---\n')).toBeNull();
    expect(parseClaudeSkill('   ')).toBeNull();
  });
});

describe('looksLikeClaudeSkill', () => {
  it('recognizes frontmatter or an H1', () => {
    expect(looksLikeClaudeSkill(SKILL_MD)).toBe(true);
    expect(looksLikeClaudeSkill('# Title\nbody')).toBe(true);
    expect(looksLikeClaudeSkill('{"schemaVersion":1,"skills":[]}')).toBe(false);
  });
});
