// Pure-function tests for the Webhook Flows payload composer. No IDB, no
// chrome. Locks the exact wire format we promise receivers (snake_case keys,
// optional sections omitted instead of present-with-empty, variable substitution).
import { describe, it, expect } from 'vitest';
import { buildFlowPayload, substituteTemplate, type PageSnapshotInput } from './snapshot';
import type { WebhookFlow } from './store';

const FIXED_NOW = new Date('2026-05-26T12:00:00.000Z');

function makeFlow(overrides: Partial<WebhookFlow> = {}): WebhookFlow {
  return {
    id: 'flw_test',
    name: 'Send to n8n',
    categoryName: 'Research',
    webhookName: 'n8n research',
    snapshotMode: 'text',
    includeSelection: true,
    includeProfile: true,
    trustNoConfirm: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const PAGE: PageSnapshotInput = {
  url: 'https://example.com/article',
  title: 'Example article',
  text: 'Hello world.',
  selectedText: 'Hello',
  html: '<html><body><p>Hello world.</p></body></html>',
};

describe('substituteTemplate', () => {
  it('replaces {url}, {title}, {selected_text}', () => {
    const out = substituteTemplate('Summarize {title} from {url}: {selected_text}', {
      url: 'https://a',
      title: 'T',
      selected_text: 'S',
    });
    expect(out).toBe('Summarize T from https://a: S');
  });

  it('leaves unknown variables untouched', () => {
    const out = substituteTemplate('Hi {who}, page {title}', {
      url: '',
      title: 'X',
      selected_text: '',
    });
    expect(out).toBe('Hi {who}, page X');
  });
});

describe('buildFlowPayload', () => {
  it('omits page block when snapshotMode is none', () => {
    const out = buildFlowPayload({
      flow: makeFlow({ snapshotMode: 'none' }),
      page: PAGE,
      profile: null,
      now: FIXED_NOW,
    });
    expect(out.page).toBeUndefined();
    expect(out.source).toBe('chrome-buddy');
    expect(out.version).toBe(1);
    expect(out.timestamp).toBe(FIXED_NOW.toISOString());
  });

  it('snapshotMode meta sends url+title only (no text, no html)', () => {
    const out = buildFlowPayload({
      flow: makeFlow({ snapshotMode: 'meta' }),
      page: PAGE,
      profile: null,
      now: FIXED_NOW,
    });
    expect(out.page).toEqual({
      url: PAGE.url,
      title: PAGE.title,
      selected_text: 'Hello',
    });
  });

  it('snapshotMode text sends url+title+text (no html)', () => {
    const out = buildFlowPayload({
      flow: makeFlow({ snapshotMode: 'text', includeSelection: false }),
      page: PAGE,
      profile: null,
      now: FIXED_NOW,
    });
    expect(out.page).toEqual({
      url: PAGE.url,
      title: PAGE.title,
      text: 'Hello world.',
    });
    expect(out.page).not.toHaveProperty('html');
    expect(out.page).not.toHaveProperty('selected_text');
  });

  it('snapshotMode full sends url+title+text+html', () => {
    const out = buildFlowPayload({
      flow: makeFlow({ snapshotMode: 'full', includeSelection: false }),
      page: PAGE,
      profile: null,
      now: FIXED_NOW,
    });
    expect(out.page).toEqual({
      url: PAGE.url,
      title: PAGE.title,
      text: 'Hello world.',
      html: PAGE.html,
    });
  });

  it('omits profile block entirely when all profile fields are empty', () => {
    const out = buildFlowPayload({
      flow: makeFlow({ includeProfile: true }),
      page: PAGE,
      profile: {},
      now: FIXED_NOW,
    });
    expect(out.profile).toBeUndefined();
  });

  it('only includes the profile fields that have values', () => {
    const out = buildFlowPayload({
      flow: makeFlow({ includeProfile: true }),
      page: PAGE,
      profile: { name: 'Clemens', about: '' }, // role/about empty → omitted
      now: FIXED_NOW,
    });
    expect(out.profile).toEqual({ name: 'Clemens' });
  });

  it('skips profile when includeProfile is false', () => {
    const out = buildFlowPayload({
      flow: makeFlow({ includeProfile: false }),
      page: PAGE,
      profile: { name: 'Clemens' },
      now: FIXED_NOW,
    });
    expect(out.profile).toBeUndefined();
  });

  it('substitutes {url}/{title}/{selected_text} inside prompt.userPrompt', () => {
    const out = buildFlowPayload({
      flow: makeFlow({
        prompt: {
          name: 'summarize',
          systemPrompt: 'You are a summarizer.',
          userPrompt: 'Summarize "{title}" ({url}). Highlight: {selected_text}',
        },
      }),
      page: PAGE,
      profile: null,
      now: FIXED_NOW,
    });
    expect(out.prompt).toEqual({
      name: 'summarize',
      system_prompt: 'You are a summarizer.',
      user_prompt: `Summarize "${PAGE.title}" (${PAGE.url}). Highlight: Hello`,
    });
  });

  it('skips selected_text when no selection exists even if includeSelection=true', () => {
    const out = buildFlowPayload({
      flow: makeFlow({ includeSelection: true }),
      page: { ...PAGE, selectedText: undefined },
      profile: null,
      now: FIXED_NOW,
    });
    expect(out.page).not.toHaveProperty('selected_text');
  });

  it('skips selected_text entirely when includeSelection=false', () => {
    const out = buildFlowPayload({
      flow: makeFlow({ includeSelection: false }),
      page: PAGE, // has selectedText
      profile: null,
      now: FIXED_NOW,
    });
    expect(out.page).not.toHaveProperty('selected_text');
  });

  it('always carries flow.id, flow.name, category and source/version/timestamp', () => {
    const out = buildFlowPayload({
      flow: makeFlow({ name: 'X', categoryName: '' }),
      page: null,
      profile: null,
      now: FIXED_NOW,
    });
    expect(out).toMatchObject({
      source: 'chrome-buddy',
      version: 1,
      flow: { id: 'flw_test', name: 'X', category: 'Uncategorized' },
      timestamp: FIXED_NOW.toISOString(),
    });
  });
});
