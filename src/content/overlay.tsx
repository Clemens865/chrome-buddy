// overlay.tsx — content script. Mounts the Chrome Buddy panel into a shadow root
// so it floats OVER the current page (page stays visible behind it).
//
// - Controlled by the `overlayEnabled` setting (Settings → toggle). Default on.
// - The close (✕) button removes it for the current page until the next load.
// - Only runs on http/https pages (Chrome blocks content scripts on chrome://,
//   the New Tab page, the Web Store, extension pages, PDFs and file:// URLs).
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PanelApp } from '../ui/PanelApp';
import css from '../sidepanel/index.css?inline';

const HOST_ID = 'chrome-buddy-overlay-host';

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let enabled = true; // global setting
let dismissed = false; // user closed it on this page

function injectStyles(shadow: ShadowRoot) {
  // Constructable stylesheet bypasses page CSP (style-src); falls back to <style>.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
  }
}

function mount() {
  if (!enabled || dismissed) return;
  if (document.getElementById(HOST_ID)) return;
  const docEl = document.documentElement;
  if (!docEl) return;

  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  docEl.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  injectStyles(shadow);

  const mountPoint = document.createElement('div');
  mountPoint.style.cssText = 'width:100%;height:100%;';
  shadow.appendChild(mountPoint);

  root = createRoot(mountPoint);
  root.render(
    <StrictMode>
      <PanelApp surface="overlay" onClose={dismiss} />
    </StrictMode>,
  );
}

function unmount() {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}

// Close button: tear down for this page (frees memory). Returns on next load.
function dismiss() {
  dismissed = true;
  unmount();
}

// Read the setting, then mount.
function init() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    mount();
    return;
  }
  chrome.storage.local.get('overlayEnabled').then((res) => {
    enabled = res.overlayEnabled !== false; // default on
    mount();
  });

  // React live to the Settings toggle.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.overlayEnabled) return;
    enabled = changes.overlayEnabled.newValue !== false;
    if (enabled) {
      dismissed = false; // re-enabling clears a per-page dismissal
      mount();
    } else {
      unmount();
    }
  });
}

init();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
}

// Re-mount if a single-page app wipes the DOM subtree we live in.
try {
  const obs = new MutationObserver(() => {
    if (enabled && !dismissed && !document.getElementById(HOST_ID)) mount();
  });
  obs.observe(document.documentElement, { childList: true });
} catch {
  /* documentElement not observable yet — init already ran */
}
