// write_file (FR-TOOLS-10), executed in the SW. The File System Access API
// needs a window + user gesture, neither of which a service worker has, so we
// save through chrome.downloads instead — a real filesystem write into the
// user's Downloads folder. write_file is CONSEQUENTIAL: the runtime's HITL gate
// always fires before this runs (see src/agent/runner.ts).
import { ok, err, type ToolResult } from '../types';

/** Keep filenames safe + relative to Downloads (no absolute paths or `..`). */
export function sanitizeFilename(raw: string): string {
  const cleaned = String(raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/')
    .trim();
  return cleaned || 'buddy-file.txt';
}

/** Build a data URL carrying UTF-8 text contents. */
export function textDataUrl(contents: string): string {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(contents)}`;
}

export async function executeFileWrite(args: Record<string, unknown>): Promise<ToolResult> {
  const path = typeof args.path === 'string' ? args.path : '';
  const contents = typeof args.contents === 'string' ? args.contents : '';
  if (!path) return err('invalid-args', 'write_file requires a "path" (filename).');
  if (!chrome.downloads?.download) return err('runtime-error', 'Downloads API unavailable.');

  const filename = sanitizeFilename(path);
  try {
    const downloadId = await chrome.downloads.download({
      url: textDataUrl(contents),
      filename,
      saveAs: false,
      conflictAction: 'uniquify',
    });
    return ok({ filename, bytes: contents.length, downloadId });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}
