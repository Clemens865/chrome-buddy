// Background service worker (MV3).
// v0: open the side panel on toolbar-action click. Per the PRD, this is where
// all cloud LLM calls and key custody will live (keys in chrome.storage.session,
// never in a content script). The agent runtime is added in a later phase.

chrome.runtime.onInstalled.addListener(() => {
  // Allow clicking the toolbar icon to toggle the side panel open.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[chrome-buddy] setPanelBehavior failed', err));
});

export {};
