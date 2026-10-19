// MCP-SPEC §5.8, §5.9, §5.11, §5.12 (P2): the runtime's full call path — edits one at a time in arrival order while
// reads run at once, the rate limit and the queue cap, the gesture wait (progress, busy, cancel), the redo wait with
// a user session (the card, Deny → redo_pending, resolved when the user redoes), confirmations with a timeout, pause
// meeting a queued call, read-only projects, presence focus cleared after the call, toasts returned as warnings.
import type { ClipId } from '@ekza-animator/doc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  type AgentToolDef,
  type AgentToolResult,
  allTools,
  createAgentToolRuntime,
  defineTool,
  FOCUS_LINGER_MS,
  finishedValue,
  QUEUE_MAX,
  RATE_BURST,
  schemas,
  WAITING_FOR_DRAG,
  WAITING_FOR_REDO,
} from '../src';
import {
  AGENT,
  call,
  controlOf,
  dataOf,
  errorOf,
  host,
  type HostOptions,
  liveHost,
  type P2Fixture,
  p2Fixture,
  signal,
} from './p2-support';

/** An edit tool whose run waits for `gate` before running its operator (one AI step: the clip's loop flag). */
function gatedEdit(name: string, gates: Map<string, Promise<void>>, order: string[]): AgentToolDef {
  return defineTool({
    name,
    title: 'Gated edit',
    description: 'Gated edit used by the runtime tests.',
    group: 'keys',
    input: z.strictObject({ ...schemas.scoped, ...schemas.writes, tag: z.string().max(20).describe('Tag.') }),
    output: z.object({ tag: z.string() }),
    annotations: { readOnly: false, destructive: true, idempotent: false },
    access: 'edit',
    hosts: ['live', 'headless'],
    alwaysLoad: false,
    stretch: false,
    kind: 'edit',
    budget: { tokens: 400, maxTokens: 1_500 },
    ready: true,
    async run(ctx, args): Promise<AgentToolResult<{ tag: string }>> {
      order.push(`start ${args.tag}`);
      await (gates.get(args.tag) ?? Promise.resolve());
      const character = ctx.resolve.character(args.character);
      const clip = ctx.resolve.clip(character.id, args.clip);
      ctx.focus({ character: character.id, clip: clip.id, controls: [], frame: 3 }, `Edit ${args.tag}`);
      const run = await ctx.run('test.toggleLoop', { clip: clip.id, label: `Toggle ${args.tag}` });
      finishedValue('test.toggleLoop', run.result);
      order.push(`end ${args.tag}`);
      return { ok: true, data: { tag: args.tag } };
    },
  });
}

const quickRead = defineTool({
  name: 'scene_quick',
  title: 'Quick read',
  description: 'Quick read used by the runtime tests.',
  group: 'scene',
  input: z.strictObject({}),
  output: z.object({ at: z.string() }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: { tokens: 400, maxTokens: 1_500 },
  ready: true,
  run: () => Promise.resolve({ ok: true, data: { at: 'read' } }),
});

let fx: P2Fixture;
beforeEach(async () => {
  fx = await p2Fixture(71);
  fx.app.operators.register<{ readonly clip: ClipId; readonly label?: string }, void, void>({
    id: 'test.toggleLoop',
    label: 'Toggle Loop',
    category: 'test',
    scope: 'global',
    flags: { undo: true, internal: true },
    undoLabel: (args) => args.label ?? 'Toggle Loop',
    apply: (ctx, args) => {
      const clip = ctx.app.store.get('clips', args.clip);
      ctx.tx?.patch('clips', args.clip, { loop: clip?.loop !== true });
      ctx.app.services.notify.toast({ kind: 'warning', text: 'Loop toggled' });
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function runtime(
  opts: HostOptions = {},
  extra: readonly AgentToolDef[] = [],
  timing?: { gestureWaitMs?: number; confirmTimeoutMs?: number },
) {
  return createAgentToolRuntime({
    app: fx.tools,
    host: opts.mode === 'live' ? liveHost(opts) : host(opts),
    actor: AGENT,
    tools: [...allTools(), ...extra],
    ...timing,
  });
}

describe('the queue and the rate limit (§5.8 2–3)', () => {
  it('runs edits one at a time in arrival order; reads run at once', async () => {
    const gates = new Map<string, Promise<void>>();
    const order: string[] = [];
    const gate = deferred();
    gates.set('A', gate.promise);
    const rt = runtime({}, [gatedEdit('keys_gated', gates, order), quickRead]);
    const a = rt.call('keys_gated', { clip: 'agent', tag: 'A' }, { signal: signal() });
    const b = rt.call('keys_gated', { clip: 'agent', tag: 'B' }, { signal: signal() });
    const read = await rt.call('scene_quick', {}, { signal: signal() });
    expect(dataOf(read)).toEqual({ at: 'read' });
    expect(order).toEqual(['start A']);
    gate.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['start A', 'end A', 'start B', 'end B']);
    const labels = fx.app.history
      .entries()
      .undo.slice(-2)
      .map((step) => step.label);
    expect(labels).toEqual(['AI: Toggle A', 'AI: Toggle B']);
  });

  it('drops a queued call whose signal aborts, keeping the order of the rest', async () => {
    const gates = new Map<string, Promise<void>>();
    const order: string[] = [];
    const gate = deferred();
    gates.set('A', gate.promise);
    const rt = runtime({}, [gatedEdit('keys_gated', gates, order)]);
    const a = rt.call('keys_gated', { clip: 'agent', tag: 'A' }, { signal: signal() });
    const abort = new AbortController();
    const b = rt.call('keys_gated', { clip: 'agent', tag: 'B' }, { signal: abort.signal });
    const c = rt.call('keys_gated', { clip: 'agent', tag: 'C' }, { signal: signal() });
    abort.abort();
    expect(errorOf(await b).code).toBe('cancelled');
    gate.resolve();
    await Promise.all([a, c]);
    expect(order).toEqual(['start A', 'end A', 'start C', 'end C']);
  });

  it('answers busy beyond the burst of the rate limit and beyond the queue cap', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const gates = new Map<string, Promise<void>>();
    const gate = deferred();
    gates.set('A', gate.promise);
    const rt = runtime({}, [gatedEdit('keys_gated', gates, []), quickRead]);
    const reads = await Promise.all(
      Array.from({ length: RATE_BURST + 1 }, () => rt.call('scene_quick', {}, { signal: signal() })),
    );
    expect(reads.filter((result) => !result.ok).map((result) => errorOf(result).code)).toEqual(['busy']);
    now += 10_000; // the bucket refills
    const calls: Promise<AgentToolResult<unknown>>[] = [
      rt.call('keys_gated', { clip: 'agent', tag: 'A' }, { signal: signal() }),
    ];
    await Promise.resolve();
    for (let i = 0; i < QUEUE_MAX; i++) {
      now += 100;
      calls.push(rt.call('keys_gated', { clip: 'agent', tag: `q${i}` }, { signal: signal() }));
    }
    now += 100;
    const over = await rt.call('keys_gated', { clip: 'agent', tag: 'over' }, { signal: signal() });
    expect(errorOf(over)).toMatchObject({ code: 'busy', message: `${QUEUE_MAX} calls are already waiting.` });
    gate.resolve();
    expect((await Promise.all(calls)).every((result) => result.ok)).toBe(true);
  });
});

describe('the gesture wait (§5.8 4)', () => {
  it('waits for the user’s drag with a progress message, then runs', async () => {
    const preview = fx.app.store.beginPreview('Drag');
    const released = deferred();
    const rt = runtime({ waitForGesture: () => released.promise.then(() => true) });
    const progress: (string | undefined)[] = [];
    const pending = rt.call(
      'keys_set',
      { clip: 'agent', keys: [{ control: 'cog', channel: 'ty', frame: 0, value: 0.05 }] },
      { signal: signal(), progress: (_d, _t, message) => progress.push(message) },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(progress).toContain(WAITING_FOR_DRAG);
    preview.cancel();
    released.resolve();
    expect((await pending).ok).toBe(true);
  });

  it('answers busy when the drag outlasts the wait, cancelled when the call is cancelled', async () => {
    const busy = await call(runtime({ waitForGesture: () => Promise.resolve(false) }), 'keys_set', {
      clip: 'agent',
      keys: [{ control: 'cog', channel: 'ty', frame: 0, value: 0.05 }],
    });
    expect(errorOf(busy)).toMatchObject({ code: 'busy', retryable: true });
    const abort = new AbortController();
    const rt = runtime({ waitForGesture: () => new Promise(() => undefined) });
    fx.app.store.beginPreview('Drag');
    const pending = rt.call(
      'keys_set',
      { clip: 'agent', keys: [{ control: 'cog', channel: 'ty', frame: 0, value: 0.05 }] },
      { signal: abort.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    abort.abort();
    expect(errorOf(await pending).code).toBe('cancelled');
    fx.app.store.preview?.cancel();
  });
});

describe('the redo wait (§5.8 4a, §5.12)', () => {
  /** Two user edits (operators without an actor), then the user undoes both. */
  async function userUndidTwo(): Promise<void> {
    const cog = controlOf(fx.app, fx.character, 'cog');
    for (const value of [0.01, 0.02]) {
      const result = await fx.app.runUntyped('channel.setValues', {
        edits: [{ control: cog, channel: 'ty', value }],
        key: 'force',
      });
      expect(result.status).toBe('finished');
    }
    fx.app.history.undo();
    fx.app.history.undo();
    expect(fx.app.history.entries().redo).toHaveLength(2);
  }
  const edit = { clip: 'agent', keys: [{ control: 'cog', channel: 'ty', frame: 0, value: 0.05 }] };

  it('asks before clearing the user’s redo; Deny answers redo_pending and the redo stays', async () => {
    await userUndidTwo();
    const prompts: { title: string }[] = [];
    const progress: (string | undefined)[] = [];
    const rt = runtime({ mode: 'live', answer: 'deny', prompts: prompts as never });
    const result = await rt.call('keys_set', edit, { signal: signal(), progress: (_d, _t, m) => progress.push(m) });
    expect(errorOf(result)).toMatchObject({ code: 'redo_pending', retryable: false });
    expect(prompts[0]?.title).toBe('AI edit will clear your redo (2 steps)');
    expect(progress).toContain(WAITING_FOR_REDO);
    expect(fx.app.history.canRedo()).toBe(true);
  });

  it('proceeds by itself once the user redid their steps', async () => {
    await userUndidTwo();
    const rt = runtime({
      mode: 'live',
      answer: async (_prompt, _signal, resolvedWhen) => {
        fx.app.history.redo();
        fx.app.history.redo();
        await Promise.resolve();
        return resolvedWhen?.() === true ? 'resolved' : 'deny';
      },
    });
    expect((await rt.call('keys_set', edit, { signal: signal() })).ok).toBe(true);
  });

  it('does not ask when the redo stack holds only AI steps', async () => {
    const rt = runtime({ mode: 'live', answer: 'deny' });
    expect((await rt.call('keys_set', edit, { signal: signal() })).ok).toBe(true);
    fx.app.history.undo();
    expect((await rt.call('keys_set', edit, { signal: signal() })).ok).toBe(true);
  });
});

describe('confirmations, pause and read-only projects (§5.9)', () => {
  it('answers declined when the card times out', async () => {
    const rt = runtime({ mode: 'live', answer: () => new Promise(() => undefined) }, [], { confirmTimeoutMs: 30 });
    const result = await rt.call('clip_delete', { clip: 'clip1' }, { signal: signal() });
    expect(errorOf(result)).toMatchObject({ code: 'declined' });
    expect(errorOf(result).message).toContain('in time');
    expect(fx.app.store.query.clipsOfCharacter(fx.character).some((clip) => clip.name === 'clip1')).toBe(true);
  });

  it('answers cancelled at once when the call is cancelled during a card, even if the host ignores the abort', async () => {
    const opened = deferred();
    const rt = runtime(
      {
        mode: 'live',
        answer: () => {
          opened.resolve();
          return new Promise(() => undefined); // never settles, ignores its signal
        },
      },
      [],
      { confirmTimeoutMs: 60_000 },
    );
    const abort = new AbortController();
    const pending = rt.call('clip_delete', { clip: 'clip1' }, { signal: abort.signal });
    await opened.promise;
    const started = Date.now();
    abort.abort();
    expect(errorOf(await pending).code).toBe('cancelled');
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(fx.app.store.query.clipsOfCharacter(fx.character).some((clip) => clip.name === 'clip1')).toBe(true);
  });

  it('meets a pause that came while the call waited in the queue', async () => {
    let paused = false;
    const gates = new Map<string, Promise<void>>();
    const gate = deferred();
    gates.set('A', gate.promise);
    const order: string[] = [];
    const rt = runtime({ paused: () => paused }, [gatedEdit('keys_gated', gates, order)]);
    const a = rt.call('keys_gated', { clip: 'agent', tag: 'A' }, { signal: signal() });
    const b = rt.call('keys_gated', { clip: 'agent', tag: 'B' }, { signal: signal() });
    await vi.waitFor(() => expect(order).toEqual(['start A']));
    paused = true; // A is running (it finishes under the grants it started with); B waits in the queue
    gate.resolve();
    expect(await a).toMatchObject({ ok: true });
    expect(errorOf(await b)).toMatchObject({ code: 'paused', retryable: false });
  });

  it('answers read_only for edits on a read-only project; reads still work', async () => {
    fx.app.store.load(fx.app.store.snapshot(), { readOnly: true });
    const rt = runtime();
    const edit = await rt.call(
      'keys_set',
      { clip: 'agent', keys: [{ control: 'cog', channel: 'ty', frame: 0, value: 0 }] },
      { signal: signal() },
    );
    expect(errorOf(edit).code).toBe('read_only');
    expect(
      dataOf<{ project: { readOnly: boolean } }>(await rt.call('scene_summary', {}, { signal: signal() })).project
        .readOnly,
    ).toBe(true);
  });
});

describe('presence and toasts (§5.11, §4.4)', () => {
  it('sets the actor’s focus during a live call and clears it after the call', async () => {
    const gates = new Map<string, Promise<void>>();
    const rt = runtime({ mode: 'live', capabilities: ['user', 'confirm', 'presence', 'view'] }, [
      gatedEdit('keys_gated', gates, []),
    ]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const result = await rt.call('keys_gated', { clip: 'agent', tag: 'A' }, { signal: signal() });
    expect(result.ok).toBe(true);
    expect(fx.app.presence.get(AGENT.id)).toMatchObject({
      focus: { clip: fx.agentClip, frame: 3 },
      activity: 'Edit A',
    });
    vi.advanceTimersByTime(FOCUS_LINGER_MS + 1);
    expect(fx.app.presence.get(AGENT.id)).toMatchObject({ focus: null, activity: null });
  });

  it('keeps a waiting edit’s activity while reads run, and clears the focus only after the last call', async () => {
    const cog = controlOf(fx.app, fx.character, 'cog');
    for (const value of [0.01, 0.02]) {
      await fx.app.runUntyped('channel.setValues', { edits: [{ control: cog, channel: 'ty', value }], key: 'force' });
    }
    fx.app.history.undo();
    const card = deferred();
    const rt = runtime({
      mode: 'live',
      answer: async () => {
        await card.promise;
        return 'deny';
      },
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const edit = rt.call(
      'keys_set',
      { clip: 'agent', keys: [{ control: 'cog', channel: 'ty', frame: 0, value: 0.05 }] },
      { signal: signal() },
    );
    await vi.waitFor(() => expect(fx.app.presence.get(AGENT.id)?.activity).toBe('waiting: you have 1 step to redo'));
    // a read while the edit waits on the redo card: the edit keeps speaking for the actor
    expect((await rt.call('scene_summary', {}, { signal: signal() })).ok).toBe(true);
    expect(fx.app.presence.get(AGENT.id)?.activity).toBe('waiting: you have 1 step to redo');
    vi.advanceTimersByTime(FOCUS_LINGER_MS + 1);
    expect(fx.app.presence.get(AGENT.id)?.activity).toBe('waiting: you have 1 step to redo');
    card.resolve();
    expect(errorOf(await edit).code).toBe('redo_pending');
    // no call left: the focus lingers, then clears
    expect(fx.app.presence.get(AGENT.id)?.activity).not.toBeNull();
    vi.advanceTimersByTime(FOCUS_LINGER_MS + 1);
    expect(fx.app.presence.get(AGENT.id)).toMatchObject({ focus: null, activity: null });
  });

  it('returns the toasts an operator raised as warnings', async () => {
    const rt = runtime({}, [gatedEdit('keys_gated', new Map(), [])]);
    const result = await rt.call('keys_gated', { clip: 'agent', tag: 'A' }, { signal: signal() });
    expect(result.ok && result.warnings).toEqual(['Loop toggled']);
  });
});
