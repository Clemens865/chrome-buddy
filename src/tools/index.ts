// Barrel for the shared Tool Registry.

export * from './types';
export * from './registry';
export * from './defs';

import { ToolRegistry } from './registry';
import { stubToolDefs } from './defs';

/**
 * Create a registry pre-populated with the stub tool definitions.
 * This is the one source of capabilities consumed by apps, the agent, and
 * skills (FR-TOOLS-1). Handlers are wired up in later waves.
 */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const def of stubToolDefs) {
    registry.register(def);
  }
  return registry;
}
