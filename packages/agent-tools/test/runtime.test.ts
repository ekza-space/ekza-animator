// MCP-SPEC §8 D0 (6): the minimal working tool runtime, end to end on a headless editor — strict validation, host,
// needs, grant and pause gating, `ctx.run` with actor, access and labels (`AI: <intent> · <label>`), the envelope,
// error mapping (the user's drag → busy), the sanitiser over tag-block and bidi strings, the budgets' hard cut, the
// resolver's user-session clip rule.
import { EkzaError } from '@ekza-studio/anim-core';
import type { ClipId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AgentToolFailure,
  type AgentToolDef,
  type AgentToolResult,
  allTools,
  createAgentToolRuntime,
  defineTool,
  finishedValue,
  type Grants,
  isClean,
  notAvailableYet,
  PROGRESS_MAX_CHARS,
  schemas,
  scrubPaths,
  TRUNCATED_NEXT,
  tokensOf,
} from '../src';
import { AGENT, type Fixture, polybotFixture, testHost } from './support';

const HOSTILE = 'Wave‮ evil\u{E0041}\u{E0042}​ hand⁦ \n\tok\u0007';

/** Every string inside a value, keys included. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      out.push(key);
      strings(inner, out);
    }
  }
  return out;
}

/** A read tool: echoes a hostile document string and the clip it resolved. */
const sceneProbe = defineTool({
  name: 'scene_probe',
  title: 'Probe',
  description: 'Read probe used by the runtime tests.',
  group: 'scene',
  input: z.strictObject({ ...schemas.scoped, count: z.int().min(0).max(100_000).default(1).describe('Items.') }),
  output: z.object({ name: z.string(), clip: z.string(), items: z.array(z.string()) }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: { tokens: 600, maxTokens: 2_000 },
  ready: true,
  run(ctx, args) {
    const character = ctx.resolve.character(args.character);
    const clip = ctx.resolve.clip(character.id, args.clip);
    return Promise.resolve({
      ok: true,
      data: { name: HOSTILE, clip: clip.name, items: Array.from({ length: args.count }, (_, i) => `item ${i}`) },
      warnings: [HOSTILE.repeat(20)],
    });
  },
});

/** An edit tool: one operator run with a label, the call's intent and the clip it names. */
const keysProbe = defineTool({
  name: 'keys_probe',
  title: 'Edit probe',
  description: 'Edit probe used by the runtime tests.',
  group: 'keys',
  input: z.strictObject({ ...schemas.scoped, ...schemas.writes, loop: z.boolean().describe('Loop flag.') }),
  output: z.object({ loop: z.boolean() }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: { tokens: 400, maxTokens: 1_500 },
  ready: true,
  async run(ctx, args): Promise<AgentToolResult<{ loop: boolean }>> {
    const character = ctx.resolve.character(args.character);
    const clip = ctx.resolve.clip(character.id, args.clip);
    const run = await ctx.run('test.setLoop', { clip: clip.id, loop: args.loop, label: 'Set loop' });
    finishedValue('test.setLoop', run.result);
    return {
      ok: true,
      data: { loop: args.loop },
      ...(run.step === null ? {} : { undo: { step: run.step.id, label: run.step.label } }),
    };
  },
});

const notReady = defineTool({ ...keysProbe, name: 'keys_later', ready: false });

const throwing = (name: string, error: () => Error): AgentToolDef =>
  defineTool({
    ...sceneProbe,
    name,
    ready: true,
    run: () => Promise.reject(error()),
  });

/**
 * A catalogue definition made ready with a stub run: validation and gating are the catalogue's, the run answers
 * "not available yet" (the D0 stub), so these tests check the gate alone whatever the tool's owner built.
 */
function readyCatalogueTool(name: string): AgentToolDef {
  const tool = allTools().find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`no catalogue tool ${name}`);
  const stub: AgentToolDef = { ...tool, ready: true, run: notAvailableYet(name) };
  delete (stub as { confirm?: unknown }).confirm;
  return stub;
}

/** A failure whose detail refers to itself: the sanitiser cannot walk it. */
function cyclicFailure(): Error {
  const detail: Record<string, unknown> = { reason: 'loop' };
  detail['self'] = detail;
  return new AgentToolFailure('limit', 'Too many targets.', 'split the call', { detail });
}

/** A failure whose detail nests 10,000 levels deep. */
function deepFailure(): Error {
  let detail: Record<string, unknown> = {};
  for (let i = 0; i < 10_000; i++) detail = { inner: detail };
  return new AgentToolFailure('limit', 'Too many targets.', 'split the call', { detail });
}

const cyclicData = defineTool({
  ...sceneProbe,
  name: 'scene_cyclic_data',
  ready: true,
  run() {
    const data: Record<string, unknown> = { name: 'a', clip: 'b', items: [] };
    data['self'] = data;
    return Promise.resolve({ ok: true, data } as AgentToolResult<never>);
  },
});

/** Reports progress with a hostile, over-long message, then without a message. */
const progressProbe = defineTool({
  ...sceneProbe,
  name: 'scene_progress',
  ready: true,
  run(ctx) {
    ctx.progress(1, 2, `Importing ${HOSTILE.repeat(20)}`);
    ctx.progress(2, 2);
    return Promise.resolve({ ok: true, data: { name: 'done', clip: 'none', items: [] } });
  },
});

const withExample = defineTool({ ...sceneProbe, name: 'scene_example', ready: true, example: { count: 3 } });

const liveOnly = defineTool({ ...sceneProbe, name: 'scene_live', hosts: ['live'], ready: true });
const needsView = defineTool({ ...sceneProbe, name: 'scene_needs', needs: ['view'], ready: true });

const TOOLS: readonly AgentToolDef[] = [
  sceneProbe,
  keysProbe,
  notReady,
  liveOnly,
  needsView,
  throwing('scene_failure', () => new AgentToolFailure('limit', 'Too many targets.', 'split the call')),
  throwing('scene_ekza', () => new EkzaError('invalid-record', 'bad record')),
  throwing('scene_bug', () => new TypeError('x is undefined at /Users/someone/secret.ts:12')),
  throwing(
    'scene_fs',
    () => new EkzaError('asset-missing', "ENOENT: no such file or directory, open '/Users/someone/secret/polybot.vrm'"),
  ),
  throwing('scene_cyclic', cyclicFailure),
  throwing('scene_deep', deepFailure),
  cyclicData,
  progressProbe,
  withExample,
  readyCatalogueTool('keys_delete'),
  readyCatalogueTool('pose_set'),
  readyCatalogueTool('clip_create'),
  readyCatalogueTool('clip_update'),
  readyCatalogueTool('operator_run'),
];

function registerSetLoop(app: EditorApp): void {
  app.operators.register<{ readonly clip: ClipId; readonly loop: boolean; readonly label?: string }, void, void>({
    id: 'test.setLoop',
    label: 'Set Loop',
    category: 'test',
    scope: 'global',
    flags: { undo: true, internal: true },
    undoLabel: (args) => args.label ?? 'Set Loop',
    apply: (ctx, args) => ctx.tx?.patch('clips', args.clip, { loop: args.loop }),
  });
}

const signal = () => new AbortController().signal;

describe('minimal tool runtime (MCP-SPEC §8 D0)', () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await polybotFixture(31);
    registerSetLoop(fx.app);
  });

  it('serves the ready tools only (the catalogue: the ready ones, in catalogue order)', async () => {
    const runtime = createAgentToolRuntime({ app: fx.app, host: testHost(), actor: AGENT, tools: TOOLS });
    expect(runtime.tools.map((tool) => tool.name)).not.toContain('keys_later');
    const later = await runtime.call('keys_later', { loop: true }, { signal: signal() });
    expect(later.ok ? null : later.error.code).toBe('unsupported');
    const catalogue = createAgentToolRuntime({ app: fx.app, host: testHost(), actor: AGENT });
    // D0 had none ready; P2 lists its tools (the manifest is the contract, test/manifest.test.ts)
    expect(catalogue.tools.map((tool) => tool.name)).toEqual(
      allTools()
        .filter((tool) => tool.ready)
        .map((tool) => tool.name),
    );
    const stretch = await catalogue.call('recipe_apply', { recipe: 'wave' }, { signal: signal() });
    expect(stretch).toMatchObject({ ok: false, error: { code: 'unsupported', retryable: false } });
  });

  it('rejects unknown keys and out-of-bounds numbers with invalid_args and the failing path', async () => {
    const runtime = createAgentToolRuntime({ app: fx.app, host: testHost(), actor: AGENT, tools: TOOLS });
    const unknown = await runtime.call('keys_probe', { loop: true, ifClipRevison: 3 }, { signal: signal() });
    expect(unknown).toMatchObject({
      ok: false,
      error: { code: 'invalid_args', retryable: true, detail: { path: 'ifClipRevison' } },
    });
    const bounds = await runtime.call('scene_probe', { count: 1e9 }, { signal: signal() });
    expect(bounds).toMatchObject({ ok: false, error: { code: 'invalid_args', detail: { path: 'count' } } });
  });

  it('gates on host, needs, grants and pause', async () => {
    const call = (host: Parameters<typeof testHost>[0], name: string, args: unknown) =>
      createAgentToolRuntime({ app: fx.app, host: testHost(host), actor: AGENT, tools: TOOLS }).call(name, args, {
        signal: signal(),
      });
    expect(await call({}, 'scene_live', {})).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    expect(await call({}, 'scene_needs', {})).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    const denied = await call({ grants: { edit: false } }, 'keys_probe', { clip: 'agent', loop: true });
    expect(denied).toMatchObject({ ok: false, error: { code: 'not_granted', retryable: false } });
    expect(denied.ok ? '' : denied.error.message).toContain('Edit grant');
    const paused = await call({ paused: () => true }, 'scene_probe', {});
    expect(paused).toMatchObject({ ok: false, error: { code: 'paused', retryable: false } });
  });

  it('runs an edit as one AI step labelled with the intent, attributed to the actor', async () => {
    const runtime = createAgentToolRuntime({ app: fx.app, host: testHost(), actor: AGENT, tools: TOOLS });
    const result = await runtime.call(
      'keys_probe',
      { clip: 'agent', loop: true, intent: 'Make the wave loop' },
      { signal: signal() },
    );
    expect(result).toMatchObject({ ok: true, data: { loop: true } });
    if (!result.ok) return;
    expect(result.undo?.label).toBe('AI: Make the wave loop · Set loop');
    const step = fx.app.history.peekUndo();
    expect(step?.id).toBe(result.undo?.step);
    expect(step?.actor).toEqual(AGENT);
    expect(fx.app.store.get('clips', fx.agentClip)?.loop).toBe(true);
  });

  it('sanitises every outgoing string and caps warnings', async () => {
    const runtime = createAgentToolRuntime({ app: fx.app, host: testHost(), actor: AGENT, tools: TOOLS });
    const result = await runtime.call('scene_probe', { clip: 'agent' }, { signal: signal() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(strings(result).every(isClean)).toBe(true);
    expect((result.data as { name: string }).name).toBe('Wave evil hand ok'); // tag characters are invisible: gone
    expect(result.warnings?.[0]?.length).toBeLessThanOrEqual(200);
    expect(result.warnings?.[0]?.endsWith('…')).toBe(true);
  });

  it('cuts an over-long result to the hard cap and says how to page', async () => {
    const runtime = createAgentToolRuntime({ app: fx.app, host: testHost(), actor: AGENT, tools: TOOLS });
    const result = await runtime.call('scene_probe', { clip: 'agent', count: 20_000 }, { signal: signal() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(tokensOf(result.data)).toBeLessThanOrEqual(2_000);
    expect(result.data).toMatchObject({ truncated: true });
    expect(result.next).toBe(TRUNCATED_NEXT);
  });

  it('requires clip for an edit on a host with a user session, the user’s active clip first', async () => {
    const runtime = createAgentToolRuntime({
      app: fx.app,
      host: testHost({ mode: 'live', capabilities: ['user', 'confirm', 'presence', 'view'] }),
      actor: AGENT,
      tools: TOOLS,
    });
    const result = await runtime.call('keys_probe', { loop: false }, { signal: signal() });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_args', detail: { path: 'clip' } } });
    const candidates = result.ok ? [] : (result.error.candidates ?? []);
    expect(candidates[0]).toBe('user');
    expect(candidates).toContain('agent');
    // Reads still default to the user's active clip.
    const read = await runtime.call('scene_probe', {}, { signal: signal() });
    expect(read).toMatchObject({ ok: true, data: { clip: 'user' } });
  });

  it('maps the user’s drag to busy and other failures to their codes, never leaking details', async () => {
    const runtime = createAgentToolRuntime({ app: fx.app, host: testHost(), actor: AGENT, tools: TOOLS });
    const preview = fx.app.store.beginPreview('Drag');
    const busy = await runtime.call('keys_probe', { clip: 'agent', loop: false }, { signal: signal() });
    preview.cancel();
    expect(busy).toMatchObject({ ok: false, error: { code: 'busy', retryable: true } });
    expect(await runtime.call('scene_failure', {}, { signal: signal() })).toMatchObject({
      ok: false,
      error: { code: 'limit', message: 'Too many targets.', hint: 'split the call', retryable: true },
    });
    expect(await runtime.call('scene_ekza', {}, { signal: signal() })).toMatchObject({
      ok: false,
      error: { code: 'invalid_args' },
    });
    const bug = await runtime.call('scene_bug', {}, { signal: signal() });
    expect(bug).toMatchObject({ ok: false, error: { code: 'internal', retryable: false } });
    expect(JSON.stringify(bug)).not.toContain('/Users/');
    const aborted = new AbortController();
    aborted.abort();
    expect(await runtime.call('keys_probe', { clip: 'agent', loop: false }, { signal: aborted.signal })).toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    });
  });

  it('never names an absolute path in an operator or host error (§5.4)', async () => {
    const runtime = createAgentToolRuntime({ app: fx.app, host: testHost(), actor: AGENT, tools: TOOLS });
    const fs = await runtime.call('scene_fs', {}, { signal: signal() });
    expect(fs).toMatchObject({
      ok: false,
      error: { code: 'io_error', message: "ENOENT: no such file or directory, open 'polybot.vrm'" },
    });
    expect(scrubPaths('at /Users/a/b.ts:12, C:\\Users\\me\\x.vrm, \\\\srv\\share\\y.glb, file:///home/u/z.vrma')).toBe(
      'at b.ts:12, x.vrm, y.glb, z.vrma',
    );
    expect(scrubPaths('fps 30/1 and/or N/A, 0 / 10, https://example.org/a/b')).toBe(
      'fps 30/1 and/or N/A, 0 / 10, https://example.org/a/b',
    );
  });

  it('answers an internal envelope, never a rejected call, when the error path cannot be sanitised', async () => {
    const runtime = createAgentToolRuntime({ app: fx.app, host: testHost(), actor: AGENT, tools: TOOLS });
    for (const name of ['scene_cyclic', 'scene_deep', 'scene_cyclic_data']) {
      const result = await runtime.call(name, {}, { signal: signal() });
      expect([name, result]).toEqual([
        name,
        {
          ok: false,
          error: {
            code: 'internal',
            message: 'The tool failed unexpectedly.',
            hint: 'report this; the document was rolled back',
            retryable: false,
          },
        },
      ]);
    }
  });

  it('sanitises progress messages (§5.3)', async () => {
    const runtime = createAgentToolRuntime({ app: fx.app, host: testHost(), actor: AGENT, tools: TOOLS });
    const seen: [number, number | null, string | undefined][] = [];
    const result = await runtime.call(
      'scene_progress',
      {},
      { signal: signal(), progress: (done, total, message) => seen.push([done, total, message]) },
    );
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(2);
    const message = seen[0]?.[2] ?? '';
    expect(isClean(message)).toBe(true);
    expect(message.startsWith('Importing Wave evil hand ok')).toBe(true);
    expect(Array.from(message).length).toBeLessThanOrEqual(PROGRESS_MAX_CHARS);
    expect(seen[1]).toEqual([2, 2, undefined]);
  });

  it('rejects a Targets that names no target, and an unbounded record, with invalid_args at the field', async () => {
    const runtime = createAgentToolRuntime({ app: fx.app, host: testHost(), actor: AGENT, tools: TOOLS });
    for (const targets of [{}, { channels: ['rx'] }]) {
      const result = await runtime.call('keys_delete', { clip: 'agent', targets, frames: [1] }, { signal: signal() });
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_args', detail: { path: 'targets' } } });
    }
    const attrs = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`a${i}`, 1] as const));
    const pose = await runtime.call(
      'pose_set',
      { clip: 'agent', frame: 0, set: [{ control: 'cog', attrs }] },
      { signal: signal() },
    );
    expect(pose).toMatchObject({ ok: false, error: { code: 'invalid_args', detail: { path: 'set[0].attrs' } } });
  });

  it('hands a minimal valid call to the agent in invalid_args when the tool has an example (§5.4)', async () => {
    const runtime = createAgentToolRuntime({ app: fx.app, host: testHost(), actor: AGENT, tools: TOOLS });
    const result = await runtime.call('scene_example', { count: 'three' }, { signal: signal() });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_args', detail: { path: 'count', example: { count: 3 } } },
    });
    expect(result.ok ? '' : result.error.hint).toContain('detail.example');
    const plain = await runtime.call('scene_probe', { count: 'three' }, { signal: signal() });
    expect(plain.ok ? null : plain.error.detail?.['example']).toBeUndefined();
  });

  it('needs Edit and View for a live activating create, View alone for an activation (§5.9, Q-AI-38)', async () => {
    const live = (grants: Partial<Grants>) =>
      createAgentToolRuntime({
        app: fx.app,
        host: testHost({ mode: 'live', grants, capabilities: ['user', 'confirm', 'presence', 'view'] }),
        actor: AGENT,
        tools: TOOLS,
      });
    const call = (grants: Partial<Grants>, name: string, args: unknown) =>
      live(grants).call(name, args, { signal: signal() });
    const notGranted = (grant: string) => ({ ok: false, error: { code: 'not_granted', detail: { grant } } });
    // The gate passed: the D0 stub answers "not available yet".
    const passed = (result: AgentToolResult<unknown>): string =>
      result.ok ? 'ok' : `${result.error.code}: ${result.error.message}`;
    const stub = (name: string) => `unsupported: ${name} is not available yet.`;
    const create = { name: 'tmp', activate: true };
    const viewOnly = { edit: false, view: true };
    const editOnly = { edit: true, view: false };

    expect(await call(viewOnly, 'clip_create', create)).toMatchObject(notGranted('edit'));
    expect(await call(editOnly, 'clip_create', create)).toMatchObject(notGranted('view'));
    const neither = await call({ edit: false, view: false }, 'clip_create', create);
    expect(neither).toMatchObject({ ok: false, error: { detail: { grant: 'edit', grants: ['edit', 'view'] } } });
    expect(neither.ok ? '' : neither.error.message).toContain('Edit and View grants');
    expect(passed(await call({ edit: true, view: true }, 'clip_create', create))).toBe(stub('clip_create'));
    expect(passed(await call(editOnly, 'clip_create', { name: 'tmp' }))).toBe(stub('clip_create'));
    // An activation only changes what the user sees.
    expect(passed(await call(viewOnly, 'clip_update', { clip: 'agent', activate: true }))).toBe(stub('clip_update'));
    // operator_run clip.new/clip.duplicate {activate: true}: the same rule.
    for (const id of ['clip.new', 'clip.duplicate']) {
      expect(await call(viewOnly, 'operator_run', { id, args: { activate: true } })).toMatchObject(notGranted('edit'));
      expect(await call(editOnly, 'operator_run', { id, args: { activate: true } })).toMatchObject(notGranted('view'));
      expect(passed(await call(editOnly, 'operator_run', { id, args: { activate: false } }))).toBe(
        stub('operator_run'),
      );
    }
    // Headless, an activating create is an ordinary edit (no View there).
    const headless = createAgentToolRuntime({ app: fx.app, host: testHost(), actor: AGENT, tools: TOOLS });
    expect(passed(await headless.call('clip_create', create, { signal: signal() }))).toBe(stub('clip_create'));
  });
});
