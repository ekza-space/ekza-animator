// MCP-SPEC §8 D0 DoD and §5.22.2: the built bin starts over stdio, answers tools/list with the ready tools (none in
// D0: an empty list), writes nothing but MCP to stdout, and exits when stdin closes. Needs `pnpm mcp:build` first
// (turbo runs the build before this package's tests).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';
import { SERVER_VERSION } from '../src';

const BIN = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
const built = existsSync(BIN);

interface PackageJson {
  readonly version: string;
  readonly bin: Readonly<Record<string, string>>;
  readonly files: readonly string[];
  readonly exports?: unknown;
  readonly publishConfig?: Readonly<Record<string, unknown>>;
  readonly dependencies?: unknown;
  readonly [field: string]: unknown;
}

const PKG = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as PackageJson;

/** Every file path an exports map names (conditions and subpaths, depth first). */
function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap(exportTargets);
}

describe('package', () => {
  it('states its version in src/version.ts', () => {
    expect(SERVER_VERSION).toBe(PKG.version);
    expect(PKG.bin).toEqual({ 'ekza-studio-mcp': 'dist/cli.mjs' });
  });

  it('publishes a manifest whose entry points are all in `files` and that has no dependencies (§2)', () => {
    // pnpm pack/publish replace top-level fields with publishConfig's (the workspace keeps `exports` on src/ for
    // the evals and tests; the published package is a bin and exports only its package.json).
    const { publishConfig, ...rest } = PKG;
    const published: Readonly<Record<string, unknown>> = { ...rest, ...publishConfig };
    const shipped = new Set([...PKG.files, 'package.json'].map((file) => file.replace(/^\.\//, '')));
    const entryPoints = [
      ...Object.values(PKG.bin),
      ...exportTargets(published['exports']),
      ...['main', 'module', 'types', 'typings'].flatMap((field) => exportTargets(published[field])),
    ].map((file) => file.replace(/^\.\//, ''));
    expect(entryPoints.filter((file) => !shipped.has(file))).toEqual([]);
    expect(published['dependencies']).toBeUndefined();
  });
});

describe.skipIf(!built)('the built bin (run pnpm mcp:build first)', () => {
  it('prints its version and refuses unknown options', () => {
    const version = spawnSync(process.execPath, [BIN, '--version'], { encoding: 'utf8' });
    expect(version.stdout.trim()).toBe(SERVER_VERSION);
    const bad = spawnSync(process.execPath, [BIN, '--frobnicate'], { encoding: 'utf8' });
    expect(bad.status).toBe(2);
    expect(bad.stdout).toBe('');
    expect(bad.stderr).toContain('unknown option --frobnicate');
  });

  it('lists no tools yet, then exits when stdin closes', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'ekza-mcp-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN, '--no-bridge', '--workspace', workspace, '--log-level', 'warn'],
      stderr: 'pipe',
    });
    const client = new Client({ name: 'cli-test', version: '1.0.0' });
    await client.connect(transport);
    expect(client.getServerVersion()).toMatchObject({
      name: 'ekza-animator',
      title: 'Ekza Animator',
      version: SERVER_VERSION,
    });
    expect(client.getInstructions()?.length ?? 0).toBeGreaterThan(100);
    const { tools } = await client.listTools();
    expect(tools).toEqual([]);
    const pid = transport.pid;
    await client.close();
    expect(pid).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(() => process.kill(pid as number, 0)).toThrow(/ESRCH/);
  });

  it('writes only JSON-RPC to stdout and exits 0 on EOF', async () => {
    const child = spawn(process.execPath, [BIN, '--no-bridge', '--workspace', tmpdir()], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      })}\n`,
    );
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    child.stdin.end();
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines.map((line) => (JSON.parse(line) as { jsonrpc: string }).jsonrpc)).toEqual(['2.0', '2.0']);
    expect((JSON.parse(lines[1] as string) as { result: { tools: unknown[] } }).result.tools).toEqual([]);
  });
});
