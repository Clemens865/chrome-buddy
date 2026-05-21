import { describe, expect, it } from 'vitest';
import { extractArtifacts, artifactFilename } from './extract';

describe('extractArtifacts', () => {
  it('returns no artifacts for plain prose', () => {
    const { text, artifacts } = extractArtifacts('Just a sentence.');
    expect(artifacts).toHaveLength(0);
    expect(text).toBe('Just a sentence.');
  });

  it('extracts a fenced code block and leaves a placeholder', () => {
    const md = 'Here:\n```python\nprint("hi")\n```\nDone.';
    const { text, artifacts } = extractArtifacts(md);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].language).toBe('python');
    expect(artifacts[0].content).toBe('print("hi")');
    expect(text).toContain('[[ARTIFACT:art_0]]');
    expect(text).not.toContain('```');
  });

  it('extracts multiple blocks with distinct ids', () => {
    const md = '```js\na\n```\n```sql\nb\n```';
    const { artifacts } = extractArtifacts(md);
    expect(artifacts.map((a) => a.id)).toEqual(['art_0', 'art_1']);
  });

  it('maps language to a file extension', () => {
    expect(artifactFilename({ id: 'x', kind: 'code', language: 'typescript', title: 't', content: '' })).toBe(
      'chrome-buddy-artifact.ts',
    );
    expect(artifactFilename({ id: 'x', kind: 'code', language: 'weird', title: 't', content: '' })).toBe(
      'chrome-buddy-artifact.txt',
    );
  });
});
