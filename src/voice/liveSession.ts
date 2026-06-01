// Panel-side controller for a Gemini Live voice session.
//
// Lifecycle:
//   const session = new VoiceSession({ onEvent, ...callbacks });
//   await session.start();   // opens mic + Port; sends 'START' to SW
//   ...                       // session emits events as transcripts + audio arrive
//   await session.stop();    // closes mic + Port; SW closes the WS
//
// Audio path:
//   getUserMedia(audio:true) → AudioContext(16000) → ScriptProcessorNode
//   → Float32Array → floatToBase64Pcm16 → Port({type:'AUDIO_IN', b64})
//
// Output path:
//   Port({type:'AUDIO_OUT', b64}) → base64Pcm16ToFloat → AudioContext(24000)
//   → AudioBufferSourceNode chain (each chunk scheduled after the previous).

import { floatToBase64Pcm16, base64Pcm16ToFloat } from './livePcm';

export type VoiceEvent =
  | { kind: 'open' }
  | { kind: 'transcript'; role: 'user' | 'model'; text: string; isFinal: boolean }
  | { kind: 'turn-done' }
  | { kind: 'interrupted' }
  | { kind: 'function-call'; name: string; args: Record<string, unknown> }
  | { kind: 'function-result'; name: string; ok: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'closed'; reason?: string }
  /** Fired ~every audio chunk so the UI can show "X sent / Y received /
   *  Z played" counters. Cheap visibility into whether bytes are flowing. */
  | { kind: 'flow'; sentChunks: number; sentBytes: number; recvChunks: number; recvBytes: number; playedChunks: number };

export interface VoiceSessionOptions {
  onEvent: (e: VoiceEvent) => void;
  /** Override the system instruction. */
  systemInstruction?: string;
  /** Override the model (default: gemini-2.5-flash-live-preview). */
  model?: string;
  /** Output modality — 'AUDIO' (default, for voice chat) or 'TEXT' (for the
   *  Live Transcriber, which only consumes the inputTranscription events
   *  and doesn't need synthesised audio replies). */
  responseModalities?: 'AUDIO' | 'TEXT';
}

const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const PROCESSOR_BUFFER = 4096; // ~256 ms at 16 kHz — safe + low-latency.

export class VoiceSession {
  private readonly opts: VoiceSessionOptions;
  private port: chrome.runtime.Port | null = null;
  private inCtx: AudioContext | null = null;
  private outCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  /** Time cursor for scheduling audio playback. Each incoming chunk is
   *  appended at max(currentTime, this cursor) so chunks queue properly. */
  private playCursor = 0;
  private stopped = false;
  /** Bidirectional flow counters — surfaced via the 'flow' VoiceEvent so
   *  the UI can render real-time numbers and the user can confirm audio
   *  is actually moving. */
  private sentChunks = 0;
  private sentBytes = 0;
  private recvChunks = 0;
  private recvBytes = 0;
  private playedChunks = 0;
  /** Throttle 'flow' emissions to ~every 250ms so we don't drown the UI
   *  with re-renders during continuous capture. */
  private lastFlowEmit = 0;

  constructor(opts: VoiceSessionOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    if (this.port) return; // already started
    // 1) Connect the Port FIRST so the SW knows the panel is here even if
    //    mic permission takes a while.
    this.port = chrome.runtime.connect({ name: 'voice-stream' });
    this.port.onMessage.addListener((msg) => this.onPortMessage(msg as Record<string, unknown>));
    this.port.onDisconnect.addListener(() => this.opts.onEvent({ kind: 'closed', reason: 'port-disconnect' }));
    this.port.postMessage({
      type: 'START',
      model: this.opts.model,
      systemInstruction: this.opts.systemInstruction,
      responseModalities: this.opts.responseModalities,
    });

    // 2) Ask for the mic. If the user denies, surface a clean error.
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      this.opts.onEvent({ kind: 'error', message: e instanceof Error ? e.message : 'Microphone denied.' });
      await this.stop();
      return;
    }

    // 3) Set up the input AudioContext at 16 kHz so we avoid resampling on the
    //    hot path; modern Chrome respects the constructor hint reliably.
    const InCtx = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    this.inCtx = new InCtx({ sampleRate: INPUT_SAMPLE_RATE });
    // An AudioContext can start 'suspended' (autoplay policy); if so,
    // onaudioprocess never fires and NO audio is captured/sent — the session
    // looks live but transcribes nothing. Resume it (the Record click is the
    // user gesture that permits this).
    if (this.inCtx.state === 'suspended') {
      try { await this.inCtx.resume(); } catch { /* best effort */ }
    }
    this.source = this.inCtx.createMediaStreamSource(this.stream);
    // ScriptProcessor is deprecated but functional; AudioWorklet would need
    // a separate bundled worklet file, which is overkill for v1.
    this.processor = this.inCtx.createScriptProcessor(PROCESSOR_BUFFER, 1, 1);
    this.processor.onaudioprocess = (ev) => {
      if (this.stopped) return;
      // Channel 0 only (mono) — copy because the buffer is reused.
      const samples = new Float32Array(ev.inputBuffer.getChannelData(0));
      const b64 = floatToBase64Pcm16(samples);
      this.port?.postMessage({ type: 'AUDIO_IN', b64 });
      this.sentChunks += 1;
      // Base64 is ~4/3 the size of the raw PCM; counting the wire bytes
      // (b64 length) is what the user actually pays in egress.
      this.sentBytes += b64.length;
      this.maybeEmitFlow();
    };
    this.source.connect(this.processor);
    // ScriptProcessor needs a destination to fire onaudioprocess in some
    // browsers; route through a muted gain to avoid playing the mic back.
    const sink = this.inCtx.createGain();
    sink.gain.value = 0;
    this.processor.connect(sink);
    sink.connect(this.inCtx.destination);

    // 4) Output context for playback.
    this.outCtx = new InCtx({ sampleRate: OUTPUT_SAMPLE_RATE });
    this.playCursor = this.outCtx.currentTime;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try { this.port?.postMessage({ type: 'STOP' }); } catch { /* ignore */ }
    try { this.port?.disconnect(); } catch { /* ignore */ }
    this.port = null;
    try { this.processor?.disconnect(); } catch { /* ignore */ }
    try { this.source?.disconnect(); } catch { /* ignore */ }
    this.processor = null;
    this.source = null;
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        try { t.stop(); } catch { /* ignore */ }
      }
      this.stream = null;
    }
    try { await this.inCtx?.close(); } catch { /* ignore */ }
    try { await this.outCtx?.close(); } catch { /* ignore */ }
    this.inCtx = null;
    this.outCtx = null;
  }

  private onPortMessage(msg: Record<string, unknown>): void {
    const t = msg?.type as string | undefined;
    if (t === 'OPEN') {
      this.opts.onEvent({ kind: 'open' });
    } else if (t === 'AUDIO_OUT' && typeof msg.b64 === 'string') {
      this.recvChunks += 1;
      this.recvBytes += msg.b64.length;
      this.playAudioChunk(msg.b64);
      this.maybeEmitFlow();
    } else if (t === 'TRANSCRIPT') {
      const role = msg.role === 'user' ? 'user' : 'model';
      const text = typeof msg.text === 'string' ? msg.text : '';
      const isFinal = msg.isFinal === true;
      if (text) this.opts.onEvent({ kind: 'transcript', role, text, isFinal });
    } else if (t === 'TURN_DONE') {
      this.opts.onEvent({ kind: 'turn-done' });
    } else if (t === 'INTERRUPTED') {
      this.opts.onEvent({ kind: 'interrupted' });
      // Drop any pending playback so the user hears the interruption.
      if (this.outCtx) this.playCursor = this.outCtx.currentTime;
    } else if (t === 'FUNCTION_CALL' && typeof msg.name === 'string') {
      this.opts.onEvent({
        kind: 'function-call',
        name: msg.name,
        args: (msg.args as Record<string, unknown>) ?? {},
      });
    } else if (t === 'FUNCTION_RESULT' && typeof msg.name === 'string') {
      this.opts.onEvent({ kind: 'function-result', name: msg.name, ok: msg.ok === true });
    } else if (t === 'ERROR') {
      this.opts.onEvent({ kind: 'error', message: String(msg.message ?? 'Live error.') });
    } else if (t === 'CLOSED') {
      this.opts.onEvent({ kind: 'closed', reason: typeof msg.reason === 'string' ? msg.reason : undefined });
    }
  }

  /** Decode a 24 kHz PCM chunk and queue it for playback after any
   *  previously-scheduled chunk. */
  private playAudioChunk(b64: string): void {
    if (!this.outCtx) return;
    const samples = base64Pcm16ToFloat(b64);
    if (samples.length === 0) return;
    const buf = this.outCtx.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    // copyToChannel narrows Float32Array's buffer type — copy into the
    // channel data view directly to avoid the SharedArrayBuffer mismatch.
    buf.getChannelData(0).set(samples);
    const src = this.outCtx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outCtx.destination);
    const startAt = Math.max(this.outCtx.currentTime, this.playCursor);
    src.start(startAt);
    this.playCursor = startAt + buf.duration;
    this.playedChunks += 1;
  }

  /** Throttled emitter for the 'flow' event. Fires immediately on the first
   *  byte of each direction (so the UI shows "1 sent" right away) and then
   *  at most every 250 ms during sustained activity. */
  private maybeEmitFlow(): void {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this.lastFlowEmit < 250 && this.sentChunks > 1 && this.recvChunks > 1) return;
    this.lastFlowEmit = now;
    this.opts.onEvent({
      kind: 'flow',
      sentChunks: this.sentChunks,
      sentBytes: this.sentBytes,
      recvChunks: this.recvChunks,
      recvBytes: this.recvBytes,
      playedChunks: this.playedChunks,
    });
  }
}

/** Feature detection for the UI — Voice mode needs getUserMedia + WebSocket. */
export function isVoiceSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  if (typeof WebSocket === 'undefined') return false;
  return true;
}
