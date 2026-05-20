// Console Buddy tool registration.
//
// Exposes a single `read_console` tool that returns the most recent captured
// log snapshot so the agent can reason over console output. Registration is
// done via an exported function (the registry index is owned by another agent,
// which calls registerConsoleTools(registry) to wire this in).

import { ok, type JSONSchema } from '../types';
import type { ToolDefinition } from '../tools/types';
import type { ToolRegistry } from '../tools/registry';
import type { CaptureController, LogEntry, LogLevel } from './capture';

/** Args accepted by the read_console tool. */
interface ReadConsoleArgs {
  /** Optional level filter; omit (or 'all') to return everything. */
  level?: 'all' | LogLevel;
  /** Cap on the number of entries returned (most-recent-first). */
  limit?: number;
}

const DEFAULT_LIMIT = 50;

const readConsoleSchema: JSONSchema = {
  type: 'object',
  properties: {
    level: {
      type: 'string',
      enum: ['all', 'error', 'warn', 'log', 'net'],
      description: 'Filter to a single level, or "all" for everything.',
      default: 'all',
    },
    limit: {
      type: 'integer',
      description: `Max entries to return (default ${DEFAULT_LIMIT}).`,
      default: DEFAULT_LIMIT,
    },
  },
  required: [],
  additionalProperties: false,
};

/** PURE: apply the read_console args to a snapshot. Exported for testing. */
export function selectEntries(
  entries: readonly LogEntry[],
  args: ReadConsoleArgs,
): LogEntry[] {
  const level = args.level ?? 'all';
  const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : DEFAULT_LIMIT;
  const filtered = level === 'all' ? entries : entries.filter((e) => e.level === level);
  return filtered.slice(-limit);
}

/**
 * Register Console Buddy tools against the shared registry, reading captured
 * logs from the provided controller. Returns the registry for chaining.
 */
export function registerConsoleTools(
  registry: ToolRegistry,
  controller: CaptureController,
): ToolRegistry {
  const readConsole: ToolDefinition<ReadConsoleArgs, { entries: LogEntry[]; capturing: boolean }> = {
    name: 'read_console',
    description:
      'Return captured console logs, warnings, errors and network events from ' +
      'the current tab. Use to diagnose page errors.',
    paramsSchema: readConsoleSchema,
    consequential: false,
    handler: async (args) => {
      const entries = selectEntries(controller.snapshot(), args ?? {});
      return ok({ entries, capturing: controller.isCapturing });
    },
  };
  registry.register(readConsole as ToolDefinition);
  return registry;
}
