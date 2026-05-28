// overlay-main.tsx — entry point for the floating-overlay iframe.
//
// This file runs at the EXTENSION ORIGIN (chrome-extension://EXT_ID/overlay.html)
// so its IDB is the same one the side panel uses. The content-script
// /src/content/overlay.tsx injects an <iframe> pointing here; the iframe
// hosts this React tree. Chats, library, notes, skills, workflows, etc.
// all see the same persistent storage as the side panel.
//
// The 'close' button inside PanelApp uses window.parent.postMessage to
// tell the content-script to dismiss the iframe; see overlay.tsx for the
// listener.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelApp } from '../ui/PanelApp';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

function dismiss() {
  // Tell the host (content script) to unmount the iframe.
  window.parent?.postMessage({ source: 'chrome-buddy-overlay', kind: 'dismiss' }, '*');
}

createRoot(container).render(
  <StrictMode>
    <PanelApp surface="overlay" onClose={dismiss} />
  </StrictMode>,
);
