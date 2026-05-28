// A Tier-1 app is a DECLARATIVE micro-tool (PRD FR / "self-extending apps"):
// a named form (typed inputs) bound to a prompt template. It is pure data — no
// code — so it's MV3/Web-Store compliant. The engine renders the form, fills the
// template, and runs a plain LLM call. (Tier-2 code apps run in a sandbox.)
export interface AppInput {
  /** Placeholder key referenced in the template as {{id}}. */
  id: string;
  label: string;
  type: 'text' | 'textarea';
  placeholder?: string;
}

export interface AppConfig {
  id: string;
  name: string;
  description: string;
  /** Form fields shown to the user (Tier-1/2; Tier-3 UI apps build their own). */
  inputs: AppInput[];
  /** 1 = declarative (prompt template + LLM); 2 = sandboxed value-return code;
   *  3 = sandboxed UI app (renders its own interface in the opaque-origin
   *  iframe + calls capabilities via the bridge). Default 1. */
  tier?: 1 | 2 | 3;
  /** Tier-1: prompt template with {{inputId}} placeholders. */
  promptTemplate?: string;
  /** Tier-2: JS function body `(inputs, bridge) => ...` run in the sandbox. */
  code?: string;
  /** Tier-3: the app's UI markup (rendered into the sandbox iframe; no <script>). */
  html?: string;
  /** Tier-3: scoped styles for the app (injected as a <style> in the sandbox). */
  css?: string;
  /** Tier-3: the app's logic, body of `(root, bridge, api) => ...`, run in the
   *  sandbox. It wires the UI in `root` and calls capabilities via `bridge`. */
  ui?: string;
  /** Tier-2/3: host capabilities the code may call via the bridge (e.g. 'gemini'). */
  permissions?: string[];
  /** Tier-2/3: the user reviewed the code + capabilities and approved a first run. */
  reviewed?: boolean;
  createdAt: number;
}

// v2: added Tier-3 sandboxed-UI apps (html/css/ui fields). Older records are
// forward-compatible — Tier-1/2 fields are untouched.
export const APP_SCHEMA_VERSION = 2;

// Capabilities a Tier-2/3 app may declare + receive through the bridge. None are
// "consequential" (no external side effects beyond the user's own LLM quota or a
// user-initiated download) — consequential tools require the args-visible HITL
// gate and are intentionally NOT exposed to generated/imported apps yet.
export const KNOWN_APP_CAPS = ['gemini', 'image', 'download'] as const;
