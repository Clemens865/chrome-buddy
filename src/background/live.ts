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
const DEFAULT_MODEL = 'gemini-2.5-flash-live-preview';

type Port = chrome.runtime.Port;

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
 */
export function registerVoiceStreamPort(getKey: (provider: string) => Promise<string | undefined>): () => void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onConnect) {
    return () => undefined;
  }
  const listener = (port: Port) => {
    if (port.name !== 'voice-stream') return;
    void onPortConnected(port, getKey);
  };
  chrome.runtime.onConnect.addListener(listener);
  return () => chrome.runtime.onConnect.removeListener(listener);
}

async function onPortConnected(
  port: Port,
  getKey: (provider: string) => Promise<string | undefined>,
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

      ws.onopen = () => {
        // Setup frame must be the first message.
        const setup = {
          setup: {
            model: `models/${model}`,
            generationConfig: { responseModalities: ['AUDIO'] },
            systemInstruction: { parts: [{ text: systemText }] },
            // Ask the server for both sides' transcripts so we can render them.
            inputAudioTranscription: {},
            outputAudioTranscription: {},
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
        const handle = (text: string) => routeServerFrame(text, send);
        if (typeof ev.data === 'string') handle(ev.data);
        else if (ev.data instanceof Blob) void ev.data.text().then(handle);
        else if (ev.data instanceof ArrayBuffer) handle(new TextDecoder().decode(ev.data));
      };

      ws.onerror = () => {
        send({ type: 'ERROR', message: 'Live WebSocket error.' });
      };
      ws.onclose = () => closeWith('ws-close');
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
        session.ws.send(JSON.stringify({ realtimeInput: { text: msg.text } }));
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

/** Parse one server-text frame and emit panel-side messages. Pure-ish: only
 * touches `send` which the caller provides. */
function routeServerFrame(text: string, send: (m: Record<string, unknown>) => void): void {
  let frame: unknown;
  try { frame = JSON.parse(text); } catch { return; }
  if (!frame || typeof frame !== 'object') return;
  const f = frame as {
    serverContent?: {
      modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
      inputTranscription?: { text?: string; finished?: boolean };
      outputTranscription?: { text?: string; finished?: boolean };
      turnComplete?: boolean;
      interrupted?: boolean;
    };
  };
  const sc = f.serverContent;
  if (!sc) return;
  // Audio output chunks.
  const parts = sc.modelTurn?.parts ?? [];
  for (const p of parts) {
    if (p.inlineData?.data && p.inlineData.mimeType?.startsWith('audio/')) {
      send({ type: 'AUDIO_OUT', b64: p.inlineData.data });
    }
  }
  // Transcripts (paired by role; the server sends incremental text + a
  // `finished:true` marker per chunk).
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

/** Test-only export — routeServerFrame is the pure parser; exposing it
 * lets the unit tests verify parsing behaviour without a real WS. */
export const __testing = { routeServerFrame };
