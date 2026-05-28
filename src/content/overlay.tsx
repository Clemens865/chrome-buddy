// overlay.tsx — content script. Injects the floating Chrome Buddy overlay
// onto a web page as an <iframe> pointing at chrome-extension://EXT_ID/overlay.html.
//
// Architectural note (this is the FIX for the original "separate IDB" bug):
//
//   Earlier versions rendered React directly inside a Shadow DOM in the
//   content-script context, which runs in the PAGE's origin. Every IDB write
//   (chats, library, notes, skills, workflows) landed in the page's IDB, not
//   the extension's — so each website had its own isolated chat history.
//
//   Now we inject an <iframe src="chrome-extension://EXT_ID/overlay.html">
//   into the page. The iframe runs at the EXTENSION origin, so its IDB is
//   the SAME one the side panel uses. One persistent surface, no per-site
//   surprise. (The iframe entry is overlay.html → overlay-main.tsx; see the
//   build entry in vite.config.ts and web_accessible_resources in
//   public/manifest.json.)
//
// Surface behavior:
//   - Controlled by the `overlayEnabled` setting (Settings → toggle). DEFAULT OFF.
//   - The close (✕) button in the panel postMessages 'dismiss' back to this
//     content script, which unmounts the iframe for the current page until
//     next load.
//   - Only runs on http/https pages (Chrome blocks content scripts on
//     chrome://, the New Tab page, the Web Store, extension pages, PDFs and
//     file:// URLs).

const HOST_ID = 'chrome-buddy-overlay-host';

let host: HTMLDivElement | null = null;
let iframe: HTMLIFrameElement | null = null;
let enabled = false; // global setting — default OFF (see comment at top)
let dismissed = false; // user closed it on this page

function mount() {
  if (!enabled || dismissed) return;
  if (document.getElementById(HOST_ID)) return;
  const docEl = document.documentElement;
  if (!docEl) return;

  // Outer host: pointer-events:none lets clicks pass through to the page in
  // the regions where the iframe isn't drawing anything. The iframe itself
  // re-enables pointer events for its own contents.
  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  docEl.appendChild(host);

  iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('overlay.html');
  iframe.allow = 'microphone; clipboard-read; clipboard-write';
  // Size to match the panel's current collapse state. The page underneath
  // stays usable everywhere OUTSIDE the iframe rectangle.
  applyIframeStyle(getCachedCollapsed());
  host.appendChild(iframe);
}

// Two static panel-footprint rectangles, derived from .root.is-overlay CSS:
//   collapsed → small floating rail card at top:80 right:10
//   expanded  → top:10 right:10 bottom:10, width:min(420, 92vw)
// Sizes are slightly padded for the rail's own shadow + click affordance.
function applyIframeStyle(collapsed: boolean) {
  if (!iframe) return;
  const COLLAPSED_W = 76;
  const COLLAPSED_H = 420;
  const COLLAPSED_TOP = 70;
  const EXPANDED_TOP = 0;
  const EXPANDED_W = Math.min(440, Math.round(window.innerWidth * 0.92));
  const css = collapsed
    ? [
        'position:fixed',
        `top:${COLLAPSED_TOP}px`,
        'right:0px',
        `width:${COLLAPSED_W}px`,
        `height:${COLLAPSED_H}px`,
      ]
    : [
        'position:fixed',
        `top:${EXPANDED_TOP}px`,
        'right:0px',
        `width:${EXPANDED_W}px`,
        'height:100vh',
      ];
  iframe.style.cssText = [
    ...css,
    'border:0',
    'background:transparent',
    'pointer-events:auto',
    'color-scheme:light dark',
  ].join(';');
}

let cachedCollapsed = true;
function getCachedCollapsed(): boolean {
  return cachedCollapsed;
}

function unmount() {
  iframe?.remove();
  iframe = null;
  host?.remove();
  host = null;
}

// Close button: tear down for this page (frees memory). Returns on next load.
function dismiss() {
  dismissed = true;
  unmount();
}

// Listen for the iframe's postMessage when the user clicks close inside it.
window.addEventListener('message', (ev) => {
  const data = ev.data as { source?: string; kind?: string } | null;
  if (!data || data.source !== 'chrome-buddy-overlay') return;
  if (data.kind === 'dismiss') dismiss();
});

// Keep the iframe sized correctly when the page is resized (expanded mode
// uses a viewport-relative width that needs to update on window resize).
window.addEventListener('resize', () => applyIframeStyle(cachedCollapsed));

// Read the setting, then mount (only if enabled).
function init() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    // Without chrome.storage access we have no way to honor the toggle, so
    // we do NOT mount. Safer than the previous "mount unconditionally"
    // fallback, which would have rendered with stale defaults.
    return;
  }
  // Read both flags together so initial mount picks the correct size.
  chrome.storage.local.get(['overlayEnabled', 'overlayCollapsed']).then((res) => {
    enabled = res.overlayEnabled === true; // default OFF — must be EXPLICITLY enabled
    cachedCollapsed = res.overlayCollapsed !== false; // default true (collapsed)
    mount();
  });

  // React live to both Settings toggle AND the panel's own collapse/expand
  // state, so the iframe always matches the panel's rendered footprint.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.overlayCollapsed) {
      cachedCollapsed = changes.overlayCollapsed.newValue !== false;
      applyIframeStyle(cachedCollapsed);
    }
    if (!changes.overlayEnabled) return;
    enabled = changes.overlayEnabled.newValue === true;
    if (enabled) {
      dismissed = false; // re-enabling clears a per-page dismissal
      mount();
    } else {
      unmount();
    }
  });
}

init();
