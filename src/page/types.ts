// Page-domain types for PageContext (DOM distillation) + hybrid Browser Control.
//
// These describe the compact, untrusted, injection-fenced view of a page the
// agent and Tier-1 apps consume (FR-TOOLS-4, FR-APP-6, NFR-SEC-6) and the
// signals the Browser Control layer returns (FR-BC-1..8). All output here is
// treated as data, never as instructions.

/** Kind of interactive element surfaced to the model. */
export type InteractiveKind =
  | 'link'
  | 'button'
  | 'input'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'option'
  | 'tab'
  | 'menuitem'
  | 'other';

/**
 * A stable handle to one interactive element on the page. The integer `id` is
 * assigned in document order during distillation; Browser Control can act on an
 * element either by this `id` (resolved back to its `selector`) or by selector
 * directly. Kept small — only what the model needs to choose a target.
 */
export interface ElementRef {
  /** Integer id, unique within a single DistilledPage, assigned in DOM order. */
  id: number;
  /** Best-effort CSS selector that re-identifies the element. */
  selector: string;
  /** Coarse semantic kind. */
  kind: InteractiveKind;
  /** Visible/accessible label (text, value, aria-label, placeholder, …). */
  label: string;
  /** Underlying tag name, lower-cased (e.g. 'a', 'button', 'input'). */
  tag: string;
  /** href for links, normalised where possible. */
  href?: string;
  /** Input type attribute, when applicable (e.g. 'email', 'checkbox'). */
  inputType?: string;
  /** Whether the element is disabled. */
  disabled?: boolean;
  /** Current value for form controls (untrusted). */
  value?: string;
}

/** A distilled table extracted from the page. */
export interface DistilledTable {
  /** Integer id, unique within a DistilledPage, assigned in DOM order. */
  id: number;
  /** Optional caption / accessible name. */
  caption?: string;
  /** Header cells (first header row), if detected. */
  headers: string[];
  /** Body rows; each row is an array of cell text, aligned to columns. */
  rows: string[][];
  /** CSS selector locating the source table element. */
  selector: string;
}

/** Where a DistilledPage came from, for audit + provenance. */
export interface PageProvenance {
  /** URL the content was distilled from. */
  url: string;
  /** Tab id the read targeted (when produced via chrome APIs). */
  tabId?: number;
  /** Epoch millis the distillation completed. */
  distilledAt: number;
}

/**
 * Compact, structured view of a page produced by the distiller. This is the
 * shared currency between PageContext, the agent loop, and Tier-1 apps.
 */
export interface DistilledPage {
  url: string;
  title: string;
  /** Pruned, readable text content (semantic + interactive context). */
  text: string;
  /** Interactive elements, in document order, with assigned integer ids. */
  interactiveElements: ElementRef[];
  /** Tables extracted from the page, in document order. */
  tables: DistilledTable[];
  /** Provenance for audit/citation. */
  provenance: PageProvenance;
}

/** Result of a viewport screenshot capture. */
export interface ScreenshotResult {
  /** data: URL of the captured image (e.g. 'data:image/png;base64,...'). */
  dataUrl: string;
  /** MIME type of the encoded image. */
  mimeType: string;
  /** Tab id captured. */
  tabId: number;
  /** Epoch millis the capture completed. */
  capturedAt: number;
}

/**
 * Why a URL/context cannot be driven by the extension (FR-BC-6). Returned as a
 * structured signal so callers can degrade gracefully rather than failing
 * opaquely.
 */
export type UndriveableReason =
  | 'browser-internal' // chrome://, edge://, brave://, about:, etc.
  | 'web-store' // Chrome Web Store / extension galleries
  | 'view-source' // view-source: pages
  | 'extension-page' // chrome-extension:// / moz-extension://
  | 'local-or-data' // file:, data:, blob: (no scripting access)
  | 'unsupported-scheme'; // anything else not http(s)/about-driveable

/** Structured "this context can't be driven" signal with a human note. */
export interface UndriveableSignal {
  undriveable: true;
  reason: UndriveableReason;
  /** The offending URL. */
  url: string;
  /** Human-readable explanation suitable for the step log / UI. */
  message: string;
}

/** Actions the hybrid Browser Control layer can apply to a page. */
export type BrowserAction =
  | { type: 'navigate'; url: string; newTab?: boolean }
  | { type: 'click'; selector?: string; elementId?: number; text?: string }
  | {
      type: 'type';
      text: string;
      selector?: string;
      elementId?: number;
      submit?: boolean;
    }
  | {
      type: 'scroll';
      direction: 'up' | 'down' | 'top' | 'bottom';
      selector?: string;
      amount?: number;
    };

/** Which mechanism applied (or would apply) an action. */
export type ControlEngine = 'scripting' | 'cdp';

/** Outcome of attempting a single browser action. */
export type ActResult =
  | {
      ok: true;
      engine: ControlEngine;
      /** Optional note (e.g. 'matched by text', 'submitted with Enter'). */
      note?: string;
    }
  | UndriveableSignal
  | {
      ok: false;
      /** Coarse failure category for the agent's reflect/retry step. */
      reason: 'not-found' | 'no-target' | 'chrome-unavailable' | 'error';
      message: string;
    };
