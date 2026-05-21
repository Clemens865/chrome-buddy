import { describe, expect, it } from 'vitest';
import { classifyIntent, resolveIntent } from './route';

describe('classifyIntent', () => {
  it('routes simple questions to plain chat', () => {
    expect(classifyIntent('what is the capital of France?')).toBe('chat');
    expect(classifyIntent('explain closures in javascript')).toBe('chat');
    expect(classifyIntent('write a haiku about rain')).toBe('chat');
    expect(classifyIntent('')).toBe('chat');
  });

  it('routes page READS to chat (page content is attached, no agent needed)', () => {
    expect(classifyIntent('can you see this page?')).toBe('chat');
    expect(classifyIntent('summarize this page')).toBe('chat');
    expect(classifyIntent('extract the content of this page')).toBe('chat');
  });

  it('routes ACTIONS / multi-step / multi-source requests to the agent', () => {
    expect(classifyIntent('go to example.com and find the pricing')).toBe('agent');
    expect(classifyIntent('compare prices across 3 sites')).toBe('agent');
    expect(classifyIntent('click the subscribe button')).toBe('agent');
    expect(classifyIntent('email me a summary')).toBe('agent');
    expect(classifyIntent('research this topic across multiple sites')).toBe('agent');
    expect(classifyIntent('search the web for AI news')).toBe('agent');
    expect(classifyIntent('find the latest articles about LLMs')).toBe('agent');
  });
});

describe('resolveIntent', () => {
  it('forces a lane for ask/agent and uses the heuristic for auto', () => {
    expect(resolveIntent('ask', 'click the button')).toBe('chat');
    expect(resolveIntent('agent', 'what is 2+2?')).toBe('agent');
    expect(resolveIntent('auto', 'what is 2+2?')).toBe('chat');
    expect(resolveIntent('auto', 'summarize this page')).toBe('chat');
    expect(resolveIntent('auto', 'click the subscribe button')).toBe('agent');
  });
});
