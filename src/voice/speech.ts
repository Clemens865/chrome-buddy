// Thin, testable wrappers around the Web Speech API: speech-to-text
// (SpeechRecognition) for voice input and text-to-speech (speechSynthesis) for
// reading answers aloud. Both degrade to no-ops when the API is unavailable, so
// callers can always render the buttons and just disable them when unsupported.

interface SpeechAlternativeLike {
  transcript: string;
}
interface SpeechResultLike {
  0: SpeechAlternativeLike;
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as RecognitionCtor | undefined;
}

export function isSTTSupported(): boolean {
  return recognitionCtor() !== undefined;
}

export function isTTSSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export interface Recognizer {
  start(): void;
  stop(): void;
}

export interface RecognizerOptions {
  /** Called as speech is transcribed; isFinal marks a settled phrase. */
  onResult: (text: string, isFinal: boolean) => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
  lang?: string;
}

/** Build a one-shot recognizer, or null when STT is unsupported. */
export function createRecognizer(opts: RecognizerOptions): Recognizer | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = opts.lang ?? 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (ev) => {
    let text = '';
    let isFinal = false;
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      text += ev.results[i][0].transcript;
      if (ev.results[i].isFinal) isFinal = true;
    }
    opts.onResult(text, isFinal);
  };
  rec.onend = () => opts.onEnd?.();
  rec.onerror = (ev) => opts.onError?.(ev.error ?? 'speech-error');
  return {
    start: () => {
      try {
        rec.start();
      } catch {
        /* already started — ignore */
      }
    },
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* not started — ignore */
      }
    },
  };
}

/** Speak text aloud (cancelling any current utterance). Returns false if unsupported. */
export function speak(text: string, opts: { lang?: string; onEnd?: () => void } = {}): boolean {
  if (!isTTSSupported() || !text.trim()) return false;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  if (opts.lang) utter.lang = opts.lang;
  if (opts.onEnd) utter.onend = () => opts.onEnd?.();
  window.speechSynthesis.speak(utter);
  return true;
}

/** Stop any in-progress speech. */
export function stopSpeaking(): void {
  if (isTTSSupported()) window.speechSynthesis.cancel();
}
