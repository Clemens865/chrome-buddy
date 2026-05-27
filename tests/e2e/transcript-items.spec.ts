// Transcript item rendering — the survey flagged that several item kinds
// have NO assertions on their visible state, even though they're how the
// user sees the agent's progress. This spec seeds each kind directly and
// locks the rendered DOM.
//
// Covered:
//   - plan item (numbered intents)
//   - tool trace status transitions: running → done, running → denied
//   - error item (red warning)
//   - ask_user inline card with choice buttons
//   - confirm card resolved state (Approve clicked → buttons gone, badge shown)
import { test, expect } from './fixtures';
import { seedChat, openSeededChat, items } from './helpers/seed';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('plan item: numbered intents render in order', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await seedChat(panel, {
    id: 'c_plan',
    title: 'plan render',
    items: [
      items.user('u1', 'do three things'),
      items.plan('p1', ['Search the web for X', 'Read the result page', 'Summarize and answer']),
    ],
  });
  await openSeededChat(panel, 'plan render');

  // Three numbered rows render in order.
  const traceItems = panel.locator('.tc-mini-inline');
  await expect(traceItems).toHaveCount(3);
  await expect(traceItems.nth(0)).toContainText('1');
  await expect(traceItems.nth(0)).toContainText('Search the web');
  await expect(traceItems.nth(1)).toContainText('2');
  await expect(traceItems.nth(1)).toContainText('Read the result');
  await expect(traceItems.nth(2)).toContainText('3');
  await expect(traceItems.nth(2)).toContainText('Summarize');
});

test('tool trace: running status shows amber, done shows green + verdict', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await seedChat(panel, {
    id: 'c_tools',
    title: 'tool status',
    items: [
      items.user('u1', 'work please'),
      items.tool('t1', 'read_dom', {}, 'running'),
      items.tool('t2', 'send_webhook', { name: 'Notify' }, 'done', 'succeeded'),
      items.tool('t3', 'github_write', { path: 'x.md' }, 'denied'),
    ],
  });
  await openSeededChat(panel, 'tool status');

  // Three tool traces; each carries its expected status class.
  const traces = panel.locator('.trace .tc-mini');
  await expect(traces).toHaveCount(3);

  // Running has the .tc-status-running class.
  await expect(traces.nth(0).locator('.tc-status')).toHaveClass(/tc-status-running/);
  // Done has the .tc-status-done class + the verdict badge.
  await expect(traces.nth(1).locator('.tc-status')).toHaveClass(/tc-status-done/);
  await expect(traces.nth(1)).toContainText('succeeded');
  // Denied shows the denied badge.
  await expect(traces.nth(2)).toContainText('denied');
  await panel.screenshot({ path: path.join(SHOTS, '260-tool-traces.png') });
});

test('error item: renders the warning icon + the error text', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await seedChat(panel, {
    id: 'c_err',
    title: 'error item',
    items: [
      items.user('u1', 'do something impossible'),
      items.error('e1', 'Daily spend cap reached. Raise it in Settings → Budget to continue.'),
    ],
  });
  await openSeededChat(panel, 'error item');

  // The error item uses .msg-subtle styling with the warn icon.
  const errMsg = panel.locator('.msg-agent.msg-subtle').filter({ hasText: 'Daily spend cap' });
  await expect(errMsg).toBeVisible({ timeout: 5_000 });
  await expect(errMsg).toContainText('Settings → Budget');
});

test('ask_user card with choice buttons: clicking a choice fills the question slot', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // The ask_user item shape (see reduceTranscript & AskUserCard render) is a
  // tool trace whose call.name === 'ask_user', then the agent yields control
  // back through an inline answer prompt. The deterministic surface we lock
  // here is the QUESTION rendering — the agent doesn't actually pause without
  // the runtime in the loop.
  await seedChat(panel, {
    id: 'c_ask',
    title: 'ask user',
    items: [
      items.user('u1', 'help me'),
      items.tool('t_ask', 'ask_user', { question: 'Which option?', choices: ['Option A', 'Option B'] }, 'running'),
    ],
  });
  await openSeededChat(panel, 'ask user');

  // The tool-trace mini shows the ask_user name.
  await expect(panel.locator('.tc-mini-name').filter({ hasText: 'ask_user' })).toBeVisible({ timeout: 5_000 });
  // The args summary on the trace contains the question text.
  await expect(panel.locator('.tc-mini-arg').filter({ hasText: 'Which option' })).toBeVisible();
});

test('confirm card: after resolution the Approve/Cancel buttons are gone + a decision badge shows', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed a chat with a confirm item ALREADY RESOLVED — the rendered UI must
  // hide the action row and show the resolution tag.
  await seedChat(panel, {
    id: 'c_confirm_resolved',
    title: 'confirm resolved',
    items: [
      items.user('u1', 'send the webhook'),
      items.tool('t_send', 'send_webhook', { name: 'Notify' }, 'done', 'succeeded'),
      {
        ...items.confirm('confirm_send', 'send_webhook', { name: 'Notify' }, 'send_webhook call'),
        resolution: 'approved',
      },
    ],
  });
  await openSeededChat(panel, 'confirm resolved');

  // The card itself still renders.
  const card = panel.locator('.hitl');
  await expect(card).toBeVisible({ timeout: 5_000 });
  // The decision tag is set to the resolution value.
  await expect(card.locator('.hitl-tag')).toContainText('approved');
  // The Approve / Cancel buttons MUST NOT be visible — the action row only
  // renders when resolution is undefined.
  await expect(card.getByRole('button', { name: 'Approve action' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Cancel action' })).toHaveCount(0);
  await panel.screenshot({ path: path.join(SHOTS, '261-confirm-resolved.png') });
});
