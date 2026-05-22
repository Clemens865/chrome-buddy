// UI helper for audio transcription (SW-owned key + native Gemini call).
import type { AudioTranscribeMessage, AudioTranscribeResponse, ErrorResponse } from '../key/messages';

export interface TranscribeResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/** Read a File/Blob as base64 (no data: prefix). */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

/** Transcribe audio via the background SW. */
export async function transcribeAudio(audioBase64: string, mimeType: string, model?: string): Promise<TranscribeResult> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return { ok: false, error: 'Extension messaging unavailable.' };
  }
  const msg: AudioTranscribeMessage = { type: 'AUDIO_TRANSCRIBE', audioBase64, mimeType, model };
  const res = (await chrome.runtime.sendMessage(msg)) as AudioTranscribeResponse | ErrorResponse | undefined;
  if (!res) return { ok: false, error: 'No response from background.' };
  if (res.type === 'AUDIO_TRANSCRIBE') return { ok: true, text: res.text };
  return { ok: false, error: res.type === 'ERROR' ? res.error : 'Transcription failed.' };
}
