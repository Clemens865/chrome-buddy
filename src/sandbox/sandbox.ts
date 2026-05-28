// Entry script for the opaque-origin sandboxed iframe (manifest `sandbox` key).
// It runs untrusted app code with ZERO ambient authority: no extension APIs, no
// same-origin DOM, no network, no access to the API key. The only way out is a
// narrow postMessage capability bridge (FR-T2-3): when code calls bridge.<op>(),
// we ask the host to perform it (the host authorizes against the app's declared
// permissions, FR-T2-4) and resolve with the result.
//
// Two runtimes share this page:
//  - SANDBOX_RUN   (Tier-2): run `(inputs, bridge) => return value` and post the value back.
//  - SANDBOX_MOUNT (Tier-3): render the app's html/css and run `(root, bridge, api) => ...`
//                            so the app paints its OWN interactive UI in this frame.
import { runUserCode, type SandboxBridge } from './run';

interface RunMessage {
  type: 'SANDBOX_RUN';
  id: string;
  code: string;
  inputs?: Record<string, unknown>;
  capabilities?: string[];
}

interface MountMessage {
  type: 'SANDBOX_MOUNT';
  id: string;
  html?: string;
  css?: string;
  ui?: string;
  capabilities?: string[];
}

let bridgeSeq = 0;
const pendingBridge = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

/** Build a bridge whose methods round-trip to the host over postMessage. One
 *  async method per granted capability; the host authorizes + executes each. */
function makeBridge(runId: string, capabilities: string[]): SandboxBridge {
  const bridge: SandboxBridge = {};
  for (const op of capabilities) {
    bridge[op] = (args?: unknown) =>
      new Promise((resolve, reject) => {
        const id = `b${bridgeSeq++}`;
        pendingBridge.set(id, { resolve, reject });
        window.parent.postMessage({ type: 'SANDBOX_BRIDGE', id, runId, op, args }, '*');
      });
  }
  return bridge;
}

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

  if (data.type === 'SANDBOX_RUN') {
    const run = data as unknown as RunMessage;
    const bridge = makeBridge(run.id, run.capabilities ?? []);
    void runUserCode(run.code, run.inputs ?? {}, bridge).then((res) => {
      let result = res.result;
      try {
        structuredClone(result);
      } catch {
        result = String(result);
      }
      window.parent.postMessage({ type: 'SANDBOX_RESULT', id: run.id, ok: res.ok, result, error: res.error }, '*');
    });
    return;
  }

  if (data.type === 'SANDBOX_MOUNT') {
    const m = data as unknown as MountMessage;
    const bridge = makeBridge(m.id, m.capabilities ?? []);
    try {
      // Styles: scoped <style> for this app.
      const style = document.createElement('style');
      style.textContent = m.css ?? '';
      document.head.appendChild(style);

      // Markup: set as innerHTML on a root node. <script> tags inserted this way
      // do NOT execute — app logic comes exclusively from the `ui` function, so
      // the markup is structure only.
      let root = document.getElementById('cb-app-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'cb-app-root';
        document.body.appendChild(root);
      }
      root.innerHTML = m.html ?? '';

      // Small convenience surface for app logic. `download` routes through the
      // host bridge (the sandbox can't trigger downloads itself).
      const api: { download: (filename: string, content: string, mime?: string) => void } = {
        download: (filename, content, mime = 'text/plain') => {
          void bridge.download?.({ filename, content, mime });
        },
      };

      const fn = new Function('root', 'bridge', 'api', `"use strict";\n${m.ui ?? ''}`) as (
        root: HTMLElement,
        bridge: SandboxBridge,
        api: { download: (filename: string, content: string, mime?: string) => void },
      ) => void;
      fn(root, bridge, api);
      window.parent.postMessage({ type: 'SANDBOX_MOUNTED', id: m.id, ok: true }, '*');
    } catch (e) {
      window.parent.postMessage(
        { type: 'SANDBOX_MOUNTED', id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) },
        '*',
      );
    }
    return;
  }
});

window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
