// Minimal SSE (Server-Sent Events) frame parser. Handles only what MCP's
// Streamable HTTP transport sends:
//   - `event: <name>` (optional; defaults to 'message')
//   - `data: <json line>` (may repeat for multi-line data — concatenated with \n)
//   - blank line terminates a frame
//   - lines starting with `:` are comments (keepalives) and ignored
// We do NOT implement `id:` / `retry:` because Streamable HTTP doesn't use them
// for reconnection — the session is one-shot per request.

export interface SseFrame {
  event?: string;
  data: string;
}

/** Parse complete frames from a buffer. Returns the frames found AND the
 *  unconsumed tail so the caller can append more bytes and call again. */
export function parseSseFrames(buf: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  let cursor = 0;
  // A frame ends at the first blank line — \n\n or \r\n\r\n.
  for (;;) {
    const nn = buf.indexOf('\n\n', cursor);
    const rnrn = buf.indexOf('\r\n\r\n', cursor);
    let term: number;
    let termLen: number;
    if (nn === -1 && rnrn === -1) break;
    if (nn === -1) {
      term = rnrn;
      termLen = 4;
    } else if (rnrn === -1) {
      term = nn;
      termLen = 2;
    } else if (rnrn < nn) {
      term = rnrn;
      termLen = 4;
    } else {
      term = nn;
      termLen = 2;
    }
    const block = buf.slice(cursor, term);
    cursor = term + termLen;
    const frame = parseBlock(block);
    if (frame) frames.push(frame);
  }
  return { frames, rest: buf.slice(cursor) };
}

function parseBlock(block: string): SseFrame | null {
  let event: string | undefined;
  let dataParts: string[] = [];
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    if (line === '' || line.startsWith(':')) continue;
    const idx = line.indexOf(':');
    let field: string;
    let value: string;
    if (idx === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, idx);
      // Per spec, a single leading space after the colon is stripped.
      value = line.slice(idx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
    }
    if (field === 'event') event = value;
    else if (field === 'data') dataParts.push(value);
  }
  if (dataParts.length === 0) return null;
  return { event, data: dataParts.join('\n') };
}
