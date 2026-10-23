// MCP-SPEC §4.6, §5.20 (D0): the in-process server answers an SDK client over InMemoryTransport with the same hub —
// identity, instructions, the manifest's ready tools (none in D0; P2's from MAI-P2-1 on), unknown tools as protocol
// errors, empty resources and the prompts whose plans are written.
import { Client } from '@modelcontextprotocol/client';
import { buildManifest, PROMPTS, SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_MAX_CHARS } from '@ekza-studio/agent-tools';
import { describe, expect, it } from 'vitest';
import { createInProcessServer, originWarnings, parseArgs, parseOrigin, SERVER_VERSION } from '../src';

describe('in-process server (MCP-SPEC §4.6)', () => {
  it('serves the hub to an SDK client', async () => {
    const server = await createInProcessServer({ workspace: '/tmp/ekza-test', logLevel: 'error' });
    const client = new Client({ name: 'in-process', version: '1.0.0' });
    await client.connect(server.clientTransport);
    expect(client.getServerVersion()).toMatchObject({ name: 'ekza-studio', version: SERVER_VERSION });
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
      buildManifest().tools.map((tool) => tool.name),
    );
    await expect(client.callTool({ name: 'no_such_tool', arguments: {} })).rejects.toThrow(/not found/);
    expect((await client.listResources()).resources).toEqual([]);
    expect((await client.listPrompts()).prompts.map((prompt) => prompt.name)).toEqual(
      PROMPTS.filter((prompt) => prompt.plan !== null).map((prompt) => prompt.name),
    );
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
    // Another spelling of a listed origin collapses into it.
    const respelled = parseArgs(
      ['--allow-origin', 'http://127.1:03000', '--allow-origin', 'HTTP://[::1]:3000'],
      {},
      '/',
    );
    if (respelled.kind !== 'serve') throw new Error('not serve');
    expect(respelled.config.bridge.allowedOrigins).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
    ]);
  });

  it('accepts exact scheme://host[:port] origins only, normalised as the browser sends them (§5.10)', () => {
    expect(parseOrigin('http://localhost:3270')).toEqual({ origin: 'http://localhost:3270' });
    expect(parseOrigin(' HTTP://LocalHost:3270/ ')).toEqual({ origin: 'http://localhost:3270' });
    expect(parseOrigin('https://animator.example.org:443')).toEqual({ origin: 'https://animator.example.org' });
    expect(parseOrigin('http://[::1]:3100')).toEqual({ origin: 'http://[::1]:3100' });
    expect(parseOrigin('http://localhost:*')).toEqual({ origin: 'http://localhost:*' });
    // As the browser serialises Origin (WHATWG URL): plain port numbers, dotted-quad IPv4, compressed IPv6.
    expect(parseOrigin('http://localhost:03000')).toEqual({ origin: 'http://localhost:3000' });
    expect(parseOrigin('https://animator.example.org:00443')).toEqual({ origin: 'https://animator.example.org' });
    expect(parseOrigin('http://127.1:3000')).toEqual({ origin: 'http://127.0.0.1:3000' });
    expect(parseOrigin('http://2130706433:3000')).toEqual({ origin: 'http://127.0.0.1:3000' });
    expect(parseOrigin('http://0x7f.0.0.1:3000')).toEqual({ origin: 'http://127.0.0.1:3000' });
    expect(parseOrigin('http://[::ffff:127.0.0.1]:3000')).toEqual({ origin: 'http://[::ffff:7f00:1]:3000' });
    expect(parseOrigin('http://[0:0:0:0:0:0:0:1]:3000')).toEqual({ origin: 'http://[::1]:3000' });
    expect(parseOrigin('http://127.1:*')).toEqual({ origin: 'http://127.0.0.1:*' });
    for (const bad of [
      '*',
      'null',
      'localhost:3000',
      'http://localhost:3000/editor',
      'http://localhost:3000/?x=1',
      'http://localhost:3000#a',
      'http://user:pw@localhost:3000',
      'http://*:3000',
      'http://*.example.org',
      'http://localhost:3*',
      'http://localhost:0',
      'http://localhost:70000',
      'file:///tmp/editor.html',
      'chrome-extension://abcdef',
      'ws://localhost:3000',
      'http://999.1.1.1:3000',
      'http://[::g]:3000',
      'http://[1::2::3]:3000',
      '',
    ]) {
      expect([bad, 'error' in parseOrigin(bad)]).toEqual([bad, true]);
    }
  });

  it('refuses an invalid allowed origin from the flag or the environment', () => {
    expect(parseArgs(['--allow-origin', '*'], env, '/')).toMatchObject({ kind: 'error', message: /--allow-origin/ });
    expect(parseArgs(['--allow-origin', 'http://localhost:3270/editor'], env, '/')).toMatchObject({ kind: 'error' });
    expect(parseArgs([], { EKZA_MCP_ALLOWED_ORIGINS: 'http://localhost:3270,null' }, '/')).toMatchObject({
      kind: 'error',
      message: /EKZA_MCP_ALLOWED_ORIGINS/,
    });
  });

  it('warns about plain http off loopback, a * port and shared gateways, not about loopback origins', () => {
    const warningsOf = (origin: string): readonly string[] => {
      const parsed = parseArgs(['--allow-origin', origin], env, '/');
      if (parsed.kind !== 'serve') throw new Error(`not serve: ${origin}`);
      return parsed.warnings;
    };
    expect(warningsOf('http://localhost:3270')).toEqual([]);
    expect(warningsOf('http://127.0.0.1:3100')).toEqual([]);
    expect(warningsOf('http://[::1]:3100')).toEqual([]);
    // Loopback in any spelling the URL parser canonicalises is still loopback.
    expect(warningsOf('http://127.1:3100')).toEqual([]);
    expect(warningsOf('http://2130706433:3100')).toEqual([]);
    expect(warningsOf('http://127.8.9.10:3100')).toEqual([]);
    expect(warningsOf('http://[::ffff:127.0.0.1]:3100')).toEqual([]);
    expect(warningsOf('http://[0:0:0:0:0:0:0:1]:3100')).toEqual([]);
    expect(warningsOf('http://[::ffff:192.168.1.20]:3000')).toEqual([expect.stringMatching(/plain http/)]);
    expect(warningsOf('https://animator.example.org')).toEqual([]);
    expect(warningsOf('http://192.168.1.20:3000')).toEqual([expect.stringMatching(/plain http/)]);
    expect(warningsOf('http://localhost:*')).toEqual([expect.stringMatching(/every port/)]);
    expect(warningsOf('https://ipfs.io')).toEqual([expect.stringMatching(/shared gateway/)]);
    expect(warningsOf('https://gateway.pinata.cloud')).toEqual([expect.stringMatching(/shared gateway/)]);
    expect(warningsOf('http://dweb-gateway.example:*')).toHaveLength(3);
    expect(originWarnings('http://localhost:3000')).toEqual([]);
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
