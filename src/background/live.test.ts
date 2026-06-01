import { describe, it, expect, vi } from 'vitest';
import { __testing } from './live';
import { ok, err } from '../types';

const { routeServerFrame, dispatchFunctionCalls, sanitizeForOpenApi, pickLiveModel, buildLiveSetup } = __testing;

describe('Gemini Live — model + setup (transcriber TEXT vs voice AUDIO)', () => {
  it('uses the v1beta native-audio Live model (half-cascade ids 1008 there); explicit wins', () => {
    expect(pickLiveModel(undefined, 'AUDIO')).toContain('native-audio');
    expect(pickLiveModel(undefined, 'TEXT')).toContain('native-audio'); // no TEXT model on v1beta
    expect(pickLiveModel('my-model', 'AUDIO')).toBe('my-model');
  });

  it('AUDIO setup requests input + output transcription (transcriber relies on input transcription)', () => {
    const s = buildLiveSetup({ model: 'x', responseModality: 'AUDIO', systemText: 'listen' }).setup as Record<string, unknown>;
    expect((s.generationConfig as { responseModalities: string[] }).responseModalities).toEqual(['AUDIO']);
    expect(s.inputAudioTranscription).toBeDefined(); // ← the transcriber's source of text
    expect(s.outputAudioTranscription).toBeDefined();
  });

  it('includes sanitized function declarations when tools are wired', () => {
    const s = buildLiveSetup({ model: 'x', responseModality: 'AUDIO', systemText: 'hi', declarations: [{ name: 'navigate', description: 'go', parameters: { type: 'object', additionalProperties: false, properties: {} } }] }).setup as Record<string, unknown>;
    const fd = (s.tools as { functionDeclarations: { parameters: Record<string, unknown> }[] }[])[0].functionDeclarations[0];
    expect('additionalProperties' in fd.parameters).toBe(false); // sanitized
  });
});

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

  it('extracts function calls from toolCall.functionCalls + emits FUNCTION_CALL', () => {
    const send = vi.fn();
    const calls = routeServerFrame(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            { id: 'c1', name: 'search_library', args: { query: 'retry' } },
            { id: 'c2', name: 'web_vitals', args: {} },
          ],
        },
      }),
      send,
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ id: 'c1', name: 'search_library', args: { query: 'retry' } });
    expect(send).toHaveBeenCalledWith({ type: 'FUNCTION_CALL', name: 'search_library', args: { query: 'retry' } });
    expect(send).toHaveBeenCalledWith({ type: 'FUNCTION_CALL', name: 'web_vitals', args: {} });
  });

  it('ignores function calls with no name', () => {
    const send = vi.fn();
    const calls = routeServerFrame(
      JSON.stringify({ toolCall: { functionCalls: [{ id: 'x', args: {} }] } }),
      send,
    );
    expect(calls).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('dispatchFunctionCalls', () => {
  function fakeWs() {
    const sent: string[] = [];
    return {
      readyState: 1, // WebSocket.OPEN
      send: (s: string) => sent.push(s),
      sent,
    } as unknown as WebSocket & { sent: string[] };
  }
  const getKey = async () => 'fake-key';

  it('routes to the matching handler and sends a toolResponse', async () => {
    const ws = fakeWs() as ReturnType<typeof fakeWs>;
    const send = vi.fn();
    const handlers = {
      search_library: vi.fn(async () => ok({ hits: [{ title: 'A' }] })),
    };
    await dispatchFunctionCalls(
      [{ id: 'c1', name: 'search_library', args: { query: 'x' } }],
      { handlers, declarations: [] },
      getKey,
      ws,
      send,
    );
    expect(handlers.search_library).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ type: 'FUNCTION_RESULT', name: 'search_library', ok: true });
    const payload = JSON.parse(ws.sent[0]) as { toolResponse: { functionResponses: Array<{ id: string; name: string; response: unknown }> } };
    expect(payload.toolResponse.functionResponses[0]).toMatchObject({
      id: 'c1',
      name: 'search_library',
      response: { result: { hits: [{ title: 'A' }] } },
    });
  });

  it('returns an error envelope when the tool is not registered', async () => {
    const ws = fakeWs() as ReturnType<typeof fakeWs>;
    const send = vi.fn();
    await dispatchFunctionCalls(
      [{ id: 'c1', name: 'nope', args: {} }],
      { handlers: {}, declarations: [] },
      getKey,
      ws,
      send,
    );
    expect(send).toHaveBeenCalledWith({ type: 'FUNCTION_RESULT', name: 'nope', ok: false });
    const payload = JSON.parse(ws.sent[0]) as { toolResponse: { functionResponses: Array<{ response: { error: string } }> } };
    expect(payload.toolResponse.functionResponses[0].response.error).toMatch(/not available in voice mode/);
  });

  it('returns an error envelope when the handler returns err(...)', async () => {
    const ws = fakeWs() as ReturnType<typeof fakeWs>;
    const send = vi.fn();
    const handlers = {
      flaky: vi.fn(async () => err('runtime-error', 'boom')),
    };
    await dispatchFunctionCalls(
      [{ id: 'c1', name: 'flaky', args: {} }],
      { handlers, declarations: [] },
      getKey,
      ws,
      send,
    );
    const payload = JSON.parse(ws.sent[0]) as { toolResponse: { functionResponses: Array<{ response: { error: string } }> } };
    expect(payload.toolResponse.functionResponses[0].response.error).toMatch(/runtime-error/);
  });

  it('does not send if the WebSocket is not OPEN', async () => {
    const ws = { readyState: 3, send: vi.fn(), sent: [] } as unknown as WebSocket & { sent: string[] };
    const send = vi.fn();
    const handlers = { x: vi.fn(async () => ok({})) };
    await dispatchFunctionCalls(
      [{ id: 'c1', name: 'x', args: {} }],
      { handlers, declarations: [] },
      getKey,
      ws,
      send,
    );
    expect((ws as unknown as { send: ReturnType<typeof vi.fn> }).send).not.toHaveBeenCalled();
  });
});

describe('sanitizeForOpenApi', () => {
  it('strips additionalProperties at any depth', () => {
    const input = {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'query' },
        nested: {
          type: 'object',
          properties: { k: { type: 'number' } },
          additionalProperties: false,
        },
      },
      required: ['q'],
      additionalProperties: false,
    };
    const out = sanitizeForOpenApi(input);
    expect('additionalProperties' in out).toBe(false);
    const nested = (out.properties as Record<string, Record<string, unknown>>).nested;
    expect('additionalProperties' in nested).toBe(false);
    // Preserves the rest unchanged.
    expect(out.type).toBe('object');
    expect(out.required).toEqual(['q']);
  });

  it('drops $schema, $ref, patternProperties', () => {
    const out = sanitizeForOpenApi({
      $schema: 'http://json-schema.org/draft-07/schema#',
      $ref: '#/definitions/x',
      patternProperties: { '^foo': { type: 'string' } },
      type: 'string',
    } as Record<string, unknown>);
    expect(out).toEqual({ type: 'string' });
  });

  it('handles arrays of object items recursively', () => {
    const out = sanitizeForOpenApi({
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { a: { type: 'number' } } },
    } as Record<string, unknown>);
    expect((out.items as Record<string, unknown>).additionalProperties).toBeUndefined();
    expect((out.items as Record<string, unknown>).properties).toBeTruthy();
  });
});
