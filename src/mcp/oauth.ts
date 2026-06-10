// OAuth 2.1 client helpers for MCP servers that don't issue a static API key
// (Asana, Framer, Linear, the hosted "connector" servers). Implements the
// discovery + authorization chain the MCP authorization spec layers on top of
// standard RFCs:
//
//   1. WWW-Authenticate challenge ............ RFC 9728 (resource_metadata hint)
//   2. Protected Resource Metadata ........... RFC 9728 (/.well-known/oauth-protected-resource)
//   3. Authorization Server Metadata ......... RFC 8414 (/.well-known/oauth-authorization-server)
//   4. Dynamic Client Registration ........... RFC 7591 (registration_endpoint)
//   5. Authorization Code + PKCE ............. RFC 7636 (S256)
//   6. Token exchange / refresh .............. RFC 6749 §4.1.3 / §6
//   7. Resource binding ...................... RFC 8707 (resource param)
//
// This module is PURE: no chrome.*, no IDB, no storage, no window. Every network
// call takes an injected `fetchImpl` (defaults to globalThis.fetch) so the SW
// can supply its privileged fetch and tests can stub it. The interactive
// authorize step (chrome.identity.launchWebAuthFlow) lives in the panel/SW, not
// here — this module only BUILDS the authorize URL and parses the redirect.
//
// PKCE uses globalThis.crypto (WebCrypto), available in the SW, the panel, and
// the Node test runtime.

// ----- Types ---------------------------------------------------------------

/** RFC 9728 Protected Resource Metadata — the subset we consume. */
export interface ProtectedResourceMetadata {
  /** The canonical resource identifier the AS must mint tokens for (RFC 8707). */
  resource: string;
  /** One or more authorization servers that can issue tokens for this resource. */
  authorizationServers: string[];
}

/** RFC 8414 Authorization Server Metadata — the subset we consume. */
export interface AuthServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** RFC 7591 dynamic registration endpoint, when the AS supports it. */
  registrationEndpoint?: string;
  scopesSupported?: string[];
  /** PKCE methods the AS advertises; we require S256 to be present (or assume it). */
  codeChallengeMethodsSupported?: string[];
}

/** Everything we need to drive the authorize → token flow against one server.
 *  The non-secret half of this is what we persist on the McpServer row. */
export interface OAuthConfig {
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopes?: string[];
}

/** RFC 7591 client registration result — only the fields we keep. */
export interface RegisteredClient {
  clientId: string;
  /** Confidential clients get a secret; public PKCE clients usually don't. */
  clientSecret?: string;
}

/** A normalized token set. `expiresAt` is an absolute epoch-ms deadline (NOT a
 *  relative `expires_in`) so callers don't have to remember when it was issued. */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Absolute epoch-ms expiry, or undefined if the AS didn't send expires_in. */
  expiresAt?: number;
  tokenType: string;
  scope?: string;
}

/** PKCE pair (RFC 7636). The verifier is the secret; the challenge goes in the
 *  authorize URL. We only support S256 (plain is discouraged by OAuth 2.1). */
export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

// ----- base64url + PKCE ----------------------------------------------------

/** RFC 4648 §5 base64url (no padding) of raw bytes. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 → base64url, the PKCE S256 transform. */
async function s256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Generate a PKCE pair. A specific `verifier` may be injected for tests; in
 *  production it's 32 random bytes (43-char base64url, within the RFC's
 *  43–128 range). */
export async function generatePkce(verifier?: string): Promise<PkcePair> {
  const v =
    verifier ??
    base64UrlEncode(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  return { verifier: v, challenge: await s256(v), method: 'S256' };
}

/** A random base64url string for the `state` CSRF parameter. */
export function randomState(): string {
  return base64UrlEncode(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

// ----- 1. WWW-Authenticate challenge parsing -------------------------------

/** Pull the `resource_metadata` URL out of a `WWW-Authenticate: Bearer …`
 *  header (RFC 9728 §5.1). Returns undefined when absent or unparsable. */
export function parseResourceMetadataUrl(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  // Params look like: Bearer realm="x", resource_metadata="https://…"
  const m = /resource_metadata\s*=\s*"([^"]+)"/i.exec(header);
  return m?.[1];
}

// ----- 2 & 3. Metadata discovery -------------------------------------------

/** Join an origin with a well-known suffix, preserving any path component per
 *  RFC 8414 §3.1 (the well-known segment is inserted AFTER the host, before the
 *  path). For the common root-hosted case this is just `${origin}${suffix}`. */
export function wellKnownUrl(baseUrl: string, suffix: string): string {
  const u = new URL(baseUrl);
  const path = u.pathname.replace(/\/$/, '');
  // suffix always starts with '/.well-known/...'
  return `${u.origin}${suffix}${path === '' ? '' : path}`;
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
): Promise<T> {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`OAuth discovery: GET ${url} → HTTP ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

/** Step 2: fetch RFC 9728 protected-resource metadata. `metadataUrl` is the URL
 *  from the WWW-Authenticate hint when present; otherwise we derive the
 *  conventional well-known path from the MCP endpoint origin. */
export async function discoverProtectedResource(
  mcpUrl: string,
  opts: { fetchImpl?: typeof fetch; metadataUrl?: string } = {},
): Promise<ProtectedResourceMetadata> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = opts.metadataUrl ?? wellKnownUrl(mcpUrl, '/.well-known/oauth-protected-resource');
  const raw = await fetchJson<Record<string, unknown>>(fetchImpl, url);
  const servers = raw.authorization_servers;
  if (!Array.isArray(servers) || servers.length === 0) {
    throw new Error('OAuth discovery: protected-resource metadata listed no authorization_servers.');
  }
  return {
    resource: typeof raw.resource === 'string' ? raw.resource : new URL(mcpUrl).origin,
    authorizationServers: servers.filter((s): s is string => typeof s === 'string'),
  };
}

/** Step 3: fetch RFC 8414 authorization-server metadata, falling back to the
 *  OpenID Connect discovery document (same shape for our fields) when the
 *  oauth-authorization-server well-known 404s. */
export async function discoverAuthServer(
  issuerUrl: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<AuthServerMetadata> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const candidates = [
    wellKnownUrl(issuerUrl, '/.well-known/oauth-authorization-server'),
    wellKnownUrl(issuerUrl, '/.well-known/openid-configuration'),
  ];
  let lastErr: unknown;
  for (const url of candidates) {
    try {
      const raw = await fetchJson<Record<string, unknown>>(fetchImpl, url);
      const authz = raw.authorization_endpoint;
      const token = raw.token_endpoint;
      if (typeof authz !== 'string' || typeof token !== 'string') {
        throw new Error('OAuth discovery: metadata missing authorization_endpoint/token_endpoint.');
      }
      return {
        issuer: typeof raw.issuer === 'string' ? raw.issuer : issuerUrl,
        authorizationEndpoint: authz,
        tokenEndpoint: token,
        registrationEndpoint:
          typeof raw.registration_endpoint === 'string' ? raw.registration_endpoint : undefined,
        scopesSupported: Array.isArray(raw.scopes_supported)
          ? raw.scopes_supported.filter((s): s is string => typeof s === 'string')
          : undefined,
        codeChallengeMethodsSupported: Array.isArray(raw.code_challenge_methods_supported)
          ? raw.code_challenge_methods_supported.filter((s): s is string => typeof s === 'string')
          : undefined,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('OAuth discovery: no AS metadata.');
}

/** Convenience: run steps 1–3 from an MCP endpoint (+ optional WWW-Authenticate
 *  header) to a ready-to-use OAuthConfig, choosing the first authorization
 *  server the resource advertises. */
export async function discoverOAuthConfig(
  mcpUrl: string,
  opts: { fetchImpl?: typeof fetch; wwwAuthenticate?: string | null } = {},
): Promise<OAuthConfig> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const metadataUrl = parseResourceMetadataUrl(opts.wwwAuthenticate);
  const pr = await discoverProtectedResource(mcpUrl, { fetchImpl, metadataUrl });
  const as = await discoverAuthServer(pr.authorizationServers[0], { fetchImpl });
  return {
    resource: pr.resource,
    issuer: as.issuer,
    authorizationEndpoint: as.authorizationEndpoint,
    tokenEndpoint: as.tokenEndpoint,
    registrationEndpoint: as.registrationEndpoint,
    scopes: as.scopesSupported,
  };
}

// ----- 4. Dynamic Client Registration (RFC 7591) ---------------------------

export async function registerClient(
  registrationEndpoint: string,
  params: { redirectUri: string; clientName?: string; scopes?: string[] },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<RegisteredClient> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const body = {
    client_name: params.clientName ?? 'Chrome Buddy',
    redirect_uris: [params.redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none', // public PKCE client
    ...(params.scopes && params.scopes.length ? { scope: params.scopes.join(' ') } : {}),
  };
  const res = await fetchImpl(registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OAuth DCR: HTTP ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  if (typeof raw.client_id !== 'string') {
    throw new Error('OAuth DCR: response had no client_id.');
  }
  return {
    clientId: raw.client_id,
    clientSecret: typeof raw.client_secret === 'string' ? raw.client_secret : undefined,
  };
}

// ----- 5. Authorize URL + redirect parsing ---------------------------------

export interface AuthorizeUrlParams {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  /** RFC 8707 — binds the issued token to this MCP server. */
  resource: string;
  scopes?: string[];
}

/** Build the authorization-code+PKCE authorize URL the panel opens via
 *  chrome.identity.launchWebAuthFlow. */
export function buildAuthorizeUrl(p: AuthorizeUrlParams): string {
  const u = new URL(p.authorizationEndpoint);
  const q = u.searchParams;
  q.set('response_type', 'code');
  q.set('client_id', p.clientId);
  q.set('redirect_uri', p.redirectUri);
  q.set('code_challenge', p.codeChallenge);
  q.set('code_challenge_method', 'S256');
  q.set('state', p.state);
  q.set('resource', p.resource);
  if (p.scopes && p.scopes.length) q.set('scope', p.scopes.join(' '));
  return u.toString();
}

/** Parse the redirect URL launchWebAuthFlow hands back. Verifies `state` and
 *  surfaces an `error`/`error_description` the AS may return. */
export function parseRedirect(
  redirectUrl: string,
  expectedState: string,
): { code: string } {
  const u = new URL(redirectUrl);
  // Authorization-code responses use the query string (PKCE = response_type=code).
  const q = u.searchParams;
  const err = q.get('error');
  if (err) {
    const desc = q.get('error_description');
    throw new Error(`OAuth authorize denied: ${err}${desc ? ` — ${desc}` : ''}`);
  }
  const state = q.get('state');
  if (state !== expectedState) {
    throw new Error('OAuth authorize: state mismatch (possible CSRF) — aborting.');
  }
  const code = q.get('code');
  if (!code) throw new Error('OAuth authorize: redirect had no authorization code.');
  return { code };
}

// ----- 6. Token exchange + refresh -----------------------------------------

/** Convert an OAuth token response body into our normalized TokenSet. `now` is
 *  injectable for deterministic expiry math in tests. */
function toTokenSet(raw: Record<string, unknown>, now: number): TokenSet {
  if (typeof raw.access_token !== 'string') {
    throw new Error('OAuth token: response had no access_token.');
  }
  const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : undefined;
  return {
    accessToken: raw.access_token,
    refreshToken: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
    expiresAt: expiresIn !== undefined ? now + expiresIn * 1000 : undefined,
    tokenType: typeof raw.token_type === 'string' ? raw.token_type : 'Bearer',
    scope: typeof raw.scope === 'string' ? raw.scope : undefined,
  };
}

async function postToken(
  fetchImpl: typeof fetch,
  tokenEndpoint: string,
  form: Record<string, string>,
  now: number,
): Promise<TokenSet> {
  const res = await fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OAuth token: HTTP ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  return toTokenSet(raw, now);
}

export async function exchangeCode(
  tokenEndpoint: string,
  params: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    resource: string;
  },
  opts: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<TokenSet> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = opts.now ?? Date.now();
  const form: Record<string, string> = {
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
    resource: params.resource,
  };
  if (params.clientSecret) form.client_secret = params.clientSecret;
  return postToken(fetchImpl, tokenEndpoint, form, now);
}

export async function refreshAccessToken(
  tokenEndpoint: string,
  params: {
    refreshToken: string;
    clientId: string;
    clientSecret?: string;
    resource: string;
    scopes?: string[];
  },
  opts: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<TokenSet> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = opts.now ?? Date.now();
  const form: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    resource: params.resource,
  };
  if (params.clientSecret) form.client_secret = params.clientSecret;
  if (params.scopes && params.scopes.length) form.scope = params.scopes.join(' ');
  const next = await postToken(fetchImpl, tokenEndpoint, form, now);
  // RFC 6749 §6: the AS MAY omit a new refresh_token; reuse the old one then.
  if (!next.refreshToken) next.refreshToken = params.refreshToken;
  return next;
}

// ----- Expiry helper -------------------------------------------------------

/** True when an access token is missing, or expires within `skewMs` (default
 *  60s) — the cue to refresh BEFORE a request rather than after a 401. */
export function isExpired(token: Pick<TokenSet, 'expiresAt'>, now: number = Date.now(), skewMs = 60_000): boolean {
  if (token.expiresAt === undefined) return false; // opaque/no-expiry tokens
  return now >= token.expiresAt - skewMs;
}
