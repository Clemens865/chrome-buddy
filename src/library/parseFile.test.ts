import { describe, it, expect } from 'vitest';
import {
  parseFile, isSupportedTextFile, baseName, fileExtension, firstHeading, prettyJson, htmlToText,
} from './parseFile';

describe('file type detection', () => {
  it('recognizes supported text/code formats and rejects others', () => {
    expect(isSupportedTextFile('notes.md')).toBe(true);
    expect(isSupportedTextFile('data.CSV')).toBe(true);
    expect(isSupportedTextFile('app.tsx')).toBe(true);
    expect(isSupportedTextFile('paper.pdf')).toBe(false);
    expect(isSupportedTextFile('photo.png')).toBe(false);
    expect(isSupportedTextFile('README')).toBe(false);
  });
  it('extracts extension + base name', () => {
    expect(fileExtension('a/b/Report.Final.MD')).toBe('.md');
    expect(baseName('/docs/Quarterly Plan.md')).toBe('Quarterly Plan');
    expect(baseName('noext')).toBe('noext');
  });
});

describe('parseFile', () => {
  it('uses the first markdown H1 as the title', () => {
    const r = parseFile('x.md', '# Competitor Analysis\n\nThey ship weekly.');
    expect(r.title).toBe('Competitor Analysis');
    expect(r.text).toContain('They ship weekly.');
  });
  it('falls back to the filename when there is no heading', () => {
    expect(parseFile('plain-notes.txt', 'just text').title).toBe('plain-notes');
  });
  it('pretty-prints valid JSON and passes raw through on parse failure', () => {
    expect(parseFile('d.json', '{"a":1}').text).toBe('{\n  "a": 1\n}');
    expect(parseFile('d.json', 'not json').text).toBe('not json');
  });
  it('strips HTML to readable text and pulls the <title>', () => {
    const html = '<html><head><title>Acme</title></head><body><script>x()</script>' +
      '<h1>Heading</h1><p>First para.</p><p>Second &amp; last.</p></body></html>';
    const r = parseFile('page.html', html);
    expect(r.title).toBe('Acme');
    expect(r.text).not.toMatch(/<[^>]+>/); // no tags
    expect(r.text).not.toContain('x()'); // script dropped
    expect(r.text).toContain('First para.');
    expect(r.text).toContain('Second & last.'); // entity decoded
  });
});

describe('helpers', () => {
  it('firstHeading finds an H1 anywhere near the top', () => {
    expect(firstHeading('preamble\n\n# Title here\nbody')).toBe('Title here');
    expect(firstHeading('no heading')).toBe('');
  });
  it('prettyJson is a no-op-ish on invalid input', () => {
    expect(prettyJson('  garbage ')).toBe('garbage');
  });
  it('htmlToText preserves paragraph breaks from block tags', () => {
    const { text } = htmlToText('<p>one</p><p>two</p>');
    expect(text).toBe('one\ntwo');
  });
});
