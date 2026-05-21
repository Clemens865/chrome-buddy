// Chat routing: decide whether a message needs the full agentic loop (tools +
// plan→act→observe→reflect) or just a cheap, tool-less plain answer.
//
// 'auto' uses a pure heuristic biased toward the cheap path — a simple question
// gets a plain answer (no tool declarations, cheaper model), while page/action
// intent runs the agent. 'ask' / 'agent' force a lane. The composer exposes all
// three so the user can override a misroute.

export type ChatMode = 'auto' | 'ask' | 'agent';
export type Intent = 'chat' | 'agent';

// Signals the user wants Buddy to ACT (not just read) or run a multi-step /
// multi-source task — i.e. genuinely needs the agent loop + tools.
//
// Note: plain "read/understand THIS page" requests (summarize, extract, "can you
// see this page") are intentionally NOT here — chat mode already attaches the
// page content, so it answers those directly and cheaply without the agent.
const AGENT_PATTERNS: RegExp[] = [
  /\b(click|type|fill|select|scroll|navigate|go to|open|visit|browse|press|submit|log ?in|sign ?in)\b/i,
  /\b(download|upload|send|email|message|post|buy|purchase|book|order|schedule|delete|reply to)\b/i,
  /\b(research|compare|monitor|watch|track)\b/i,
  // Web search (uses the search_web tool, not the current page).
  /\bsearch (the web|online|for|google)\b/i,
  /\b(find|look up|latest|recent|newest)\b[^.]*\b(news|articles|papers|posts|releases|updates)\b/i,
  /\b(across|multiple|several)\b[^.]*\b(sites|pages|tabs|websites)\b/i,
  /\bfor each\b|\band then\b|\bstep by step\b/i,
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
