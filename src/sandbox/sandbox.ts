// Entry script for the opaque-origin sandboxed iframe (manifest `sandbox` key).
// It waits for SANDBOX_RUN messages from the host, runs the generated code with
// zero ambient authority, and posts the result back. The host (panel) is the
// only thing that can talk to it, over this narrow postMessage protocol.
import { runUserCode } from './run';

interface RunMessage {
  type: 'SANDBOX_RUN';
  id: string;
  code: string;
  inputs?: Record<string, unknown>;
}

window.addEventListener('message', (ev: MessageEvent) => {
  const data = ev.data as RunMessage | undefined;
  if (!data || data.type !== 'SANDBOX_RUN') return;

  const res = runUserCode(data.code, data.inputs ?? {});
  // Ensure the payload survives structured clone (functions/DOM etc. won't).
  let result = res.result;
  try {
    structuredClone(result);
  } catch {
    result = String(result);
  }
  window.parent.postMessage({ type: 'SANDBOX_RESULT', id: data.id, ok: res.ok, result, error: res.error }, '*');
});

// Tell the host we're alive.
window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
