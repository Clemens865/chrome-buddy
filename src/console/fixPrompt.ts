// Build a paste-ready bug-fix prompt from console-inspector findings.
// Goal: the user clicks "Copy fix prompt" in the Errors panel, pastes the
// result into their coding IDE (Cursor / Claude Code / Continue / Cody / …),
// and the IDE has everything needed to locate and fix the bug.
//
// Pure module — no chrome, no I/O — fully unit-testable.

import type { ErrorMatch, Severity } from './errorPatterns';
import type { LogEntry } from './capture';

export interface FixPromptContext {
  /** The page URL where the error was captured. */
  url?: string;
  /** Page title (used as a friendly label when the URL is long). */
  title?: string;
  /** Detected tech stack (from detect_tech_stack), e.g. ['React', 'Next.js']. */
  techStack?: readonly string[];
}

export interface FixPromptInput {
  /** The pattern matches from analyze_errors (grouped, severity-sorted). */
  matches: readonly ErrorMatch[];
  /** Optional raw console snapshot — used to add concrete stack-trace lines. */
  logs?: readonly LogEntry[];
  context?: FixPromptContext;
}

/**
 * Build a single, paste-ready markdown prompt covering ALL matched patterns.
 * Designed for "Copy and paste this into your IDE" — opens with what / where /
 * stack, then per-error diagnosis + fix, then a numbered task list.
 */
export function buildFixPrompt(input: FixPromptInput): string {
  const ctx = input.context ?? {};
  const lines: string[] = [];

  // --- Header ----------------------------------------------------------
  lines.push('# Bug-fix request — captured by Chrome Buddy console inspector');
  lines.push('');
  lines.push('I captured the following error(s) on a live page. Please locate the');
  lines.push('offending code in this repository and fix each one. Use the framework-');
  lines.push('idiomatic pattern noted under each error and run the test suite when done.');
  lines.push('');

  // --- Context block ---------------------------------------------------
  if (ctx.url || ctx.title || (ctx.techStack && ctx.techStack.length)) {
    lines.push('## Context');
    if (ctx.url) lines.push(`- **Page URL:** ${ctx.url}`);
    if (ctx.title) lines.push(`- **Page title:** ${ctx.title}`);
    if (ctx.techStack && ctx.techStack.length) {
      lines.push(`- **Detected stack:** ${ctx.techStack.join(', ')}`);
    }
    lines.push('');
  }

  // --- Per-error sections ----------------------------------------------
  if (input.matches.length === 0) {
    lines.push('## Errors');
    lines.push('');
    lines.push('_No known patterns matched. See the raw console snapshot below._');
    lines.push('');
  } else {
    input.matches.forEach((m, idx) => {
      lines.push(`## ${idx + 1}. ${m.category}${m.framework ? ` · ${m.framework}` : ''} — \`${m.severity}\``);
      lines.push('');
      lines.push(`**Diagnosis:** ${m.description}`);
      lines.push('');
      lines.push(`**Suggested fix:** ${m.suggestion}`);
      if (m.docUrl) {
        lines.push('');
        lines.push(`**Reference:** ${m.docUrl}`);
      }
      lines.push('');
      lines.push('### Captured');
      lines.push('```');
      lines.push(truncate(m.text, 800));
      lines.push('```');
      if (m.count > 1) {
        lines.push(`_This pattern fired ${m.count} time(s) during the capture._`);
      }
      // If we have raw logs, surface the FIRST entry that contains the
      // matched text — its `source` field usually carries a stack-line URL.
      const stackHint = input.logs ? findStackHint(input.logs, m.text) : undefined;
      if (stackHint) {
        lines.push('');
        lines.push(`**Stack hint:** ${stackHint}`);
      }
      lines.push('');
    });
  }

  // --- Raw snapshot tail (only when small enough to be useful) ---------
  if (input.logs && input.logs.length > 0) {
    const tail = input.logs.slice(-15);
    lines.push('## Recent console snapshot');
    lines.push('```');
    for (const e of tail) {
      const src = e.source ? ` @ ${shortSource(e.source)}` : '';
      lines.push(`[${e.level}] ${truncate(e.text, 200)}${src}`);
    }
    lines.push('```');
    lines.push('');
  }

  // --- Task block ------------------------------------------------------
  lines.push('## Your task');
  lines.push('');
  lines.push('1. For each numbered error above, locate the offending code in this repo.');
  lines.push('   (Search for the error text; check the stack-hint URL if present.)');
  lines.push('2. Apply the suggested fix using the framework-idiomatic pattern.');
  lines.push('3. Add or update a test so the regression cannot recur silently.');
  lines.push('4. Run the project test suite and report which tests now pass.');
  lines.push('');
  lines.push('Treat errors marked `critical` or `high` as P0; surface `medium` and `low`');
  lines.push('as follow-ups if a focused fix is more appropriate.');

  return lines.join('\n');
}

/** Short single-error prompt for the per-card "Copy" button. */
export function buildSingleFixPrompt(match: ErrorMatch, context?: FixPromptContext): string {
  return buildFixPrompt({ matches: [match], context });
}

/**
 * A compact "send to Buddy chat" prompt — uses the same diagnosis but asks
 * Buddy to use its own tools (read_file / list_files / search_web) to find
 * and apply the fix in the user's root folder.
 */
export function buildBuddyChatPrompt(input: FixPromptInput): string {
  const ctx = input.context ?? {};
  const lines: string[] = [];
  lines.push("Use list_files + read_file to locate the source of this error in the user's");
  lines.push('root folder, then propose a fix. If a write_file would correct it, prepare it');
  lines.push('and wait for confirmation.');
  lines.push('');
  if (ctx.url) lines.push(`Page URL: ${ctx.url}`);
  if (ctx.techStack?.length) lines.push(`Detected stack: ${ctx.techStack.join(', ')}`);
  lines.push('');
  for (const m of input.matches.slice(0, 5)) {
    lines.push(`- [${m.severity}] ${m.category}: ${truncate(m.text, 240)}`);
    lines.push(`  → Suggestion: ${m.suggestion}`);
  }
  return lines.join('\n');
}

// --- helpers ---------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function shortSource(s: string): string {
  try {
    const u = new URL(s);
    return `${u.host}${u.pathname}`;
  } catch {
    return s;
  }
}

/** Return the first log line whose text contains the matched substring, with
 * its source URL appended as a stack-hint. Used to enrich the per-error block. */
function findStackHint(logs: readonly LogEntry[], matchText: string): string | undefined {
  const needle = matchText.slice(0, 40);
  for (const e of logs) {
    if (e.text.includes(needle) && e.source) return shortSource(e.source);
  }
  return undefined;
}

/** Test-only helper — exposed so unit tests can verify severity ordering. */
export const severityRank = (s: Severity): number =>
  s === 'critical' ? 0 : s === 'high' ? 1 : s === 'medium' ? 2 : 3;

// ---------------------------------------------------------------------------
// Generic finding-fix-prompt builder (shared by A11y / Security / SEO panels)
// ---------------------------------------------------------------------------

/** Severity used by the A11y, Security, and SEO analyzers. Wider than Severity
 * (which is the console-error type) because a11y adds 'serious' and 'minor'. */
export type FindingSeverity = 'critical' | 'high' | 'serious' | 'moderate' | 'medium' | 'minor' | 'low';

/** Structural finding shared across analytical panels. */
export interface Finding {
  /** Short rule name (e.g. "Images must have alt text"). */
  rule: string;
  description: string;
  suggestion: string;
  severity: FindingSeverity;
  /** Optional measurement (e.g. "12 chars"). */
  detail?: string;
  /** Number of elements that triggered the rule. */
  count?: number;
  /** Optional docs link. */
  docUrl?: string;
}

/** Build a paste-ready markdown bug-fix prompt for any list of findings. */
export function buildFindingsPrompt(
  topic: string,
  findings: ReadonlyArray<Finding>,
  context?: FixPromptContext,
): string {
  const lines: string[] = [];
  lines.push(`# ${topic} fix request — captured by Chrome Buddy console inspector`);
  lines.push('');
  lines.push(`I audited a live page and found the following ${topic.toLowerCase()} issue(s).`);
  lines.push('Please locate the offending code in this repository and apply each fix.');
  lines.push('');
  if (context && (context.url || context.title || context.techStack?.length)) {
    lines.push('## Context');
    if (context.url) lines.push(`- **Page URL:** ${context.url}`);
    if (context.title) lines.push(`- **Page title:** ${context.title}`);
    if (context.techStack?.length) lines.push(`- **Detected stack:** ${context.techStack.join(', ')}`);
    lines.push('');
  }
  if (findings.length === 0) {
    lines.push('_No issues found._');
    return lines.join('\n');
  }
  findings.forEach((f, i) => {
    lines.push(`## ${i + 1}. ${f.rule} — \`${f.severity}\``);
    if (typeof f.count === 'number' && f.count > 1) {
      lines.push(`_${f.count} element(s) triggered this rule._`);
    }
    if (f.detail) {
      lines.push(`_Measured: ${f.detail}_`);
    }
    lines.push('');
    lines.push(`**Issue:** ${f.description}`);
    lines.push('');
    lines.push(`**Fix:** ${f.suggestion}`);
    if (f.docUrl) {
      lines.push('');
      lines.push(`**Reference:** ${f.docUrl}`);
    }
    lines.push('');
  });
  lines.push('## Your task');
  lines.push('');
  lines.push(`1. Locate each ${topic.toLowerCase()} issue in this repo. Search for the affected`);
  lines.push('   element/attribute/header named above.');
  lines.push('2. Apply the suggested fix using the framework-idiomatic pattern.');
  lines.push('3. Re-run the audit in Chrome Buddy and verify the issue is resolved.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Master prompt — built from the composeHealth output for the HealthPanel
// ---------------------------------------------------------------------------

/** Single-panel-mastered findings grouped by the analyser they came from. */
export interface MasterFinding extends Finding {
  /** Category label used for the section header in the master prompt. */
  category: string;
}

/**
 * Build ONE comprehensive bug-fix prompt that spans every analytical surface.
 * Sections appear in category order with severity-sorted findings inside each.
 * The Health Score lands at the top so the reader (and IDE agent) knows what
 * "good" looks like as a measurable target after the fixes ship.
 */
export function buildMasterPrompt(
  score: number,
  findings: ReadonlyArray<MasterFinding>,
  context?: FixPromptContext,
): string {
  const lines: string[] = [];
  lines.push('# Site-health fix request — captured by Chrome Buddy console inspector');
  lines.push('');
  lines.push(`**Health Score:** ${score} / 100`);
  lines.push('');
  lines.push('I ran a full audit across console errors, security, accessibility, SEO,');
  lines.push('privacy (leaked secrets), and Web Vitals. Findings are listed below grouped');
  lines.push('by category, severity-sorted within each. Please locate the offending code in');
  lines.push('this repository and apply each fix.');
  lines.push('');
  if (context && (context.url || context.title || context.techStack?.length)) {
    lines.push('## Context');
    if (context.url) lines.push(`- **Page URL:** ${context.url}`);
    if (context.title) lines.push(`- **Page title:** ${context.title}`);
    if (context.techStack?.length) lines.push(`- **Detected stack:** ${context.techStack.join(', ')}`);
    lines.push('');
  }
  // Group by category for stable section headers.
  const byCategory = new Map<string, MasterFinding[]>();
  for (const f of findings) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category)!.push(f);
  }
  if (findings.length === 0) {
    lines.push('_No issues found — Health Score is 100. Nothing to fix._');
    return lines.join('\n');
  }
  for (const [cat, items] of byCategory) {
    lines.push(`## ${labelFor(cat)} (${items.length})`);
    lines.push('');
    items.forEach((f, i) => {
      lines.push(`### ${i + 1}. ${f.rule} — \`${f.severity}\``);
      if (typeof f.count === 'number' && f.count > 1) {
        lines.push(`_${f.count} element(s) triggered this rule._`);
      }
      if (f.detail) lines.push(`_Measured: ${f.detail}_`);
      lines.push('');
      lines.push(`**Issue:** ${f.description}`);
      lines.push('');
      lines.push(`**Fix:** ${f.suggestion}`);
      if (f.docUrl) {
        lines.push('');
        lines.push(`**Reference:** ${f.docUrl}`);
      }
      lines.push('');
    });
  }
  lines.push('## Your task');
  lines.push('');
  lines.push('1. For each finding above, locate the offending code in this repository.');
  lines.push('2. Apply the suggested fix using the framework-idiomatic pattern.');
  lines.push('3. Add or update a test so the regression cannot recur silently.');
  lines.push('4. Re-run Chrome Buddy\'s Health audit on the page and confirm the score');
  lines.push(`   improves beyond ${score} / 100.`);
  lines.push('');
  lines.push('Treat `critical` and `high` as P0; `medium` as P1; `low` as polish.');
  return lines.join('\n');
}

function labelFor(cat: string): string {
  return {
    errors: 'Console Errors',
    security: 'Security',
    a11y: 'Accessibility',
    seo: 'SEO',
    privacy: 'Privacy / Leaked secrets',
    performance: 'Performance (Web Vitals)',
  }[cat] ?? cat;
}

/** Compact "Send to Buddy" prompt — shared shape across panels. */
export function buildBuddyFindingsPrompt(
  topic: string,
  findings: ReadonlyArray<Finding>,
  context?: FixPromptContext,
): string {
  const lines: string[] = [];
  lines.push(`Use list_files + read_file to locate the source of these ${topic.toLowerCase()} issues in the`);
  lines.push("user's root folder, then propose a fix. If a write_file would correct it, prepare it");
  lines.push('and wait for confirmation.');
  lines.push('');
  if (context?.url) lines.push(`Page URL: ${context.url}`);
  if (context?.techStack?.length) lines.push(`Detected stack: ${context.techStack.join(', ')}`);
  lines.push('');
  for (const f of findings.slice(0, 5)) {
    lines.push(`- [${f.severity}] ${f.rule}: ${f.description}`);
    lines.push(`  → ${f.suggestion}`);
  }
  return lines.join('\n');
}
