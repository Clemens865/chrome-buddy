import { describe, it, expect, vi, afterEach } from 'vitest';
import { isSTTSupported, isTTSSupported, createRecognizer, speak, stopSpeaking } from './speech';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('feature detection', () => {
  it('reports STT/TTS unsupported when the APIs are absent', () => {
    vi.stubGlobal('window', {});
    expect(isSTTSupported()).toBe(false);
    expect(isTTSSupported()).toBe(false);
    expect(createRecognizer({ onResult: () => {} })).toBeNull();
    expect(speak('hello')).toBe(false);
  });
});

describe('createRecognizer', () => {
  it('wires start and maps a final recognition event to onResult', () => {
    const instances: FakeRec[] = [];
    class FakeRec {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      started = false;
      constructor() {
        instances.push(this);
      }
      start() {
        this.started = true;
      }
      stop() {}
    }
    vi.stubGlobal('window', { webkitSpeechRecognition: FakeRec });

    const results: { text: string; final: boolean }[] = [];
    const rec = createRecognizer({ onResult: (text, final) => results.push({ text, final }) });
    expect(rec).not.toBeNull();
    rec!.start();

    const inst = instances[0];
    expect(inst.started).toBe(true);
    expect(inst.interimResults).toBe(true);

    // Drive the wired handler with a fake event (one final phrase).
    inst.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: 'hello there' }, isFinal: true }],
    });
    expect(results).toEqual([{ text: 'hello there', final: true }]);
  });
});

describe('speak / stopSpeaking', () => {
  it('calls speechSynthesis.speak with the text', () => {
    const speakSpy = vi.fn();
    const cancelSpy = vi.fn();
    vi.stubGlobal('window', { speechSynthesis: { speak: speakSpy, cancel: cancelSpy } });
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      text: string;
      lang = '';
      onend: (() => void) | null = null;
      constructor(t: string) {
        this.text = t;
      }
    });

    expect(speak('hello world')).toBe(true);
    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect((speakSpy.mock.calls[0][0] as { text: string }).text).toBe('hello world');

    stopSpeaking();
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('does not speak empty text', () => {
    const speakSpy = vi.fn();
    vi.stubGlobal('window', { speechSynthesis: { speak: speakSpy, cancel: vi.fn() } });
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      constructor(public text: string) {}
    });
    expect(speak('   ')).toBe(false);
    expect(speakSpy).not.toHaveBeenCalled();
  });
});
