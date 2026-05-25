// Lightweight accessibility ruleset. Mirrors a small but high-signal subset of
// axe-core (img/alt, controls/label, ARIA roles, document-language, heading
// outline). The page-side probe collects raw signals; this module scores them
// — pure, no chrome, no I/O.

export type A11ySeverity = 'critical' | 'serious' | 'moderate' | 'minor';

export interface A11ySignal {
  /** Snapshot of every <img>: src + alt (alt is undefined when the attribute is missing). */
  images: ReadonlyArray<{ src: string; alt?: string; role?: string }>;
  /** Snapshot of every form control: tag, id, type, label-association. */
  controls: ReadonlyArray<{
    tag: 'input' | 'select' | 'textarea';
    type?: string;
    id?: string;
    name?: string;
    ariaLabel?: string;
    /** Whether a `<label for="id">` or wrapping `<label>` resolves to this control. */
    hasLabel: boolean;
  }>;
  /** Levels of every `<h1>…<h6>` in document order. */
  headingLevels: ReadonlyArray<number>;
  /** Page-level language attribute from <html lang="…">. */
  htmlLang?: string;
  /** Document title text (used for "Title Present" check). */
  title?: string;
  /** Buttons with neither text content nor aria-label. */
  unlabeledButtons: number;
  /** Number of <a> elements with empty/null text and no aria-label. */
  unlabeledLinks: number;
}

export interface A11yIssue {
  id: string;
  severity: A11ySeverity;
  /** Short rule name shown in the panel. */
  rule: string;
  /** Plain-language description of what was found. */
  description: string;
  /** How to fix it. */
  suggestion: string;
  /** How many elements triggered this rule. */
  count: number;
}

export interface A11yReport {
  total: number;
  issues: A11yIssue[];
}

/**
 * Score an A11ySignal into a sorted list of issues. Each rule is at-most-once
 * in the output and aggregates count — keeps the UI compact even on large pages.
 */
export function analyzeA11y(s: A11ySignal): A11yReport {
  const issues: A11yIssue[] = [];

  // 1. <img> without alt (decorative imgs should declare role="presentation").
  const missingAlt = s.images.filter((i) => i.alt === undefined && i.role !== 'presentation' && i.role !== 'none').length;
  if (missingAlt > 0) {
    issues.push({
      id: 'image-alt',
      severity: 'serious',
      rule: 'Images must have alt text',
      description: `${missingAlt} image element(s) have no \`alt\` attribute.`,
      suggestion: 'Add a descriptive alt="…"; use alt="" for decorative images.',
      count: missingAlt,
    });
  }

  // 2. Form controls without an associated label.
  const unlabeledControls = s.controls.filter(
    (c) => !c.hasLabel && !c.ariaLabel && (c.type ?? '') !== 'hidden' && (c.type ?? '') !== 'submit' && (c.type ?? '') !== 'button',
  ).length;
  if (unlabeledControls > 0) {
    issues.push({
      id: 'label',
      severity: 'critical',
      rule: 'Form controls must have labels',
      description: `${unlabeledControls} form control(s) have no associated <label> or aria-label.`,
      suggestion: 'Wrap the control in a <label>, link via for=/id=, or add aria-label="…".',
      count: unlabeledControls,
    });
  }

  // 3. Missing document language.
  if (!s.htmlLang) {
    issues.push({
      id: 'html-has-lang',
      severity: 'serious',
      rule: 'Document language',
      description: 'The <html> element is missing the `lang` attribute.',
      suggestion: 'Set lang on <html>, e.g. <html lang="en">.',
      count: 1,
    });
  }

  // 4. Heading-order outline.
  const headingOrderIssues = countHeadingOrderViolations(s.headingLevels);
  if (headingOrderIssues > 0) {
    issues.push({
      id: 'heading-order',
      severity: 'moderate',
      rule: 'Heading levels should not skip',
      description: `${headingOrderIssues} heading level jump(s) (e.g. h1 → h3).`,
      suggestion: 'Use heading levels in order; do not skip levels for styling.',
      count: headingOrderIssues,
    });
  }
  if (s.headingLevels.length > 0 && !s.headingLevels.includes(1)) {
    issues.push({
      id: 'page-has-h1',
      severity: 'moderate',
      rule: 'Page should have an <h1>',
      description: 'The page has headings but no <h1>.',
      suggestion: 'Add a single <h1> that names the page topic.',
      count: 1,
    });
  }

  // 5. Title text.
  if (!s.title || !s.title.trim()) {
    issues.push({
      id: 'document-title',
      severity: 'serious',
      rule: 'Document must have a title',
      description: 'The <title> element is missing or empty.',
      suggestion: 'Add a descriptive <title> in the document head.',
      count: 1,
    });
  }

  // 6. Unlabeled buttons / links.
  if (s.unlabeledButtons > 0) {
    issues.push({
      id: 'button-name',
      severity: 'critical',
      rule: 'Buttons must have discernible text',
      description: `${s.unlabeledButtons} button(s) have no text content and no aria-label.`,
      suggestion: 'Add visible text, or aria-label="…" if you use an icon-only button.',
      count: s.unlabeledButtons,
    });
  }
  if (s.unlabeledLinks > 0) {
    issues.push({
      id: 'link-name',
      severity: 'serious',
      rule: 'Links must have discernible text',
      description: `${s.unlabeledLinks} link(s) have no text content and no aria-label.`,
      suggestion: 'Provide link text, or aria-label="…" for icon-only links.',
      count: s.unlabeledLinks,
    });
  }

  return {
    total: issues.reduce((n, i) => n + i.count, 0),
    issues: issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
  };
}

/** Count how many adjacent headings jump by more than 1 level downwards. */
export function countHeadingOrderViolations(levels: ReadonlyArray<number>): number {
  let n = 0;
  let prev = 0;
  for (const lvl of levels) {
    if (prev > 0 && lvl > prev + 1) n += 1;
    prev = lvl;
  }
  return n;
}

function severityRank(s: A11ySeverity): number {
  return s === 'critical' ? 0 : s === 'serious' ? 1 : s === 'moderate' ? 2 : 3;
}
