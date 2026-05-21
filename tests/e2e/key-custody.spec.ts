// NFR-SEC-1: the API key must live ONLY in chrome.storage.session (in-memory),
// never chrome.storage.local (disk). Run: npm run test:e2e:keycustody
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');
const TEST_KEY = 'sk-test-session-ONLY-123';

test('API key is stored in session, never in local', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Store a key via the real KEY_SET handler.
  await panel.evaluate(
    (key) => chrome.runtime.sendMessage({ type: 'KEY_SET', provider: 'google-gemini', key }),
    TEST_KEY,
  );

  const where = await panel.evaluate(async () => ({
    session: (await chrome.storage.session.get('apiKey:google-gemini'))['apiKey:google-gemini'],
    local: (await chrome.storage.local.get('apiKey:google-gemini'))['apiKey:google-gemini'],
  }));

  expect(where.session).toBe(TEST_KEY);
  expect(where.local).toBeUndefined(); // NEVER on disk

  // Settings reflects a key is set.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByText('Key set')).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '35-key-session.png') });

  // Cleanup: clear the test key.
  await panel.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'KEY_SET', provider: 'google-gemini', key: '' }),
  );
});
