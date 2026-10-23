// Helpers of the server tests: temporary workspaces, an SDK client over the in-process server in either protocol era,
// and tool calls that return the envelope (structuredContent on success, the text envelope on isError).
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { expect } from 'vitest';
import { createInProcessServer, type McpServerConfig } from '../src';

export type Era = 'legacy' | 'modern';

/** A fresh folder under the OS temp folder (realpath'd: macOS /var → /private/var). */
export function tempWorkspace(prefix = 'ekza-ws-'): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export interface Envelope {
  readonly ok: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: { readonly code: string; readonly message: string; readonly hint: string };
  readonly undo?: { readonly step: number; readonly label: string };
  readonly warnings?: readonly string[];
  readonly next?: string;
  readonly clip?: Record<string, unknown>;
}

export interface Session {
  readonly client: Client;
  readonly server: Awaited<ReturnType<typeof createInProcessServer>>;
  call(name: string, args?: Record<string, unknown>): Promise<Envelope>;
  /** The data of a successful call; throws with the error otherwise. */
  ok<T = Record<string, unknown>>(name: string, args?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

export async function connect(
  config: Partial<McpServerConfig> & { readonly simulatedUser?: boolean; readonly now?: () => number },
  era: Era = 'legacy',
): Promise<Session> {
  const server = await createInProcessServer({ logLevel: 'error', ...config });
  const client = new Client(
    { name: 'server-test', version: '1.0.0' },
    era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  );
  await client.connect(server.clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Envelope> => {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError === true) {
      expect(result.structuredContent).toBeUndefined();
      const text = (result.content as { type: string; text: string }[])[0]?.text ?? '{}';
      return JSON.parse(text) as Envelope;
    }
    const structured: unknown = result.structuredContent;
    return structured as Envelope;
  };
  return {
    client,
    server,
    call,
    async ok<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const envelope = await call(name, args);
      if (!envelope.ok) throw new Error(`${name} failed: ${JSON.stringify(envelope.error)}`);
      return envelope.data as T;
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** The wave script of E2E-AI-01 step 5 (MCP-SPEC §9.1; the AE-01 reference): a checkpoint, a 2 s clip, 7 aims. */
export async function waveScript(session: Session, project?: string): Promise<void> {
  const p = project === undefined ? {} : { project };
  await session.ok('history_checkpoint', { ...p, label: 'Wave left hand ×3' });
  await session.ok('clip_create', { ...p, name: 'wave', fps: 30, durationSeconds: 2 });
  for (let i = 0; i <= 6; i++) {
    await session.ok('pose_aim', {
      ...p,
      clip: 'wave',
      frame: 10 * i,
      aims: [
        { bone: 'leftUpperArm', direction: [0.8, 0.6, 0] },
        { bone: 'leftLowerArm', direction: i % 2 === 0 ? [0.55, 0.83, 0.1] : [-0.25, 0.97, 0.1] },
      ],
    });
  }
}
