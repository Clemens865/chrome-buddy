// Host side of the Tier-2 bridge (runs in the panel). Lazily mounts the hidden
// sandbox iframe and runs generated code in it over postMessage, with a timeout
// + frame reset so a runaway loop in untrusted code can't wedge the panel.
import type { SandboxResult } from './run';

let frame: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
let seq = 0;

function ensureFrame(): Promise<void> {
  if (ready) return ready;
  ready = new Promise<void>((resolve) => {
    frame = document.createElement('iframe');
    frame.src =
      typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL('sandbox.html')
        : 'sandbox.html';
    frame.style.display = 'none';
    frame.setAttribute('aria-hidden', 'true');
    const onReady = (ev: MessageEvent) => {
      if ((ev.data as { type?: string })?.type === 'SANDBOX_READY') {
        window.removeEventListener('message', onReady);
        resolve();
      }
    };
    window.addEventListener('message', onReady);
    document.body.appendChild(frame);
  });
  return ready;
}

function resetFrame(): void {
  frame?.remove();
  frame = null;
  ready = null;
}

/** Host-side handler for a bridge op: authorizes + executes, returns a value. */
export type BridgeHandler = (op: string, args: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string }>;

export interface RunInSandboxOptions {
  timeoutMs?: number;
  /** Capabilities exposed to the code (the bridge surface) — must be authorized. */
  capabilities?: string[];
  /** Executes an authorized bridge op (e.g. gemini.generate). */
  onBridge?: BridgeHandler;
}

/** Run generated code in the sandbox with the given inputs + optional bridge. */
export async function runInSandbox(
  code: string,
  inputs: Record<string, unknown>,
  options: RunInSandboxOptions = {},
): Promise<SandboxResult> {
  const { timeoutMs = 3000, capabilities = [], onBridge } = options;
  await ensureFrame();
  const id = `s${seq++}`;
  return new Promise<SandboxResult>((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
    };
    // Bridge calls may legitimately take a while (an LLM call) — the timeout is
    // refreshed on each bridge round-trip so a working app isn't killed.
    let timer = setTimeout(onTimeout, timeoutMs);
    function onTimeout() {
      cleanup();
      resetFrame();
      resolve({ ok: false, error: 'Sandbox timed out (possible infinite loop).' });
    }
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(onTimeout, timeoutMs);
    };
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as {
        type?: string;
        id?: string;
        runId?: string;
        op?: string;
        args?: unknown;
        ok?: boolean;
        result?: unknown;
        error?: string;
      };
      if (data?.type === 'SANDBOX_BRIDGE' && data.runId === id) {
        bump();
        void (async () => {
          const r = onBridge
            ? await onBridge(String(data.op), data.args).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
            : { ok: false, error: `Capability "${data.op}" is not available.` };
          frame!.contentWindow!.postMessage({ type: 'SANDBOX_BRIDGE_RESULT', id: data.id, ...r }, '*');
        })();
        return;
      }
      if (data?.type === 'SANDBOX_RESULT' && data.id === id) {
        cleanup();
        resolve({ ok: !!data.ok, result: data.result, error: data.error });
      }
    };
    window.addEventListener('message', onMsg);
    frame!.contentWindow!.postMessage({ type: 'SANDBOX_RUN', id, code, inputs, capabilities }, '*');
  });
}
