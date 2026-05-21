// UI/content-side helper: ask the background SW to capture the active page's
// content (so chat can include it without an agentic read_dom round-trip).
// The SW reads the DOM via chrome.scripting; this context never touches it.
import type { PageContextMessage, PageContextResponse, ErrorResponse } from '../key/messages';

export interface PageSummary {
  url: string;
  title: string;
  text: string;
}

export async function requestPageContext(): Promise<PageSummary | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
  try {
    const message: PageContextMessage = { type: 'PAGE_CONTEXT' };
    const res = (await chrome.runtime.sendMessage(message)) as
      | PageContextResponse
      | ErrorResponse
      | undefined;
    if (!res || res.type === 'ERROR' || res.ok !== true) return null;
    return res.page;
  } catch {
    return null;
  }
}
