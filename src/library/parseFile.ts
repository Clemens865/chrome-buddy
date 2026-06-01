// Multi-format file parsing for Library ingest. Pure string→{title,text} so the
// extraction logic is unit-testable; the panel reads File.text() and hands the
// raw string here. Binary formats (PDF) are handled separately (Slice 3) — this
// module covers everything that arrives as text.

export interface ParsedFile {
  title: string;
  text: string;
}

/** Extensions we can extract text from here (text-based). */
const TEXT_EXTS = [
  '.md', '.markdown', '.mdx', '.txt', '.text', '.rst',
  '.csv', '.tsv', '.json', '.yaml', '.yml', '.toml',
  '.html', '.htm', '.xml',
  // common code/config files — indexed as plain text
  '.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.rb',
  '.c', '.h', '.cpp', '.cs', '.php', '.sh', '.sql', '.css',
];

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

export function isSupportedTextFile(name: string): boolean {
  return TEXT_EXTS.includes(fileExtension(name));
}

/** Strip the extension + leading path from a filename for a default title. */
export function baseName(name: string): string {
  const file = name.split(/[\\/]/).pop() ?? name;
  const dot = file.lastIndexOf('.');
  return (dot > 0 ? file.slice(0, dot) : file).trim() || file;
}

/**
 * Parse a text file's raw contents into a title + clean text ready to index.
 * Routes by extension: HTML is tag-stripped, JSON is pretty-printed, Markdown's
 * first H1 becomes the title — everything else is passed through verbatim.
 */
export function parseFile(name: string, raw: string): ParsedFile {
  const ext = fileExtension(name);
  const fallbackTitle = baseName(name);
  if (ext === '.html' || ext === '.htm' || ext === '.xml') {
    const { title, text } = htmlToText(raw);
    return { title: title || fallbackTitle, text };
  }
  if (ext === '.json') {
    return { title: fallbackTitle, text: prettyJson(raw) };
  }
  // Markdown/MDX: prefer the first H1 as the title.
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') {
    return { title: firstHeading(raw) || fallbackTitle, text: raw.trim() };
  }
  return { title: fallbackTitle, text: raw.trim() };
}

/** First `# Heading` text in a markdown doc, or '' if none near the top. */
export function firstHeading(md: string): string {
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? m[1].trim() : '';
}

/** Pretty-print JSON when valid; fall back to the raw text otherwise. */
export function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw.trim();
  }
}

/** Strip HTML to readable text + pull out the <title>. Pure, dependency-free —
 *  removes script/style blocks, drops tags, decodes common entities, and
 *  collapses whitespace so the chunker sees prose, not markup. */
export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Block elements → newline so paragraphs survive.
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return { title, text: collapse(decodeEntities(text)) };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/** Collapse runs of spaces/tabs and excess blank lines. */
function collapse(s: string): string {
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
