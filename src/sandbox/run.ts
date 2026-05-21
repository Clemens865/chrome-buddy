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

export function runUserCode(code: string, inputs: Record<string, unknown>): SandboxResult {
  if (typeof code !== 'string' || !code.trim()) {
    return { ok: false, error: 'No code to run.' };
  }
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('inputs', `"use strict";\n${code}`);
    const result = fn(inputs ?? {});
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
