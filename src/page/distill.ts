// PURE DOM-distillation helpers (FR-TOOLS-4, PageContext).
//
// Two layers live here:
//
//  1. A small structural model (`DomNodeLike`) + pure functions that distill a
//     plain tree into ElementRefs, DistilledTables, and pruned text. These take
//     ordinary data — no real DOM, no chrome.* — so they are unit-testable in a
//     `node` Vitest environment without jsdom.
//
//  2. `distillInPage`: a self-contained function meant to be injected via
//     chrome.scripting.executeScript. It walks the *real* Document, maps it onto
//     the structural model, and reuses the pure functions. It references browser
//     globals (document) only when executed in the page, so it is guarded by its
//     usage site (pageContext.ts), never called here.

import type {
  DistilledPage,
  DistilledTable,
  ElementRef,
  InteractiveKind,
} from './types';

/**
 * Minimal, DOM-shaped node the pure distillers understand. A real `Element`
 * structurally satisfies the bits we read, but tests can hand-build plain
 * objects instead of needing jsdom.
 */
export interface DomNodeLike {
  /** Lower- or upper-cased tag name; we normalise. */
  tagName: string;
  /** Visible text content of this node and descendants. */
  textContent?: string | null;
  /** Attribute bag (lower-cased keys recommended). */
  attributes?: Record<string, string | undefined>;
  /** Child element nodes in document order. */
  children?: DomNodeLike[];
}

/** Tags whose subtree carries no useful semantic/visible content. */
const PRUNE_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'head',
  'meta',
  'link',
]);

/** ARIA roles we treat as interactive even on generic tags. */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'tab',
  'menuitem',
  'checkbox',
  'radio',
  'option',
]);

function attr(node: DomNodeLike, name: string): string | undefined {
  return node.attributes?.[name];
}

function tag(node: DomNodeLike): string {
  return (node.tagName || '').toLowerCase();
}

/** Collapse runs of whitespace and trim. */
export function normalizeText(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Map a node to a coarse interactive kind, or null if not interactive. */
export function interactiveKind(node: DomNodeLike): InteractiveKind | null {
  const t = tag(node);
  const role = (attr(node, 'role') ?? '').toLowerCase();

  if (t === 'a') return 'link';
  if (t === 'button') return 'button';
  if (t === 'textarea') return 'textarea';
  if (t === 'select') return 'select';
  if (t === 'option') return 'option';
  if (t === 'input') {
    const it = (attr(node, 'type') ?? 'text').toLowerCase();
    if (it === 'checkbox') return 'checkbox';
    if (it === 'radio') return 'radio';
    if (it === 'button' || it === 'submit' || it === 'reset') return 'button';
    return 'input';
  }

  if (role && INTERACTIVE_ROLES.has(role)) {
    switch (role) {
      case 'link':
        return 'link';
      case 'tab':
        return 'tab';
      case 'menuitem':
        return 'menuitem';
      case 'checkbox':
        return 'checkbox';
      case 'radio':
        return 'radio';
      case 'option':
        return 'option';
      default:
        return 'button';
    }
  }

  return null;
}

/** Best-effort accessible label for an interactive element. */
export function labelFor(node: DomNodeLike): string {
  const aria = normalizeText(attr(node, 'aria-label'));
  if (aria) return aria;

  const t = tag(node);
  if (t === 'input' || t === 'textarea' || t === 'select') {
    const val = normalizeText(attr(node, 'value'));
    const placeholder = normalizeText(attr(node, 'placeholder'));
    const name = normalizeText(attr(node, 'name'));
    const title = normalizeText(attr(node, 'title'));
    return placeholder || val || title || name || '';
  }

  const text = normalizeText(node.textContent);
  if (text) return text;
  return normalizeText(attr(node, 'title')) || normalizeText(attr(node, 'alt'));
}

/**
 * Build a stable-ish CSS selector for a node from id/name/data-testid, falling
 * back to the tag. The page-side walker can override with a positional selector
 * when nothing unique is available.
 */
export function selectorFor(node: DomNodeLike): string {
  const id = attr(node, 'id');
  if (id) return `#${cssEscape(id)}`;
  const testid = attr(node, 'data-testid');
  if (testid) return `[data-testid="${cssEscapeAttr(testid)}"]`;
  const name = attr(node, 'name');
  const t = tag(node);
  if (name) return `${t}[name="${cssEscapeAttr(name)}"]`;
  return t || '*';
}

/** Minimal CSS identifier escaping (sufficient for ids). */
function cssEscape(value: string): string {
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

/** Escape a value used inside a double-quoted attribute selector. */
function cssEscapeAttr(value: string): string {
  return value.replace(/(["\\])/g, '\\$1');
}

/**
 * Walk a structural tree, extracting interactive elements in document order and
 * assigning sequential integer ids starting at 1. Pure.
 */
export function extractInteractive(root: DomNodeLike): ElementRef[] {
  const out: ElementRef[] = [];
  let nextId = 1;

  const visit = (node: DomNodeLike): void => {
    const t = tag(node);
    if (PRUNE_TAGS.has(t)) return;

    const kind = interactiveKind(node);
    if (kind) {
      const ref: ElementRef = {
        id: nextId++,
        selector: selectorFor(node),
        kind,
        label: labelFor(node),
        tag: t,
      };
      const href = attr(node, 'href');
      if (href !== undefined && t === 'a') ref.href = href;
      const it = attr(node, 'type');
      if (it !== undefined && t === 'input') ref.inputType = it.toLowerCase();
      if (attr(node, 'disabled') !== undefined) ref.disabled = true;
      const value = attr(node, 'value');
      if (value !== undefined) ref.value = value;
      out.push(ref);
    }

    for (const child of node.children ?? []) visit(child);
  };

  visit(root);
  return out;
}

/** Extract semantic tables in document order, with sequential integer ids. */
export function extractTables(root: DomNodeLike): DistilledTable[] {
  const out: DistilledTable[] = [];
  let nextId = 1;

  const findRows = (node: DomNodeLike): DomNodeLike[] => {
    const rows: DomNodeLike[] = [];
    const walk = (n: DomNodeLike): void => {
      if (tag(n) === 'tr') rows.push(n);
      for (const c of n.children ?? []) walk(c);
    };
    walk(node);
    return rows;
  };

  const cellsOf = (row: DomNodeLike): { text: string; header: boolean }[] => {
    const cells: { text: string; header: boolean }[] = [];
    const walk = (n: DomNodeLike): void => {
      const t = tag(n);
      if (t === 'td' || t === 'th') {
        cells.push({ text: normalizeText(n.textContent), header: t === 'th' });
        return; // don't descend into nested tables' cells from here
      }
      for (const c of n.children ?? []) walk(c);
    };
    for (const c of row.children ?? []) walk(c);
    return cells;
  };

  const captionOf = (node: DomNodeLike): string | undefined => {
    for (const c of node.children ?? []) {
      if (tag(c) === 'caption') return normalizeText(c.textContent) || undefined;
    }
    return undefined;
  };

  const visit = (node: DomNodeLike): void => {
    const t = tag(node);
    if (PRUNE_TAGS.has(t)) return;
    if (t === 'table') {
      const rows = findRows(node);
      if (rows.length > 0) {
        const parsed = rows.map(cellsOf);
        let headers: string[] = [];
        let bodyStart = 0;
        if (parsed.length > 0 && parsed[0].every((c) => c.header)) {
          headers = parsed[0].map((c) => c.text);
          bodyStart = 1;
        }
        const body = parsed.slice(bodyStart).map((r) => r.map((c) => c.text));
        out.push({
          id: nextId++,
          caption: captionOf(node),
          headers,
          rows: body,
          selector: selectorFor(node),
        });
      }
      // Do not descend into the table again for further table extraction.
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };

  visit(root);
  return out;
}

/**
 * Produce pruned, readable text: concatenate visible text from non-pruned
 * nodes, collapsing whitespace and capping total length. Pure.
 */
export function distillText(root: DomNodeLike, maxChars = 20_000): string {
  const parts: string[] = [];

  const visit = (node: DomNodeLike): void => {
    const t = tag(node);
    if (PRUNE_TAGS.has(t)) return;
    const kids = node.children ?? [];
    if (kids.length === 0) {
      const text = normalizeText(node.textContent);
      if (text) parts.push(text);
      return;
    }
    for (const child of kids) visit(child);
  };

  visit(root);
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
}

/**
 * Compose the full distillation from a structural tree plus document metadata.
 * Pure — the chrome-side wrapper supplies url/title/tabId and the tree.
 */
export function distillTree(
  root: DomNodeLike,
  meta: { url: string; title: string; tabId?: number },
): DistilledPage {
  const provenance: DistilledPage['provenance'] = {
    url: meta.url,
    distilledAt: Date.now(),
  };
  if (meta.tabId !== undefined) provenance.tabId = meta.tabId;

  return {
    url: meta.url,
    title: normalizeText(meta.title),
    text: distillText(root),
    interactiveElements: extractInteractive(root),
    tables: extractTables(root),
    provenance,
  };
}

/**
 * Injected page-side distiller. Serialised and run via
 * chrome.scripting.executeScript({ func: distillInPage }). It maps the live DOM
 * onto DomNodeLike and reuses the pure distillers — but because executeScript
 * serialises the function source, it cannot close over imports. We therefore
 * keep it dependency-free and self-contained, returning the structural tree +
 * metadata; the SW side calls `distillTree` on the result.
 *
 * Returns a plain serialisable payload (no functions, no DOM refs).
 */
export function buildPageTreePayload(): {
  tree: DomNodeLike;
  url: string;
  title: string;
} {
  // NOTE: executed in the page context; `document` is the real DOM there.
  // This function intentionally references only standard DOM globals so it can
  // be string-serialised by chrome.scripting.executeScript.
  const ATTRS = [
    'id',
    'role',
    'type',
    'name',
    'href',
    'value',
    'placeholder',
    'aria-label',
    'title',
    'alt',
    'disabled',
    'data-testid',
  ];

  const toNode = (el: Element): DomNodeLike => {
    const attributes: Record<string, string> = {};
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v !== null) attributes[a] = v;
    }
    // Leaf text only when there are no element children (avoids duplicating
    // text up the tree); the pure distillers handle aggregation.
    const childEls = Array.from(el.children);
    const node: DomNodeLike = {
      tagName: el.tagName,
      attributes,
      children: childEls.map(toNode),
    };
    if (childEls.length === 0) {
      node.textContent = el.textContent ?? '';
    } else {
      // Preserve a node's own immediate text for labels (e.g. <a>Buy</a>).
      node.textContent = el.textContent ?? '';
    }
    return node;
  };

  const doc = document;
  return {
    tree: toNode(doc.documentElement),
    url: doc.location?.href ?? '',
    title: doc.title ?? '',
  };
}
