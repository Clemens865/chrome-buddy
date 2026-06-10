// OAuth 2.1 client helpers — unit tests. No real network: every fetch is a
// URL-routed stub. PKCE is verified against the RFC 7636 Appendix B vector so a
// botched base64url/S256 transform can't slip through.
import { describe, it, expect } from 'vitest';
import {
  base64UrlEncode,
  generatePkce,
  parseResourceMetadataUrl,
  wellKnownUrl,
  discoverProtectedResource,
  discoverAuthServer,
  discoverOAuthConfig,
  registerClient,
  buildAuthorizeUrl,
  parseRedirect,
  exchangeCode,
  refreshAccessToken,
  isExpired,
} from './oauth';

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Build a fetch stub that routes by exact URL; records the bodies it saw. */
function routedFetch(routes: Record<string, (init: RequestInit | undefined) => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    const handler = routes[url];
    if (!handler) return new Response('not found', { status: 404 });
    return handler(init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('base64url + PKCE', () => {
  it('base64UrlEncode strips padding and uses url-safe alphabet', () => {
    // 0xfb 0xff 0xbf → would be "+/+/" style chars in standard base64.
    expect(base64UrlEncode(new Uint8Array([251, 255, 191]))).toBe('-_-_');
    expect(base64UrlEncode(new Uint8Array([1]))).toBe('AQ'); // no '=' padding
  });

  it('generatePkce computes the RFC 7636 Appendix B S256 challenge', async () => {
    const vector = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const pair = await generatePkce(vector);
    expect(pair.verifier).toBe(vector);
    expect(pair.method).toBe('S256');
    expect(pair.challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generatePkce without an injected verifier yields a fresh 43-char verifier', async () => {
    const a = await generatePkce();
    const b = await generatePkce();
    expect(a.verifier).toHaveLength(43); // 32 bytes → 43 base64url chars
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(a.verifier);
  });
});

describe('WWW-Authenticate parsing', () => {
  it('extracts the resource_metadata URL', () => {
    const h = 'Bearer realm="mcp", resource_metadata="https://as.example/.well-known/oauth-protected-resource"';
    expect(parseResourceMetadataUrl(h)).toBe('https://as.example/.well-known/oauth-protected-resource');
  });
  it('returns undefined when absent or null', () => {
    expect(parseResourceMetadataUrl('Bearer realm="x"')).toBeUndefined();
    expect(parseResourceMetadataUrl(null)).toBeUndefined();
  });
});

describe('wellKnownUrl', () => {
  it('roots the well-known path for a host-only endpoint', () => {
    expect(wellKnownUrl('https://mcp.example.com/', '/.well-known/oauth-protected-resource')).toBe(
      'https://mcp.example.com/.well-known/oauth-protected-resource',
    );
  });
  it('preserves a path component after the well-known segment (RFC 8414 §3.1)', () => {
    expect(wellKnownUrl('https://mcp.example.com/mcp', '/.well-known/oauth-authorization-server')).toBe(
      'https://mcp.example.com/.well-known/oauth-authorization-server/mcp',
    );
  });
});

describe('discovery', () => {
  it('discoverProtectedResource reads authorization_servers + resource', async () => {
    const url = 'https://mcp.example.com/.well-known/oauth-protected-resource';
    const { impl } = routedFetch({
      [url]: () => jsonRes({ resource: 'https://mcp.example.com', authorization_servers: ['https://as.example'] }),
    });
    const pr = await discoverProtectedResource('https://mcp.example.com/', { fetchImpl: impl });
    expect(pr.authorizationServers).toEqual(['https://as.example']);
    expect(pr.resource).toBe('https://mcp.example.com');
  });

  it('discoverProtectedResource honors an explicit metadataUrl from the challenge', async () => {
    const url = 'https://as.example/.well-known/oauth-protected-resource';
    const { impl, calls } = routedFetch({
      [url]: () => jsonRes({ resource: 'r', authorization_servers: ['https://as.example'] }),
    });
    await discoverProtectedResource('https://mcp.example.com/', { fetchImpl: impl, metadataUrl: url });
    expect(calls[0].url).toBe(url);
  });

  it('discoverProtectedResource throws when no authorization_servers are listed', async () => {
    const url = 'https://mcp.example.com/.well-known/oauth-protected-resource';
    const { impl } = routedFetch({ [url]: () => jsonRes({ authorization_servers: [] }) });
    await expect(discoverProtectedResource('https://mcp.example.com/', { fetchImpl: impl })).rejects.toThrow(
      /no authorization_servers/,
    );
  });

  it('discoverAuthServer reads the oauth-authorization-server doc', async () => {
    const url = 'https://as.example/.well-known/oauth-authorization-server';
    const { impl } = routedFetch({
      [url]: () =>
        jsonRes({
          issuer: 'https://as.example',
          authorization_endpoint: 'https://as.example/authorize',
          token_endpoint: 'https://as.example/token',
          registration_endpoint: 'https://as.example/register',
          scopes_supported: ['read', 'write'],
        }),
    });
    const as = await discoverAuthServer('https://as.example', { fetchImpl: impl });
    expect(as.authorizationEndpoint).toBe('https://as.example/authorize');
    expect(as.tokenEndpoint).toBe('https://as.example/token');
    expect(as.registrationEndpoint).toBe('https://as.example/register');
    expect(as.scopesSupported).toEqual(['read', 'write']);
  });

  it('discoverAuthServer falls back to openid-configuration on a 404', async () => {
    const oidc = 'https://as.example/.well-known/openid-configuration';
    const { impl } = routedFetch({
      // oauth-authorization-server route absent → 404 → fallback
      [oidc]: () =>
        jsonRes({
          issuer: 'https://as.example',
          authorization_endpoint: 'https://as.example/oidc/authorize',
          token_endpoint: 'https://as.example/oidc/token',
        }),
    });
    const as = await discoverAuthServer('https://as.example', { fetchImpl: impl });
    expect(as.authorizationEndpoint).toBe('https://as.example/oidc/authorize');
  });

  it('discoverOAuthConfig chains protected-resource → auth-server', async () => {
    const pr = 'https://mcp.example.com/.well-known/oauth-protected-resource';
    const as = 'https://as.example/.well-known/oauth-authorization-server';
    const { impl } = routedFetch({
      [pr]: () => jsonRes({ resource: 'https://mcp.example.com', authorization_servers: ['https://as.example'] }),
      [as]: () =>
        jsonRes({
          issuer: 'https://as.example',
          authorization_endpoint: 'https://as.example/authorize',
          token_endpoint: 'https://as.example/token',
          registration_endpoint: 'https://as.example/register',
        }),
    });
    const cfg = await discoverOAuthConfig('https://mcp.example.com/', { fetchImpl: impl });
    expect(cfg.resource).toBe('https://mcp.example.com');
    expect(cfg.authorizationEndpoint).toBe('https://as.example/authorize');
    expect(cfg.tokenEndpoint).toBe('https://as.example/token');
    expect(cfg.registrationEndpoint).toBe('https://as.example/register');
  });
});

describe('dynamic client registration', () => {
  it('POSTs a public-client registration and returns the client_id', async () => {
    const reg = 'https://as.example/register';
    const { impl, calls } = routedFetch({ [reg]: () => jsonRes({ client_id: 'cli_123' }, 201) });
    const client = await registerClient(reg, { redirectUri: 'https://abc.chromiumapp.org/' }, { fetchImpl: impl });
    expect(client.clientId).toBe('cli_123');
    expect(client.clientSecret).toBeUndefined();
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.redirect_uris).toEqual(['https://abc.chromiumapp.org/']);
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.grant_types).toContain('refresh_token');
  });

  it('throws on a registration error response', async () => {
    const reg = 'https://as.example/register';
    const { impl } = routedFetch({ [reg]: () => new Response('bad', { status: 400 }) });
    await expect(registerClient(reg, { redirectUri: 'https://x/' }, { fetchImpl: impl })).rejects.toThrow(/HTTP 400/);
  });
});

describe('authorize URL + redirect', () => {
  it('builds an authorize URL with PKCE + resource binding', () => {
    const url = buildAuthorizeUrl({
      authorizationEndpoint: 'https://as.example/authorize',
      clientId: 'cli_123',
      redirectUri: 'https://abc.chromiumapp.org/',
      codeChallenge: 'CHAL',
      state: 'STATE',
      resource: 'https://mcp.example.com',
      scopes: ['read', 'write'],
    });
    const u = new URL(url);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('cli_123');
    expect(u.searchParams.get('code_challenge')).toBe('CHAL');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('resource')).toBe('https://mcp.example.com');
    expect(u.searchParams.get('scope')).toBe('read write');
    expect(u.searchParams.get('state')).toBe('STATE');
  });

  it('parseRedirect returns the code when state matches', () => {
    const r = parseRedirect('https://abc.chromiumapp.org/?code=AUTH&state=STATE', 'STATE');
    expect(r.code).toBe('AUTH');
  });

  it('parseRedirect rejects a state mismatch (CSRF guard)', () => {
    expect(() => parseRedirect('https://abc.chromiumapp.org/?code=AUTH&state=WRONG', 'STATE')).toThrow(/state mismatch/);
  });

  it('parseRedirect surfaces an AS error param', () => {
    expect(() =>
      parseRedirect('https://abc.chromiumapp.org/?error=access_denied&error_description=nope&state=STATE', 'STATE'),
    ).toThrow(/access_denied — nope/);
  });

  it('parseRedirect throws when there is no code', () => {
    expect(() => parseRedirect('https://abc.chromiumapp.org/?state=STATE', 'STATE')).toThrow(/no authorization code/);
  });
});

describe('token exchange + refresh', () => {
  const token = 'https://as.example/token';

  it('exchangeCode form-encodes the grant and computes absolute expiry', async () => {
    const { impl, calls } = routedFetch({
      [token]: () =>
        jsonRes({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, token_type: 'Bearer', scope: 'read' }),
    });
    const set = await exchangeCode(
      token,
      {
        code: 'AUTH',
        codeVerifier: 'VERIFIER',
        clientId: 'cli_123',
        redirectUri: 'https://abc.chromiumapp.org/',
        resource: 'https://mcp.example.com',
      },
      { fetchImpl: impl, now: 1_000_000 },
    );
    expect(set.accessToken).toBe('AT');
    expect(set.refreshToken).toBe('RT');
    expect(set.expiresAt).toBe(1_000_000 + 3600 * 1000);
    expect(set.scope).toBe('read');

    const form = new URLSearchParams(calls[0].init!.body as string);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('AUTH');
    expect(form.get('code_verifier')).toBe('VERIFIER');
    expect(form.get('resource')).toBe('https://mcp.example.com');
    expect(calls[0].init!.headers).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded' });
  });

  it('refreshAccessToken reuses the old refresh_token when the AS omits a new one', async () => {
    const { impl, calls } = routedFetch({
      [token]: () => jsonRes({ access_token: 'AT2', expires_in: 1800, token_type: 'Bearer' }),
    });
    const set = await refreshAccessToken(
      token,
      { refreshToken: 'RT_OLD', clientId: 'cli_123', resource: 'https://mcp.example.com' },
      { fetchImpl: impl, now: 2_000_000 },
    );
    expect(set.accessToken).toBe('AT2');
    expect(set.refreshToken).toBe('RT_OLD'); // reused
    expect(set.expiresAt).toBe(2_000_000 + 1800 * 1000);
    const form = new URLSearchParams(calls[0].init!.body as string);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('RT_OLD');
  });

  it('exchangeCode throws on an HTTP error from the token endpoint', async () => {
    const { impl } = routedFetch({ [token]: () => new Response('invalid_grant', { status: 400 }) });
    await expect(
      exchangeCode(
        token,
        { code: 'x', codeVerifier: 'v', clientId: 'c', redirectUri: 'r', resource: 'res' },
        { fetchImpl: impl },
      ),
    ).rejects.toThrow(/HTTP 400/);
  });
});

describe('isExpired', () => {
  it('treats a no-expiry token as never expired', () => {
    expect(isExpired({ expiresAt: undefined }, 9_999_999)).toBe(false);
  });
  it('expires within the default 60s skew window', () => {
    expect(isExpired({ expiresAt: 100_000 }, 100_000 - 30_000)).toBe(true); // 30s left < 60s skew
    expect(isExpired({ expiresAt: 100_000 }, 100_000 - 90_000)).toBe(false); // 90s left
  });
});
