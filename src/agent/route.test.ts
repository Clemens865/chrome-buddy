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

  it('routes file write/save requests to the agent (write_file tool)', () => {
    expect(classifyIntent('create an md file about Vienna and save it in the root folder Chrome-Buddy_Files')).toBe(
      'agent',
    );
    expect(classifyIntent('save this as a markdown file')).toBe('agent');
    expect(classifyIntent('write a file called notes.txt with my todos')).toBe('agent');
    expect(classifyIntent('export the results to CSV')).toBe('agent');
    expect(classifyIntent('generate a Vienna.md summary')).toBe('agent');
    expect(classifyIntent('save it to my root folder')).toBe('agent');
  });

  it('does not over-trigger on creative "write" prompts with no file', () => {
    expect(classifyIntent('write a haiku about rain')).toBe('chat');
    expect(classifyIntent('write a short story about Vienna')).toBe('chat');
    expect(classifyIntent('create a poem about the ocean')).toBe('chat');
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
