// M-AI e2e helpers (MCP-SPEC §9, §3 rule 4): spawn the built `ekza-animator-mcp` bin over stdio and connect an SDK
// client, reserve a free bridge port the page can be told about, and pair the editor through the UI (§5.10). P7 owns
// this file after D0; other packages add helpers through P7. The live specs spawn packages/mcp-server/dist/cli.mjs,
// so `pnpm mcp:build` (part of `pnpm test:e2e`) runs first.
import { existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, type Page } from '@playwright/test';

/** The built server (rolldown bundle of packages/mcp-server). */
export const MCP_BIN = fileURLToPath(new URL('../../../../packages/mcp-server/dist/cli.mjs', import.meta.url));

/** The e2e web server's origin, allowed on the bridge with `--allow-origin` (the default list is :3000 only). */
export function e2eOrigin(): string {
  return `http://localhost:${Number(process.env['EKZA_E2E_PORT'] ?? 3100)}`;
}

/** A free loopback port from the OS, never one of the default bridge ports 47821–47830 (real sessions use them). */
export async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const value = typeof address === 'object' && address !== null ? address.port : 0;
        server.close(() => resolve(value));
      });
    });
    if (port < 47_821 || port > 47_830) return port;
  }
}

export interface AgentServer {
  readonly client: Client;
  readonly workspace: string;
  /** The bridge port the server was started with (null with `--no-bridge`). */
  readonly bridgePort: number | null;
  /** Everything the server wrote to stderr so far. */
  stderr(): string;
  close(): Promise<void>;
}

/**
 * Spawns the built bin through StdioClientTransport and connects an SDK client: `--workspace <tmp> --bridge-port
 * <port> --allow-origin <e2e origin> --log-level warn` plus `flags`. Every spec closes its server in `afterEach`.
 */
export async function startAgentServer(opts?: {
  readonly workspace?: string;
  readonly bridgePort?: number | null;
  readonly flags?: readonly string[];
}): Promise<AgentServer> {
  if (!existsSync(MCP_BIN)) throw new Error(`${MCP_BIN} is missing: run pnpm mcp:build`);
  const workspace = opts?.workspace ?? mkdtempSync(join(tmpdir(), 'ekza-ai-e2e-'));
  const bridgePort = opts?.bridgePort === undefined ? await freePort() : opts.bridgePort;
  const args = [
    MCP_BIN,
    '--workspace',
    workspace,
    ...(bridgePort === null ? ['--no-bridge'] : ['--bridge-port', String(bridgePort)]),
    '--allow-origin',
    e2eOrigin(),
    '--log-level',
    'warn',
    ...(opts?.flags ?? []),
  ];
  const transport = new StdioClientTransport({ command: process.execPath, args, stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const client = new Client({ name: 'ekza-e2e', version: '1.0.0' });
  await client.connect(transport);
  return {
    client,
    workspace,
    bridgePort,
    stderr: () => stderr,
    close: () => client.close(),
  };
}

/** The structured envelope of a tool call (`structuredContent`, else the parsed text of an error envelope). */
export async function callTool(
  server: AgentServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await server.client.callTool({ name, arguments: args });
  if (result.structuredContent !== undefined) return result.structuredContent;
  const first = (result.content as readonly { readonly type: string; readonly text?: string }[] | undefined)?.[0];
  return first?.type === 'text' && first.text !== undefined ? (JSON.parse(first.text) as unknown) : result;
}

export type GrantName = 'read' | 'edit' | 'files' | 'workspace' | 'view';

/**
 * Pairs the open editor with the server through the UI (§5.10): reads the code from `agent-code`, claims it with
 * `editor_connect`, sets the grants in `agent-grants` and allows. The page must have been opened with
 * `?e2e=1&agentPort=<server.bridgePort>`. Needs P7 (bridge) and P8 (panel); specs gate on them with `test.fixme`.
 */
export async function pair(
  page: Page,
  server: AgentServer,
  grants: Partial<Readonly<Record<GrantName, boolean>>> = {},
): Promise<unknown> {
  const codeText = page.getByTestId('agent-code');
  await expect(codeText).toBeVisible();
  const code = (await codeText.textContent())?.trim() ?? '';
  const claimed = callTool(server, 'editor_connect', { code });
  const dialog = page.getByTestId('agent-grants');
  await expect(dialog).toBeVisible();
  for (const [grant, wanted] of Object.entries(grants) as [GrantName, boolean][]) {
    const box = dialog.getByTestId(`agent-grant-${grant}`);
    if ((await box.isChecked()) !== wanted) await box.click();
  }
  await page.getByTestId('agent-allow').click();
  return claimed;
}
