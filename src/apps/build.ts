// Pure builders/validators for Tier-1 declarative apps + the generator prompt.
import type { AppConfig, AppInput } from './types';

export const APP_BUILDER_SYSTEM = `You design a small declarative "app": a form bound to a prompt.
Return ONLY JSON of the shape:
{"name": string, "description": string,
 "inputs": [{"id": string, "label": string, "type": "text"|"textarea", "placeholder"?: string}],
 "promptTemplate": string}
Rules:
- 1-4 inputs. "id" is a short lowercase identifier (a-z0-9_), unique.
- Use {{id}} placeholders in promptTemplate for every input.
- promptTemplate is a clear instruction to an LLM that produces the app's output.
- Use type "textarea" for long/multiline input, otherwise "text".
No prose, no markdown fences — just the JSON object.`;

const idOf = () => `app_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function cleanInputs(raw: unknown): AppInput[] {
  if (!Array.isArray(raw)) return [];
  const out: AppInput[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const label = typeof o.label === 'string' ? o.label.trim() : id;
    if (!id || out.some((i) => i.id === id)) continue;
    out.push({
      id,
      label: label || id,
      type: o.type === 'textarea' ? 'textarea' : 'text',
      placeholder: typeof o.placeholder === 'string' ? o.placeholder : undefined,
    });
    if (out.length >= 4) break;
  }
  return out;
}

/** Parse the generator's JSON into a valid AppConfig, or null. */
export function parseAppConfig(jsonText: string): AppConfig | null {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const promptTemplate = typeof o.promptTemplate === 'string' ? o.promptTemplate.trim() : '';
  const inputs = cleanInputs(o.inputs);
  if (!name || !promptTemplate || inputs.length === 0) return null;
  return {
    id: idOf(),
    name,
    description: typeof o.description === 'string' ? o.description.trim() : '',
    inputs,
    tier: 1,
    promptTemplate,
    createdAt: Date.now(),
  };
}

export const CODE_APP_BUILDER_SYSTEM = `You design a small SANDBOXED CODE app: a form bound to a JavaScript transform.
Return ONLY JSON of the shape:
{"name": string, "description": string,
 "inputs": [{"id": string, "label": string, "type": "text"|"textarea", "placeholder"?: string}],
 "permissions": string[],
 "code": string}
Rules:
- 1-4 inputs. "id" is a short lowercase identifier (a-z0-9_), unique.
- "code" is the BODY of an async function (inputs, bridge) => ... It MUST end with a \`return\` of the output (a string or JSON-serialisable value).
- Read values via the \`inputs\` object, keyed by input id (values are strings).
- Default to PURE JavaScript (String, Number, Math, JSON, Array, RegExp). No DOM, no imports, no direct fetch.
- To call the LLM, set "permissions": ["gemini"] and use \`await bridge.gemini(promptString)\` which returns the model's text. If you don't need it, use "permissions": [].
No prose, no markdown fences — just the JSON object.`;

/** Parse the code-app generator's JSON into a Tier-2 AppConfig, or null. */
export function parseCodeApp(jsonText: string): AppConfig | null {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const code = typeof o.code === 'string' ? o.code.trim() : '';
  const inputs = cleanInputs(o.inputs);
  if (!name || !code || inputs.length === 0) return null;
  // Only known capabilities are honored (the host authorizes each anyway).
  const KNOWN_CAPS = ['gemini'];
  const permissions = Array.isArray(o.permissions)
    ? (o.permissions as unknown[]).map(String).filter((p) => KNOWN_CAPS.includes(p))
    : [];
  return {
    id: idOf(),
    name,
    description: typeof o.description === 'string' ? o.description.trim() : '',
    inputs,
    tier: 2,
    code,
    permissions,
    reviewed: false,
    createdAt: Date.now(),
  };
}

/** Substitute {{id}} placeholders with the user's values (missing -> empty). */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, id: string) => values[id] ?? '');
}
