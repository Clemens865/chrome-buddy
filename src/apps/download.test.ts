import { describe, it, expect } from 'vitest';
import { buildDownloadBlob, safeDownloadName } from './download';

// 1x1 transparent PNG (base64) — 67 decoded bytes.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('buildDownloadBlob', () => {
  it('decodes a base64 image data URL to real bytes with the embedded MIME', async () => {
    const blob = buildDownloadBlob(`data:image/png;base64,${PNG}`);
    expect(blob.type).toBe('image/png');
    // It is the DECODED bytes, not the literal data-URL string.
    expect(blob.size).toBe(atob(PNG).length);
    expect(blob.size).not.toBe(`data:image/png;base64,${PNG}`.length);
  });
  it('decodes a percent-encoded (non-base64) data URL as text', async () => {
    const blob = buildDownloadBlob('data:image/svg+xml,%3Csvg%3E%3C/svg%3E');
    expect(blob.type).toBe('image/svg+xml');
    expect(await blob.text()).toBe('<svg></svg>');
  });
  it('treats plain text content as text (SVG/CSV strings)', async () => {
    const blob = buildDownloadBlob('<svg></svg>', 'image/svg+xml');
    expect(blob.type).toBe('image/svg+xml');
    expect(await blob.text()).toBe('<svg></svg>');
    expect(buildDownloadBlob('a,b,c').type).toBe('text/plain');
  });
});

describe('safeDownloadName', () => {
  it('keeps the extension + sanitizes the rest', () => {
    expect(safeDownloadName('portrait.png')).toBe('portrait.png');
    expect(safeDownloadName('my file*?.png')).toBe('my_file_.png');
    expect(safeDownloadName()).toBe('download.txt');
  });
});
