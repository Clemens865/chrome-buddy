import { describe, it, expect } from 'vitest';
import { parseUiApp, toAppConfig, describeMessages, iterateMessage, repairMessage } from './uiBuild';

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
});
