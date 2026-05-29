// Import a Claude Agent Skill (SKILL.md) → it becomes a Chrome Buddy agent
// skill via the existing review gate, which flags any unknown tools. The
// instruction body is imported; bundled scripts are not run (MV3 no-RCE).
// Run with: npm run test:e2e:claudeskill
import { test, expect } from './fixtures';

const SKILL_MD = `---
name: PDF Filler
description: Fill a PDF form from structured data
allowed-tools: read_file, write_file, frobnicate
---

# PDF Filler

Given a {{form}} and {{data}}, fill the fields and return the result.`;

test('import a Claude SKILL.md → review (unknown tool flagged) → saved as a skill', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Skills', exact: true }).click();

  // Feed a SKILL.md into the (shared) skills import input.
  await panel.locator('input[type="file"]').setInputFiles({ name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from(SKILL_MD) });

  // Review screen: the skill is named, its tools listed, and the unknown one
  // (frobnicate) flagged — read_file/write_file are known.
  await expect(panel.getByText('Import skills — review')).toBeVisible({ timeout: 5_000 });
  await expect(panel.locator('.stub-row-title', { hasText: 'PDF Filler' })).toBeVisible();
  await expect(panel.getByText(/unknown: .*frobnicate/)).toBeVisible();

  // Confirm → it lands in the skills list as a real skill.
  await panel.getByRole('button', { name: /Import 1 skill/ }).click();
  await expect(panel.locator('.stub-row-title', { hasText: 'PDF Filler' })).toBeVisible({ timeout: 5_000 });
});
