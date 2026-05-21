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

/** Run generated code in the sandbox with the given inputs. */
export async function runInSandbox(
  code: string,
  inputs: Record<string, unknown>,
  timeoutMs = 3000,
): Promise<SandboxResult> {
  await ensureFrame();
  const id = `s${seq++}`;
  return new Promise<SandboxResult>((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
    };
    const timer = setTimeout(() => {
      cleanup();
      resetFrame(); // a hung iframe can't be interrupted — recreate it next time
      resolve({ ok: false, error: 'Sandbox timed out (possible infinite loop).' });
    }, timeoutMs);
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string };
      if (data?.type === 'SANDBOX_RESULT' && data.id === id) {
        cleanup();
        resolve({ ok: !!data.ok, result: data.result, error: data.error });
      }
    };
    window.addEventListener('message', onMsg);
    frame!.contentWindow!.postMessage({ type: 'SANDBOX_RUN', id, code, inputs }, '*');
  });
}
