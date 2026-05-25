// Markdown-aware chunker for the local Library RAG index.
//
// Strategy:
//   1. Split the document on heading boundaries (# / ## / ### ...).
//   2. Within each section, if the body fits in TARGET chars, emit one chunk.
//   3. Otherwise, char-window the section with OVERLAP overlap so semantically
//      adjacent content stays linked.
//
// Pure module — no chrome, no I/O — fully unit-testable.

export interface Chunk {
  /** Index in document order (0..N-1). */
  chunkIdx: number;
  /** The chunk's text payload — what we'll embed and surface in results. */
  text: string;
  /** Character offset into the source text where the chunk starts. */
  charStart: number;
  /** Character offset where it ends (exclusive). */
  charEnd: number;
}

export interface ChunkOptions {
  /** Target chunk size in characters. Default 500 (~125 tokens). */
  target?: number;
  /** Overlap between adjacent char-window chunks. Default 50. */
  overlap?: number;
  /** Maximum chunk size before we force a split, even mid-paragraph. Default 800. */
  hardMax?: number;
}

/** Heading detector — matches `#`, `##`, … `######` at start of line. */
const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;

/**
 * Markdown-aware chunker. Returns chunks in document order with stable char
 * offsets, so we can later trace a result back to its position in the source.
 */
export function chunkMarkdown(text: string, opts: ChunkOptions = {}): Chunk[] {
  const target = opts.target ?? 500;
  const overlap = opts.overlap ?? 50;
  const hardMax = opts.hardMax ?? 800;
  const normalized = (text ?? '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) return [];

  const sections = splitIntoSections(normalized);
  const chunks: Chunk[] = [];
  for (const sec of sections) {
    if (sec.text.length <= target) {
      // Section fits in one chunk — emit it whole.
      pushIfMeaningful(chunks, sec.text, sec.start, sec.start + sec.text.length);
    } else {
      // Section too big: char-window with overlap.
      for (const sub of windowText(sec.text, target, overlap, hardMax)) {
        pushIfMeaningful(chunks, sub.text, sec.start + sub.start, sec.start + sub.end);
      }
    }
  }

  // Renumber chunkIdx after the (rare) skip of meaningless chunks.
  return chunks.map((c, i) => ({ ...c, chunkIdx: i }));
}

interface Section {
  text: string;
  start: number;
}

/**
 * Split a markdown doc on heading boundaries. The text BEFORE the first
 * heading (preamble) becomes its own section. Each heading + following body
 * up to the next heading becomes a section.
 */
export function splitIntoSections(text: string): Section[] {
  const out: Section[] = [];
  const matches: Array<{ start: number }> = [];
  HEADING_RE.lastIndex = 0;
  for (const m of text.matchAll(HEADING_RE)) {
    matches.push({ start: m.index ?? 0 });
  }
  if (matches.length === 0) {
    return [{ text, start: 0 }];
  }
  // Preamble before first heading (if any).
  if (matches[0].start > 0) {
    const preamble = text.slice(0, matches[0].start).trim();
    if (preamble) out.push({ text: preamble, start: 0 });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start;
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    out.push({ text: text.slice(start, end).trim(), start });
  }
  return out;
}

/** Sliding-window split for long sections. Returns relative offsets. */
function* windowText(
  text: string,
  target: number,
  overlap: number,
  hardMax: number,
): Generator<{ text: string; start: number; end: number }> {
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + target, text.length);
    // Prefer to break at a paragraph or sentence boundary near the target if
    // we're not at the end; falls back to hardMax to avoid unbounded growth.
    if (end < text.length) {
      const niceEnd = findNiceBreak(text, pos, end, hardMax);
      if (niceEnd > pos) end = niceEnd;
    }
    yield { text: text.slice(pos, end).trim(), start: pos, end };
    if (end >= text.length) break;
    pos = Math.max(end - overlap, pos + 1);
  }
}

/**
 * Find a "nicer" break point near the target end: prefer a paragraph break
 * (\n\n), then a sentence end (. / ! / ?), then the target itself. Never goes
 * past `pos + hardMax` so a pathological line doesn't blow the budget.
 */
function findNiceBreak(text: string, pos: number, end: number, hardMax: number): number {
  const ceil = Math.min(pos + hardMax, text.length);
  const slice = text.slice(end, ceil);
  // Look ahead for a double-newline first.
  const para = slice.indexOf('\n\n');
  if (para !== -1) return end + para;
  // Then a single newline.
  const nl = slice.indexOf('\n');
  if (nl !== -1) return end + nl;
  // Then a sentence terminator.
  const sent = slice.search(/[.!?]\s/);
  if (sent !== -1) return end + sent + 1;
  return end;
}

/** Drop empty / whitespace-only chunks; otherwise append with placeholder idx. */
function pushIfMeaningful(out: Chunk[], text: string, charStart: number, charEnd: number): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  out.push({ chunkIdx: out.length, text: trimmed, charStart, charEnd });
}
