import { describe, it, expect, vi } from 'vitest';
import { __testing } from './live';

const { routeServerFrame } = __testing;

describe('Gemini Live — server frame parser', () => {
  it('emits AUDIO_OUT for inlineData with an audio/* mime type', () => {
    const send = vi.fn();
    routeServerFrame(
      JSON.stringify({
        serverContent: {
          modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm' } }] },
        },
      }),
      send,
    );
    expect(send).toHaveBeenCalledWith({ type: 'AUDIO_OUT', b64: 'AAA=' });
  });

  it('ignores non-audio inlineData (e.g. images)', () => {
    const send = vi.fn();
    routeServerFrame(
      JSON.stringify({
        serverContent: {
          modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'image/png' } }] },
        },
      }),
      send,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('emits TRANSCRIPT for input + output transcription chunks', () => {
    const send = vi.fn();
    routeServerFrame(
      JSON.stringify({
        serverContent: {
          inputTranscription: { text: 'hello buddy', finished: true },
          outputTranscription: { text: 'hi there', finished: false },
        },
      }),
      send,
    );
    expect(send).toHaveBeenCalledWith({ type: 'TRANSCRIPT', role: 'user', text: 'hello buddy', isFinal: true });
    expect(send).toHaveBeenCalledWith({ type: 'TRANSCRIPT', role: 'model', text: 'hi there', isFinal: false });
  });

  it('emits TURN_DONE when serverContent.turnComplete is true', () => {
    const send = vi.fn();
    routeServerFrame(JSON.stringify({ serverContent: { turnComplete: true } }), send);
    expect(send).toHaveBeenCalledWith({ type: 'TURN_DONE' });
  });

  it('emits INTERRUPTED when serverContent.interrupted is true', () => {
    const send = vi.fn();
    routeServerFrame(JSON.stringify({ serverContent: { interrupted: true } }), send);
    expect(send).toHaveBeenCalledWith({ type: 'INTERRUPTED' });
  });

  it('silently ignores malformed JSON', () => {
    const send = vi.fn();
    routeServerFrame('not json', send);
    routeServerFrame('{"unexpected": true}', send);
    expect(send).not.toHaveBeenCalled();
  });

  it('handles modelTurn with no parts gracefully', () => {
    const send = vi.fn();
    routeServerFrame(JSON.stringify({ serverContent: { modelTurn: {} } }), send);
    expect(send).not.toHaveBeenCalled();
  });
});
