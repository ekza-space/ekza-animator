// The scripted driver (MCP-SPEC §9.3.1): a reference or adversarial script plays tool calls through a real MCP
// client ↔ server pair (`createInProcessServer` over InMemoryTransport), so schemas, budgets and error shapes are
// exercised exactly as a client sees them. Every call and its envelope go into the transcript the graders read.
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { createInProcessServer } from 'ekza-studio-mcp';

export interface Envelope {
  readonly ok: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly hint: string;
    readonly candidates?: readonly string[];
  };
  readonly undo?: { readonly step: number; readonly label: string };
  readonly warnings?: readonly string[];
  readonly clip?: Record<string, unknown>;
  readonly next?: string;
}

export interface TranscriptEntry {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly result: Envelope;
}

/** What a script sees: the agent's side of the connection. */
export interface Agent {
  /** One tool call; the envelope (success or error). */
  call(name: string, args?: Record<string, unknown>): Promise<Envelope>;
  /** One tool call that must succeed (a reference script's step); its data. */
  ok<T = Record<string, unknown>>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** Tool names the server lists. */
  readonly tools: readonly string[];
}

export interface EvalSession {
  readonly agent: Agent;
  readonly transcript: TranscriptEntry[];
  readonly workspace: string;
  /** Harness-owned calls (setup, the final save): not in the transcript. */
  harness(name: string, args?: Record<string, unknown>): Promise<Envelope>;
  close(): Promise<void>;
}

export interface EvalSessionOptions {
  readonly workspace?: string;
  readonly samplesDir?: string | null;
  readonly era?: 'legacy' | 'modern';
  readonly seed?: number | null;
}

export function tempWorkspace(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'ekza-evals-')));
}

export async function evalSession(opts: EvalSessionOptions = {}): Promise<EvalSession> {
  const workspace = opts.workspace ?? tempWorkspace();
  const server = await createInProcessServer({
    workspace,
    samplesDir: opts.samplesDir ?? null,
    seed: opts.seed ?? null,
    logLevel: 'error',
  });
  const client = new Client(
    { name: 'agent-evals', version: '1.0.0' },
    opts.era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } as never } : {},
  );
  await client.connect(server.clientTransport);
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  const transcript: TranscriptEntry[] = [];
  const raw = async (name: string, args: Record<string, unknown>): Promise<Envelope> => {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError === true) {
      const text = (result.content as { readonly text?: string }[])[0]?.text ?? '{}';
      return JSON.parse(text) as Envelope;
    }
    return result.structuredContent as unknown as Envelope;
  };
  const agent: Agent = {
    tools,
    async call(name, args = {}) {
      const result = await raw(name, args);
      transcript.push({ name, args, result });
      return result;
    },
    async ok<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const result = await agent.call(name, args);
      if (!result.ok) throw new Error(`${name} failed: ${JSON.stringify(result.error)}`);
      return result.data as T;
    },
  };
  return {
    agent,
    transcript,
    workspace,
    harness: (name, args = {}) => raw(name, args),
    async close() {
      await client.close();
      await server.close();
    },
  };
}
