// Visual capture only — opens the Webhook Flows editor at the snapshot section
// after you reported the radios were stretched. Keeps a screenshot at
// screenshots/123-webhook-flow-editor.png so the fix is visually verifiable.
import { test } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('visual: Webhook Flows editor renders radios + toggles correctly', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Need a webhook in the dropdown.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByTestId('webhook-name').fill('Visual Hook');
  await panel.getByTestId('webhook-url').fill('https://example.com/x');
  await panel.getByTestId('webhook-add').click();

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Webhook Flows', { exact: true }).click();
  await panel.getByTestId('wf-new-flow').click();
  await panel.getByTestId('wf-name').fill('Visual flow');
  // Screenshot the editor as it stands now — radios sit tight to their labels.
  await panel.screenshot({ path: path.join(SHOTS, '123-webhook-flow-editor.png') });
});
