// Starting the server (MCP-SPEC §4.6, §5.20.1, §5.22.2): stdio through SDK v2's `serveStdio` with the default
// 'serve' handling of 2025-era openings (one server answers 2025-11-25 `initialize` clients and 2026-07-28 clients);
// the process ends when stdin closes. The in-process server serves the same hub over an InMemoryTransport (tests,
// evals). The bridge (P7) and `--http` (P6) start here when enabled.
import { InMemoryTransport, type SessionStore } from './sdk';
import { configWithDefaults, type McpServerConfig } from './config';
import { type AgentHub, createAgentHub } from './hub/hub';
import { createLogger } from './log';
import { createMcpServerFactory } from './mcp/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { EkzaError } from '@ekza-studio/anim-core';

export interface StdioIo {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
}

export interface RunningServer {
  readonly close: () => Promise<void>;
  readonly bridgePort: number | null;
  /** Resolves when the server stopped (stdin closed or `close()`). */
  readonly closed: Promise<void>;
}

export async function startMcpServer(config: McpServerConfig, io?: StdioIo): Promise<RunningServer> {
  const stdio: StdioIo = io ?? { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
  const log = createLogger(config.logLevel, stdio.stderr);
  if (config.http !== null) throw new EkzaError('not-implemented', 'ekza-studio-mcp --http (P6)');
  const hub = createAgentHub(config, log);
  const transport = new StdioServerTransport(stdio.stdin as never, stdio.stdout as never);
  const handle = serveStdio(createMcpServerFactory(hub), {
    transport,
    onerror: (error) => log.warn(error.message),
  });
  log.info(`workspace ${config.workspace} (${config.workspaceSource})`);
  let done = false;
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const close = async (): Promise<void> => {
    if (done) return;
    done = true;
    await handle.close();
    await hub.close();
    resolveClosed();
  };
  // §5.22.2: the process exits when stdin closes.
  stdio.stdin.once('end', () => void close());
  stdio.stdin.once('close', () => void close());
  return { close, bridgePort: null, closed };
}

/** Drives the session of a headless project as a user would (§9.3.1; evals and tests only, never the CLI). */
export interface SimulatedUser {
  session(project: string): SessionStore;
  runAsUser(project: string, op: string, args: unknown): Promise<unknown>;
  answerConfirms(policy: 'allow' | 'deny'): void;
}

/** In-process server for tests (InMemoryTransport); the same hub and handlers as stdio. */
export async function createInProcessServer(
  config: Partial<McpServerConfig> & { readonly simulatedUser?: boolean },
): Promise<{
  readonly clientTransport: InMemoryTransport;
  readonly hub: AgentHub;
  readonly close: () => Promise<void>;
  readonly user: SimulatedUser | null;
}> {
  const { simulatedUser, ...partial } = config;
  if (simulatedUser === true) throw new EkzaError('not-implemented', 'ekza-studio-mcp simulatedUser (P6)');
  const full = configWithDefaults({ workspace: partial.workspace ?? '/nonexistent-workspace', ...partial });
  const hub = createAgentHub(full, createLogger(full.logLevel, process.stderr));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = await createMcpServerFactory(hub)({} as never);
  await server.connect(serverTransport);
  return {
    clientTransport,
    hub,
    user: null,
    close: async () => {
      await server.close();
      await hub.close();
    },
  };
}
