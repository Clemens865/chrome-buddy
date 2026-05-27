// Pure-helper tests for the MCP server store. The IDB CRUD is covered
// transitively in the e2e (Settings UI flow); these lock the URL allowlist
// and hostOf parsing in isolation.
import { describe, it, expect } from 'vitest';
import { hostOf, isAllowedUrl } from './store';

describe('isAllowedUrl', () => {
  it('accepts https endpoints', () => {
    expect(isAllowedUrl('https://mcp.example.com/sse')).toBe(true);
    expect(isAllowedUrl('https://api.cloudflare.com/mcp')).toBe(true);
  });

  it('accepts http only for localhost / 127.0.0.1', () => {
    expect(isAllowedUrl('http://localhost:3000/mcp')).toBe(true);
    expect(isAllowedUrl('http://127.0.0.1:8080/mcp')).toBe(true);
  });

  it('rejects http for non-loopback hosts', () => {
    expect(isAllowedUrl('http://example.com/mcp')).toBe(false);
    expect(isAllowedUrl('http://192.168.1.10/mcp')).toBe(false);
  });

  it('rejects non-http(s) schemes', () => {
    expect(isAllowedUrl('ws://example.com/mcp')).toBe(false);
    expect(isAllowedUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isAllowedUrl('not a url')).toBe(false);
    expect(isAllowedUrl('')).toBe(false);
  });
});

describe('hostOf', () => {
  it('returns just the host', () => {
    expect(hostOf('https://mcp.example.com:8443/some/path')).toBe('mcp.example.com:8443');
    expect(hostOf('http://localhost:3000/')).toBe('localhost:3000');
  });

  it('falls back to the input for unparseable URLs', () => {
    expect(hostOf('not a url')).toBe('not a url');
  });
});
