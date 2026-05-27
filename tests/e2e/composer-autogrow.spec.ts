// Locks the composer's auto-grow behavior:
//   - empty / one line: roughly one row tall
//   - typing multiple lines: grows
//   - past the cap (50vh): scrolls instead of pushing the page up
//   - clearing collapses back to one row
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('composer textarea auto-grows then scrolls at 50vh', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const ta = panel.locator('.composer-input');
  await expect(ta).toBeVisible({ timeout: 8_000 });

  // 1) Empty textarea: roughly one line tall.
  const h0 = (await ta.boundingBox())!.height;
  expect(h0).toBeGreaterThan(0);
  expect(h0).toBeLessThan(60); // single-row + padding ≈ 22-40px

  // 2) Type a few lines (Enter is intercepted as Send, so use Shift+Enter).
  await ta.click();
  for (let i = 0; i < 4; i++) {
    await ta.pressSequentially(`line ${i + 1}`);
    await ta.press('Shift+Enter');
  }
  const h1 = (await ta.boundingBox())!.height;
  expect(h1).toBeGreaterThan(h0 + 30); // grew at least one row of headroom

  await panel.screenshot({ path: path.join(SHOTS, '161-composer-grown.png') });

  // 3) Type WAY more than 50vh's worth of lines — height must NOT exceed the
  // 50vh cap (490px on our 980px viewport, with a small fudge for line-rounding).
  await ta.focus();
  for (let i = 0; i < 60; i++) {
    await ta.press('Shift+Enter');
  }
  const h2 = (await ta.boundingBox())!.height;
  expect(h2).toBeGreaterThan(h1);
  expect(h2).toBeLessThanOrEqual(500); // 50vh of 980 + a hair

  // It MUST be scrollable now — content height exceeds the cap.
  const isScrollable = await ta.evaluate(
    (el) => (el as HTMLTextAreaElement).scrollHeight > el.clientHeight,
  );
  expect(isScrollable).toBe(true);

  await panel.screenshot({ path: path.join(SHOTS, '162-composer-capped.png') });

  // 4) Clear input → height collapses back near the starting value.
  await ta.fill('');
  const h3 = (await ta.boundingBox())!.height;
  expect(Math.abs(h3 - h0)).toBeLessThan(8); // back to ~one row
});
