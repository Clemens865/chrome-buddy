import { describe, it, expect } from 'vitest';
import { parseUiApp, toAppConfig, describeMessages, iterateMessage, repairMessage, parseBuilderReply, answersMessage } from './uiBuild';

const valid = JSON.stringify({
  name: 'Counter',
  description: 'A click counter',
  html: '<button id="b">0</button>',
  css: '#b{font-size:20px}',
  ui: "let n=0; const b=root.querySelector('#b'); b.addEventListener('click',()=>{n++; b.textContent=n;});",
  permissions: [],
});

describe('parseUiApp', () => {
  it('parses a valid Tier-3 app', () => {
    const p = parseUiApp(valid);
    expect(p?.name).toBe('Counter');
    expect(p?.html).toContain('<button');
    expect(p?.permissions).toEqual([]);
  });
  it('strips a ```json fence', () => {
    expect(parseUiApp('```json\n' + valid + '\n```')?.name).toBe('Counter');
  });
  it('salvages JSON embedded in prose', () => {
    expect(parseUiApp('Sure! ' + valid + ' Done.')?.name).toBe('Counter');
  });
  it('keeps only known capabilities', () => {
    const p = parseUiApp(JSON.stringify({ name: 'X', html: '<div></div>', ui: '', permissions: ['gemini', 'fetch', 'download', 'gemini'] }));
    expect(p?.permissions).toEqual(['gemini', 'download']); // dedup + drop unknown 'fetch'
  });
  it('strips <script> from html', () => {
    const p = parseUiApp(JSON.stringify({ name: 'X', html: '<div>hi</div><script>steal()</script>', ui: 'x' }));
    expect(p?.html).toBe('<div>hi</div>');
  });
  it('strips inline on* handlers (the silent-dead-button trap)', () => {
    const p = parseUiApp(JSON.stringify({ name: 'X', html: '<button onclick="go()" onmouseover=\'x()\'>Go</button>', ui: 'x' }));
    expect(p?.html).toBe('<button>Go</button>');
  });
  it('rejects missing name or empty body', () => {
    expect(parseUiApp(JSON.stringify({ html: '<div></div>' }))).toBeNull();
    expect(parseUiApp(JSON.stringify({ name: 'X', html: '', ui: '' }))).toBeNull();
    expect(parseUiApp('not json')).toBeNull();
  });
});

describe('toAppConfig', () => {
  it('builds a tier-3 AppConfig with reviewed:false', () => {
    const cfg = toAppConfig(parseUiApp(valid)!, 'fixed_id');
    expect(cfg).toMatchObject({ id: 'fixed_id', tier: 3, reviewed: false, name: 'Counter', inputs: [] });
    expect(cfg.ui).toContain('addEventListener');
  });
});

describe('parseBuilderReply', () => {
  it('returns an app when the reply is a valid spec', () => {
    const r = parseBuilderReply(valid);
    expect(r?.kind).toBe('app');
    if (r?.kind === 'app') expect(r.app.name).toBe('Counter');
  });
  it('returns clarifying questions when the model asks for directions', () => {
    const r = parseBuilderReply('{"clarify":["Which platform?","One image or batch?"]}');
    expect(r).toEqual({ kind: 'clarify', questions: ['Which platform?', 'One image or batch?'] });
  });
  it('prefers an app over clarify when both-ish (has html/ui)', () => {
    const r = parseBuilderReply(JSON.stringify({ name: 'X', html: '<div></div>', ui: 'x', clarify: ['ignored'] }));
    expect(r?.kind).toBe('app');
  });
  it('caps clarify at 3 questions and drops blanks', () => {
    const r = parseBuilderReply('{"clarify":["a","","b","c","d"]}');
    expect(r).toEqual({ kind: 'clarify', questions: ['a', 'b', 'c'] });
  });
  it('returns null for junk', () => {
    expect(parseBuilderReply('not json')).toBeNull();
  });
});

describe('message builders', () => {
  it('describeMessages carries the system contract + the ask', () => {
    const msgs = describeMessages('a tip calculator');
    expect(msgs[0].role).toBe('system');
    expect(String(msgs[0].content)).toContain('micro-app');
    expect(String(msgs[1].content)).toContain('tip calculator');
  });
  it('iterateMessage asks for the complete updated JSON', () => {
    expect(String(iterateMessage('add a reset button').content)).toMatch(/COMPLETE updated app JSON/);
  });
  it('repairMessage feeds the error back', () => {
    expect(String(repairMessage('TypeError: x is undefined').content)).toContain('TypeError: x is undefined');
  });
  it('answersMessage carries the answers + asks to build', () => {
    expect(String(answersMessage('iOS, batch of 4').content)).toContain('iOS, batch of 4');
    expect(String(answersMessage('x').content)).toMatch(/build the app/i);
  });
});
