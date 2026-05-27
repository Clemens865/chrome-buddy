// Tests for the agent-side MCP integration: namespacing, routing through
// TOOL_EXEC, and the consequential flag derived from per-tool trust.
//
// We don't reach the real SW handler here — instead we install a fake `send`
// that captures the messages the registry handler would dispatch and returns
// canned results. This locks: (a) the namespaced name is what the handler
// uses to call TOOL_EXEC and (b) trust='always' → consequential=false.
import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../tools/registry';
import { collectMcpBindings } from './merger';
import type { McpServer } from './store';

function makeServer(over: Partial<McpServer> = {}): McpServer {
  return {
    id: 'sv1',
    name: 'Stub',
    url: 'https://stub.example/mcp',
    authKind: 'bearer',
    createdAt: 0,
    updatedAt: 0,
    enabledInAgent: true,
    tools: [
      { name: 'list_issues', description: 'List issues', inputSchema: { type: 'object' } },
      { name: 'create_issue', description: 'Create an issue', inputSchema: { type: 'object' } },
    ],
    ...over,
  };
}

/** A miniature copy of the runner's injection step, parameterized for testing.
 *  Mirrors the production logic in src/agent/runner.ts injectMcpTools. */
function injectInto(
  registry: ToolRegistry,
  servers: McpServer[],
  handlerFactory: (name: string) => (args: Record<string, unknown>) => Promise<unknown>,
) {
  for (const b of collectMcpBindings(servers)) {
    if (registry.has(b.declaration.name)) continue;
    registry.register({
      name: b.declaration.name,
      description: b.declaration.description,
      paramsSchema: b.declaration.parameters,
      consequential: b.trust !== 'always',
      // The real handler dispatches TOOL_EXEC; here we just record + canned.
      handler: handlerFactory(b.declaration.name) as never,
    });
  }
}

describe('agent-side MCP injection', () => {
  it('registers one tool per enabled binding with the namespaced name', () => {
    const r = new ToolRegistry();
    injectInto(r, [makeServer()], () => async () => ({ ok: true, data: 'x' }));
    expect(r.has('mcp__sv1__list_issues')).toBe(true);
    expect(r.has('mcp__sv1__create_issue')).toBe(true);
    // Original non-namespaced names must NOT be registered (otherwise two
    // servers with a 'search' tool would collide).
    expect(r.has('list_issues')).toBe(false);
  });

  it('registers nothing when the server is disabled', () => {
    const r = new ToolRegistry();
    injectInto(r, [makeServer({ enabledInAgent: false })], () => async () => ({ ok: true }));
    expect(r.has('mcp__sv1__list_issues')).toBe(false);
    expect(r.has('mcp__sv1__create_issue')).toBe(false);
  });

  it('honors per-tool toolFilter — deselected tools never register', () => {
    const r = new ToolRegistry();
    injectInto(
      r,
      [makeServer({ toolFilter: { create_issue: false } })],
      () => async () => ({ ok: true }),
    );
    expect(r.has('mcp__sv1__list_issues')).toBe(true);
    expect(r.has('mcp__sv1__create_issue')).toBe(false);
  });

  it("marks the tool consequential by default and consequential=false only when trust='always'", () => {
    const r = new ToolRegistry();
    injectInto(
      r,
      [makeServer({ trust: { list_issues: 'always' } })],
      () => async () => ({ ok: true }),
    );
    const trusted = r.get('mcp__sv1__list_issues')!;
    const notTrusted = r.get('mcp__sv1__create_issue')!;
    expect(trusted.consequential).toBe(false);
    expect(notTrusted.consequential).toBe(true);
  });

  it('handler dispatches with the namespaced name (proxy for TOOL_EXEC routing)', async () => {
    const r = new ToolRegistry();
    const sent: string[] = [];
    injectInto(
      r,
      [makeServer()],
      (name) => async () => {
        sent.push(name);
        return { ok: true, data: { text: 'result' } };
      },
    );
    // Direct handler call — the real path uses registry.invoke with HITL.
    const tool = r.get('mcp__sv1__list_issues')!;
    await tool.handler({ owner: 'x' }, { caller: 'agent', approved: true });
    expect(sent).toEqual(['mcp__sv1__list_issues']);
  });
});
