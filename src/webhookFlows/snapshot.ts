// Snapshot composer for Webhook Flows. Pure functions only — the chrome /
// runtime hops live in the app UI, which calls TOOL_EXEC for the page read
// and `send_webhook` for the POST. Unit-tested directly with synthetic inputs.

import type { WebhookFlow } from './store';
import type { UserProfile } from '../agent';

/** What we promise to fill into a {url}, {title}, {selected_text} template. */
export interface TemplateVars {
  url: string;
  title: string;
  selected_text: string;
}

/** Compact distilled-page input (matches the DistilledPage subset we use). */
export interface PageSnapshotInput {
  url: string;
  title: string;
  /** Already-distilled readable text (truncated upstream). */
  text: string;
  /** Optional active text selection, if any. */
  selectedText?: string;
  /** Optional raw HTML — only included when snapshotMode === 'full'. */
  html?: string;
}

/** What a flow execution actually POSTs. Our-shape, NOT byte-for-byte
 *  compatible with WebhookBuddy: snake_case, no double-encoded data, the
 *  receiver gets a single distilled `page.text` instead of a {headings,
 *  paragraphs} pair, and there is no `binaryFilesAvailable` mode flag. */
export interface FlowWebhookPayload {
  source: 'chrome-buddy';
  version: 1;
  flow: { id: string; name: string; category: string };
  page?: {
    url: string;
    title: string;
    /** Present only when snapshotMode is 'text' or 'full'. */
    text?: string;
    /** Present only when snapshotMode === 'full'. */
    html?: string;
    /** Only present when includeSelection && a selection exists. */
    selected_text?: string;
  };
  profile?: {
    name?: string;
    role?: string;
    about?: string;
  };
  prompt?: {
    name?: string;
    system_prompt?: string;
    /** User prompt with {url}/{title}/{selected_text} substituted. */
    user_prompt?: string;
  };
  timestamp: string;
}

/** Replace {url}, {title}, {selected_text} (and any future-safe extras) in a
 *  template. Unknown variables are left as-is so the receiver can post-process. */
export function substituteTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (key in vars) return (vars as unknown as Record<string, string>)[key];
    return whole;
  });
}

/**
 * Assemble the outgoing payload from a flow, an optional page snapshot, and an
 * optional profile. The caller is responsible for actually performing the page
 * read (TOOL_EXEC read_dom) — this function never touches chrome / network.
 */
export function buildFlowPayload(args: {
  flow: WebhookFlow;
  page: PageSnapshotInput | null;
  profile: UserProfile | null;
  now?: Date;
}): FlowWebhookPayload {
  const { flow, page, profile, now = new Date() } = args;

  const payload: FlowWebhookPayload = {
    source: 'chrome-buddy',
    version: 1,
    flow: {
      id: flow.id,
      name: flow.name,
      category: flow.categoryName || 'Uncategorized',
    },
    timestamp: now.toISOString(),
  };

  if (page && flow.snapshotMode !== 'none') {
    const sel = flow.includeSelection ? page.selectedText?.trim() || '' : '';
    payload.page = {
      url: page.url,
      title: page.title,
      ...(flow.snapshotMode !== 'meta' && page.text ? { text: page.text } : {}),
      ...(flow.snapshotMode === 'full' && page.html ? { html: page.html } : {}),
      ...(sel ? { selected_text: sel } : {}),
    };
  }

  if (flow.includeProfile && profile && hasProfileData(profile)) {
    payload.profile = {
      ...(profile.name ? { name: profile.name } : {}),
      ...(profile.role ? { role: profile.role } : {}),
      ...(profile.about ? { about: profile.about } : {}),
    };
  }

  if (flow.prompt) {
    const vars: TemplateVars = {
      url: page?.url ?? '',
      title: page?.title ?? '',
      selected_text: page?.selectedText ?? '',
    };
    payload.prompt = {
      ...(flow.prompt.name ? { name: flow.prompt.name } : {}),
      ...(flow.prompt.systemPrompt ? { system_prompt: flow.prompt.systemPrompt } : {}),
      ...(flow.prompt.userPrompt
        ? { user_prompt: substituteTemplate(flow.prompt.userPrompt, vars) }
        : {}),
    };
  }

  return payload;
}

function hasProfileData(p: UserProfile): boolean {
  return !!(p.name?.trim() || p.role?.trim() || p.about?.trim());
}
