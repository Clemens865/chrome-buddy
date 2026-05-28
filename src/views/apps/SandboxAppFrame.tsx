// Reusable runtime for a Tier-3 sandbox-UI app: the VISIBLE opaque-origin
// iframe (sandbox.html) + the capability-bridge broker. Used both standalone
// (SandboxAppView) and as the live preview inside the conversational builder.
//
// Security model: the iframe is opaque-origin (manifest `sandbox` key) — NO
// chrome.* APIs, cannot read the API key (SW-only), no same-origin DOM, no
// ambient network. Capabilities reach it ONLY through this broker, which
// authorizes each op against the app's declared permissions and rate-caps calls.
import { useEffect, useRef } from 'react';
import { type AppConfig, KNOWN_APP_CAPS } from '../../apps/types';
import { generateViaBackground } from '../../llm/instance';

type BridgeOutcome = { ok: boolean; result?: unknown; error?: string };
export type AppStatus = 'loading' | 'running' | 'error';

const KNOWN_CAPS = new Set<string>(KNOWN_APP_CAPS);
const MAX_CALLS_PER_MIN = 30;

export function grantedCaps(app: AppConfig): string[] {
  return (app.permissions ?? []).filter((p) => KNOWN_CAPS.has(p));
}

export function SandboxAppFrame({
  app,
  onStatus,
}: {
  app: AppConfig;
  onStatus?: (status: AppStatus, error?: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const callTimes = useRef<number[]>([]);
  const caps = grantedCaps(app);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const mountId = `ui_${app.id}`;

    const rateOk = (): boolean => {
      const now = Date.now();
      callTimes.current = callTimes.current.filter((t) => now - t < 60_000);
      if (callTimes.current.length >= MAX_CALLS_PER_MIN) return false;
      callTimes.current.push(now);
      return true;
    };

    const runBridge = async (op: string, args: unknown): Promise<BridgeOutcome> => {
      if (!caps.includes(op)) return { ok: false, error: `Capability "${op}" was not granted to this app.` };
      if (!rateOk()) return { ok: false, error: 'Rate limit: too many capability calls in a minute. Pause and retry.' };
      try {
        if (op === 'gemini') {
          const prompt = typeof args === 'string' ? args : String((args as { prompt?: unknown })?.prompt ?? '');
          if (!prompt.trim()) return { ok: false, error: 'gemini: empty prompt.' };
          const res = await generateViaBackground({ messages: [{ role: 'user', content: prompt }] });
          return { ok: true, result: res.text };
        }
        if (op === 'image') {
          const a = (args ?? {}) as { prompt?: string; model?: string };
          const r = (await chrome.runtime.sendMessage({
            type: 'IMAGE_GENERATE',
            model: a.model ?? 'gemini-2.5-flash-image',
            prompt: String(a.prompt ?? ''),
          })) as { type?: string; ok?: boolean; dataUrl?: string; error?: string } | undefined;
          if (r?.type === 'IMAGE_GENERATE' && r.ok && r.dataUrl) return { ok: true, result: r.dataUrl };
          return { ok: false, error: r?.error ?? 'Image generation failed.' };
        }
        if (op === 'download') {
          const a = (args ?? {}) as { filename?: string; content?: string; mime?: string };
          const blob = new Blob([a.content ?? ''], { type: a.mime || 'text/plain' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = (a.filename || 'download.txt').replace(/[^a-z0-9._-]+/gi, '_');
          link.click();
          URL.revokeObjectURL(url);
          return { ok: true, result: true };
        }
        return { ok: false, error: `Unknown capability "${op}".` };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    };

    const onMsg = (ev: MessageEvent) => {
      if (ev.source !== frame.contentWindow) return;
      const d = ev.data as { type?: string; id?: string; runId?: string; op?: string; args?: unknown; ok?: boolean; error?: string };
      if (d?.type === 'SANDBOX_READY') {
        onStatus?.('loading');
        frame.contentWindow?.postMessage(
          { type: 'SANDBOX_MOUNT', id: mountId, html: app.html ?? '', css: app.css ?? '', ui: app.ui ?? '', capabilities: caps },
          '*',
        );
      } else if (d?.type === 'SANDBOX_MOUNTED' && d.id === mountId) {
        onStatus?.(d.ok ? 'running' : 'error', d.ok ? undefined : d.error ?? 'The app failed to start.');
      } else if (d?.type === 'SANDBOX_BRIDGE' && d.runId === mountId) {
        void runBridge(String(d.op), d.args).then((r) =>
          frame.contentWindow?.postMessage({ type: 'SANDBOX_BRIDGE_RESULT', id: d.id, ...r }, '*'),
        );
      }
    };

    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // app.id identifies the mount; remount (via React key) on a new app/version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id]);

  return (
    <iframe
      ref={frameRef}
      title={app.name}
      className="sandbox-app-frame"
      src={typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('sandbox.html') : 'sandbox.html'}
    />
  );
}
