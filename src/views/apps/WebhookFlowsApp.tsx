// Webhook Flows app — ported from WebhookBuddy's Automation tab. Saved
// one-tap flows that snapshot the current page and POST to a chosen entry
// from the existing Webhooks address book. Sends our-shape JSON (snake_case,
// no double-encoded payloads) — see src/webhookFlows/snapshot.ts for the
// exact wire format. HITL by default with a per-flow trust toggle.
import { useEffect, useMemo, useState } from 'react';
import { AppHeader, appById } from '../AppsView';
import { Ic } from '../../ui/icons';
import {
  listFlows,
  saveFlow,
  deleteFlow,
  groupByCategory,
  touchFlowRun,
  type WebhookFlow,
  type SnapshotMode,
  type NewFlowInput,
} from '../../webhookFlows/store';
import { buildFlowPayload, type PageSnapshotInput } from '../../webhookFlows/snapshot';
import { listWebhooks, type Webhook } from '../../webhooks/store';
import { usePersistedState } from '../../sidepanel/usePersistedState';
import { EMPTY_PROFILES, type Profiles, type ProfileKind } from '../../agent';

type Status =
  | { kind: 'idle' }
  | { kind: 'previewing'; flow: WebhookFlow; payload: unknown }
  | { kind: 'sending'; flowId: string }
  | { kind: 'done'; flowId: string; httpStatus: number; ok: boolean }
  | { kind: 'error'; flowId: string; message: string };

export function WebhookFlowsApp({ onBack }: { onBack: () => void }) {
  const app = appById('webhooks');
  const [flows, setFlows] = useState<WebhookFlow[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [editing, setEditing] = useState<WebhookFlow | 'new' | null>(null);
  const [profiles] = usePersistedState<Profiles>('userProfiles', EMPTY_PROFILES);
  const [activeProfile] = usePersistedState<ProfileKind>('activeProfile', 'professional');

  const refresh = async () => {
    const [f, w] = await Promise.all([listFlows(), listWebhooks()]);
    setFlows(f);
    setWebhooks(w);
  };
  useEffect(() => {
    void refresh();
  }, []);

  const groups = useMemo(() => groupByCategory(flows), [flows]);
  const profile = profiles[activeProfile] ?? null;

  // --- Run pipeline -------------------------------------------------------
  const startRun = async (flow: WebhookFlow) => {
    setStatus({ kind: 'sending', flowId: flow.id });
    try {
      const page =
        flow.snapshotMode === 'none' ? null : await readPageSnapshot();
      const payload = buildFlowPayload({ flow, page, profile });
      if (flow.trustNoConfirm) {
        await doSend(flow, payload);
      } else {
        setStatus({ kind: 'previewing', flow, payload });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ kind: 'error', flowId: flow.id, message });
      await touchFlowRun(flow.id, 'error', message);
      void refresh();
    }
  };

  const doSend = async (flow: WebhookFlow, payload: unknown) => {
    setStatus({ kind: 'sending', flowId: flow.id });
    try {
      const r = (await chrome.runtime.sendMessage({
        type: 'TOOL_EXEC',
        tool: 'send_webhook',
        args: { name: flow.webhookName, payload },
      })) as
        | { ok: boolean; result: { ok: boolean; data?: { status: number; ok: boolean }; error?: { message: string } } }
        | undefined;
      if (!r || !r.ok) {
        throw new Error('No response from background.');
      }
      if (!r.result.ok) {
        throw new Error(r.result.error?.message ?? 'Send failed.');
      }
      const httpStatus = r.result.data?.status ?? 0;
      const ok = r.result.data?.ok === true;
      setStatus({ kind: 'done', flowId: flow.id, httpStatus, ok });
      await touchFlowRun(flow.id, ok ? 'ok' : 'error', `HTTP ${httpStatus}`);
      void refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ kind: 'error', flowId: flow.id, message });
      await touchFlowRun(flow.id, 'error', message);
      void refresh();
    }
  };

  const cancelPreview = () => setStatus({ kind: 'idle' });

  // --- Render -------------------------------------------------------------
  return (
    <div className="micro" data-testid="webhook-flows-app">
      <AppHeader app={app} onBack={onBack} />
      <div className="micro-body wf-body">
        <div className="wf-toolbar">
          <button
            className="btn"
            onClick={() => setEditing('new')}
            data-testid="wf-new-flow"
          >
            <span className="ic ic-sm">{Ic.plus}</span> New flow
          </button>
          {webhooks.length === 0 && (
            <span className="wf-hint">
              Add a webhook in Settings first — flows POST to a saved name.
            </span>
          )}
        </div>

        {flows.length === 0 ? (
          <div className="wf-empty">
            <div className="wf-empty-icon">{Ic.hook}</div>
            <div className="wf-empty-title">No flows yet</div>
            <div className="wf-empty-sub">
              A flow snapshots the current page and POSTs JSON to a webhook you
              already saved. Use it for one-tap "send page to n8n / Make / your
              own endpoint" automations.
            </div>
          </div>
        ) : (
          <div className="wf-groups">
            {groups.map((g) => (
              <FlowGroup
                key={g.category}
                category={g.category}
                flows={g.flows}
                status={status}
                onRun={startRun}
                onEdit={(f) => setEditing(f)}
                onDelete={async (id) => {
                  if (!confirm('Delete this flow?')) return;
                  await deleteFlow(id);
                  void refresh();
                }}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <FlowEditor
          flow={editing === 'new' ? null : editing}
          webhooks={webhooks}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            await saveFlow(input);
            setEditing(null);
            void refresh();
          }}
        />
      )}

      {status.kind === 'previewing' && (
        <PreviewModal
          flow={status.flow}
          payload={status.payload}
          onCancel={cancelPreview}
          onApprove={() => doSend(status.flow, status.payload)}
        />
      )}
    </div>
  );
}

// ------- Subcomponents ----------------------------------------------------

function FlowGroup({
  category,
  flows,
  status,
  onRun,
  onEdit,
  onDelete,
}: {
  category: string;
  flows: WebhookFlow[];
  status: Status;
  onRun: (f: WebhookFlow) => void;
  onEdit: (f: WebhookFlow) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="wf-group">
      <button
        className="wf-group-h"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`wf-chev ${open ? 'is-open' : ''}`}>{Ic.chev}</span>
        <span>{category}</span>
        <span className="wf-group-count">{flows.length}</span>
      </button>
      {open && (
        <ul className="wf-list">
          {flows.map((f) => (
            <FlowRow
              key={f.id}
              flow={f}
              status={status}
              onRun={() => onRun(f)}
              onEdit={() => onEdit(f)}
              onDelete={() => onDelete(f.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FlowRow({
  flow,
  status,
  onRun,
  onEdit,
  onDelete,
}: {
  flow: WebhookFlow;
  status: Status;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isThis =
    (status.kind === 'sending' && status.flowId === flow.id) ||
    (status.kind === 'done' && status.flowId === flow.id) ||
    (status.kind === 'error' && status.flowId === flow.id);
  const pill =
    status.kind === 'sending' && status.flowId === flow.id
      ? 'Sending…'
      : status.kind === 'done' && status.flowId === flow.id
        ? `✓ HTTP ${status.httpStatus}`
        : status.kind === 'error' && status.flowId === flow.id
          ? `✗ ${status.message.slice(0, 60)}`
          : flow.lastRunStatus === 'ok'
            ? `✓ ${flow.lastRunMessage ?? 'OK'}`
            : flow.lastRunStatus === 'error'
              ? `✗ ${flow.lastRunMessage ?? 'Error'}`
              : '';
  return (
    <li className="wf-row" data-testid={`wf-row-${flow.name}`}>
      <div className="wf-row-main">
        <div className="wf-row-name">{flow.name}</div>
        <div className="wf-row-meta">
          → <code>{flow.webhookName}</code> · {labelForMode(flow.snapshotMode)}
          {flow.trustNoConfirm ? ' · no-confirm' : ''}
        </div>
        {pill && (
          <div className={`wf-pill ${isThis ? 'is-active' : ''}`}>{pill}</div>
        )}
      </div>
      <div className="wf-row-actions">
        <button
          className="btn btn-primary btn-sm"
          onClick={onRun}
          disabled={status.kind === 'sending' && status.flowId === flow.id}
          data-testid={`wf-run-${flow.name}`}
        >
          <span className="ic ic-sm">{Ic.send}</span> Run
        </button>
        <button className="btn btn-ghost btn-sm wf-icon-btn" onClick={onEdit} aria-label="Edit flow" title="Edit">
          <span className="ic ic-sm">{Ic.settings}</span>
        </button>
        <button className="btn btn-ghost btn-sm wf-icon-btn" onClick={onDelete} aria-label="Delete flow" title="Delete">
          <span className="ic ic-sm">{Ic.x}</span>
        </button>
      </div>
    </li>
  );
}

function FlowEditor({
  flow,
  webhooks,
  onCancel,
  onSave,
}: {
  flow: WebhookFlow | null;
  webhooks: Webhook[];
  onCancel: () => void;
  onSave: (input: NewFlowInput) => Promise<void>;
}) {
  const [name, setName] = useState(flow?.name ?? '');
  const [categoryName, setCategoryName] = useState(flow?.categoryName ?? '');
  const [webhookName, setWebhookName] = useState(
    flow?.webhookName ?? webhooks[0]?.name ?? '',
  );
  const [snapshotMode, setSnapshotMode] = useState<SnapshotMode>(
    flow?.snapshotMode ?? 'text',
  );
  const [includeSelection, setIncludeSelection] = useState(flow?.includeSelection ?? true);
  const [includeProfile, setIncludeProfile] = useState(flow?.includeProfile ?? true);
  const [trustNoConfirm, setTrustNoConfirm] = useState(flow?.trustNoConfirm ?? false);
  const [promptOpen, setPromptOpen] = useState(!!flow?.prompt);
  const [promptName, setPromptName] = useState(flow?.prompt?.name ?? '');
  const [systemPrompt, setSystemPrompt] = useState(flow?.prompt?.systemPrompt ?? '');
  const [userPrompt, setUserPrompt] = useState(flow?.prompt?.userPrompt ?? '');
  const [busy, setBusy] = useState(false);

  const canSave = name.trim().length > 0 && webhookName.trim().length > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const input: NewFlowInput = {
        id: flow?.id,
        name,
        categoryName,
        webhookName,
        snapshotMode,
        includeSelection,
        includeProfile,
        trustNoConfirm,
        prompt: promptOpen
          ? { name: promptName, systemPrompt, userPrompt }
          : undefined,
      };
      await onSave(input);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wf-modal" data-testid="wf-editor" role="dialog">
      <div className="wf-modal-card">
        <div className="wf-modal-h">{flow ? 'Edit flow' : 'New flow'}</div>
        <div className="wf-form">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Send article to n8n"
              data-testid="wf-name"
            />
          </Field>
          <Field label="Category">
            <input
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              placeholder="Research (optional)"
              data-testid="wf-category"
            />
          </Field>
          <Field label="Webhook">
            {webhooks.length === 0 ? (
              <div className="wf-warn">
                No saved webhooks yet. Add one in Settings → Webhooks first.
              </div>
            ) : (
              <select
                value={webhookName}
                onChange={(e) => setWebhookName(e.target.value)}
                data-testid="wf-webhook"
              >
                {webhooks.map((w) => (
                  <option key={w.id} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Page snapshot">
            <div className="wf-radios">
              {(['none', 'meta', 'text', 'full'] as SnapshotMode[]).map((m) => (
                <label key={m} className="wf-radio">
                  <input
                    type="radio"
                    name="snapshot"
                    checked={snapshotMode === m}
                    onChange={() => setSnapshotMode(m)}
                  />
                  <span>{labelForMode(m)}</span>
                </label>
              ))}
            </div>
          </Field>
          <Toggle
            label="Include active selection"
            checked={includeSelection}
            onChange={setIncludeSelection}
          />
          <Toggle
            label="Include user profile"
            checked={includeProfile}
            onChange={setIncludeProfile}
          />
          <Toggle
            label="Trusted — skip confirm modal"
            checked={trustNoConfirm}
            onChange={setTrustNoConfirm}
          />

          <button
            className="wf-disclose"
            onClick={() => setPromptOpen((o) => !o)}
            type="button"
          >
            <span className={`wf-chev ${promptOpen ? 'is-open' : ''}`}>{Ic.chev}</span>
            Prompt template (optional)
          </button>
          {promptOpen && (
            <div className="wf-prompt">
              <Field label="Prompt name">
                <input
                  value={promptName}
                  onChange={(e) => setPromptName(e.target.value)}
                  placeholder="summarize"
                />
              </Field>
              <Field label="System prompt">
                <textarea
                  rows={3}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are a summarizer."
                />
              </Field>
              <Field label="User prompt">
                <textarea
                  rows={3}
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  placeholder="Summarize {title} from {url}. Highlight: {selected_text}"
                />
              </Field>
            </div>
          )}
        </div>
        <div className="wf-modal-foot">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={!canSave}
            data-testid="wf-save"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({
  flow,
  payload,
  onCancel,
  onApprove,
}: {
  flow: WebhookFlow;
  payload: unknown;
  onCancel: () => void;
  onApprove: () => void;
}) {
  return (
    <div className="wf-modal" data-testid="wf-preview" role="dialog">
      <div className="wf-modal-card">
        <div className="wf-modal-h">
          Send to <code>{flow.webhookName}</code>?
        </div>
        <div className="wf-preview">
          <pre>{JSON.stringify(payload, null, 2)}</pre>
        </div>
        <div className="wf-modal-foot">
          <button className="btn btn-ghost" onClick={onCancel} data-testid="wf-preview-cancel">
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onApprove}
            data-testid="wf-preview-approve"
          >
            <span className="ic ic-sm">{Ic.send}</span> Approve & send
          </button>
        </div>
      </div>
    </div>
  );
}

// ------- Tiny field/toggle helpers ---------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="wf-field">
      <div className="wf-field-label">{label}</div>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="wf-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// ------- Helpers ----------------------------------------------------------

function labelForMode(m: SnapshotMode): string {
  switch (m) {
    case 'none':
      return 'No page data';
    case 'meta':
      return 'URL + title only';
    case 'text':
      return 'URL + title + readable text';
    case 'full':
      return 'URL + title + text + raw HTML';
  }
}

/** Calls TOOL_EXEC read_dom and reshapes the result into the snapshot input.
 *  Throws on undriveable tabs (e.g. chrome://) so the caller can surface it. */
async function readPageSnapshot(): Promise<PageSnapshotInput | null> {
  const r = (await chrome.runtime.sendMessage({
    type: 'TOOL_EXEC',
    tool: 'read_dom',
    args: {},
  })) as
    | {
        ok: boolean;
        result: {
          ok: boolean;
          data?: { url?: string; title?: string; text?: string };
          error?: { message?: string };
        };
      }
    | undefined;
  if (!r || !r.ok) throw new Error('No response from background.');
  if (!r.result.ok) {
    throw new Error(r.result.error?.message ?? 'Could not read this page.');
  }
  const d = r.result.data ?? {};
  return {
    url: d.url ?? '',
    title: d.title ?? '',
    text: d.text ?? '',
  };
}
