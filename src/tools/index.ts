// Barrel for the shared Tool Registry.

export * from './types';
export * from './registry';
export * from './defs';

import { ToolRegistry } from './registry';
import { stubToolDefs } from './defs';
import { registerConsoleTools, consoleController } from '../console';
import { registerImageTools } from '../image';

/**
 * Create a registry pre-populated with the stub tool definitions plus the
 * capabilities contributed by the micro-apps (Console Inspector, Image Studio).
 * This is the one source of capabilities consumed by apps, the agent, and
 * skills (FR-TOOLS-1) — "build a capability once, expose it three ways".
 */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const def of stubToolDefs) {
    registry.register(def);
  }
  registerConsoleTools(registry, consoleController());
  registerImageTools(registry);
  return registry;
}
