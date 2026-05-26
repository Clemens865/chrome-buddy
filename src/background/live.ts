// Gemini Live API client — SW-side. Owns the WebSocket connection lifecycle
// so the API key never leaves the service worker (NFR-SEC-1).
//
// The panel opens a `voice-stream` Port; we relay frames in both directions:
//
//   panel → SW:  { type: 'START', model?, systemInstruction? }
//                { type: 'AUDIO_IN', b64 }     // base64 LE 16-bit PCM, 16 kHz
//                { type: 'TEXT_IN', text }     // optional text turn
//                { type: 'AUDIO_END' }         // signal end-of-stream
//                { type: 'STOP' }              // close session
//
//   SW → panel:  { type: 'OPEN' }              // WS connected
//                { type: 'AUDIO_OUT', b64 }    // base64 LE 16-bit PCM, 24 kHz
//                { type: 'TRANSCRIPT', role: 'user'|'model', text, isFinal }
//                { type: 'TURN_DONE' }
//                { type: 'INTERRUPTED' }       // server cancelled mid-turn
//                { type: 'ERROR', message }
//                { type: 'CLOSED' }
//
// We deliberately do NOT buffer audio output here — the panel handles playback
// queueing. We just forward.

const LIVE_HOST = 'generativelanguage.googleapis.com';
const LIVE_PATH = '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
// Current 2.5-lineage live model. Earlier doc snapshots referenced
// 'gemini-2.5-flash-live-preview'; the maintained id is
// 'gemini-2.5-flash-native-audio-preview-12-2025' (the older alias 404s
// silently — connection opens but generation never fires).
const DEFAULT_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

type Port = chrome.runtime.Port;

export type LiveToolHandler = (
  args: Record<string, unknown>,
  getKey: (provider: string) => Promise<string | undefined>,
) => Promise<import('../types').ToolResult>;

export interface LiveFunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

interface LiveSession {
  ws: WebSocket;
  port: Port;
  closed: boolean;
}

/**
 * Wire up the `voice-stream` Port (panel side calls
 * `chrome.runtime.connect({name:'voice-stream'})`). Returns an unregister
 * function for tests; the SW boot just calls it once.
 *
 * `getKey()` is the SW's existing key reader (chrome.storage.session fallback
 * to import.meta.env.VITE_GEMINI_API_KEY in dev / e2e).
 *
 * `tools` is optional — when provided, the SW will:
 *   1. Include the function declarations in the setup payload so the model
 *      can call them mid-conversation.
 *   2. Route incoming functionCall frames to `tools.handlers[name]`,
 *      then send back a functionResponse with the tool's result.
 */
export function registerVoiceStreamPort(
  getKey: (provider: string) => Promise<string | undefined>,
  tools?: { handlers: Record<string, LiveToolHandler>; declarations: LiveFunctionDeclaration[] },
): () => void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onConnect) {
    return () => undefined;
  }
  const listener = (port: Port) => {
    if (port.name !== 'voice-stream') return;
    void onPortConnected(port, getKey, tools);
  };
  chrome.runtime.onConnect.addListener(listener);
  return () => chrome.runtime.onConnect.removeListener(listener);
}

async function onPortConnected(
  port: Port,
  getKey: (provider: string) => Promise<string | undefined>,
  tools?: { handlers: Record<string, LiveToolHandler>; declarations: LiveFunctionDeclaration[] },
): Promise<void> {
  const session: LiveSession = { ws: null as unknown as WebSocket, port, closed: false };

  const send = (msg: Record<string, unknown>) => {
    if (session.closed) return;
    try {
      port.postMessage(msg);
    } catch {
      // Port already gone — mark closed.
      session.closed = true;
    }
  };

  const closeWith = (reason: string) => {
    if (session.closed) return;
    session.closed = true;
    try { session.ws?.close(); } catch { /* ignore */ }
    send({ type: 'CLOSED', reason });
    try { port.disconnect(); } catch { /* ignore */ }
  };

  port.onDisconnect.addListener(() => closeWith('panel-disconnect'));

  // Register the message listener BEFORE awaiting the key — otherwise the
  // panel's START frame (sent right after connect) lands while we're still
  // in the await and gets dropped (Port messages aren't buffered for late
  // listeners). We resolve the key in a promise the listener awaits.
  const keyPromise = getKey('google-gemini');

  port.onMessage.addListener((msg: { type?: string; [k: string]: unknown }) => {
    if (session.closed) return;
    void (async () => {
      const apiKey = await keyPromise;
      if (!apiKey) {
        send({ type: 'ERROR', message: 'No API key. Open Settings → API key first.' });
        closeWith('no-key');
        return;
      }
    const t = msg?.type;
    if (t === 'START' && !session.ws) {
      const url = `wss://${LIVE_HOST}${LIVE_PATH}?key=${encodeURIComponent(apiKey)}`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        send({ type: 'ERROR', message: e instanceof Error ? e.message : 'WebSocket construction failed.' });
        closeWith('ws-error');
        return;
      }
      session.ws = ws;
      const model = typeof msg.model === 'string' ? msg.model : DEFAULT_MODEL;
      const systemText = typeof msg.systemInstruction === 'string'
        ? msg.systemInstruction
        : 'You are Buddy, a concise, helpful voice assistant. Keep replies short and conversational.';
      // Output modality — 'AUDIO' for voice chat, 'TEXT' for the Live
      // Transcriber (no synthesised replies; cheaper + faster).
      const responseModality = msg.responseModalities === 'TEXT' ? 'TEXT' : 'AUDIO';

      ws.onopen = () => {
        // Setup frame must be the first message. When `tools` are wired,
        // surface the function declarations so the model can call them.
        const setup: Record<string, unknown> = {
          setup: {
            model: `models/${model}`,
            generationConfig: { responseModalities: [responseModality] },
            systemInstruction: { parts: [{ text: systemText }] },
            // Ask the server for both sides' transcripts so we can render them.
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            ...(tools && tools.declarations.length > 0
              ? {
                  tools: [{
                    functionDeclarations: tools.declarations.map((d) => ({
                      ...d,
                      parameters: d.parameters ? sanitizeForOpenApi(d.parameters) : undefined,
                    })),
                  }],
                }
              : {}),
          },
        };
        try {
          ws.send(JSON.stringify(setup));
          send({ type: 'OPEN' });
        } catch (e) {
          send({ type: 'ERROR', message: e instanceof Error ? e.message : 'Setup send failed.' });
          closeWith('setup-error');
        }
      };

      ws.onmessage = (ev) => {
        // The server may send text frames OR Blob frames. We coerce to JSON.
        const handle = (text: string) => {
          // Surface server frames to the panel AND extract function calls
          // for the SW-side dispatch loop.
          const calls = routeServerFrame(text, send);
          if (calls && calls.length > 0 && tools) {
            void dispatchFunctionCalls(calls, tools, getKey, ws, send);
          }
        };
        if (typeof ev.data === 'string') handle(ev.data);
        else if (ev.data instanceof Blob) void ev.data.text().then(handle);
        else if (ev.data instanceof ArrayBuffer) handle(new TextDecoder().decode(ev.data));
      };

      ws.onerror = () => {
        send({ type: 'ERROR', message: 'Live WebSocket error.' });
      };
      ws.onclose = (ev) => {
        // Code 1007 = invalid payload. We surface server-side rejection
        // reasons (model name issues, schema validation failures) to the
        // panel so the user sees a real error instead of a silent close.
        if (ev.code === 1007 && ev.reason) {
          send({ type: 'ERROR', message: `Gemini Live rejected the request: ${ev.reason}` });
        }
        closeWith('ws-close');
      };
      return;
    }

    // Subsequent frames need an open WS.
    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) return;
    try {
      if (t === 'AUDIO_IN' && typeof msg.b64 === 'string') {
        session.ws.send(JSON.stringify({
          realtimeInput: {
            audio: { data: msg.b64, mimeType: 'audio/pcm;rate=16000' },
          },
        }));
      } else if (t === 'TEXT_IN' && typeof msg.text === 'string') {
        // Discrete text turn — clientContent with turnComplete:true is what
        // triggers the model to generate a response. `realtimeInput.text`
        // exists but does NOT itself trigger generation; using it leaves
        // the conversation hanging until audio arrives.
        session.ws.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text: msg.text }] }],
            turnComplete: true,
          },
        }));
      } else if (t === 'AUDIO_END') {
        session.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } else if (t === 'STOP') {
        closeWith('client-stop');
      }
    } catch (e) {
      send({ type: 'ERROR', message: e instanceof Error ? e.message : String(e) });
    }
    })();
  });
}

export interface LiveFunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

/** Parse one server-text frame and emit panel-side messages. Also returns
 *  any function calls the model issued so the caller can dispatch them and
 *  send a functionResponse back over the same WebSocket. Pure-ish: only
 *  touches `send` which the caller provides. */
function routeServerFrame(text: string, send: (m: Record<string, unknown>) => void): LiveFunctionCall[] {
  let frame: unknown;
  try { frame = JSON.parse(text); } catch { return []; }
  if (!frame || typeof frame !== 'object') return [];
  const f = frame as {
    serverContent?: {
      modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
      inputTranscription?: { text?: string; finished?: boolean };
      outputTranscription?: { text?: string; finished?: boolean };
      turnComplete?: boolean;
      interrupted?: boolean;
    };
    toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> };
  };
  const sc = f.serverContent;
  if (sc) {
    // Audio output chunks.
    const parts = sc.modelTurn?.parts ?? [];
    for (const p of parts) {
      if (p.inlineData?.data && p.inlineData.mimeType?.startsWith('audio/')) {
        send({ type: 'AUDIO_OUT', b64: p.inlineData.data });
      }
    }
    if (sc.inputTranscription?.text) {
      send({
        type: 'TRANSCRIPT',
        role: 'user',
        text: sc.inputTranscription.text,
        isFinal: sc.inputTranscription.finished === true,
      });
    }
    if (sc.outputTranscription?.text) {
      send({
        type: 'TRANSCRIPT',
        role: 'model',
        text: sc.outputTranscription.text,
        isFinal: sc.outputTranscription.finished === true,
      });
    }
    if (sc.interrupted) send({ type: 'INTERRUPTED' });
    if (sc.turnComplete) send({ type: 'TURN_DONE' });
  }
  // Function calls live in a sibling field (`toolCall.functionCalls`).
  const calls: LiveFunctionCall[] = [];
  for (const c of f.toolCall?.functionCalls ?? []) {
    if (typeof c.name === 'string') {
      calls.push({ id: c.id, name: c.name, args: c.args ?? {} });
      send({ type: 'FUNCTION_CALL', name: c.name, args: c.args ?? {} });
    }
  }
  return calls;
}

/**
 * Dispatch function calls the Live model issued and send a `toolResponse`
 * back over the same WebSocket. Each call is matched against the registered
 * handlers; unknown names produce a 'not-found' error response so the model
 * can recover (rather than the conversation silently dropping).
 */
async function dispatchFunctionCalls(
  calls: LiveFunctionCall[],
  tools: { handlers: Record<string, LiveToolHandler>; declarations: LiveFunctionDeclaration[] },
  getKey: (provider: string) => Promise<string | undefined>,
  ws: WebSocket,
  send: (m: Record<string, unknown>) => void,
): Promise<void> {
  const responses: Array<{ id?: string; name: string; response: Record<string, unknown> }> = [];
  for (const call of calls) {
    const handler = tools.handlers[call.name];
    let response: Record<string, unknown>;
    if (!handler) {
      response = { error: `Tool "${call.name}" is not available in voice mode.` };
    } else {
      try {
        const result = await handler(call.args, getKey);
        response = result.ok
          ? { result: result.data as unknown as Record<string, unknown> }
          : { error: `${result.error.code}: ${result.error.message}` };
      } catch (e) {
        response = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    send({ type: 'FUNCTION_RESULT', name: call.name, ok: !('error' in response) });
    responses.push({ id: call.id, name: call.name, response });
  }
  if (responses.length === 0 || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
  } catch (e) {
    send({ type: 'ERROR', message: e instanceof Error ? e.message : 'Failed to send toolResponse.' });
  }
}

/**
 * Strip JSON-Schema-only fields that Gemini Live's OpenAPI Schema parser
 * rejects. The Live server returns close-code 1007 with
 *   "Unknown name 'additionalProperties' at 'setup.tools[0].function_declarations[0].parameters'"
 * if we pass them through. Recursively drops `additionalProperties`,
 * `$schema`, and `$ref`; preserves `type`, `description`, `properties`,
 * `required`, `enum`, `items`, `format`, `nullable`. Pure.
 */
export function sanitizeForOpenApi<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'additionalProperties' || k === '$schema' || k === '$ref' || k === 'patternProperties') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizeForOpenApi(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeForOpenApi(item as Record<string, unknown>)
          : item,
      );
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/** Test-only export — routeServerFrame is the pure parser; exposing it
 * lets the unit tests verify parsing behaviour without a real WS. */
export const __testing = { routeServerFrame, dispatchFunctionCalls, sanitizeForOpenApi };
