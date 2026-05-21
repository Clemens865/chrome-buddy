// Pure: pull fenced code blocks out of an assistant message into artifacts, so
// they can be shown as cards (and opened in the full-panel viewer) instead of
// crowding the chat. Returns the prose with [[ARTIFACT:id]] placeholders.

export interface Artifact {
  id: string;
  kind: 'code';
  title: string;
  language: string;
  content: string;
}

const FENCE = /```([\w+#.-]*)\n([\s\S]*?)```/g;

export function extractArtifacts(markdown: string): { text: string; artifacts: Artifact[] } {
  const artifacts: Artifact[] = [];
  let i = 0;
  const text = markdown.replace(FENCE, (_m, lang: string, body: string) => {
    const id = `art_${i}`;
    const language = (lang || 'text').toLowerCase();
    artifacts.push({
      id,
      kind: 'code',
      language,
      title: lang ? `${lang} snippet` : 'Code',
      content: body.replace(/\n+$/, ''),
    });
    i += 1;
    return `\n\n[[ARTIFACT:${id}]]\n\n`;
  });
  return { text, artifacts };
}

const EXT: Record<string, string> = {
  javascript: 'js', typescript: 'ts', jsx: 'jsx', tsx: 'tsx', python: 'py', json: 'json',
  html: 'html', css: 'css', bash: 'sh', shell: 'sh', sh: 'sh', sql: 'sql', yaml: 'yaml',
  markdown: 'md', rust: 'rs', go: 'go', java: 'java', text: 'txt',
};

export function artifactFilename(a: Artifact): string {
  return `chrome-buddy-artifact.${EXT[a.language] ?? 'txt'}`;
}
