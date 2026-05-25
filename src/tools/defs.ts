// Stub ToolDefinitions for the shared registry (FR-TOOLS-2..11).
// Schemas + consequential flags are real; handlers are intentionally not wired
// yet and throw. Wave-1 establishes the registry contract; later waves supply
// the implementations (Browser Control, PageContext, LLM client, FSA, etc.).

import { type JSONSchema } from '../types';
import type { ToolDefinition, ToolHandler } from './types';

/** A handler placeholder used by every stub until its subsystem is wired. */
function notWired(name: string): ToolHandler {
  return async () => {
    throw new Error(`Tool "${name}" is not wired yet`);
  };
}

/** Helper to build a parameters object schema with strict properties. */
function objectSchema(
  properties: Record<string, JSONSchema>,
  required: string[] = [],
): JSONSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}

// --- navigate (FR-TOOLS-2) -------------------------------------------------
export const navigateTool: ToolDefinition = {
  name: 'navigate',
  description:
    'Open or go to a URL (or run a web search query) in the target tab.',
  paramsSchema: objectSchema(
    {
      url: {
        type: 'string',
        description: 'Absolute URL to open. Provide either url or query.',
      },
      query: {
        type: 'string',
        description: 'Search query to run when no direct URL is known.',
      },
      newTab: {
        type: 'boolean',
        description: 'Open in a new tab instead of the current one.',
        default: false,
      },
    },
    [],
  ),
  consequential: false,
  handler: notWired('navigate'),
};

// --- click (FR-TOOLS-3) ----------------------------------------------------
export const clickTool: ToolDefinition = {
  name: 'click',
  description: 'Click a DOM element identified by a CSS selector or text.',
  paramsSchema: objectSchema(
    {
      selector: {
        type: 'string',
        description: 'CSS selector of the element to click.',
      },
      text: {
        type: 'string',
        description: 'Visible text to match when no selector is given.',
      },
      trusted: {
        type: 'boolean',
        description:
          'Use OS-level trusted input (CDP) for hardened sites that ignore synthetic clicks. Shows a debugging banner. Default false.',
      },
    },
    [],
  ),
  consequential: false,
  handler: notWired('click'),
};

// --- type (FR-TOOLS-3) -----------------------------------------------------
export const typeTool: ToolDefinition = {
  name: 'type',
  description: 'Type text into a focused or selected input element.',
  paramsSchema: objectSchema(
    {
      selector: {
        type: 'string',
        description: 'CSS selector of the input/textarea to type into.',
      },
      text: { type: 'string', description: 'The text to type.' },
      submit: {
        type: 'boolean',
        description: 'Press Enter after typing.',
        default: false,
      },
      trusted: {
        type: 'boolean',
        description:
          'Use OS-level trusted input (CDP) for hardened sites that ignore synthetic typing. Shows a debugging banner. Default false.',
      },
    },
    ['text'],
  ),
  consequential: false,
  handler: notWired('type'),
};

// --- scroll (FR-TOOLS-3) ---------------------------------------------------
export const scrollTool: ToolDefinition = {
  name: 'scroll',
  description: 'Scroll the page or a scrollable element.',
  paramsSchema: objectSchema(
    {
      direction: {
        type: 'string',
        enum: ['up', 'down', 'top', 'bottom'],
        description: 'Scroll direction.',
      },
      selector: {
        type: 'string',
        description: 'Optional selector of the element to scroll into view.',
      },
      amount: {
        type: 'number',
        description: 'Pixels to scroll for up/down (defaults to one viewport).',
      },
    },
    ['direction'],
  ),
  consequential: false,
  handler: notWired('scroll'),
};

// --- read_dom (FR-TOOLS-4) -------------------------------------------------
export const readDomTool: ToolDefinition = {
  name: 'read_dom',
  description:
    'Return the distilled/parsed structure of the current page via the shared PageContext service.',
  paramsSchema: objectSchema(
    {
      selector: {
        type: 'string',
        description: 'Optional selector to scope the read to a subtree.',
      },
      includeAccessibilityTree: {
        type: 'boolean',
        description: 'Include the accessibility tree alongside the DOM.',
        default: false,
      },
    },
    [],
  ),
  consequential: false,
  handler: notWired('read_dom'),
};

// --- screenshot (FR-TOOLS-5) -----------------------------------------------
export const screenshotTool: ToolDefinition = {
  name: 'screenshot',
  description:
    'Capture a screenshot of the visible viewport for vision analysis.',
  paramsSchema: objectSchema(
    {
      fullPage: {
        type: 'boolean',
        description: 'Stitch multiple captures into a full-page image.',
        default: false,
      },
    },
    [],
  ),
  consequential: false,
  handler: notWired('screenshot'),
};

// --- extract (FR-TOOLS-6) --------------------------------------------------
export const extractTool: ToolDefinition = {
  name: 'extract',
  description:
    'Extract structured data from the page conforming to a supplied response schema.',
  paramsSchema: objectSchema(
    {
      instruction: {
        type: 'string',
        description: 'What to extract (e.g. "plan name, price, period").',
      },
      responseSchema: {
        type: 'object',
        description: 'Gemini responseSchema the extracted data must conform to.',
      },
    },
    ['instruction', 'responseSchema'],
  ),
  consequential: false,
  handler: notWired('extract'),
};

// --- summarize (FR-TOOLS-7) ------------------------------------------------
export const summarizeTool: ToolDefinition = {
  name: 'summarize',
  description: 'Summarize page content or supplied text.',
  paramsSchema: objectSchema(
    {
      text: {
        type: 'string',
        description: 'Text to summarize; omit to summarize the current page.',
      },
      maxWords: {
        type: 'integer',
        description: 'Approximate maximum length of the summary in words.',
      },
    },
    [],
  ),
  consequential: false,
  handler: notWired('summarize'),
};

// --- search_web (Gemini google-search grounding) ---------------------------
export const searchWebTool: ToolDefinition = {
  name: 'search_web',
  description:
    'Search the live web for current information and return a grounded answer ' +
    'with source links. Use for anything not on the current page (news, recent events).',
  paramsSchema: objectSchema(
    {
      query: { type: 'string', description: 'The web search query.' },
    },
    ['query'],
  ),
  consequential: false,
  handler: notWired('search_web'),
};

// --- call_skill (FR-TOOLS-8) -----------------------------------------------
export const callSkillTool: ToolDefinition = {
  name: 'call_skill',
  description:
    'Discover and invoke a saved skill by id, executing its predefined steps with inputs.',
  paramsSchema: objectSchema(
    {
      skillId: { type: 'string', description: 'Id of the skill to invoke.' },
      inputs: {
        type: 'object',
        description: "Values for the skill's declared inputs.",
      },
    },
    ['skillId'],
  ),
  consequential: false,
  handler: notWired('call_skill'),
};

// --- send_webhook (FR-TOOLS-9, consequential) ------------------------------
export const sendWebhookTool: ToolDefinition = {
  name: 'send_webhook',
  description:
    'POST a payload to an external system within declared host permissions.',
  paramsSchema: objectSchema(
    {
      url: { type: 'string', description: 'Target webhook URL.' },
      payload: {
        type: 'object',
        description: 'JSON body to POST.',
      },
      headers: {
        type: 'object',
        description: 'Optional HTTP headers.',
      },
    },
    ['url', 'payload'],
  ),
  consequential: true,
  handler: notWired('send_webhook'),
};

// --- notes (private IndexedDB scratchpad — first sink in the save router) --
export const noteSaveTool: ToolDefinition = {
  name: 'note_save',
  description:
    "Save a short note (markdown or plain text) to the user's PRIVATE in-extension " +
    "notebook for quick recall later. Use when the user asks to 'remember', " +
    "'save as a note', 'jot down', or capture a fact/snippet without naming a file " +
    "or destination. NOT for files (use write_file when the user names a path or " +
    'an extension like .md/.csv/.pdf), and NOT for external destinations.',
  paramsSchema: objectSchema(
    {
      key: {
        type: 'string',
        description:
          'A short, user-meaningful slug to recall this note by (e.g. "staging-url", ' +
          '"2026-05-25-meeting"). Lowercase letters, digits, dot/dash/underscore.',
      },
      content: { type: 'string', description: 'Note body — markdown or plain text.' },
    },
    ['key', 'content'],
  ),
  consequential: false,
  handler: notWired('note_save'),
};

export const noteGetTool: ToolDefinition = {
  name: 'note_get',
  description:
    "Load a previously-saved note by its key. Use to recall something the user " +
    "asked you to remember earlier. Use note_list first if you don't know the key.",
  paramsSchema: objectSchema(
    { key: { type: 'string', description: 'The note key to look up.' } },
    ['key'],
  ),
  consequential: false,
  handler: notWired('note_get'),
};

export const noteListTool: ToolDefinition = {
  name: 'note_list',
  description:
    "List all saved note keys + short snippets, newest first. Use when the user " +
    "asks 'what did I save?' or you need to find a note whose key you don't know.",
  paramsSchema: objectSchema({}, []),
  consequential: false,
  handler: notWired('note_list'),
};

// --- github_* — write / read / list files in a user repo via Contents API --
export const githubWriteTool: ToolDefinition = {
  name: 'github_write',
  description:
    "Commit a file to a user's GitHub repo (creates or updates). Use when the " +
    'user explicitly says "save to GitHub", "commit to my repo", or names a ' +
    'repo + path. CONSEQUENTIAL — every commit passes through the HITL gate.',
  paramsSchema: objectSchema(
    {
      repo: { type: 'string', description: 'Repo in the form "owner/name" (e.g. "user/buddy-vault").' },
      path: { type: 'string', description: 'Path inside the repo (no leading slash). E.g. "notes/2026-05-25.md".' },
      content: { type: 'string', description: 'File contents to commit (UTF-8 text).' },
      message: { type: 'string', description: 'Optional commit message. Defaults to "chore: update <path> via Chrome Buddy".' },
      branch: { type: 'string', description: 'Optional branch; omitted = default branch.' },
    },
    ['repo', 'path', 'content'],
  ),
  consequential: true,
  handler: notWired('github_write'),
};

export const githubReadTool: ToolDefinition = {
  name: 'github_read',
  description: 'Read the contents of a file from a user GitHub repo. Returns UTF-8 text.',
  paramsSchema: objectSchema(
    {
      repo: { type: 'string', description: 'Repo in "owner/name" form.' },
      path: { type: 'string', description: 'Path inside the repo.' },
      ref: { type: 'string', description: 'Optional branch / tag / SHA; omit for the default branch.' },
    },
    ['repo', 'path'],
  ),
  consequential: false,
  handler: notWired('github_read'),
};

export const githubListTool: ToolDefinition = {
  name: 'github_list',
  description: 'List files and subdirectories at a path in a user GitHub repo (path omitted = root).',
  paramsSchema: objectSchema(
    {
      repo: { type: 'string', description: 'Repo in "owner/name" form.' },
      path: { type: 'string', description: 'Optional subpath; omitted = repo root.' },
      ref: { type: 'string', description: 'Optional branch / tag / SHA.' },
    },
    ['repo'],
  ),
  consequential: false,
  handler: notWired('github_list'),
};

// --- file_search (H8 — Gemini fileSearch built-in RAG) ---------------------
export const fileSearchTool: ToolDefinition = {
  name: 'file_search',
  description:
    'Answer a question by retrieving from the user-configured Gemini File ' +
    'Search store(s) — a server-side vector RAG over uploaded documents. ' +
    'Use when the user asks about content in THEIR own corpora (research ' +
    'notes, saved PDFs, indexed pages), not when they ask about a single ' +
    'specific URL (use fetch_url) or the open web (use search_web).',
  paramsSchema: objectSchema(
    {
      query: { type: 'string', description: 'Question to ask the corpus.' },
      stores: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional: list of fileSearchStores/<id> names to query. Omit to use the ' +
          "user's configured default set (Settings → File Search Stores).",
      },
    },
    ['query'],
  ),
  consequential: false,
  handler: notWired('file_search'),
};

// --- fetch_url (H6 — Gemini urlContext built-in) ---------------------------
export const fetchUrlTool: ToolDefinition = {
  name: 'fetch_url',
  description:
    'Read the contents of a PUBLIC http(s) URL (html, json, xml, csv, text, ' +
    'image, or pdf) and return what it says. Use this for "summarize this URL" / ' +
    '"extract X from this page" without leaving the side panel. Does NOT work ' +
    'with paywalled pages, YouTube, Google Docs, or localhost.',
  paramsSchema: objectSchema(
    {
      url: { type: 'string', description: 'The public http(s) URL to read.' },
      instruction: {
        type: 'string',
        description:
          'Optional: what to extract or how to summarize (e.g. "list the headline + author"). ' +
          'Omit for a general summary of the page.',
      },
    },
    ['url'],
  ),
  consequential: false,
  handler: notWired('fetch_url'),
};

// --- list_files (FR-TOOLS-10) ----------------------------------------------
export const listFilesTool: ToolDefinition = {
  name: 'list_files',
  description:
    "List the files and subfolders in the user's chosen root folder. Use this to see " +
    'what is in the folder before reading a specific file (e.g. to answer "what files are there?").',
  paramsSchema: objectSchema(
    {
      path: {
        type: 'string',
        description: 'Optional subfolder relative to the root folder. Omit to list the root.',
      },
    },
    [],
  ),
  consequential: false,
  handler: notWired('list_files'),
};

// --- read_file (FR-TOOLS-10) -----------------------------------------------
export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description:
    'Read a file from the user-selected root folder (File System Access). Use list_files first ' +
    'if you do not know the exact filename.',
  paramsSchema: objectSchema(
    {
      path: {
        type: 'string',
        description: 'Path relative to the root folder.',
      },
    },
    ['path'],
  ),
  consequential: false,
  handler: notWired('read_file'),
};

// --- write_file (FR-TOOLS-10, consequential) -------------------------------
export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description:
    "Save text content to a file in the user's chosen root folder (or Downloads if no " +
    'folder is set). Use for exporting results, notes, CSV, or code. Requires user confirmation.',
  paramsSchema: objectSchema(
    {
      path: {
        type: 'string',
        description:
          'Filename relative to the chosen root folder (e.g. "notes.txt" or "data/out.csv"). ' +
          "Do NOT include the root folder's own name — files are already saved inside it.",
      },
      contents: { type: 'string', description: 'File contents to write.' },
    },
    ['path', 'contents'],
  ),
  consequential: true,
  handler: notWired('write_file'),
};

// --- analyze_errors (Console-Buddy parity, Tier 1) -------------------------
export const analyzeErrorsTool: ToolDefinition = {
  name: 'analyze_errors',
  description:
    'Scan the recent console-capture buffer for the active page and return a ' +
    'framework-aware diagnosis of any errors found (React / Vue / Angular / ' +
    'Network / CORS / Security / Type / Syntax / Reference / Performance). Each ' +
    'match includes a description and a fix suggestion. Use this when the user ' +
    'asks "what is broken on this page?" or to triage console output.',
  paramsSchema: objectSchema(
    {
      limit: {
        type: 'number',
        description: 'Max number of recent console entries to scan (default 200).',
      },
    },
    [],
  ),
  consequential: false,
  handler: notWired('analyze_errors'),
};

// --- web_vitals (Console-Buddy parity, Tier 1) -----------------------------
export const webVitalsTool: ToolDefinition = {
  name: 'web_vitals',
  description:
    'Measure the Core Web Vitals (LCP, FID, CLS, FCP, TTFB) of the active web ' +
    'page using PerformanceObserver. Returns each metric with the captured value ' +
    'and a verdict (good / needs-improvement / poor) based on Google thresholds.',
  paramsSchema: objectSchema({}, []),
  consequential: false,
  handler: notWired('web_vitals'),
};

// --- read_network (Console-Buddy parity, Tier 1) ---------------------------
export const readNetworkTool: ToolDefinition = {
  name: 'read_network',
  description:
    'Return the recent network requests captured by the console inspector on ' +
    'the active page (status, URL, type). Use to investigate failed requests, ' +
    'slow endpoints, or CORS issues. Pass filter="failed" to surface only 4xx/5xx.',
  paramsSchema: objectSchema(
    {
      filter: {
        type: 'string',
        description: 'Optional filter: "failed" (4xx/5xx only) or "errors".',
      },
      limit: {
        type: 'number',
        description: 'Max number of requests to return (default 50).',
      },
    },
    [],
  ),
  consequential: false,
  handler: notWired('read_network'),
};

// --- scan_security (Console-Buddy parity, Tier 1) --------------------------
export const scanSecurityTool: ToolDefinition = {
  name: 'scan_security',
  description:
    'Run a quick security inspection of the active page: HTTPS / mixed content, ' +
    'Content-Security-Policy meta tag, and cookies flagged for missing Secure / ' +
    'HttpOnly / SameSite attributes.',
  paramsSchema: objectSchema({}, []),
  consequential: false,
  handler: notWired('scan_security'),
};

// --- read_storage (Console-Buddy parity, Tier 2) ---------------------------
export const readStorageTool: ToolDefinition = {
  name: 'read_storage',
  description:
    "Inspect the active page's localStorage, sessionStorage, and cookies. " +
    'Returns aggregate counts, total bytes, the top-N largest entries, and a ' +
    'list of keys flagged as token / credential / PII by name. Values are ' +
    'NEVER returned in cleartext — only a shape preview ("jwt-ish 247 chars").',
  paramsSchema: objectSchema(
    {
      limit: { type: 'number', description: 'Max number of top entries to return (default 10).' },
    },
    [],
  ),
  consequential: false,
  handler: notWired('read_storage'),
};

// --- scan_sensitive_data (Console-Buddy parity, Tier 2) --------------------
export const scanSensitiveDataTool: ToolDefinition = {
  name: 'scan_sensitive_data',
  description:
    "Scan the active page's storage values AND visible body text for leaked " +
    'secrets (API keys, JWTs, AWS keys, PEM private keys, Stripe/GitHub/Slack ' +
    'tokens), and PII (credit cards w/ Luhn, emails, phone numbers). Matched ' +
    'values are returned in redacted form (first 4 + last 4 chars only).',
  paramsSchema: objectSchema({}, []),
  consequential: false,
  handler: notWired('scan_sensitive_data'),
};

// --- detect_tech_stack (Console-Buddy parity, Tier 2) ----------------------
export const detectTechStackTool: ToolDefinition = {
  name: 'detect_tech_stack',
  description:
    'Identify which frontend frameworks, UI libraries, CSS frameworks, ' +
    'analytics tools, and CDN/hosts are in use on the active page. Uses ' +
    'Wappalyzer-style fingerprinting (window globals, script src, link href, ' +
    'meta generator, cookies). Returns matches with evidence per signal.',
  paramsSchema: objectSchema({}, []),
  consequential: false,
  handler: notWired('detect_tech_stack'),
};

// --- analyze_a11y (Console-Buddy parity, Tier 2) ---------------------------
export const analyzeA11yTool: ToolDefinition = {
  name: 'analyze_a11y',
  description:
    'Audit the active page for common accessibility issues: missing img alt, ' +
    'unlabeled form controls, missing <html lang>, missing <title>, heading ' +
    'order jumps, no <h1>, unlabeled buttons / links. Returns severity-sorted ' +
    'issues with fix suggestions.',
  paramsSchema: objectSchema({}, []),
  consequential: false,
  handler: notWired('analyze_a11y'),
};

// --- analyze_seo (Console-Buddy parity, Tier 3) ----------------------------
export const analyzeSeoTool: ToolDefinition = {
  name: 'analyze_seo',
  description:
    'Audit the active page for SEO best practices: title length, meta ' +
    'description, viewport, canonical URL, Open Graph + Twitter Card tags, ' +
    'heading structure (one h1), structured data (JSON-LD validity), robots ' +
    'directive, lang attribute. Returns an overall 0-100 score and a sorted ' +
    'list of issues with fix suggestions.',
  paramsSchema: objectSchema({}, []),
  consequential: false,
  handler: notWired('analyze_seo'),
};

// --- ask_user (FR-TOOLS-11) ------------------------------------------------
export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  description:
    'ONLY for asking the USER a question to obtain INPUT you do not already have ' +
    '(e.g. a missing parameter, an ambiguous choice). DO NOT use this tool to ' +
    'deliver, announce, or report a final answer back to the user — for that, ' +
    'return plain text with no tool call and the synthesis step will format the ' +
    'reply. Calling ask_user with a statement instead of a question is incorrect.',
  paramsSchema: objectSchema(
    {
      question: { type: 'string', description: 'The question to ask.' },
      choices: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of choices to present.',
      },
    },
    ['question'],
  ),
  consequential: false,
  handler: notWired('ask_user'),
};

/** All stub tool definitions, in registry order. */
export const stubToolDefs: ToolDefinition[] = [
  navigateTool,
  clickTool,
  typeTool,
  scrollTool,
  readDomTool,
  screenshotTool,
  extractTool,
  summarizeTool,
  searchWebTool,
  callSkillTool,
  sendWebhookTool,
  fetchUrlTool,
  fileSearchTool,
  githubWriteTool,
  githubReadTool,
  githubListTool,
  noteSaveTool,
  noteGetTool,
  noteListTool,
  listFilesTool,
  readFileTool,
  writeFileTool,
  analyzeErrorsTool,
  webVitalsTool,
  readNetworkTool,
  scanSecurityTool,
  readStorageTool,
  scanSensitiveDataTool,
  detectTechStackTool,
  analyzeA11yTool,
  analyzeSeoTool,
  askUserTool,
];
