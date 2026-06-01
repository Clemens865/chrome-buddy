// Pure transform layer for the Voice Transcriber: prompt builders for the
// post-processing actions a user runs on a finished transcript, plus small
// helpers (title from transcript, duration formatting). No I/O — the view runs
// the LLM call (generateViaBackground) and persists the result on the session.

export type TransformKind = 'summary' | 'cleaned' | 'notes' | 'speakers';

export interface TransformDef {
  kind: TransformKind;
  label: string;
  /** Build the LLM prompt that turns the transcript into this output. */
  prompt: (transcript: string) => string;
}

export const TRANSFORMS: readonly TransformDef[] = [
  {
    kind: 'summary',
    label: 'Summarize',
    prompt: (t) =>
      'Summarize the following transcript. Start with a 2-3 sentence overview, then 3-6 ' +
      'bullet points of the key topics/takeaways. Be faithful; do not invent.\n\nTranscript:\n' + t,
  },
  {
    kind: 'cleaned',
    label: 'Clean up',
    prompt: (t) =>
      'Clean up this raw speech transcript: remove filler words (um, uh, like), false ' +
      'starts and stutters, fix punctuation, casing and obvious transcription slips — but ' +
      'keep ALL meaning and wording otherwise. Return ONLY the cleaned transcript.\n\nTranscript:\n' + t,
  },
  {
    kind: 'notes',
    label: 'Meeting notes',
    prompt: (t) =>
      'Turn this transcript into structured meeting notes in markdown with these sections ' +
      '(omit a section only if truly empty):\n## Summary\n## Decisions\n## Action items ' +
      '(format each as "- [ ] owner — task")\n## Open questions\n\nTranscript:\n' + t,
  },
  {
    kind: 'speakers',
    label: 'Add speakers',
    prompt: (t) =>
      'Add speaker labels to this transcript. Infer turn changes from context and prefix ' +
      'each turn with "Speaker 1:", "Speaker 2:", etc. (consistent per voice). Do not change ' +
      'the words. Return ONLY the labeled transcript.\n\nTranscript:\n' + t,
  },
] as const;

export function transformDef(kind: TransformKind): TransformDef {
  return TRANSFORMS.find((t) => t.kind === kind) ?? TRANSFORMS[0];
}

/** A short title from the transcript's opening words; falls back to a stamp. */
export function deriveTitle(transcript: string, createdAt: number): string {
  const firstLine = transcript.trim().split(/\n+/)[0] ?? '';
  const words = firstLine.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 7).join(' ');
  if (words.length >= 3) return words.length > 60 ? words.slice(0, 60) + '…' : words;
  return `Recording ${formatClock(createdAt)}`;
}

/** "MM:SS" or "H:MM:SS" for an elapsed duration in ms. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Local-ish wall clock from an epoch ms (HH:MM), date-agnostic, no Date.now. */
function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
