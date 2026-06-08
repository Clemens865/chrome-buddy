// "Ask an AI about this page" — the AEO killer artifact. We feed the page's
// visible text to the model and ask it to behave like an answer engine: what
// would it tell a user about this page, which facts can it confidently cite,
// and what's ambiguous or missing. This shows the user EXACTLY what an AI sees
// and gets wrong — feedback no static audit can give.
//
// buildSimulationPrompt + parseSimulation are PURE (unit-testable); runSimulation
// adds the SW round-trip (the key stays in the SW).

import { generateViaBackground } from '../llm/instance';

export interface AeoSimulation {
  /** A 2-3 sentence answer an engine would give about the page's topic. */
  answer: string;
  /** Concrete facts the engine can confidently extract + cite. */
  citableFacts: string[];
  /** What's ambiguous / missing / would make the engine unsure. */
  gaps: string[];
}

export const AEO_SIMULATION_SYSTEM =
  'You are an AI answer engine (like ChatGPT, Claude, or Perplexity) deciding ' +
  'whether and how to cite a web page. Judge ONLY what the provided text supports ' +
  '— do not invent facts. Respond with ONLY a JSON object, no prose, no fences.';

const MAX_PAGE_CHARS = 6000;

export interface SimulationInput {
  url: string;
  title?: string;
  /** Visible page text (from read_dom). */
  text: string;
}

/** PURE: build the simulation prompt from the page text. */
export function buildSimulationPrompt(input: SimulationInput): string {
  const body = (input.text ?? '').slice(0, MAX_PAGE_CHARS);
  const lines: string[] = [];
  lines.push('A user is asking about the topic of the web page below. Acting as an AI answer engine:');
  lines.push('');
  lines.push(`URL: ${input.url}`);
  if (input.title) lines.push(`Title: ${input.title}`);
  lines.push('');
  lines.push('PAGE TEXT:');
  lines.push('"""');
  lines.push(body);
  lines.push('"""');
  lines.push('');
  lines.push('Respond with EXACTLY this JSON (no other keys):');
  lines.push('{');
  lines.push('  "answer": "2-3 sentences you would tell a user about this page\'s topic, citing ONLY what the text supports",');
  lines.push('  "citableFacts": ["specific fact you can confidently extract + cite", "another"],');
  lines.push('  "gaps": ["what is ambiguous, unsupported, or missing that would make you unsure or unable to cite this page"]');
  lines.push('}');
  return lines.join('\n');
}

function stripFence(text: string): string {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return fence ? fence[1].trim() : t;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : String(x ?? '').trim())).filter(Boolean);
}

/** PURE + tolerant: parse the model reply into an AeoSimulation, or null. */
export function parseSimulation(text: string): AeoSimulation | null {
  let data: unknown;
  try {
    data = JSON.parse(stripFence(text));
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) return null;
    try {
      data = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const answer = typeof o.answer === 'string' ? o.answer.trim() : '';
  if (!answer) return null;
  return {
    answer,
    citableFacts: toStringArray(o.citableFacts),
    gaps: toStringArray(o.gaps),
  };
}

/** Run the simulation via the background SW. Throws on transport/parse failure. */
export async function runSimulation(input: SimulationInput, model?: string): Promise<AeoSimulation> {
  const prompt = buildSimulationPrompt(input);
  const result = await generateViaBackground({
    messages: [
      { role: 'system', content: AEO_SIMULATION_SYSTEM },
      { role: 'user', content: prompt },
    ],
    ...(model ? { model } : {}),
  });
  const parsed = parseSimulation(result.text);
  if (!parsed) throw new Error('The model did not return a parseable answer. Try again.');
  return parsed;
}
