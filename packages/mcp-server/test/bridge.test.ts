// MCP-SPEC §4.5, §5.8, §5.10, §5.19 (B2): the live bridge against a WebSocket client that plays the editor tab —
// upgrade checks, the hello/toolset handshake, server-generated codes (wrong, reused, expired, lockout), the human's
// decision (accept, deny), one tab per server, the call relay with re-validation of results (the rogue page T16),
// deadlines, cancellation, frame limits, the unpaired-socket cap, blobs, `bye` and the hub's routing.
import {
  type AgentToolDef,
  allTools,
  BRIDGE_PROTOCOL,
  type BridgeMessage,
  buildManifest,
} from '@ekza-studio/agent-tools';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { z } from 'zod';
import {
  type BridgeServer,
  checkUpgrade,
  configWithDefaults,
  createAgentHub,
  createLogger,
  displayPairingCode,
  generatePairingCode,
  imageSize,
  normalizePairingCode,
  originAllowed,
  revalidateTabResult,
  startBridgeServer,
  startHubBridge,
} from '../src';

const manifest = buildManifest();
const TOOLSET = { version: manifest.toolset, hash: manifest.hash };
const ORIGIN = 'http://localhost:3000';
const log = createLogger('error', process.stderr);
const editorConnect = allTools().find((tool) => tool.name === 'editor_connect') as AgentToolDef;

/** Minimal tool definitions the fake tab answers (the server only needs name, kind, output and budget). */
const fakeTool = (name: string, kind: AgentToolDef['kind'], output: z.ZodType): AgentToolDef =>
  ({
    name,
    kind,
    output,
    budget: { tokens: 400, maxTokens: 1_500 },
    hosts: ['live'],
    group: 'scene',
    input: z.strictObject({}),
  }) as unknown as AgentToolDef;
const TOOLS = new Map<string, AgentToolDef>([
  ['editor_connect', editorConnect],
  ['scene_summary', fakeTool('scene_summary', 'read', z.object({ name: z.string() }))],
  ['keys_set', fakeTool('keys_set', 'edit', z.object({ set: z.number(), name: z.string() }))],
]);

const servers: BridgeServer[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const server of servers.splice(0)) await server.close();
});

async function bridge(
  overrides: Partial<ReturnType<typeof configWithDefaults>['bridge']> = {},
  timing: Parameters<typeof startBridgeServer>[0]['timing'] = {},
): Promise<BridgeServer> {
  const base = configWithDefaults({ workspace: '/tmp/ws' }).bridge;
  const server = await startBridgeServer({
    config: { ...base, enabled: true, port: 0, ...overrides },
    log,
    toolset: TOOLSET,
    clientInfo: () => ({ name: 'Claude Code', version: '2.0.0' }),
    cwdName: 'walk-project',
    tools: TOOLS,
    timing,
  });
  if (server === null) throw new Error('no bridge');
  servers.push(server);
  return server;
}

interface FakeTab {
  readonly ws: WebSocket;
  next<T extends BridgeMessage['t']>(t?: T): Promise<Extract<BridgeMessage, { t: T }>>;
  send(message: unknown): void;
  readonly closed: Promise<number>;
}

/** Opens a socket as a tab would (Origin and Host headers), or reports the HTTP status of a refused upgrade. */
function open(
  port: number,
  headers: { origin?: string | null; host?: string } = {},
): Promise<FakeTab | { status: number }> {
  return new Promise((resolve) => {
    const origin = headers.origin === undefined ? ORIGIN : headers.origin;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      ...(origin === null ? {} : { origin }),
      ...(headers.host === undefined ? {} : { headers: { host: headers.host } }),
    });
    sockets.push(ws);
    const queue: BridgeMessage[] = [];
    const waiters: ((message: BridgeMessage) => void)[] = [];
    let resolveClosed: (code: number) => void = () => {};
    const closed = new Promise<number>((r) => {
      resolveClosed = r;
    });
    ws.on('message', (data, binary) => {
      if (binary) return;
      const message = JSON.parse(String(data)) as BridgeMessage;
      const waiter = waiters.shift();
      if (waiter === undefined) queue.push(message);
      else waiter(message);
    });
    ws.on('close', (code) => resolveClosed(code));
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0 }));
    ws.on('error', () => {});
    ws.on('open', () =>
      resolve({
        ws,
        closed,
        send: (message) => ws.send(typeof message === 'string' ? message : JSON.stringify(message)),
        next: (t) =>
          new Promise((r, reject) => {
            const take = (message: BridgeMessage): void => {
              if (t !== undefined && message.t !== t)
                reject(new Error(`expected ${t}, got ${JSON.stringify(message)}`));
              else r(message as never);
            };
            const queued = queue.shift();
            if (queued !== undefined) take(queued);
            else waiters.push(take);
          }),
      }),
    );
  });
}

async function tabOf(port: number): Promise<FakeTab> {
  const tab = await open(port);
  if ('status' in tab) throw new Error(`refused ${tab.status}`);
  tab.send({ t: 'hello', bridge: BRIDGE_PROTOCOL, toolset: TOOLSET, app: { version: '0.2.0', build: 'e2e' } });
  await tab.next('hello.ok');
  return tab;
}

const signal = (): AbortSignal => new AbortController().signal;

/** Offer, claim, accept, report and answer the scene_summary of the claim: a paired fake tab. */
async function paired(
  server: BridgeServer,
): Promise<{ tab: FakeTab; connect: Awaited<ReturnType<BridgeServer['claim']>> }> {
  const tab = await tabOf(server.port);
  tab.send({ t: 'pair.offer' });
  const { code } = await tab.next('pair.code');
  const claim = server.claim(code, { signal: signal() });
  const claimed = await tab.next('pair.claimed');
  expect(claimed).toEqual({
    t: 'pair.claimed',
    client: { name: 'Claude Code', version: '2.0.0' },
    cwdName: 'walk-project',
  });
  tab.send({ t: 'pair.accept', grants: { read: true, edit: true, files: false, view: false, workspace: false } });
  const ok = await tab.next('pair.ok');
  expect(ok.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(ok.actor).toMatchObject({ kind: 'agent', name: 'Claude Code' });
  tab.send({ t: 'tab', title: 'Ekza Studio', project: 'walk' });
  const call = await tab.next('call');
  expect(call.tool).toBe('scene_summary');
  tab.send({ t: 'result', id: call.id, result: { ok: true, data: { name: 'scene' } }, images: [], writes: [] });
  return { tab, connect: await claim };
}

describe('upgrade checks (§5.10, T1–T3)', () => {
  it('admits only loopback Host and allow-listed Origin values', async () => {
    const server = await bridge();
    expect(await open(server.port, { origin: null })).toEqual({ status: 403 });
    expect(await open(server.port, { origin: 'https://evil.example' })).toEqual({ status: 403 });
    expect(await open(server.port, { host: `rebind.example:${server.port}` })).toEqual({ status: 403 });
    expect('ws' in (await open(server.port, { origin: 'https://studio.ekza.io' }))).toBe(true);
    expect('ws' in (await open(server.port, { host: `localhost:${server.port}` }))).toBe(true);
  });

  it('matches origins exactly or by a whole-port wildcard', () => {
    expect(originAllowed('http://localhost:3152', ['http://localhost:*'])).toBe(true);
    expect(originAllowed('http://localhost:3152', ['http://localhost:3000'])).toBe(false);
    expect(originAllowed('http://localhost.evil:3000', ['http://localhost:*'])).toBe(false);
    expect(originAllowed('null', ['null'])).toBe(false);
    expect(checkUpgrade({ host: '[::1]:5', origin: ORIGIN }, 5, [ORIGIN])).toBeNull();
    expect(checkUpgrade({ host: '127.0.0.1:6', origin: ORIGIN }, 5, [ORIGIN])).toEqual({ status: 403, reason: 'host' });
  });

  it('refuses a ninth unpaired socket (503) and closes a silent one after the hello timeout', async () => {
    const server = await bridge({ maxUnpairedSockets: 2 }, { helloTimeoutMs: 100 });
    const first = await open(server.port);
    await open(server.port);
    expect(await open(server.port)).toEqual({ status: 503 });
    if ('status' in first) throw new Error('refused');
    expect(await first.closed).toBe(1008);
  });
});

describe('hello and pairing (§5.10)', () => {
  it('answers hello with the server, the reported client and the toolset; refuses another major', async () => {
    const server = await bridge();
    const tab = await open(server.port);
    if ('status' in tab) throw new Error('refused');
    tab.send({ t: 'hello', bridge: 1, toolset: TOOLSET, app: { version: '0.2.0', build: 'e2e' } });
    const hello = await tab.next('hello.ok');
    expect(hello).toMatchObject({ server: { name: 'ekza-studio-mcp' }, client: { name: 'Claude Code' }, busy: false });
    const other = await open(server.port);
    if ('status' in other) throw new Error('refused');
    other.send({
      t: 'hello',
      bridge: 1,
      toolset: { version: '9.0.0', hash: TOOLSET.hash },
      app: { version: '0', build: 'e2e' },
    });
    expect(await other.next('hello.refused')).toMatchObject({ code: 'version_mismatch' });
  });

  it('closes a socket that sends an invalid or unknown-key message (1008) or a big frame before pairing (1009)', async () => {
    const server = await bridge();
    const a = await tabOf(server.port);
    a.send({ t: 'pair.offer', code: 'AAAAAA' });
    expect(await a.closed).toBe(1008);
    const b = await tabOf(server.port);
    b.send({ t: 'tab', title: 'x'.repeat(70_000), project: '' });
    expect(await b.closed).toBe(1009);
    const c = await open(server.port);
    if ('status' in c) throw new Error('refused');
    c.send({ t: 'pair.offer' });
    expect(await c.closed).toBe(1008);
  });

  it('generates codes from the alphabet, accepts them with or without the dash, single use', async () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(normalizePairingCode(displayPairingCode(code).toLowerCase())).toBe(code);
    expect(normalizePairingCode('K7Q-M4P0')).toBeNull();
    const server = await bridge();
    const { connect, tab } = await paired(server);
    expect(connect).toMatchObject({
      ok: true,
      data: { project: expect.stringMatching(/^tab_[0-9A-Za-z]{12}$/), origin: ORIGIN, actor: { name: 'Claude Code' } },
    });
    expect(server.status()).toBe('paired');
    expect(server.tab()).toMatchObject({ origin: ORIGIN, title: 'Ekza Studio', project: 'walk' });
    // a second tab is told the server is busy and cannot offer
    const other = await open(server.port);
    if ('status' in other) throw new Error('refused');
    other.send({ t: 'hello', bridge: 1, toolset: TOOLSET, app: { version: '0', build: 'e2e' } });
    expect(await other.next('hello.ok')).toMatchObject({ busy: true });
    other.send({ t: 'pair.offer' });
    expect(await other.next('error')).toMatchObject({ code: 'busy' });
    // bye ends the pairing at once
    tab.send({ t: 'bye', reason: 'user' });
    await tab.closed;
    expect(server.status()).toBe('listening');
  });

  it('answers wrong, expired and denied codes, and locks pairing after five wrong codes', async () => {
    const server = await bridge({ pairingTtlMs: 150, pairingLockoutMs: 200 });
    const tab = await tabOf(server.port);
    tab.send({ t: 'pair.offer' });
    const { code } = await tab.next('pair.code');
    // deny
    const denied = server.claim(code, { signal: signal() });
    await tab.next('pair.claimed');
    tab.send({ t: 'pair.deny' });
    expect(await denied).toMatchObject({ ok: false, error: { code: 'declined' } });
    // reused
    expect(await server.claim(code, { signal: signal() })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    // expired
    tab.send({ t: 'pair.offer' });
    const second = await tab.next('pair.code');
    await new Promise((r) => setTimeout(r, 200));
    expect(await server.claim(second.code, { signal: signal() })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    // lockout (five wrong within the window; three already counted above)
    await server.claim('AAA-AAA', { signal: signal() });
    expect(await server.claim('AAA-AAB', { signal: signal() })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await server.claim('AAA-AAC', { signal: signal() })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await server.claim('AAA-AAE', { signal: signal() })).toMatchObject({ ok: false, error: { code: 'busy' } });
    await new Promise((r) => setTimeout(r, 250));
    expect(await server.claim('AAA-AAD', { signal: signal() })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('answers busy when the user has not decided in time; the same code keeps waiting on the same dialog', async () => {
    const server = await bridge({}, { connectMs: 100 });
    const tab = await tabOf(server.port);
    tab.send({ t: 'pair.offer' });
    const { code } = await tab.next('pair.code');
    expect(await server.claim(code, { signal: signal() })).toMatchObject({
      ok: false,
      error: { code: 'busy', retryable: true },
    });
    await tab.next('pair.claimed');
    const again = server.claim(code, { signal: signal() });
    tab.send({ t: 'pair.deny' });
    expect(await again).toMatchObject({ ok: false, error: { code: 'declined' } });
  });
});

describe('calls (§5.8, §5.10)', () => {
  it('re-validates results: own schema (unknown fields stripped), sanitiser, budgets', async () => {
    const server = await bridge();
    const { tab } = await paired(server);
    const pending = server.call(TOOLS.get('keys_set') as AgentToolDef, { x: 1 }, { signal: signal() });
    const call = await tab.next('call');
    expect(call).toMatchObject({ tool: 'keys_set', args: { x: 1 }, files: [] });
    tab.send({
      t: 'result',
      id: call.id,
      result: {
        ok: true,
        data: { set: 3, name: `evil‮\u{E0041}${'n'.repeat(20_000)}`, secret: 'leak' },
        undo: { step: 7, label: 'AI: Set keys' },
        extra: true,
      },
      images: [],
      writes: [],
    });
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as Record<string, unknown>;
    expect(data['secret']).toBeUndefined();
    expect(String(data['name'])).not.toMatch(/[‮\u{E0041}]/u);
    expect(String(data['name']).length).toBeLessThanOrEqual(300);
    expect(result.undo).toEqual({ step: 7, label: 'AI: Set keys' });
  });

  it('rejects writes with a path and a result that is not the tool’s data', async () => {
    const server = await bridge();
    const { tab } = await paired(server);
    const pending = server.call(TOOLS.get('keys_set') as AgentToolDef, {}, { signal: signal() });
    const call = await tab.next('call');
    tab.send({ t: 'result', id: call.id, result: { ok: true, data: { nope: 1 } }, images: [], writes: [] });
    expect(await pending).toMatchObject({ ok: false, error: { code: 'internal' } });
    const bad = server.call(TOOLS.get('keys_set') as AgentToolDef, {}, { signal: signal() });
    const second = await tab.next('call');
    tab.send({
      t: 'result',
      id: second.id,
      result: { ok: true, data: { set: 1, name: 'a' } },
      images: [],
      writes: [{ name: '../x.vrma', blob: 'b' }],
    });
    expect(await tab.closed).toBe(1008);
    expect(await bad).toMatchObject({ ok: false, error: { code: 'not_connected' } });
  });

  it('times out (not retryable) and sends cancel; cancellation sends cancel too', async () => {
    const server = await bridge({}, { callMs: 100 });
    const { tab } = await paired(server);
    const slow = server.call(TOOLS.get('keys_set') as AgentToolDef, {}, { signal: signal() });
    const call = await tab.next('call');
    expect(await slow).toMatchObject({ ok: false, error: { code: 'timeout', retryable: false } });
    expect(await tab.next('cancel')).toEqual({ t: 'cancel', id: call.id });
    const controller = new AbortController();
    const cancelled = server.call(TOOLS.get('keys_set') as AgentToolDef, {}, { signal: controller.signal });
    const second = await tab.next('call');
    controller.abort();
    expect(await cancelled).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(await tab.next('cancel')).toEqual({ t: 'cancel', id: second.id });
  });

  it('extends the deadline once when a confirm card opens', async () => {
    const server = await bridge({}, { callMs: 100, confirmExtensionMs: 200 });
    const { tab } = await paired(server);
    const pending = server.call(TOOLS.get('keys_set') as AgentToolDef, {}, { signal: signal() });
    const call = await tab.next('call');
    tab.send({ t: 'progress', id: call.id, done: 0, total: null, message: 'waiting for your confirmation' });
    await new Promise((r) => setTimeout(r, 150));
    tab.send({ t: 'result', id: call.id, result: { ok: true, data: { set: 1, name: 'a' } }, images: [], writes: [] });
    expect(await pending).toMatchObject({ ok: true });
  });

  it('takes one image over blob frames and checks its header against the reported size', async () => {
    const server = await bridge();
    const { tab } = await paired(server);
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 64);
    new DataView(png.buffer).setUint32(20, 32);
    expect(imageSize(png, 'image/png')).toEqual({ width: 64, height: 32 });
    const send = async (width: number): Promise<unknown> => {
      const pending = server.call(TOOLS.get('scene_summary') as AgentToolDef, {}, { signal: signal() });
      const call = await tab.next('call');
      tab.send({ t: 'blob', id: `${call.id}_i0`, seq: 0, last: true, bytes: png.length });
      tab.ws.send(png);
      tab.send({
        t: 'result',
        id: call.id,
        result: { ok: true, data: { name: 'x' } },
        images: [{ blob: `${call.id}_i0`, mime: 'image/png', width, height: 32 }],
        writes: [],
      });
      return pending;
    };
    const good = (await send(64)) as { ok: boolean; images?: unknown[] };
    expect(good.ok).toBe(true);
    expect(good.images).toHaveLength(1);
    expect(await send(65)).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('answers not_connected when nothing is paired and on the tab’s close', async () => {
    const server = await bridge();
    expect(await server.call(TOOLS.get('keys_set') as AgentToolDef, {}, { signal: signal() })).toMatchObject({
      ok: false,
      error: { code: 'not_connected' },
    });
    const { tab } = await paired(server);
    const pending = server.call(TOOLS.get('keys_set') as AgentToolDef, {}, { signal: signal() });
    await tab.next('call');
    tab.ws.terminate();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'not_connected' } });
  });

  it('revalidates an error envelope from the tab too', () => {
    const result = revalidateTabResult(TOOLS.get('keys_set') as AgentToolDef, {
      ok: false,
      error: { code: 'stale', message: 'm‮', hint: 'h', retryable: true, bogus: 1 },
    });
    expect(result).toEqual({ ok: false, error: { code: 'stale', message: 'm', hint: 'h', retryable: true } });
  });
});

describe('the hub routes over the bridge', () => {
  it('editor_connect validates the code, reaches the bridge, and the tab handle expires with the pairing', async () => {
    const hub = createAgentHub(
      configWithDefaults({
        workspace: '/tmp/ws',
        bridge: { ...configWithDefaults({ workspace: '/' }).bridge, enabled: true, port: 0 },
      }),
      log,
    );
    const port = await startHubBridge(hub);
    expect(port).toBeGreaterThan(0);
    const bad = await hub.callTool('editor_connect', { code: 'nope' }, { signal: signal() });
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid_args' } });
    const none = await hub.callTool('editor_connect', { code: 'K7Q-M4P' }, { signal: signal() });
    expect(none).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const stale = await hub.callTool('scene_summary', { project: 'tab_000000000000' }, { signal: signal() });
    expect(stale).toMatchObject({ ok: false, error: { code: 'expired_handle' } });
    await hub.close();
  });
});
