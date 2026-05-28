// Host for a Tier-3 sandbox-UI app. Mounts the app's html/css/ui into a VISIBLE
// opaque-origin iframe (sandbox.html) and brokers its capability bridge.
//
// Security model: the iframe is opaque-origin (manifest `sandbox` key) — it has
// NO chrome.* APIs, cannot read the API key (keys are SW-only), no same-origin
// DOM, no ambient network. Capabilities reach it ONLY through this broker, which
// authorizes each op against the app's declared permissions and rate-caps calls.
// Persistent Chrome Buddy chrome (header + "Sandboxed" badge) frames the app so
// it can't impersonate the host UI.
import { useEffect, useRef, useState } from 'react';
import { AppHeader } from '../AppsView';
import { Ic } from '../../ui/icons';
import type { AppConfig } from '../../apps/types';
import { generateViaBackground } from '../../llm/instance';

type BridgeOutcome = { ok: boolean; result?: unknown; error?: string };

// Capabilities an app may declare. None here are "consequential" (no external
// side effects beyond the user's own LLM quota / a user-initiated download);
// consequential tools (webhook/github/file write) are intentionally NOT exposed
// to Tier-3 apps yet — they require the args-visible HITL gate (later phase).
const KNOWN_CAPS = new Set(['gemini', 'image', 'download']);
const MAX_CALLS_PER_MIN = 30;

export function SandboxAppView({ app, onBack }: { app: AppConfig; onBack: () => void }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'running' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const callTimes = useRef<number[]>([]);

  const caps = (app.permissions ?? []).filter((p) => KNOWN_CAPS.has(p));

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
        frame.contentWindow?.postMessage(
          { type: 'SANDBOX_MOUNT', id: mountId, html: app.html ?? '', css: app.css ?? '', ui: app.ui ?? '', capabilities: caps },
          '*',
        );
      } else if (d?.type === 'SANDBOX_MOUNTED' && d.id === mountId) {
        setStatus(d.ok ? 'running' : 'error');
        if (!d.ok) setErrMsg(d.error ?? 'The app failed to start.');
      } else if (d?.type === 'SANDBOX_BRIDGE' && d.runId === mountId) {
        void runBridge(String(d.op), d.args).then((r) =>
          frame.contentWindow?.postMessage({ type: 'SANDBOX_BRIDGE_RESULT', id: d.id, ...r }, '*'),
        );
      }
    };

    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // app.id identifies the app; re-mount only when switching apps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id]);

  const meta = { id: app.id, icon: Ic.sparkle, name: app.name, desc: app.description || 'Sandboxed app', color: '#8B5CF6' };

  return (
    <div className="micro" data-testid="sandbox-app">
      <AppHeader app={meta} onBack={onBack} />
      <div className="sandbox-app-bar">
        <span className="sandbox-badge">{Ic.warn}Sandboxed app — runs isolated; can’t read your keys or other tabs</span>
        {caps.length > 0 && <span className="sandbox-caps">Uses: {caps.join(', ')}</span>}
      </div>
      {status === 'error' && (
        <div className="empty-state-desc" style={{ color: '#B91C1C', padding: '8px 14px' }}>{errMsg}</div>
      )}
      <iframe
        ref={frameRef}
        title={app.name}
        className="sandbox-app-frame"
        src={typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('sandbox.html') : 'sandbox.html'}
      />
    </div>
  );
}
