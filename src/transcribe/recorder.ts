// Mic recorder for the Voice Transcriber. Reuses the live session's proven
// capture path (getUserMedia → 16 kHz AudioContext → ScriptProcessor) but,
// instead of streaming, it ACCUMULATES Float32 chunks and encodes one WAV blob
// on stop() — the robust record-then-transcribe path (no Live WebSocket). WAV
// because Gemini accepts WAV but not MediaRecorder's webm/opus.
import { encodeWavPcm16, concatFloat32 } from './wav';

const SAMPLE_RATE = 16_000;
const PROCESSOR_BUFFER = 4096;

export interface Recording {
  /** 16 kHz mono WAV bytes, ready to base64 + transcribe. */
  wav: Uint8Array;
  mimeType: 'audio/wav';
  durationMs: number;
  /** Captured sample count (0 means silence/no audio reached the processor). */
  sampleCount: number;
}

export class MicRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private startedAt = 0;
  private recording = false;

  isRecording(): boolean {
    return this.recording;
  }

  async start(): Promise<void> {
    if (this.recording) return;
    this.chunks = [];
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const Ctx = (window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    this.ctx = new Ctx({ sampleRate: SAMPLE_RATE });
    // Autoplay policy can leave the context suspended → onaudioprocess never
    // fires → silent recording. The Record click is the gesture that allows
    // resume(), so do it here.
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* best effort */ }
    }
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(PROCESSOR_BUFFER, 1, 1);
    this.processor.onaudioprocess = (ev) => {
      if (!this.recording) return;
      this.chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.processor);
    // ScriptProcessor needs a destination to fire; route through a muted gain
    // so we don't echo the mic back to the user.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.processor.connect(sink);
    sink.connect(this.ctx.destination);
    this.startedAt = performance.now();
    this.recording = true;
  }

  /** Stop capture and return the encoded WAV recording. */
  async stop(): Promise<Recording> {
    const durationMs = this.recording ? Math.round(performance.now() - this.startedAt) : 0;
    this.recording = false;
    try { this.processor?.disconnect(); } catch { /* ignore */ }
    try { this.source?.disconnect(); } catch { /* ignore */ }
    if (this.stream) {
      for (const t of this.stream.getTracks()) { try { t.stop(); } catch { /* ignore */ } }
    }
    try { await this.ctx?.close(); } catch { /* ignore */ }
    const samples = concatFloat32(this.chunks);
    this.chunks = [];
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
    return {
      wav: encodeWavPcm16(samples, SAMPLE_RATE),
      mimeType: 'audio/wav',
      durationMs,
      sampleCount: samples.length,
    };
  }

  /** Discard a recording without producing a blob (cancel). */
  async cancel(): Promise<void> {
    this.recording = false;
    this.chunks = [];
    try { this.processor?.disconnect(); } catch { /* ignore */ }
    try { this.source?.disconnect(); } catch { /* ignore */ }
    if (this.stream) for (const t of this.stream.getTracks()) { try { t.stop(); } catch { /* ignore */ } }
    try { await this.ctx?.close(); } catch { /* ignore */ }
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
  }
}
