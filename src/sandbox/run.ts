// The actual execution of generated Tier-2 code. Lives in (and only runs in)
// the opaque-origin sandboxed iframe — zero ambient authority: no extension
// APIs, no same-origin DOM, no network unless the host bridge grants it.
//
// Generated code is the BODY of a function `(inputs) => ...` that must `return`
// its output. We run it with `new Function`, which is why this only ever
// executes inside the sandbox page (exempt from the extension CSP).
export interface SandboxResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * The capability bridge handed to sandboxed code: a map of host-exposed ops the
 * code may `await` (FR-T2-3). Each call is authorized + executed by the host;
 * the sandbox itself has zero ambient authority.
 */
export type SandboxBridge = Record<string, (args?: unknown) => Promise<unknown>>;

export async function runUserCode(
  code: string,
  inputs: Record<string, unknown>,
  bridge: SandboxBridge = {},
): Promise<SandboxResult> {
  if (typeof code !== 'string' || !code.trim()) {
    return { ok: false, error: 'No code to run.' };
  }
  try {
    // Async function body so generated code can `await bridge.gemini(...)`.
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as (
      ...args: string[]
    ) => (inputs: unknown, bridge: SandboxBridge) => Promise<unknown>;
    const fn = AsyncFunction('inputs', 'bridge', `"use strict";\n${code}`);
    const result = await fn(inputs ?? {}, bridge);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
