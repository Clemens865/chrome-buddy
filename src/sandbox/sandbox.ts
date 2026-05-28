// Entry script for the opaque-origin sandboxed iframe (manifest `sandbox` key).
// It runs generated code with zero ambient authority. The only way out is a
// narrow postMessage capability bridge (FR-T2-3): when code calls bridge.<op>(),
// we ask the host to perform it (the host authorizes against the app's declared
// permissions, FR-T2-4) and resolve with the result.
import { runUserCode, type SandboxBridge } from './run';

interface RunMessage {
  type: 'SANDBOX_RUN';
  id: string;
  code: string;
  inputs?: Record<string, unknown>;
  /** Host ops this app is allowed to call (becomes the bridge surface). */
  capabilities?: string[];
}

let bridgeSeq = 0;
const pendingBridge = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

window.addEventListener('message', (ev: MessageEvent) => {
  const data = ev.data as { type?: string } | undefined;
  if (!data) return;

  if (data.type === 'SANDBOX_BRIDGE_RESULT') {
    const d = data as { id: string; ok: boolean; result?: unknown; error?: string };
    const p = pendingBridge.get(d.id);
    if (p) {
      pendingBridge.delete(d.id);
      if (d.ok) p.resolve(d.result);
      else p.reject(new Error(d.error ?? 'bridge error'));
    }
    return;
  }

  if (data.type !== 'SANDBOX_RUN') return;
  const run = data as unknown as RunMessage;

  // Build a bridge with one async method per granted capability.
  const bridge: SandboxBridge = {};
  for (const op of run.capabilities ?? []) {
    bridge[op] = (args?: unknown) =>
      new Promise((resolve, reject) => {
        const id = `b${bridgeSeq++}`;
        pendingBridge.set(id, { resolve, reject });
        window.parent.postMessage({ type: 'SANDBOX_BRIDGE', id, runId: run.id, op, args }, '*');
      });
  }

  void runUserCode(run.code, run.inputs ?? {}, bridge).then((res) => {
    let result = res.result;
    try {
      structuredClone(result);
    } catch {
      result = String(result);
    }
    window.parent.postMessage({ type: 'SANDBOX_RESULT', id: run.id, ok: res.ok, result, error: res.error }, '*');
  });
});

window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
