// MCP-SPEC §9.3 (D0): the package is wired — the in-process server and the tool catalogue are reachable; P9 replaces
// this with the CI modes.
import { allTools, lintTools } from '@ekza-animator/agent-tools';
import { Client } from '@modelcontextprotocol/client';
import { createInProcessServer } from 'ekza-animator-mcp';
import { describe, expect, it } from 'vitest';
import { CI_MODES, TASK_IDS } from '../src';
import { READY } from './ready';

describe('agent-evals scaffold', () => {
  it('names the 25 tasks and the CI modes', () => {
    expect(TASK_IDS).toHaveLength(25);
    expect(TASK_IDS[0]).toBe('AE-01');
    expect(CI_MODES).toContain('schema-lint');
  });

  it('runs the schema-lint mode over every tool definition', () => {
    expect(lintTools(allTools())).toEqual([]);
  });

  it.skipIf(READY.p9)('reaches the in-process server through an SDK client', async () => {
    const server = await createInProcessServer({ workspace: '/tmp/ekza-evals', logLevel: 'error' });
    const client = new Client({ name: 'agent-evals', version: '0.0.0' });
    await client.connect(server.clientTransport);
    expect(Array.isArray((await client.listTools()).tools)).toBe(true);
    await client.close();
    await server.close();
  });
});
