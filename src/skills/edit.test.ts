import { describe, it, expect } from 'vitest';
import { detectSkillInputs, fillSkillPrompt, makeSkill, reviewImport } from './edit';
import type { Skill } from './types';

describe('detectSkillInputs', () => {
  it('finds unique {{vars}} in order', () => {
    expect(detectSkillInputs('Compare {{competitors}} and email {{ recipient }}, then {{competitors}}')).toEqual([
      'competitors',
      'recipient',
    ]);
  });
  it('returns [] when none', () => {
    expect(detectSkillInputs('just a plain prompt')).toEqual([]);
  });
});

describe('fillSkillPrompt', () => {
  it('substitutes provided values, leaves missing ones', () => {
    expect(fillSkillPrompt('Hi {{name}}, re {{topic}}', { name: 'Ada' })).toBe('Hi Ada, re {{topic}}');
  });
});

describe('makeSkill', () => {
  it('normalizes fields and auto-detects inputs', () => {
    const s = makeSkill({ name: '  Pricing  ', kind: 'agent', prompt: 'pricing for {{company}}', allowedTools: ['navigate', ''] });
    expect(s.name).toBe('Pricing');
    expect(s.inputs).toEqual(['company']);
    expect(s.allowedTools).toEqual(['navigate']);
    expect(s.id).toMatch(/^skill_/);
  });
});

describe('reviewImport', () => {
  it('flags unknown requested tools (FR-SKILL-10)', () => {
    const skills: Skill[] = [
      { id: '1', name: 'A', description: '', kind: 'agent', prompt: 'x', allowedTools: ['navigate', 'frobnicate'], createdAt: 1 },
    ];
    const review = reviewImport(skills);
    expect(review[0].tools).toEqual(['navigate', 'frobnicate']);
    expect(review[0].unknownTools).toEqual(['frobnicate']);
  });
});
