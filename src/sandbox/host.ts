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
  /** Idle timeout between progress events (refreshed on each bridge round-trip). */
  timeoutMs?: number;
  /** ABSOLUTE wall-clock cap for the whole run — NOT refreshed by bridge calls,
   *  so a tight `while(true){ await bridge.gemini() }` loop can't dodge it. */
  maxWallMs?: number;
  /** Hard cap on bridge round-trips for one run (quota-drain / loop guard). */
  maxBridgeCalls?: number;
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
  const { timeoutMs = 3000, maxWallMs = 60_000, maxBridgeCalls = 64, capabilities = [], onBridge } = options;
  await ensureFrame();
  const id = `s${seq++}`;
  return new Promise<SandboxResult>((resolve) => {
    // Absolute deadline for the whole run. The idle timer is refreshed on each
    // bridge round-trip (legit LLM calls are slow) but NEVER past this deadline —
    // otherwise a loop that keeps calling the bridge would reset the timer forever.
    const deadline = Date.now() + maxWallMs;
    let bridgeCalls = 0;
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
    };
    function fail(error: string) {
      cleanup();
      resetFrame();
      resolve({ ok: false, error });
    }
    const onTimeout = () => fail('Sandbox timed out (possible infinite loop).');
    // Idle timer, clamped to the remaining wall-clock budget.
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(onTimeout, Math.max(0, Math.min(timeoutMs, deadline - Date.now())));
    };
    let timer = setTimeout(onTimeout, Math.min(timeoutMs, maxWallMs));
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
        if (++bridgeCalls > maxBridgeCalls) {
          fail(`Sandbox exceeded its capability-call budget (${maxBridgeCalls}).`);
          return;
        }
        arm();
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
