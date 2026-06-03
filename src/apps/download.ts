// Build the Blob for a sandbox app's api.download(). Critical: content from
// bridge.image (and any <img>.src) is a data: URL — it MUST be decoded to its
// real bytes, or the saved file is the literal "data:image/png;base64,…" text
// and won't open. Plain text (SVG, CSV, JSON strings) passes through unchanged.
// Pure (uses Blob/atob, both available in the panel + the test runtime).

/** Decode `content` into a Blob. Data URLs (base64 or percent-encoded) become
 *  their real bytes with the embedded MIME; everything else is treated as text. */
export function buildDownloadBlob(content: string, mime?: string): Blob {
  const m = /^data:([^;,]*?)(;base64)?,([\s\S]*)$/.exec(content ?? '');
  if (m) {
    const type = m[1] || mime || 'application/octet-stream';
    if (m[2]) {
      // base64 → bytes
      const bin = atob(m[3]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    }
    return new Blob([decodeURIComponent(m[3])], { type });
  }
  return new Blob([content ?? ''], { type: mime || 'text/plain' });
}

/** Sanitize a proposed download filename (keep dots/dashes/underscores). */
export function safeDownloadName(name?: string): string {
  return (name || 'download.txt').replace(/[^a-z0-9._-]+/gi, '_');
}
