// LLM-driven Library consolidation (pure decision layer; all I/O is injected).
//
// When a NEW doc would be added to the Library, we compare it to the most
// similar EXISTING doc and decide what to do — so the Library self-curates
// instead of accumulating near-duplicates:
//   • REPLACE        — the new content supersedes the old (near-dup or fresher)
//   • MERGE          — combine both into one updated doc (model writes the merge)
//   • KEEP_SEPARATE  — genuinely distinct; index the new doc alongside
//   • SKIP           — the new content adds nothing; don't index it
//
// Two cheap threshold fast-paths bracket the (single) LLM call: an obvious
// near-duplicate is REPLACEd with no LLM, and a clearly-distinct doc is
// KEEP_SEPARATE with no LLM. Only the ambiguous middle band spends a call.

export type ConsolidationAction = 'merge' | 'replace' | 'keep_separate' | 'skip';

/** Top cosine ≥ this ⇒ obvious near-duplicate, REPLACE without an LLM. */
export const REPLACE_THRESHOLD = 0.92;
/** Top cosine < this ⇒ clearly distinct, KEEP_SEPARATE without an LLM. */
export const CONSIDER_THRESHOLD = 0.78;

export interface ConsolidationDecision {
  action: ConsolidationAction;
  /** For 'merge': the combined doc content the model produced. */
  mergedContent?: string;
  reason?: string;
}

/**
 * Decide WITHOUT an LLM from the top similarity score alone — or return null
 * when the score lands in the ambiguous band where a judgment call is worth one
 * cheap model call.
 */
export function decideBySimilarity(topScore: number): ConsolidationDecision | null {
  if (topScore >= REPLACE_THRESHOLD) {
    return { action: 'replace', reason: `near-duplicate (cosine ${topScore.toFixed(2)})` };
  }
  if (topScore < CONSIDER_THRESHOLD) {
    return { action: 'keep_separate', reason: `distinct (cosine ${topScore.toFixed(2)})` };
  }
  return null; // ambiguous → ask the LLM
}

export const CONSOLIDATE_SYSTEM =
  'You curate a personal knowledge library. A NEW note is about to be saved and ' +
  'an EXISTING note is similar. Decide how to keep the library clean and ' +
  'non-redundant WITHOUT losing information. Choose exactly one action:\n' +
  '- "merge": the two overlap and should become ONE note — return the combined ' +
  'content in "mergedContent" (keep every distinct fact, drop the redundancy).\n' +
  '- "replace": the new note fully supersedes the old (same topic, fresher/better).\n' +
  '- "keep_separate": they are genuinely about different things.\n' +
  '- "skip": the new note adds nothing the old one does not already cover.\n' +
  'Prefer keep_separate when unsure — never discard information. ' +
  'Respond ONLY with JSON: {"action":"...","mergedContent":"...(only for merge)","reason":"..."}.';

/** Build the user message pairing the incoming + existing docs for the judge. */
export function consolidatePrompt(
  incoming: { title: string; content: string },
  existing: { title: string; content: string },
): string {
  const clip = (s: string) => (s.length > 4000 ? s.slice(0, 4000) + '\n…(truncated)' : s);
  return (
    `NEW note — "${incoming.title}":\n${clip(incoming.content)}\n\n` +
    `EXISTING note — "${existing.title}":\n${clip(existing.content)}`
  );
}

const ACTIONS: readonly ConsolidationAction[] = ['merge', 'replace', 'keep_separate', 'skip'];

function extractJson(text: string): unknown {
  if (!text) return null;
  let raw = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  if (raw[0] !== '{') {
    const start = raw.indexOf('{');
    if (start < 0) return null;
    raw = raw.slice(start);
  }
  try {
    return JSON.parse(raw);
  } catch {
    const end = raw.lastIndexOf('}');
    if (end < 0) return null;
    try {
      return JSON.parse(raw.slice(0, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Parse the judge's reply into a decision. Safe by default: anything
 * unparseable, an unknown action, or a 'merge' with no usable mergedContent
 * falls back to KEEP_SEPARATE — we never DROP a note on a parse failure.
 */
export function parseConsolidationDecision(text: string): ConsolidationDecision {
  const safe: ConsolidationDecision = { action: 'keep_separate', reason: 'unparseable — kept separate' };
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== 'object') return safe;
  const o = parsed as Record<string, unknown>;
  const action = typeof o.action === 'string' ? (o.action.toLowerCase() as ConsolidationAction) : undefined;
  if (!action || !ACTIONS.includes(action)) return safe;
  const reason = typeof o.reason === 'string' ? o.reason : undefined;
  if (action === 'merge') {
    const mergedContent = typeof o.mergedContent === 'string' ? o.mergedContent.trim() : '';
    if (!mergedContent) return { action: 'keep_separate', reason: 'merge had no content — kept separate' };
    return { action: 'merge', mergedContent, reason };
  }
  return { action, reason };
}
