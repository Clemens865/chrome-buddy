// PURE helper: classify whether a URL points at a context the extension cannot
// drive (FR-BC-6). No chrome.* usage — fully unit-testable.
//
// "Undriveable" means scripting/CDP injection is impossible or disallowed:
// browser-internal pages, the Web Store, view-source, extension pages, and
// non-http(s) schemes. Normal http(s) pages return null (driveable).

import type { UndriveableReason } from './types';

/** Hostnames Chromium-family browsers block extensions from scripting. */
const WEB_STORE_HOSTS = new Set([
  'chromewebstore.google.com',
  'chrome.google.com', // legacy /webstore path
  'microsoftedge.microsoft.com', // Edge add-ons
  'addons.mozilla.org',
]);

/** Browser-internal URL schemes (with trailing colon). */
const BROWSER_INTERNAL_SCHEMES = new Set([
  'chrome:',
  'chrome-untrusted:',
  'edge:',
  'brave:',
  'opera:',
  'vivaldi:',
  'about:',
  'devtools:',
]);

const EXTENSION_SCHEMES = new Set(['chrome-extension:', 'moz-extension:']);

const LOCAL_OR_DATA_SCHEMES = new Set(['file:', 'data:', 'blob:', 'filesystem:']);

/**
 * Returns the reason a URL is undriveable, or `null` if it can be driven.
 *
 * Robust to malformed input: anything that fails to parse and isn't a clear
 * scheme match is reported as `unsupported-scheme`.
 */
export function isUndriveable(url: string): UndriveableReason | null {
  const raw = (url ?? '').trim();
  if (raw === '') return 'unsupported-scheme';

  // view-source: is special — it wraps another URL and is never driveable.
  const lower = raw.toLowerCase();
  if (lower.startsWith('view-source:')) return 'view-source';

  let scheme: string;
  let host = '';
  try {
    const parsed = new URL(raw);
    scheme = parsed.protocol.toLowerCase(); // includes trailing ':'
    host = parsed.hostname.toLowerCase();
  } catch {
    // Fall back to a scheme sniff for inputs URL can't parse (e.g. "about:blank"
    // parses fine, but exotic forms may not). Extract leading "scheme:".
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(lower);
    scheme = m ? `${m[1].toLowerCase()}:` : '';
    if (scheme === '') return 'unsupported-scheme';
  }

  if (EXTENSION_SCHEMES.has(scheme)) return 'extension-page';
  if (BROWSER_INTERNAL_SCHEMES.has(scheme)) return 'browser-internal';
  if (LOCAL_OR_DATA_SCHEMES.has(scheme)) return 'local-or-data';

  if (scheme === 'http:' || scheme === 'https:') {
    if (WEB_STORE_HOSTS.has(host)) return 'web-store';
    // Legacy Web Store lived under chrome.google.com/webstore.
    if (host === 'chrome.google.com' || host.endsWith('.chrome.google.com')) {
      return 'web-store';
    }
    return null; // ordinary web page — driveable
  }

  return 'unsupported-scheme';
}

/** Human-readable explanation for an undriveable reason. */
export function describeUndriveable(reason: UndriveableReason): string {
  switch (reason) {
    case 'browser-internal':
      return 'This is a browser-internal page; extensions cannot read or act on it.';
    case 'web-store':
      return 'The browser blocks extensions from operating on the Web Store / add-ons gallery.';
    case 'view-source':
      return 'view-source: pages cannot be driven.';
    case 'extension-page':
      return 'Extension pages cannot be driven by other extension code.';
    case 'local-or-data':
      return 'Local files and data/blob URLs cannot be scripted by this extension.';
    case 'unsupported-scheme':
      return 'This URL scheme is not supported for browser control.';
  }
}
