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
  /** Form fields shown to the user. */
  inputs: AppInput[];
  /** 1 = declarative (prompt template + LLM); 2 = sandboxed code. Default 1. */
  tier?: 1 | 2;
  /** Tier-1: prompt template with {{inputId}} placeholders. */
  promptTemplate?: string;
  /** Tier-2: JS function body `(inputs, bridge) => ...` run in the sandbox. */
  code?: string;
  /** Tier-2: host capabilities the code may call via the bridge (e.g. 'gemini'). */
  permissions?: string[];
  /** Tier-2: the user reviewed the code + capabilities and approved a first run. */
  reviewed?: boolean;
  createdAt: number;
}

export const APP_SCHEMA_VERSION = 1;
