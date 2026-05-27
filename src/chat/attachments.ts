// Compose attachments for the chat composer. Pure module (no chrome / no
// network / no FileReader globals beyond what's available in DOM contexts).
//
// Behavior:
//   - Image files (image/*)         → ChatAttachment of kind 'image' with a
//                                     data: URL (base64 dataUrl).
//   - Text-ish files (.txt/.md/...) → ChatAttachment of kind 'text' with the
//                                     raw decoded contents inlined.
//   - Other (PDFs, archives, etc.)  → rejected with a structured error so the
//                                     UI can render a friendly toast.

/** What the composer holds between picking a file and pressing Send. */
export type ChatAttachment =
  | {
      kind: 'image';
      name: string;
      mime: string;
      /** data:<mime>;base64,<…> — passed verbatim to the ContentPart image part. */
      dataUrl: string;
      size: number;
    }
  | {
      kind: 'text';
      name: string;
      mime: string;
      /** Decoded UTF-8 contents. Truncated to MAX_TEXT_CHARS by the caller if needed. */
      text: string;
      size: number;
    };

export const MAX_ATTACHMENTS = 5;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_TEXT_CHARS = 80_000; // ~ ~30k tokens; bigger pastes are mostly noise

/** File extensions we treat as text-ish (read inline, not base64). */
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'yaml', 'yml', 'xml',
  'html', 'htm', 'log', 'ini', 'toml', 'env', 'js', 'ts', 'tsx', 'jsx',
  'css', 'sql', 'sh', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp',
  'rst', 'org', 'tex',
]);

/** Mimes the OpenAI-compat image_url part definitely accepts. */
const SUPPORTED_IMAGE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
]);

/** Classify a File into one of the categories the chat path supports. */
export function classifyFile(f: { name: string; type: string; size: number }):
  | { kind: 'image' }
  | { kind: 'text' }
  | { kind: 'reject'; reason: string } {
  if (f.size === 0) return { kind: 'reject', reason: `"${f.name}" is empty.` };
  if (f.size > MAX_TOTAL_BYTES) {
    return { kind: 'reject', reason: `"${f.name}" is ${formatBytes(f.size)}; max is ${formatBytes(MAX_TOTAL_BYTES)}.` };
  }
  const ext = (f.name.split('.').pop() ?? '').toLowerCase();
  if (f.type.startsWith('image/')) {
    return SUPPORTED_IMAGE_MIMES.has(f.type) || f.type === 'image/jpg'
      ? { kind: 'image' }
      : { kind: 'reject', reason: `Image format ${f.type} not supported. Use PNG, JPEG, WebP, GIF, or HEIC.` };
  }
  if (f.type === 'application/pdf' || ext === 'pdf') {
    return {
      kind: 'reject',
      reason: 'PDF documents are not supported yet — paste the text, or use the Audio Transcriber for spoken content.',
    };
  }
  if (f.type.startsWith('text/') || TEXT_EXTS.has(ext)) {
    return { kind: 'text' };
  }
  return {
    kind: 'reject',
    reason: `"${f.name}" (${f.type || 'unknown'}) is not a supported document. Try an image, .txt, .md, or another plain-text file.`,
  };
}

/** Sum of bytes across the current attachment list. */
export function totalBytes(items: ChatAttachment[]): number {
  return items.reduce((n, a) => n + a.size, 0);
}

/** Format byte counts for inline chips ("12.3 KB"). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Build the fenced text block that gets prepended to the prompt's context.
 *  Each text attachment becomes its own fenced section so the model can tell
 *  them apart. Truncates each body to MAX_TEXT_CHARS with a notice. */
export function formatTextAttachments(items: ChatAttachment[]): string {
  const parts: string[] = [];
  for (const a of items) {
    if (a.kind !== 'text') continue;
    const truncated = a.text.length > MAX_TEXT_CHARS;
    const body = truncated ? a.text.slice(0, MAX_TEXT_CHARS) : a.text;
    parts.push(
      `# Attached file: ${a.name} (${formatBytes(a.size)})${truncated ? ' — TRUNCATED' : ''}\n\n${'```'}\n${body}\n${'```'}`,
    );
  }
  return parts.join('\n\n');
}

/** Filter just the image attachments — used when building the multimodal
 *  user message. */
export function imageAttachments(items: ChatAttachment[]): ChatAttachment[] {
  return items.filter((a) => a.kind === 'image');
}
