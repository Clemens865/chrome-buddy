import { describe, it, expect } from 'vitest';
import { maskWebhookUrl, webhookHost } from './store';

describe('maskWebhookUrl', () => {
  it('redacts long path segments past the first one (Slack-shape)', () => {
    const masked = maskWebhookUrl('https://hooks.slack.com/services/T01ABCDEF/B01DEFGHI/abc1234567890');
    expect(masked).toBe('https://hooks.slack.com/services/T01******/B01******/abc**********');
    expect(masked).not.toContain('ABCDEF');
    expect(masked).not.toContain('1234567890');
  });

  it('keeps short segments visible (≤4 chars)', () => {
    expect(maskWebhookUrl('https://api.example.com/v1/test')).toBe('https://api.example.com/v1/test');
  });

  it('keeps host + path shape when truncating', () => {
    const masked = maskWebhookUrl('https://api.example.com/x/long-secret-token-here');
    expect(masked.startsWith('https://api.example.com/')).toBe(true);
    expect(masked).not.toContain('long-secret-token-here');
  });

  it('falls back to a tail-truncated string for invalid URLs', () => {
    expect(maskWebhookUrl('not-a-url')).toBe('not-a-url');
    expect(maskWebhookUrl('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toMatch(/…$/);
  });

  it('handles empty-path origins gracefully', () => {
    expect(maskWebhookUrl('https://example.com')).toBe('https://example.com/');
  });
});

describe('webhookHost', () => {
  it('returns just the hostname', () => {
    expect(webhookHost('https://hooks.slack.com/services/abc/def')).toBe('hooks.slack.com');
    expect(webhookHost('http://localhost:3000/x')).toBe('localhost:3000');
  });
  it('passes garbage through unchanged', () => {
    expect(webhookHost('not-a-url')).toBe('not-a-url');
  });
});
