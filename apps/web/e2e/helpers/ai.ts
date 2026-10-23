// M-AI e2e helpers (MCP-SPEC §9, §3 rule 4): spawn the built `ekza-studio-mcp` bin over stdio and connect an SDK
// client, reserve a free bridge port the page can be told about, and pair the editor through the UI (§5.10). P7 owns
// this file after D0; other packages add helpers through P7. The live specs spawn packages/mcp-server/dist/cli.mjs,
// so `pnpm mcp:build` (part of `pnpm test:e2e`) runs first.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
  /** Closes the client (the server exits with stdin) and removes the workspace when the helper created it. */
  close(): Promise<void>;
}

/**
 * Spawns the built bin through StdioClientTransport and connects an SDK client: `--workspace <tmp> --bridge-port
 * <port> --allow-origin <e2e origin> --log-level warn` plus `flags`. Every spec closes its server in `afterEach`;
 * `close()` removes a workspace the helper created (a caller's own `workspace` stays).
 */
export async function startAgentServer(opts?: {
  readonly workspace?: string;
  readonly bridgePort?: number | null;
  readonly flags?: readonly string[];
}): Promise<AgentServer> {
  if (!existsSync(MCP_BIN)) throw new Error(`${MCP_BIN} is missing: run pnpm mcp:build`);
  const ownWorkspace = opts?.workspace === undefined;
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
    async close() {
      try {
        await client.close();
      } finally {
        if (ownWorkspace) rmSync(workspace, { recursive: true, force: true });
      }
    },
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

/** A tool envelope as the server answers it (structuredContent or the error text). */
export interface ToolEnvelope<T = Record<string, unknown>> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string; readonly hint?: string };
  readonly undo?: { readonly step: number; readonly label: string };
  readonly warnings?: readonly string[];
  readonly next?: string;
}

/** A tool call with its image blocks (base64) next to the envelope (INT: view_capture over the bridge). */
export async function callToolRaw(
  server: AgentServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ envelope: ToolEnvelope; images: { mimeType: string; data: string }[] }> {
  const result = await server.client.callTool({ name, arguments: args });
  const content = (result.content ?? []) as readonly {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }[];
  const images = content
    .filter((block) => block.type === 'image')
    .map((block) => ({ mimeType: block.mimeType ?? '', data: block.data ?? '' }));
  const first = content.find((block) => block.type === 'text');
  const envelope = (result.structuredContent ??
    (first?.text === undefined ? { ok: false } : JSON.parse(first.text))) as ToolEnvelope;
  return { envelope, images };
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

/** The agent session as the test API reports it (null while none exists). */
export async function agentState(
  page: Page,
): Promise<ReturnType<NonNullable<Window['__EKZA_STUDIO_TEST__']>['agent']>> {
  return page.evaluate(() => window.__EKZA_STUDIO_TEST__?.agent() ?? null);
}

/**
 * Pairs through the session itself (B2, M-AI-B2-3): waits for the code the server sent the page (`?agentPort=`
 * connects at start), claims it with `editor_connect`, and answers the grants dialog with `agentAct('accept')` — the
 * same session calls the Agent panel's dialog makes. `pair()` above does it through the panel's UI once P8/B3 merged.
 */
export async function pairViaTestApi(
  page: Page,
  server: AgentServer,
  grants: Partial<Readonly<Record<Exclude<GrantName, 'read'>, boolean>>> = {},
): Promise<unknown> {
  await expect.poll(async () => (await agentState(page))?.status, { timeout: 15_000 }).toBe('offering');
  const code = (await agentState(page))?.code ?? '';
  expect(code).toMatch(/^[A-HJKMNP-Z2-9]{3}-[A-HJKMNP-Z2-9]{3}$/);
  const claimed = callTool(server, 'editor_connect', { code });
  await expect.poll(async () => (await agentState(page))?.status).toBe('claimed');
  await page.evaluate(async (g) => window.__EKZA_STUDIO_TEST__?.agentAct('accept', g), grants);
  return claimed;
}

/** The clips of the active character, or null when the scene has no character (`clips()` fails then). */
export async function clipsOrNone(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    try {
      const value = window.__EKZA_STUDIO_TEST__?.clips() as unknown;
      return typeof value === 'object' && value !== null && '__failure' in value ? null : (value ?? null);
    } catch {
      return null;
    }
  });
}
