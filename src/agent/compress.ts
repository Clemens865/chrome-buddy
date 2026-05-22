// Evidence compression for the synthesis step (concept adapted from
// hermes-agent's context_compressor): a long agent run accumulates many tool
// results (read_dom/extract page dumps are the worst), which blow the token
// budget and cost when fed back for the final answer. We keep the most RECENT
// successful results in full and collapse older ones to a one-line summary,
// with a hard global cap. Pure + unit-tested.

export interface EvidenceItem {
  toolName: string;
  text: string;
}

export interface CompressOptions {
  /** Number of most-recent results kept in full. */
  keepRecent?: number;
  /** Per-result char cap for the full (recent) results. */
  perActionChars?: number;
  /** Char cap for a summarized (older) result. */
  summaryChars?: number;
  /** Hard cap on the whole returned string. */
  totalChars?: number;
}

const DEFAULTS: Required<CompressOptions> = {
  keepRecent: 3,
  perActionChars: 4000,
  summaryChars: 200,
  totalChars: 16_000,
};

/** Collapse whitespace and clip to a single short line. */
export function oneLine(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Build a bounded evidence block: recent results in full (each capped), older
 * results summarized to one line, then the whole thing clipped to totalChars.
 */
export function compressEvidence(items: EvidenceItem[], opts: CompressOptions = {}): string {
  const { keepRecent, perActionChars, summaryChars, totalChars } = { ...DEFAULTS, ...opts };
  const n = items.length;
  const blocks = items.map((it, i) => {
    const recent = i >= n - keepRecent;
    const body = recent ? it.text.slice(0, perActionChars) : oneLine(it.text, summaryChars);
    return `## ${it.toolName}${recent ? '' : ' (earlier — summary)'}\n${body}`;
  });
  const joined = blocks.join('\n\n');
  // Clip from the FRONT so the freshest evidence survives the global cap.
  return joined.length > totalChars ? `…\n${joined.slice(joined.length - totalChars)}` : joined;
}
