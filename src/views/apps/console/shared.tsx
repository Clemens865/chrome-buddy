// Console Inspector — cross-cutting helpers shared by every panel.
//
// What lives here:
//   - runTool<T>()           single TOOL_EXEC bridge with a 30s in-memory cache
//                            (Re-audit buttons pass force=true to bypass).
//   - invalidateToolCache()  cache invalidation hook (e.g. after navigation).
//   - copyToClipboard()      safe clipboard write with execCommand fallback.
//   - CopyHandoffButtons     "Copy fix prompt" / "Send to Buddy" toolbar.
//   - useTechContext()       lazily fetches detect_tech_stack once per mount.
//   - shortHost / hostOnly / formatBytes — small format helpers.
//
// Each panel imports only what it needs from here, keeping individual panel
// files focused on rendering their analyser's structured output.

import { useEffect, useState, type CSSProperties } from 'react';
import type { ToolResult } from '../../../types';
import type { TechMatch } from '../../../console/techStack';
import {
  buildFindingsPrompt,
  buildBuddyFindingsPrompt,
  type Finding,
  type FixPromptContext,
} from '../../../console/fixPrompt';

// --- Shared TOOL_EXEC bridge + 30s cache ----------------------------------

interface CacheEntry {
  result: ToolResult;
  ts: number;
}
const TOOL_CACHE = new Map<string, CacheEntry>();
const TOOL_CACHE_TTL_MS = 30_000;

/** Drop everything cached. Exported so any future "page changed" signal can
 * wipe the slate. */
export function invalidateToolCache(toolPrefix?: string): void {
  if (!toolPrefix) { TOOL_CACHE.clear(); return; }
  for (const key of TOOL_CACHE.keys()) {
    if (key.startsWith(toolPrefix + ':')) TOOL_CACHE.delete(key);
  }
}

export async function runTool<T>(
  tool: string,
  args: Record<string, unknown> = {},
  options: { force?: boolean } = {},
): Promise<ToolResult<T>> {
  const key = `${tool}:${JSON.stringify(args)}`;
  if (!options.force) {
    const hit = TOOL_CACHE.get(key);
    if (hit && Date.now() - hit.ts < TOOL_CACHE_TTL_MS) {
      return hit.result as ToolResult<T>;
    }
  }
  const r = (await chrome.runtime.sendMessage({ type: 'TOOL_EXEC', tool, args })) as
    | { type: 'TOOL_EXEC'; ok: true; result: ToolResult<T> }
    | undefined;
  let result: ToolResult<T>;
  if (!r || !r.ok) {
    result = { ok: false, error: { code: 'runtime-error', message: 'No response from background.' } };
  } else {
    result = r.result;
  }
  // Only cache successful results — errors should be retried on next call.
  if (result.ok) TOOL_CACHE.set(key, { result, ts: Date.now() });
  return result;
}

// --- Handoff type ----------------------------------------------------------

/** Callback the panel calls when the user wants to hand off a fix request to
 * Buddy chat. PanelApp wires this to setPendingRun + setView('chat'). */
export type OnHandoff = (req: { prompt: string; mode: 'ask' | 'agent' }) => void;

// --- copyToClipboard with execCommand fallback -----------------------------

/** Copy text to the clipboard. Falls back gracefully when navigator.clipboard
 * is gated (older Chromes / iframe contexts) by selecting + execCommand. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

// --- CopyHandoffButtons ----------------------------------------------------

/** Shared toolbar: "Copy fix prompt" + "Send to Buddy" used by A11y,
 * Security, and SEO panels. The Errors and Health panels render bespoke
 * variants because their prompt shapes differ. */
export function CopyHandoffButtons({
  topic,
  findings,
  context,
  onHandoff,
  testid,
}: {
  topic: string;
  findings: ReadonlyArray<Finding>;
  context?: FixPromptContext;
  onHandoff?: OnHandoff;
  /** Test-id stem (e.g. "ci-a11y", "ci-sec", "ci-seo"). */
  testid: string;
}) {
  const [copied, setCopied] = useState(false);
  if (findings.length === 0) return null;
  const flash = () => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        data-testid={`${testid}-copy`}
        title="Copy a paste-ready fix prompt for your coding IDE (Cursor, Claude Code, …)."
        onClick={async () => {
          const md = buildFindingsPrompt(topic, findings, context);
          if (await copyToClipboard(md)) flash();
        }}
      >
        {copied ? 'Copied ✓' : 'Copy fix prompt'}
      </button>
      {onHandoff && (
        <button
          type="button"
          className="btn btn-sm"
          data-testid={`${testid}-send-buddy`}
          title="Open a Buddy chat that uses list_files + read_file + write_file to find and fix the code."
          onClick={() => {
            const prompt = buildBuddyFindingsPrompt(topic, findings, context);
            onHandoff({ prompt, mode: 'agent' });
          }}
        >
          Send to Buddy
        </button>
      )}
    </>
  );
}

// --- useTechContext hook ---------------------------------------------------

/** Lazily fetch detect_tech_stack once and return the structured context
 * each panel threads into its IDE prompt. Cache means re-mounting any panel
 * within 30s won't refire the probe. */
export function useTechContext(): FixPromptContext | undefined {
  const [ctx, setCtx] = useState<FixPromptContext | undefined>();
  useEffect(() => {
    let active = true;
    void (async () => {
      const r = await runTool<{ url: string; matches: TechMatch[] }>('detect_tech_stack');
      if (!active) return;
      if (r.ok) {
        setCtx({
          url: r.data.url,
          techStack: r.data.matches.map((m) => m.name),
        });
      }
    })();
    return () => { active = false; };
  }, []);
  return ctx;
}

// --- Format helpers --------------------------------------------------------

export function shortHost(s: string | undefined): string {
  if (!s) return '';
  try {
    const u = new URL(s);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    return last ? `${u.host}/${last}` : u.host;
  } catch {
    return s;
  }
}
export function hostOnly(s: string | undefined): string {
  if (!s) return '';
  try {
    return new URL(s).host;
  } catch {
    return s;
  }
}
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// --- Inline styles shared between panel notice banners ---------------------

export const noticeStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  fontSize: 11.5,
  lineHeight: 1.4,
  color: 'var(--panel-muted)',
  background: 'var(--panel-elev)',
  borderBottom: '1px solid var(--panel-border-soft)',
};
export const errNoticeStyle: CSSProperties = {
  ...noticeStyle,
  color: '#B91C1C',
  background: 'color-mix(in srgb, #EF4444 8%, transparent)',
};
