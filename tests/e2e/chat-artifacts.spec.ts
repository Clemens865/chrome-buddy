// Chat artifact rendering — locks the promise that fenced code blocks in an
// agent reply surface as ArtifactCard items in the transcript, can be opened
// into a full-panel view, copied, downloaded, and closed back to chat.
//
// Deterministic: seeds an assistant message containing different fence
// shapes into IDB and verifies the rendered DOM. Uses the same seed pattern
// the other deterministic specs use.
import { test, expect } from './fixtures';
import { seedChat, openSeededChat, items } from './helpers/seed';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test.describe('Chat artifacts', () => {
  test('renders a single code block as a card with language + line count', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await seedChat(panel, {
      id: 'c_art_single',
      title: 'single code',
      items: [
        items.user('u1', 'show me a hello-world in python'),
        items.agent('a1', 'Here you go:\n\n```python\nprint("hello world")\nprint("bye")\n```\n\nThat\'s it.'),
      ],
    });
    await openSeededChat(panel, 'single code');

    // One artifact card rendered, with the language label + line count.
    const cards = panel.locator('.artifact-card');
    await expect(cards).toHaveCount(1);
    await expect(cards.first().locator('.artifact-card-title')).toContainText('python');
    await expect(cards.first().locator('.artifact-card-sub')).toContainText('python');
    await expect(cards.first().locator('.artifact-card-sub')).toContainText('2 lines');
    await panel.screenshot({ path: path.join(SHOTS, '200-artifact-single.png') });
  });

  test('renders multiple code blocks of different languages, each as its own card', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const reply = [
      'Here are three snippets:',
      '```javascript',
      'const x = 1;',
      '```',
      'And the matching TypeScript:',
      '```typescript',
      'const x: number = 1;',
      '```',
      'Plus the JSON:',
      '```json',
      '{"x": 1}',
      '```',
    ].join('\n\n');

    await seedChat(panel, {
      id: 'c_art_multi',
      title: 'multi lang',
      items: [items.user('u1', 'three snippets please'), items.agent('a1', reply)],
    });
    await openSeededChat(panel, 'multi lang');

    const cards = panel.locator('.artifact-card');
    await expect(cards).toHaveCount(3);
    const subs = await cards.locator('.artifact-card-sub').allTextContents();
    // Order is preserved (js → ts → json).
    expect(subs[0]).toMatch(/javascript/);
    expect(subs[1]).toMatch(/typescript/);
    expect(subs[2]).toMatch(/json/);
    await panel.screenshot({ path: path.join(SHOTS, '201-artifact-multi.png') });
  });

  test('interleaves prose with artifact cards in original order', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await seedChat(panel, {
      id: 'c_art_interleave',
      title: 'interleave',
      items: [
        items.user('u1', 'walk me through'),
        items.agent('a1', 'First, the imports:\n\n```python\nimport os\n```\n\nThen the body:\n\n```python\nprint(os.getcwd())\n```\n\nDone.'),
      ],
    });
    await openSeededChat(panel, 'interleave');

    // Prose paragraphs + 2 artifact cards, in document order.
    const msgBody = panel.locator('.msg-agent .msg-body').first();
    const children = msgBody.locator('> *');
    // Should be: prose → card → prose → card → prose (5 nodes minimum).
    const count = await children.count();
    expect(count).toBeGreaterThanOrEqual(5);
    // Card 0 follows the "First, the imports:" prose.
    const firstCard = panel.locator('.artifact-card').nth(0);
    const secondCard = panel.locator('.artifact-card').nth(1);
    await expect(firstCard).toBeVisible();
    await expect(secondCard).toBeVisible();
    // The "Done." prose sits AFTER the second card in DOM order.
    const cardBox = await secondCard.boundingBox();
    const doneText = panel.locator('.msg-agent .msg-body').getByText('Done.');
    const doneBox = await doneText.boundingBox();
    expect(doneBox!.y).toBeGreaterThan(cardBox!.y);
  });

  test('opening a card shows the full code in a <pre> + Back / Copy / Download', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const code = 'function hi() {\n  return "hello";\n}';
    await seedChat(panel, {
      id: 'c_art_open',
      title: 'open art',
      items: [
        items.user('u1', 'a function'),
        items.agent('a1', 'OK:\n\n```javascript\n' + code + '\n```'),
      ],
    });
    await openSeededChat(panel, 'open art');

    await panel.locator('.artifact-card').click();
    // Full view opens — back button, code block, Copy + Download.
    await expect(panel.locator('.artifact-view')).toBeVisible();
    await expect(panel.locator('.artifact-view pre code')).toContainText('function hi');
    await expect(panel.locator('.artifact-view pre code')).toContainText('return "hello"');
    await expect(panel.getByRole('button', { name: /^Copy$|^Copied$/ })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Download' })).toBeVisible();
    await panel.screenshot({ path: path.join(SHOTS, '202-artifact-opened.png') });

    // Back to chat — the card is still there, the full view is gone.
    await panel.getByRole('button', { name: 'Back to chat' }).click();
    await expect(panel.locator('.artifact-view')).toBeHidden();
    await expect(panel.locator('.artifact-card')).toBeVisible();
  });

  test('Copy button writes the code to the clipboard', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const code = 'SELECT * FROM users WHERE id=1;';
    await seedChat(panel, {
      id: 'c_art_copy',
      title: 'copy art',
      items: [items.user('u1', 'sql'), items.agent('a1', '```sql\n' + code + '\n```')],
    });
    await openSeededChat(panel, 'copy art');
    await panel.locator('.artifact-card').click();
    await panel.getByRole('button', { name: 'Copy' }).click();
    await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible();

    const clip = await panel.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(code);
  });

  test('does not create cards when the agent reply has no fenced code', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await seedChat(panel, {
      id: 'c_art_none',
      title: 'plain reply',
      items: [
        items.user('u1', 'hi'),
        items.agent('a1', 'Hi there! Just a plain text reply with **bold** and _italic_ but no fenced code.'),
      ],
    });
    await openSeededChat(panel, 'plain reply');

    await expect(panel.locator('.artifact-card')).toHaveCount(0);
    // The prose still renders as markdown.
    await expect(panel.locator('.msg-agent .msg-body strong')).toContainText('bold');
    await expect(panel.locator('.msg-agent .msg-body em')).toContainText('italic');
  });

  test('handles non-standard fence languages by falling back to text', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await seedChat(panel, {
      id: 'c_art_obscure',
      title: 'obscure',
      items: [
        items.user('u1', 'ada'),
        items.agent('a1', 'A rare lang:\n\n```ada\nput_line("hi");\n```'),
      ],
    });
    await openSeededChat(panel, 'obscure');

    // The card still renders. The language label uses whatever the fence said,
    // and the file-extension fallback for download will be .txt (unknown).
    const card = panel.locator('.artifact-card');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.artifact-card-sub')).toContainText('ada');
  });

  test('preserves whitespace and indentation inside the artifact body', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const code = 'def f(x):\n    if x:\n        return 1\n    return 0';
    await seedChat(panel, {
      id: 'c_art_indent',
      title: 'indent',
      items: [items.user('u1', 'indented'), items.agent('a1', '```python\n' + code + '\n```')],
    });
    await openSeededChat(panel, 'indent');
    await panel.locator('.artifact-card').click();
    const rendered = await panel.locator('.artifact-view pre code').textContent();
    expect(rendered).toBe(code);
  });
});
