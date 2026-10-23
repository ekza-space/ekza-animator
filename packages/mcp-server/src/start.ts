// Starting the server (MCP-SPEC §4.6, §5.20.1, §5.22.2): stdio through SDK v2's `serveStdio` with the default
// 'serve' handling of 2025-era openings (one server answers 2025-11-25 `initialize` clients and 2026-07-28 clients);
// the process ends when stdin closes (the bridge says `bye {server}`, the projects close). The in-process server
// serves the same hub over an InMemoryTransport (tests, evals), optionally with the simulated user of §9.3.1.
import { EkzaError } from '@ekza-studio/anim-core';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { configWithDefaults, type McpServerConfig } from './config';
import type { ConfirmPolicy } from './headless/host';
import { type AgentHub, type AgentHubOptions, createAgentHub } from './hub/hub';
import type { HubBridge } from './hub/link';
import { createLogger, type Logger } from './log';
import { createMcpServerFactory } from './mcp/server';
import { InMemoryTransport, type SessionStore } from './sdk';

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
  readonly hub: AgentHub;
}

/**
 * Starts the live bridge (B2's `startBridgeServer(hub)` in ./bridge/server.ts returns a `HubBridge`) and attaches it
 * to the hub. Until B2 lands, or when every bridge port is taken, the server runs headless (the live tools answer
 * `not_connected`).
 */
async function startBridge(hub: AgentHub, log: Logger): Promise<HubBridge | null> {
  if (!hub.config.bridge.enabled) return null;
  try {
    const module = await import('./bridge/server');
    const start = module.startBridgeServer as unknown as (hub: AgentHub) => Promise<HubBridge>;
    const bridge = await start(hub);
    hub.attachBridge(bridge);
    return bridge;
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') {
      log.debug('the editor bridge is not in this build: headless only');
    } else {
      log.warn(`the editor bridge is off: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}

export async function startMcpServer(config: McpServerConfig, io?: StdioIo): Promise<RunningServer> {
  const stdio: StdioIo = io ?? { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
  const log = createLogger(config.logLevel, stdio.stderr);
  if (config.http !== null) throw new EkzaError('not-implemented', 'ekza-studio-mcp --http (not in this build)');
  const hub = await createAgentHub(config, log);
  const transport = new StdioServerTransport(stdio.stdin as never, stdio.stdout as never);
  const handle = serveStdio(createMcpServerFactory(hub), {
    transport,
    onerror: (error) => log.warn(error.message),
  });
  log.info(`workspace ${hub.sandbox.root} (${config.workspaceSource}${hub.sandbox.enabled ? '' : ', file tools off'})`);
  const bridge = await startBridge(hub, log);
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
  return { close, bridgePort: bridge?.status().port ?? null, closed, hub };
}

/** Drives the session of a headless project as a user would (§9.3.1; evals and tests only, never the CLI). */
export interface SimulatedUser {
  session(project: string): SessionStore;
  runAsUser(project: string, op: string, args: unknown): Promise<unknown>;
  answerConfirms(policy: 'allow' | 'deny'): void;
}

/** In-process server for tests (InMemoryTransport); the same hub and handlers as stdio. */
export async function createInProcessServer(
  config: Partial<McpServerConfig> & {
    readonly simulatedUser?: boolean;
    /** Tests: a fake clock for idle closes. */
    readonly now?: () => number;
  },
): Promise<{
  readonly clientTransport: InMemoryTransport;
  readonly hub: AgentHub;
  readonly close: () => Promise<void>;
  readonly user: SimulatedUser | null;
}> {
  const { simulatedUser, now, ...partial } = config;
  const full = configWithDefaults({ workspace: partial.workspace ?? process.cwd(), ...partial });
  let answer: 'allow' | 'deny' = 'deny';
  const policy: ConfirmPolicy | null = simulatedUser === true ? { current: () => answer } : null;
  const hubOptions: AgentHubOptions = {
    ...(policy === null ? {} : { simulatedUser: policy }),
    ...(now === undefined ? {} : { now }),
  };
  const hub = await createAgentHub(full, createLogger(full.logLevel, process.stderr), hubOptions);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  // the same entry as stdio (both protocol eras: the opening exchange picks one), over the in-memory pair
  const handle = serveStdio(createMcpServerFactory(hub), {
    transport: serverTransport,
    onerror: (error) => hub.log.debug(error.message),
  });
  const user: SimulatedUser | null =
    policy === null
      ? null
      : {
          session: (project) => hub.projects.get(project).app.session,
          async runAsUser(project, op, args) {
            const result = await hub.projects.get(project).app.runUntyped(op, args);
            if (result.status !== 'finished') throw new Error(`${op}: ${JSON.stringify(result)}`);
            return result.value;
          },
          answerConfirms(next) {
            answer = next;
          },
        };
  return {
    clientTransport,
    hub,
    user,
    close: async () => {
      await handle.close();
      await hub.close();
    },
  };
}
