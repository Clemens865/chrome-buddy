// Pure helpers for trimming MCP tool results before they land in the visible
// chat transcript. The FULL result still goes back to the model on the next
// turn — this is purely about what the user sees, so a 50KB API response
// doesn't make the conversation unscrollable.

/** Soft cap on what we render inline in chat. Past this, the renderer shows
 *  the first slice + a "Show full result" expander that reveals the rest. */
export const CHAT_RESULT_TRIM_BYTES = 2 * 1024;

export interface TrimmedResult {
  /** What the chat shows by default. */
  visible: string;
  /** Tail content; empty when the result is already small. */
  hidden: string;
  /** True if any trimming happened. */
  trimmed: boolean;
  /** Byte length of the full original (for the "12.3 KB" affordance). */
  totalBytes: number;
}

/** Split a string at a UTF-8 byte boundary close to maxBytes WITHOUT splitting
 *  a multi-byte character (so we don't render replacement squares mid-emoji). */
export function trimForChat(full: string, maxBytes = CHAT_RESULT_TRIM_BYTES): TrimmedResult {
  const totalBytes = byteLength(full);
  if (totalBytes <= maxBytes) {
    return { visible: full, hidden: '', trimmed: false, totalBytes };
  }
  // Walk the codepoints, counting bytes, stop just before maxBytes.
  let acc = 0;
  let cut = full.length;
  for (let i = 0; i < full.length; ) {
    const cp = full.codePointAt(i) ?? 0;
    const bytes = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (acc + bytes > maxBytes) {
      cut = i;
      break;
    }
    acc += bytes;
    i += cp >= 0x10000 ? 2 : 1; // surrogate pair → step 2 chars
  }
  return {
    visible: full.slice(0, cut),
    hidden: full.slice(cut),
    trimmed: true,
    totalBytes,
  };
}

export function byteLength(s: string): number {
  // Encode rather than s.length * 2; counts actual UTF-8 bytes.
  return new TextEncoder().encode(s).length;
}

/** Format a byte count for the "showing 2.0 KB of 12.3 KB" affordance. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
