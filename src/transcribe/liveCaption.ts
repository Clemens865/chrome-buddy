// Live captions while recording, via the browser's built-in SpeechRecognition
// (free, on-device, real-time). This is a PREVIEW only — on stop we still run
// the accurate Gemini WAV transcription as the authoritative session transcript.
// SpeechRecognition is best-effort: if it's unsupported or errors, recording +
// the final transcript are unaffected.

/** Minimal shape of a SpeechRecognition result list entry we read. */
export interface SpeechResultLike {
  isFinal: boolean;
  0: { transcript: string };
  length: number;
}

/**
 * Fold a SpeechRecognition result batch into the running final text + the
 * current interim text. Pure so it's unit-testable without the browser API.
 * Final results are APPENDED to `prevFinal`; interim results are collected
 * separately (they get replaced on the next event, not appended).
 */
export function reduceSpeechResults(
  prevFinal: string,
  resultIndex: number,
  results: ArrayLike<SpeechResultLike>,
): { final: string; interim: string } {
  let final = prevFinal;
  let interim = '';
  for (let i = resultIndex; i < results.length; i++) {
    const r = results[i];
    const t = r?.[0]?.transcript ?? '';
    if (r.isFinal) final += t;
    else interim += t;
  }
  return { final, interim };
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<SpeechResultLike> }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isLiveCaptionSupported(): boolean {
  return recognitionCtor() !== null;
}

export class LiveCaption {
  private rec: SpeechRecognitionLike | null = null;
  private finalText = '';
  private running = false;
  private readonly onUpdate: (full: string, interim: string) => void;

  constructor(onUpdate: (full: string, interim: string) => void) {
    this.onUpdate = onUpdate;
  }

  /** Begin live captioning. No-op (returns false) if unsupported. */
  start(): boolean {
    const Ctor = recognitionCtor();
    if (!Ctor) return false;
    let rec: SpeechRecognitionLike;
    try { rec = new Ctor(); } catch { return false; }
    rec.continuous = true;
    rec.interimResults = true;
    try { rec.lang = navigator.language || 'en-US'; } catch { /* default */ }
    rec.onresult = (ev) => {
      const { final, interim } = reduceSpeechResults(this.finalText, ev.resultIndex, ev.results);
      this.finalText = final;
      this.onUpdate(final.trim(), interim.trim());
    };
    rec.onerror = () => { /* best effort — keep recording either way */ };
    rec.onend = () => {
      // Chrome ends recognition after a silence gap; restart while we're still
      // recording so captions stay live for the whole session.
      if (this.running) { try { rec.start(); } catch { /* give up quietly */ } }
    };
    this.rec = rec;
    this.running = true;
    try { rec.start(); return true; } catch { this.running = false; return false; }
  }

  /** Stop captioning and return the accumulated final text. */
  stop(): string {
    this.running = false;
    try { this.rec?.stop(); } catch { /* ignore */ }
    this.rec = null;
    const out = this.finalText.trim();
    this.finalText = '';
    return out;
  }
}
