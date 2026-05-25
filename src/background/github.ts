// GitHub Contents API — write / read / list files in a user repo.
//
// Token custody mirrors NFR-SEC-1 for the Gemini key: the GitHub PAT lives
// ONLY in chrome.storage.session (in-memory, cleared at browser-session end).
// Set via Settings → GitHub. Never embedded in the bundle. Never sent to a
// content script.
//
// Tools:
//   - github_write(repo, path, content, message?, branch?)
//       PUT /repos/{owner}/{repo}/contents/{path}. Auto GET-then-PUT to obtain
//       the sha for updates (creates when GET 404s). CONSEQUENTIAL — HITL gates.
//   - github_read(repo, path, ref?)
//   - github_list(repo, path?, ref?)
import { ok, err, type ToolResult } from '../types';
import { BUDDY_UA } from '../llm/ua';
import { retryFetch } from '../llm/retry';

const API_BASE = 'https://api.github.com';
const ACCEPT = 'application/vnd.github+json';
const VERSION = '2022-11-28';

/** Encode any UTF-8 string as base64 (works for non-Latin1 content too). */
export function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Decode a base64-encoded UTF-8 string (the shape GitHub returns). */
export function base64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Split "owner/repo" → {owner, repo}. */
export function parseRepo(repo: string): { owner: string; name: string } | null {
  const m = /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(String(repo ?? '').trim());
  return m ? { owner: m[1], name: m[2] } : null;
}

/** Read the configured PAT from chrome.storage.session (never logged). */
async function readToken(): Promise<string | undefined> {
  const r = (await chrome.storage.session.get('gh_token')) as { gh_token?: string };
  return typeof r.gh_token === 'string' && r.gh_token.length > 0 ? r.gh_token : undefined;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Accept: ACCEPT,
    'X-GitHub-Api-Version': VERSION,
    Authorization: `Bearer ${token}`,
    'User-Agent': BUDDY_UA,
  };
}

/** GET /repos/{owner}/{repo}/contents/{path}?ref={ref} */
async function getContents(token: string, owner: string, name: string, path: string, ref?: string): Promise<Response> {
  const qs = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return retryFetch(`${API_BASE}/repos/${owner}/${name}/contents/${path}${qs}`, {
    method: 'GET',
    headers: authHeaders(token),
  });
}

// ---- github_write ----------------------------------------------------------

export async function executeGithubWrite(args: Record<string, unknown>): Promise<ToolResult> {
  const repoStr = typeof args.repo === 'string' ? args.repo : '';
  const path = typeof args.path === 'string' ? args.path.replace(/^\/+/, '') : '';
  const content = typeof args.content === 'string' ? args.content : '';
  const message =
    typeof args.message === 'string' && args.message.trim()
      ? args.message
      : `chore: update ${path || '(file)'} via Chrome Buddy`;
  const branch = typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : undefined;

  if (!path) return err('invalid-args', 'github_write requires `path`.');
  const parsed = parseRepo(repoStr);
  if (!parsed) return err('invalid-args', 'github_write requires `repo` in the form "owner/name".');

  const token = await readToken();
  if (!token) return err('runtime-error', 'No GitHub token set. Add one in Settings → GitHub.');

  // GET first to obtain the sha if the file exists (PUT needs sha to update).
  let sha: string | undefined;
  const get = await getContents(token, parsed.owner, parsed.name, path, branch);
  if (get.ok) {
    const data = (await get.json()) as { sha?: string; type?: string };
    if (data.type === 'dir') return err('invalid-args', 'github_write target is a directory, not a file.');
    if (typeof data.sha === 'string') sha = data.sha;
  } else if (get.status !== 404) {
    const body = await get.text().catch(() => '');
    return err('runtime-error', `GitHub GET ${get.status}: ${body.slice(0, 300)}`);
  }

  const body: Record<string, unknown> = {
    message,
    content: utf8ToBase64(content),
  };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;

  const put = await retryFetch(`${API_BASE}/repos/${parsed.owner}/${parsed.name}/contents/${path}`, {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!put.ok) {
    const text = await put.text().catch(() => '');
    return err('runtime-error', `GitHub PUT ${put.status}: ${text.slice(0, 300)}`);
  }
  const data = (await put.json()) as {
    content?: { html_url?: string; sha?: string; path?: string };
    commit?: { sha?: string; html_url?: string };
  };
  return ok({
    repo: `${parsed.owner}/${parsed.name}`,
    path,
    branch: branch ?? null,
    bytes: content.length,
    created: !sha,
    url: data.content?.html_url ?? null,
    commit: data.commit?.html_url ?? null,
    sha: data.content?.sha ?? null,
  });
}

// ---- github_read -----------------------------------------------------------

export async function executeGithubRead(args: Record<string, unknown>): Promise<ToolResult> {
  const repoStr = typeof args.repo === 'string' ? args.repo : '';
  const path = typeof args.path === 'string' ? args.path.replace(/^\/+/, '') : '';
  const ref = typeof args.ref === 'string' && args.ref.trim() ? args.ref.trim() : undefined;
  if (!path) return err('invalid-args', 'github_read requires `path`.');
  const parsed = parseRepo(repoStr);
  if (!parsed) return err('invalid-args', 'github_read requires `repo` in the form "owner/name".');
  const token = await readToken();
  if (!token) return err('runtime-error', 'No GitHub token set. Add one in Settings → GitHub.');
  const res = await getContents(token, parsed.owner, parsed.name, path, ref);
  if (res.status === 404) return err('not-found', `Not found: ${parsed.owner}/${parsed.name}/${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return err('runtime-error', `GitHub GET ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { type?: string; encoding?: string; content?: string; size?: number; html_url?: string };
  if (data.type !== 'file') return err('invalid-args', `Target is a ${data.type ?? 'non-file'}, not a file. Use github_list.`);
  const content = data.encoding === 'base64' && typeof data.content === 'string' ? base64ToUtf8(data.content) : '';
  return ok({ repo: `${parsed.owner}/${parsed.name}`, path, ref: ref ?? null, bytes: data.size ?? content.length, content, url: data.html_url ?? null });
}

// ---- github_list -----------------------------------------------------------

export async function executeGithubList(args: Record<string, unknown>): Promise<ToolResult> {
  const repoStr = typeof args.repo === 'string' ? args.repo : '';
  const path = typeof args.path === 'string' ? args.path.replace(/^\/+/, '') : '';
  const ref = typeof args.ref === 'string' && args.ref.trim() ? args.ref.trim() : undefined;
  const parsed = parseRepo(repoStr);
  if (!parsed) return err('invalid-args', 'github_list requires `repo` in the form "owner/name".');
  const token = await readToken();
  if (!token) return err('runtime-error', 'No GitHub token set. Add one in Settings → GitHub.');
  const res = await getContents(token, parsed.owner, parsed.name, path, ref);
  if (res.status === 404) return err('not-found', `Not found: ${parsed.owner}/${parsed.name}/${path || '(root)'}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return err('runtime-error', `GitHub GET ${res.status}: ${text.slice(0, 300)}`);
  }
  const raw: unknown = await res.json();
  // Directory → array; file → object (treat as one-entry).
  const items = Array.isArray(raw) ? (raw as { type?: string; name?: string; path?: string; size?: number }[]) : [raw as { type?: string; name?: string; path?: string; size?: number }];
  const entries = items.map((it) => ({ name: it.name ?? '', path: it.path ?? '', type: it.type ?? '', size: typeof it.size === 'number' ? it.size : 0 }));
  return ok({ repo: `${parsed.owner}/${parsed.name}`, path: path || '(root)', ref: ref ?? null, count: entries.length, entries });
}
