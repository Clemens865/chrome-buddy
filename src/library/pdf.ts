// PDF text extraction via pdfjs-dist. Runs PANEL-side (needs a worker + DOM),
// never in the service worker. Gemini accepts WAV/text but not PDFs directly, so
// we extract text here and index it like any other doc. Bundled worker (no CDN)
// keeps us within the zero-RCE line.
import * as pdfjs from 'pdfjs-dist';
// Vite emits the worker as a same-origin asset; ?url gives its bundled path.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { pageItemsToText, assemblePdfText, type PdfTextItem } from './pdfText';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfExtract {
  text: string;
  pageCount: number;
}

/**
 * Extract plain text from a PDF's bytes. isEvalSupported:false + disableFontFace
 * keep us off the code-eval / web-font paths (CSP-clean, faster). Returns the
 * concatenated page text + page count.
 */
export async function extractPdfText(data: ArrayBuffer): Promise<PdfExtract> {
  // isEvalSupported:false keeps us off the code-eval path (CSP-clean) — it's a
  // valid runtime option that pdfjs v6's d.ts omits, hence the cast.
  const params = {
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  } as Parameters<typeof pdfjs.getDocument>[0];
  const loadingTask = pdfjs.getDocument(params);
  try {
    const doc = await loadingTask.promise;
    const pageTexts: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pageTexts.push(pageItemsToText(content.items as PdfTextItem[]));
      page.cleanup();
    }
    return { text: assemblePdfText(pageTexts), pageCount: doc.numPages };
  } finally {
    await loadingTask.destroy();
  }
}

export function isPdfFile(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf');
}
