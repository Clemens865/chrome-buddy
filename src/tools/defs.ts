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

// --- read_file (FR-TOOLS-10) -----------------------------------------------
export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read a file from the user-selected root folder (File System Access).',
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
    'Write or overwrite a file in the user-selected root folder (File System Access).',
  paramsSchema: objectSchema(
    {
      path: {
        type: 'string',
        description: 'Path relative to the root folder.',
      },
      contents: { type: 'string', description: 'File contents to write.' },
    },
    ['path', 'contents'],
  ),
  consequential: true,
  handler: notWired('write_file'),
};

// --- ask_user (FR-TOOLS-11) ------------------------------------------------
export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  description:
    'Pause the run and surface a question or choice in the panel; resume on the answer.',
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
  readFileTool,
  writeFileTool,
  askUserTool,
];
