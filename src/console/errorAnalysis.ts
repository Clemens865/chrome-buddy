// AI Error Analysis — turns captured console errors into a structured, artifact-
// style debugging report: a plain-language summary, the likely root cause, a
// numbered fix plan, an optional code snippet, a ready-to-paste prompt for an
// external AI coding assistant, plus files-to-check and search terms.
//
// This complements the offline pattern-matcher (errorPatterns.ts): the matcher
// is instant and works with no key; THIS asks the model for a deeper read when
// the user wants one. Pattern matches are fed in as a head-start so the model
// reasons from a pre-diagnosis rather than raw text alone.
//
// `buildErrorAnalysisPrompt` + `parseErrorAnalysis` are PURE (no chrome, no
// network) so they are unit-testable; `analyzeErrorsAI` adds the SW round-trip.

import { generateViaBackground } from '../llm/instance';
import type { ErrorMatch } from './errorPatterns';
import type { LogEntry } from './capture';
import type { FixPromptContext } from './fixPrompt';

/** The structured artifact rendered by ErrorAnalysisCard. */
export interface ErrorAnalysis {
  /** 1-2 sentence plain-language summary of what's going wrong. */
  summary: string;
  /** Developer-friendly explanation of the likely root cause. */
  rootCause: string;
  /** Ordered, actionable fix steps. */
  suggestedFixes: string[];
  /** Optional fix snippet (real newlines after parsing). */
  suggestedCode?: string;
  /** A comprehensive, ready-to-paste prompt for Claude / Cursor / Copilot. */
  aiPrompt: string;
  /** Files likely involved (extracted from stack traces / messages). */
  filesToCheck: string[];
  /** Useful search queries for further help. */
  searchTerms: string[];
}

export interface ErrorAnalysisInput {
  /** Pattern matches from analyze_errors (pre-diagnosed; may be empty). */
  matches: readonly ErrorMatch[];
  /** Raw captured logs — used for stack traces + source files. */
  logs?: readonly LogEntry[];
  context?: FixPromptContext;
}

export const ERROR_ANALYSIS_SYSTEM =
  'You are an expert full-stack developer and debugger. You help developers ' +
  'quickly understand and fix console errors. Be practical, specific, and ' +
  'action-oriented. Respond with ONLY a JSON object — no prose, no markdown ' +
  'fences.';

const MAX_LOG_LINES = 30;
const MAX_LINE_CHARS = 300;

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/**
 * PURE: build the analysis prompt. Feeds the model the page context, the
 * pre-diagnosed pattern matches, and a bounded slice of raw error/warning lines
 * (with their source URLs so it can extract file names + stack frames).
 */
export function buildErrorAnalysisPrompt(input: ErrorAnalysisInput): string {
  const ctx = input.context ?? {};
  const lines: string[] = [];

  lines.push('Analyze these console errors/warnings from a web application and provide debugging assistance.');
  lines.push('');

  if (ctx.url || ctx.title || ctx.techStack?.length) {
    lines.push('## Context');
    if (ctx.url) lines.push(`- Page URL: ${ctx.url}`);
    if (ctx.title) lines.push(`- Page title: ${ctx.title}`);
    if (ctx.techStack?.length) lines.push(`- Detected stack: ${ctx.techStack.join(', ')}`);
    lines.push('');
  }

  if (input.matches.length > 0) {
    lines.push('## Known patterns already detected (use as a head-start, verify against the raw logs)');
    input.matches.slice(0, 12).forEach((m, i) => {
      const fw = m.framework ? ` · ${m.framework}` : '';
      lines.push(`${i + 1}. [${m.severity}] ${m.category}${fw}: ${m.description}`);
      lines.push(`   captured: ${truncate(m.text, MAX_LINE_CHARS)}`);
    });
    lines.push('');
  }

  // Raw error/warn lines carry the stack/source the matcher discards.
  const raw = (input.logs ?? [])
    .filter((e) => e.level === 'error' || e.level === 'warn')
    .slice(-MAX_LOG_LINES);
  if (raw.length > 0) {
    lines.push('## Raw error/warning log lines');
    lines.push('```');
    for (const e of raw) {
      const src = e.source ? ` @ ${e.source}` : '';
      const times = e.count > 1 ? ` [x${e.count}]` : '';
      lines.push(`[${e.level.toUpperCase()}]${times} ${truncate(e.text, MAX_LINE_CHARS)}${src}`);
    }
    lines.push('```');
    lines.push('');
  }

  lines.push('Respond with EXACTLY this JSON structure (no other keys, no commentary):');
  lines.push('{');
  lines.push('  "summary": "1-2 sentence summary of what is going wrong",');
  lines.push('  "rootCause": "developer-friendly explanation of the likely root cause",');
  lines.push('  "suggestedFixes": ["step-by-step fix 1", "fix 2", "fix 3"],');
  lines.push('  "suggestedCode": "optional code snippet that fixes the issue; use \\n for newlines; omit or empty if not applicable",');
  lines.push('  "filesToCheck": ["file names extracted from stack traces / messages"],');
  lines.push('  "searchTerms": ["useful search query", "another"],');
  lines.push('  "aiPrompt": "a comprehensive, ready-to-paste prompt for an AI coding assistant (Claude, Cursor, Copilot) that restates the key errors and asks for a fix, detailed enough that another AI can act on it without seeing this console"');
  lines.push('}');
  lines.push('');
  lines.push('Be specific and actionable. Extract real file names from stack traces. Give framework-specific advice when the stack is known (React/Next.js/Vue/Node/etc.).');

  return lines.join('\n');
}

/** Strip a ```json … ``` (or bare ```) fence the model may wrap JSON in. */
function stripFence(text: string): string {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return fence ? fence[1].trim() : t;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : String(x ?? '').trim())).filter(Boolean);
}

/**
 * PURE + tolerant: parse the model reply into an ErrorAnalysis. Handles fenced
 * JSON and prose-wrapped JSON (salvages the first {...} block). Returns null if
 * there's no usable summary/rootCause — the caller surfaces a retry hint.
 */
export function parseErrorAnalysis(text: string): ErrorAnalysis | null {
  let data: unknown;
  try {
    data = JSON.parse(stripFence(text));
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) return null;
    try {
      data = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const summary = typeof o.summary === 'string' ? o.summary.trim() : '';
  const rootCause = typeof o.rootCause === 'string' ? o.rootCause.trim() : '';
  if (!summary && !rootCause) return null;
  const codeRaw = typeof o.suggestedCode === 'string' ? o.suggestedCode : '';
  // Models sometimes emit literal "\n" in JSON strings; normalize to real ones.
  const suggestedCode = codeRaw.replace(/\\n/g, '\n').trim();
  const aiPrompt = typeof o.aiPrompt === 'string' ? o.aiPrompt.trim() : '';
  return {
    summary,
    rootCause,
    suggestedFixes: toStringArray(o.suggestedFixes),
    suggestedCode: suggestedCode || undefined,
    aiPrompt,
    filesToCheck: toStringArray(o.filesToCheck ?? o.relatedFiles),
    searchTerms: toStringArray(o.searchTerms),
  };
}

/**
 * Run the AI analysis via the background SW (key stays in the SW). Throws on
 * transport/model failure or an unparseable reply — the panel surfaces it.
 */
export async function analyzeErrorsAI(
  input: ErrorAnalysisInput,
  model?: string,
): Promise<ErrorAnalysis> {
  const prompt = buildErrorAnalysisPrompt(input);
  const result = await generateViaBackground({
    messages: [
      { role: 'system', content: ERROR_ANALYSIS_SYSTEM },
      { role: 'user', content: prompt },
    ],
    ...(model ? { model } : {}),
  });
  const parsed = parseErrorAnalysis(result.text);
  if (!parsed) {
    throw new Error('The model did not return a parseable analysis. Try again.');
  }
  return parsed;
}
