import { describe, expect, it } from 'vitest';
import { classifyIntent, resolveIntent } from './route';

describe('classifyIntent', () => {
  it('routes simple questions to plain chat', () => {
    expect(classifyIntent('what is the capital of France?')).toBe('chat');
    expect(classifyIntent('explain closures in javascript')).toBe('chat');
    expect(classifyIntent('write a haiku about rain')).toBe('chat');
    expect(classifyIntent('')).toBe('chat');
  });

  it('routes page/action requests to the agent', () => {
    expect(classifyIntent('summarize this page')).toBe('agent');
    expect(classifyIntent('extract the table to CSV')).toBe('agent');
    expect(classifyIntent('go to example.com and find the pricing')).toBe('agent');
    expect(classifyIntent('compare prices across 3 sites')).toBe('agent');
    expect(classifyIntent('click the subscribe button')).toBe('agent');
    expect(classifyIntent('email me a summary')).toBe('agent');
  });
});

describe('resolveIntent', () => {
  it('forces a lane for ask/agent and uses the heuristic for auto', () => {
    expect(resolveIntent('ask', 'summarize this page')).toBe('chat');
    expect(resolveIntent('agent', 'what is 2+2?')).toBe('agent');
    expect(resolveIntent('auto', 'what is 2+2?')).toBe('chat');
    expect(resolveIntent('auto', 'summarize this page')).toBe('agent');
  });
});
