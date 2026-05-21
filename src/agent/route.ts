// Chat routing: decide whether a message needs the full agentic loop (tools +
// plan→act→observe→reflect) or just a cheap, tool-less plain answer.
//
// 'auto' uses a pure heuristic biased toward the cheap path — a simple question
// gets a plain answer (no tool declarations, cheaper model), while page/action
// intent runs the agent. 'ask' / 'agent' force a lane. The composer exposes all
// three so the user can override a misroute.

export type ChatMode = 'auto' | 'ask' | 'agent';
export type Intent = 'chat' | 'agent';

// Verbs/phrases that signal the user wants Buddy to READ or ACT on the page or
// run a multi-step task — i.e. needs tools.
const AGENT_PATTERNS: RegExp[] = [
  /\b(this|the|current)\s+(page|site|tab|article|video|selection|screenshot)\b/i,
  /\bon\s+(this|the)\s+page\b/i,
  /\b(summari[sz]e|extract|scrape|crawl|screenshot|capture)\b/i,
  /\b(click|type|fill|select|scroll|navigate|go to|open|visit|browse)\b/i,
  /\b(download|upload|send|email|message|post|submit|buy|purchase|book)\b/i,
  /\b(research|compare|monitor|watch|track|find .* (on|across))\b/i,
  /\b(translate|read) (this|the)\b/i,
  /\bfor each\b|\band then\b|\bstep by step\b/i,
  /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|org|net|io|ai|app|dev|co)\b/i,
];

/** Pure heuristic: does this message need the agent (tools), or just a chat answer? */
export function classifyIntent(prompt: string): Intent {
  const text = prompt.trim();
  if (!text) return 'chat';
  return AGENT_PATTERNS.some((re) => re.test(text)) ? 'agent' : 'chat';
}

/** Apply the user's chosen mode, falling back to the heuristic in 'auto'. */
export function resolveIntent(mode: ChatMode, prompt: string): Intent {
  if (mode === 'ask') return 'chat';
  if (mode === 'agent') return 'agent';
  return classifyIntent(prompt);
}
