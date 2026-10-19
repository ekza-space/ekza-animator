// MCP-SPEC §4.6, §5.20 (D0): the in-process server answers an SDK client over InMemoryTransport with the same hub —
// identity, instructions, an empty tool list in D0, unknown tools as protocol errors, empty resources and prompts.
import { Client } from '@modelcontextprotocol/client';
import { SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_MAX_CHARS } from '@ekza-animator/agent-tools';
import { describe, expect, it } from 'vitest';
import { createInProcessServer, parseArgs, SERVER_VERSION } from '../src';

describe('in-process server (MCP-SPEC §4.6)', () => {
  it('serves the hub to an SDK client', async () => {
    const server = await createInProcessServer({ workspace: '/tmp/ekza-test', logLevel: 'error' });
    const client = new Client({ name: 'in-process', version: '1.0.0' });
    await client.connect(server.clientTransport);
    expect(client.getServerVersion()).toMatchObject({ name: 'ekza-animator', version: SERVER_VERSION });
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect((await client.listTools()).tools).toEqual([]);
    await expect(client.callTool({ name: 'scene_summary', arguments: {} })).rejects.toThrow(/not found/);
    expect((await client.listResources()).resources).toEqual([]);
    expect((await client.listPrompts()).prompts).toEqual([]);
    await client.close();
    await server.close();
  });

  it('keeps the server instructions within 2,000 characters', () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(SERVER_INSTRUCTIONS_MAX_CHARS);
  });
});

describe('command-line arguments (MCP-SPEC §5.22.2)', () => {
  const env = {};
  it('defaults the workspace to $CLAUDE_PROJECT_DIR, else the current folder', () => {
    const flag = parseArgs(['--workspace', 'proj'], { CLAUDE_PROJECT_DIR: '/env/dir' }, '/cwd');
    expect(flag).toMatchObject({ kind: 'serve', config: { workspace: '/cwd/proj', workspaceSource: 'flag' } });
    expect(parseArgs([], { CLAUDE_PROJECT_DIR: '/env/dir' }, '/cwd')).toMatchObject({
      config: { workspace: '/env/dir', workspaceSource: 'env' },
    });
    expect(parseArgs([], env, '/cwd')).toMatchObject({ config: { workspace: '/cwd', workspaceSource: 'cwd' } });
  });

  it('parses the bridge, origins, limits and testing flags', () => {
    const parsed = parseArgs(
      [
        '--bridge-port',
        '0',
        '--allow-origin',
        'http://localhost:3270',
        '--max-projects',
        '2',
        '--seed',
        '7',
        '--log-level',
        'debug',
        '--pairing-ttl-ms',
        '3000',
        '--validate',
      ],
      { EKZA_MCP_ALLOWED_ORIGINS: 'http://a:1, http://b:2' },
      '/cwd',
    );
    expect(parsed).toMatchObject({
      kind: 'serve',
      config: {
        bridge: { enabled: true, port: 0, pairingTtlMs: 3_000 },
        maxProjects: 2,
        seed: 7,
        logLevel: 'debug',
        validate: true,
      },
    });
    if (parsed.kind !== 'serve') throw new Error('not serve');
    expect(parsed.config.bridge.allowedOrigins).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
      'http://a:1',
      'http://b:2',
      'http://localhost:3270',
    ]);
    expect(parseArgs(['--no-bridge'], env, '/cwd')).toMatchObject({ config: { bridge: { enabled: false } } });
  });

  it('refuses bad values and unknown options; there is no --token flag', () => {
    expect(parseArgs(['--log-level', 'loud'], env, '/')).toMatchObject({ kind: 'error' });
    expect(parseArgs(['--bridge-port', '70000'], env, '/')).toMatchObject({ kind: 'error' });
    expect(parseArgs(['--workspace'], env, '/')).toMatchObject({ kind: 'error' });
    expect(parseArgs(['--token', 'secret'], env, '/')).toMatchObject({
      kind: 'error',
      message: 'unknown option --token',
    });
    expect(parseArgs(['--version'], env, '/')).toEqual({ kind: 'version' });
  });
});
