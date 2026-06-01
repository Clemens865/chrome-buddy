// Pure text-assembly for PDF extraction. pdfjs (in pdf.ts) yields, per page, a
// list of text items; turning those into clean prose is pure string work, kept
// here so it's unit-testable without the pdfjs worker/DOM runtime.

export interface PdfTextItem {
  /** The text run. */
  str: string;
  /** pdfjs sets this when the run ends a line. */
  hasEOL?: boolean;
}

/** Join one page's text items into a string, inserting newlines at EOL items
 *  and a space between adjacent runs so words don't fuse. */
export function pageItemsToText(items: readonly PdfTextItem[]): string {
  let out = '';
  for (const it of items) {
    const s = it?.str ?? '';
    if (s) out += s;
    if (it?.hasEOL) out += '\n';
    else if (s && !s.endsWith(' ')) out += ' ';
  }
  return collapse(out);
}

/** Assemble per-page texts into one document, separated by blank lines, with
 *  empty pages dropped. */
export function assemblePdfText(pageTexts: readonly string[]): string {
  return pageTexts.map((t) => t.trim()).filter(Boolean).join('\n\n').trim();
}

/** Collapse stray spaces and excess blank lines (PDFs are whitespace-noisy). */
function collapse(s: string): string {
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
