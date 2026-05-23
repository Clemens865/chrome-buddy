import { describe, it, expect } from 'vitest';
import { mapUsage } from './openaiCompatible';

describe('mapUsage', () => {
  it('maps prompt/completion/total tokens', () => {
    expect(mapUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it('captures cached_tokens via prompt_tokens_details', () => {
    const out = mapUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 70 },
    });
    expect(out.cachedInputTokens).toBe(70);
  });

  it('captures thinking tokens via completion_tokens_details.reasoning_tokens', () => {
    const out = mapUsage({
      prompt_tokens: 50,
      completion_tokens: 120,
      total_tokens: 170,
      completion_tokens_details: { reasoning_tokens: 80 },
    });
    expect(out.thoughtsTokens).toBe(80);
    // Thinking tokens are INCLUDED in the output total (billed at output rate);
    // we just surface them separately for the ledger UI.
    expect(out.outputTokens).toBe(120);
  });

  it('handles missing usage cleanly', () => {
    expect(mapUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });
});
