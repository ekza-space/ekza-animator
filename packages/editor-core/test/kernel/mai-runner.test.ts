// MCP-SPEC §4.1 runner rules 1–9 (D0): actor runs are labelled `AI: …`, attributed (actor and change journal), never
// coalesce with user steps, carry no selection snapshots, stop on their signal, keep the user's session state
// (`agent-ustate` otherwise; `view` access exempt), forward their context to nested runs, and never run during the
// user's drag. Also the run scope helpers, `EditorHistory.entries()` and the presence registry.
import type { ControlId, Tx } from '@ekza-studio/doc';
import { createNaiveStore } from '../../src/testing';
import { describe, expect, it } from 'vitest';
import {
  AI_LABEL_MAX,
  applyChannelEdits,
  CANCELLED_BY_AGENT,
  CHANGE_JOURNAL_CAP,
  createPresenceRegistry,
  GESTURE_IN_PROGRESS,
  PRESENCE_MAX_CONTROLS,
  scopedCharacterOf,
  scopedClipOf,
  selectionOf,
  setSelectionOf,
} from '../../src';
import { createKernelApp } from '../../src/app/kernel';
import { createEditorHistory } from '../../src/history/history';
import { forward, runContextOf } from '../../src/operators/builtin/define';
import { operatorContext } from '../../src/operators/registry';
import type { CoalescingOperatorDef } from '../../src/operators/runner';
import { createFakeServices } from '../../src/testing';
import { naiveKernelDeps } from '../../src/testing/deps';
import type { EditorApp, OperatorContext, RunActor, RunContext, RunScope, Selection } from '../../src/types';
import {
  addOperator,
  humanoidSkeleton,
  kernelApp,
  SECOND,
  select,
  setFrame,
  twoCharacterDoc,
  W,
  waveApp,
  waveDoc,
} from './support';

const AGENT: RunActor = { kind: 'agent', id: 'agt_TestAgent00001', name: 'Test Agent' };
const AS_AGENT: RunContext = { source: 'api', actor: AGENT };

function registerRename(app: EditorApp): void {
  addOperator<{ readonly name: string }>(app, {
    id: 'test.rename',
    label: 'Rename Clip',
    category: 'clip',
    scope: 'global',
    flags: { undo: true },
    undoLabel: (args) => `Rename to ${args.name}`,
    apply: (ctx, args) => ctx.tx?.patch('clips', W.clip, { name: args.name }),
  });
}

/** A Channel Box style nudge (coalescing) that writes a static value (unkeyed channel) or an override. */
function registerNudge(app: EditorApp): void {
  const nudge: CoalescingOperatorDef<{
    readonly control: ControlId;
    readonly rz: number;
    readonly key?: 'auto' | 'none';
  }> = {
    id: 'test.nudge',
    label: 'Nudge',
    category: 'channel',
    scope: 'channelBox',
    flags: { undo: true },
    coalesce: (args) => ({ key: `nudge:${args.control}.rz`, ms: 60_000 }),
    apply: (ctx, args) => {
      if (ctx.tx !== null) {
        applyChannelEdits(ctx.app, ctx.tx, [{ control: args.control, channel: 'rz', value: args.rz }], {
          key: args.key ?? 'auto',
        });
      }
    },
  };
  app.operators.register(nudge);
}

function nudgeApp(): { app: EditorApp; tick: (ms?: number) => void } {
  let now = 1_000;
  const store = createNaiveStore({ now: () => now });
  store.load(waveDoc());
  const app = createKernelApp(
    { services: createFakeServices(), store, builtins: false, now: () => now },
    naiveKernelDeps(humanoidSkeleton()),
  );
  registerNudge(app);
  return {
    app,
    tick: (ms = 100) => {
      now += ms;
    },
  };
}

describe('runner rule 2: AI labels', () => {
  it('prefixes the step and the doc entry with "AI: " and records the actor and the changes', async () => {
    const app = waveApp();
    registerRename(app);
    const batches: unknown[] = [];
    app.store.subscribe((batch) => {
      if (batch.origin === 'local') batches.push(...batch.changes);
    });
    expect(await app.runUntyped('test.rename', { name: 'walk' }, AS_AGENT)).toEqual({
      status: 'finished',
      value: undefined,
    });
    const step = app.history.peekUndo();
    expect(step?.label).toBe('AI: Rename to walk');
    expect(app.store.undo.peekUndo()?.label).toBe('AI: Rename to walk');
    expect(step?.actor).toEqual(AGENT);
    expect(step?.changes).toEqual(batches);
    expect(step?.changes?.length).toBe(1);
  });

  it('prefixes a later tx.annotate label, never twice, and cuts labels at 80 characters', async () => {
    const app = waveApp();
    addOperator(app, {
      id: 'test.annotated',
      label: 'Annotated',
      category: 'test',
      scope: 'global',
      flags: { undo: true },
      apply: (ctx) => {
        ctx.tx?.patch('clips', W.clip, { name: 'x' });
        ctx.tx?.annotate({ label: 'Delete 3 Keys' });
      },
    });
    await app.runUntyped('test.annotated', undefined, AS_AGENT);
    expect(app.history.peekUndo()?.label).toBe('AI: Delete 3 Keys');
    registerRename(app);
    await app.runUntyped('test.rename', { name: 'n'.repeat(200) }, AS_AGENT);
    const label = app.history.peekUndo()?.label ?? '';
    expect(label.startsWith('AI: Rename to nnn')).toBe(true);
    expect(label.length).toBe(AI_LABEL_MAX);
    // A user run is unchanged.
    await app.runUntyped('test.rename', { name: 'mine' });
    expect(app.history.peekUndo()?.label).toBe('Rename to mine');
    expect(app.history.peekUndo()?.actor ?? null).toBeNull();
    expect(app.history.peekUndo()?.changes ?? null).toBeNull();
  });
});

describe('runner rule 4: no cross-actor coalescing', () => {
  it('a user nudge after an agent step, and an agent step after a user nudge, make new steps', async () => {
    const { app, tick } = nudgeApp();
    // Unkeyed channel: static values (doc writes) with a coalesce key.
    await app.runUntyped('test.nudge', { control: W.upperArmL, rz: 0.1 });
    tick();
    await app.runUntyped('test.nudge', { control: W.upperArmL, rz: 0.2 }, AS_AGENT);
    tick();
    await app.runUntyped('test.nudge', { control: W.upperArmL, rz: 0.3 });
    tick();
    await app.runUntyped('test.nudge', { control: W.upperArmL, rz: 0.4 });
    const { undo } = app.history.entries();
    expect(undo.map((step) => [step.label, step.actor?.name ?? 'user'])).toEqual([
      ['Nudge', 'user'],
      ['AI: Nudge', 'Test Agent'],
      ['Nudge', 'user'], // the two later user nudges merge with each other only
    ]);
    expect(undo[1]?.coalesceKey).toBeUndefined();
  });

  it('override-only steps never merge across actors (view-access proposals)', async () => {
    const { app, tick } = nudgeApp();
    setFrame(app, 5);
    // Keyed channel, auto-key off: an override; the agent's proposal runs with View access (rule 6 exempt).
    await app.runUntyped('test.nudge', { control: W.lowerArmL, rz: 0.5 }, { ...AS_AGENT, access: 'view' });
    tick();
    await app.runUntyped('test.nudge', { control: W.lowerArmL, rz: 0.6 });
    tick();
    await app.runUntyped('test.nudge', { control: W.lowerArmL, rz: 0.7 }, { ...AS_AGENT, access: 'view' });
    const { undo } = app.history.entries();
    expect(undo.map((step) => step.label)).toEqual(['AI: Nudge', 'Nudge', 'AI: Nudge']);
    expect(undo.every((step) => step.docTxId === null)).toBe(true);
    expect(undo[0]?.changes ?? null).toBeNull(); // override-only steps carry no change journal
  });
});

describe('runner rule 5: no selection snapshots', () => {
  it('undo and redo of an agent step leave the user selection as it is', async () => {
    const app = waveApp();
    registerRename(app);
    select(app, [W.handL]);
    await app.runUntyped('test.rename', { name: 'walk' }, AS_AGENT);
    const entry = app.store.undo.peekUndo();
    expect(entry?.selectionBefore).toBeUndefined();
    expect(entry?.selectionAfter).toBeUndefined();
    select(app, [W.lowerArmL]);
    const selection = app.session.getState().selection;
    app.history.undo();
    expect(app.session.getState().selection).toEqual(selection);
    app.history.redo();
    expect(app.session.getState().selection).toEqual(selection);
  });
});

describe('runner rule 1: the signal', () => {
  it('stops before the first poll, after prepare and right before apply', async () => {
    const app = waveApp();
    const calls: string[] = [];
    let abortIn: 'prepare' | 'poll2' | null = null;
    let controller = new AbortController();
    let polls = 0;
    addOperator(app, {
      id: 'test.slow',
      label: 'Slow',
      category: 'test',
      scope: 'global',
      flags: { undo: true },
      poll: () => {
        polls++;
        calls.push(`poll${polls}`);
        if (abortIn === 'poll2' && polls === 2) controller.abort();
        return true;
      },
      prepare: async () => {
        calls.push('prepare');
        if (abortIn === 'prepare') controller.abort();
      },
      apply: (ctx) => {
        calls.push('apply');
        ctx.tx?.patch('clips', W.clip, { name: 'x' });
      },
    });
    const run = () => app.runUntyped('test.slow', undefined, { ...AS_AGENT, signal: controller.signal });
    const cancelled = { status: 'cancelled', reason: CANCELLED_BY_AGENT };

    controller.abort();
    expect(await run()).toEqual(cancelled);
    expect(calls).toEqual([]);

    for (const where of ['prepare', 'poll2'] as const) {
      controller = new AbortController();
      calls.length = 0;
      polls = 0;
      abortIn = where;
      expect(await run()).toEqual(cancelled);
      expect(calls).toEqual(where === 'prepare' ? ['poll1', 'prepare'] : ['poll1', 'prepare', 'poll2']);
    }
    expect(app.history.canUndo()).toBe(false);
    expect(app.store.get('clips', W.clip)?.name).not.toBe('x');

    // Not aborted: the run completes.
    controller = new AbortController();
    abortIn = null;
    polls = 0;
    expect((await run()).status).toBe('finished');
  });
});

describe('runner rule 6: the session-state invariant', () => {
  function writer(app: EditorApp, id: `${string}.${string}`, write: (app: EditorApp) => void): void {
    addOperator(app, {
      id,
      label: 'Writer',
      category: 'test',
      scope: 'global',
      flags: { undo: true },
      apply: (ctx) => {
        ctx.tx?.patch('clips', W.clip, { name: 'changed' });
        write(ctx.app);
      },
    });
  }

  it('fails an agent run that writes session.selection with agent-ustate and rolls the document back', async () => {
    const app = waveApp();
    writer(app, 'test.selects', (a) => select(a, [W.handL]));
    select(app, [W.lowerArmL]);
    const before = app.session.getState();
    const name = app.store.get('clips', W.clip)?.name;
    const result = await app.runUntyped('test.selects', undefined, AS_AGENT);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.error.code).toBe('agent-ustate');
    expect(result.error.message).toBe('test.selects changed session.selection during an agent run');
    expect(app.store.get('clips', W.clip)?.name).toBe(name);
    expect(app.session.getState().selection).toBe(before.selection);
    expect(app.history.canUndo()).toBe(false);
    expect(app.store.undo.canUndo()).toBe(false);
  });

  it.each([
    ['time', (a: EditorApp) => setFrame(a, 7)],
    ['activeClip', (a: EditorApp) => a.session.setState({ activeClip: {} })],
    ['activeCharacter', (a: EditorApp) => a.session.setState({ activeCharacter: null })],
    ['overrides', (a: EditorApp) => a.session.setState({ overrides: new Map([[W.handL, { rz: 0.1 }]]) })],
    ['hiddenControls', (a: EditorApp) => a.session.setState({ hiddenControls: new Set([W.handL]) })],
  ])('guards session.%s', async (field, write) => {
    const app = waveApp();
    writer(app, 'test.writes', write);
    const result = await app.runUntyped('test.writes', undefined, AS_AGENT);
    expect(result.status === 'failed' ? result.error.message : result.status).toBe(
      `test.writes changed session.${field} during an agent run`,
    );
  });

  it('guards the preferences', async () => {
    const app = waveApp();
    writer(app, 'test.prefs', (a) => a.prefs.setState({ autoKey: !a.prefs.getState().autoKey }));
    const result = await app.runUntyped('test.prefs', undefined, AS_AGENT);
    expect(result.status === 'failed' ? result.error.code : result.status).toBe('agent-ustate');
  });

  it('exempts view-access runs and user runs', async () => {
    const app = waveApp();
    writer(app, 'test.selects', (a) => select(a, [W.handL]));
    expect((await app.runUntyped('test.selects', undefined, { ...AS_AGENT, access: 'view' })).status).toBe('finished');
    select(app, []);
    expect((await app.runUntyped('test.selects')).status).toBe('finished');
  });
});

describe('runner rule 7: context forwarding', () => {
  it('operatorContext copies the new fields; runContextOf and forward() keep actor, scope, signal and access', async () => {
    const app = waveApp();
    const seen: OperatorContext[] = [];
    addOperator(app, {
      id: 'test.inner',
      label: 'Inner',
      category: 'test',
      scope: 'global',
      apply: (ctx) => {
        seen.push(ctx);
        return 1;
      },
    });
    addOperator(app, {
      id: 'test.dispatch',
      label: 'Dispatch',
      category: 'test',
      scope: 'global',
      prepare: (ctx) => forward(ctx, 'test.inner', undefined),
      apply: () => undefined,
    });
    const signal = new AbortController().signal;
    const runScope: RunScope = { character: W.character, clip: W.clip, selection: { controls: [W.handL] } };
    await app.runUntyped('test.dispatch', undefined, { ...AS_AGENT, signal, runScope, access: 'edit' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ source: 'api', actor: AGENT, signal, runScope, access: 'edit' });

    const plain = operatorContext(app, undefined);
    expect(plain).toEqual({
      app,
      panel: null,
      paneId: null,
      // M6a: `source` is left out when the run context has none (M6a code tests `source === undefined`).
      actor: null,
      runScope: null,
      signal: null,
      access: null,
    });
    // A scope without an actor is ignored (rule: only meaningful with `actor`).
    expect(operatorContext(app, { runScope }).runScope).toBeNull();
    expect(runContextOf(plain)).toEqual({});
  });
});

describe('runner rule 9: the user drag', () => {
  it('never runs an agent edit during a store preview, not even a gesture-safe operator', async () => {
    const app = waveApp();
    registerRename(app);
    // `edit.escape` is the gesture-safe operator (it cancels the user's drag).
    addOperator(app, { id: 'edit.escape', label: 'Escape', category: 'edit', scope: 'global', apply: () => undefined });
    const preview = app.store.beginPreview('Drag');
    preview.update((tx: Tx) => tx.patch('clips', W.clip, { loop: true }));
    expect(await app.runUntyped('test.rename', { name: 'x' }, AS_AGENT)).toEqual({
      status: 'cancelled',
      reason: GESTURE_IN_PROGRESS,
    });
    expect(await app.runUntyped('edit.escape', undefined, AS_AGENT)).toEqual({
      status: 'cancelled',
      reason: GESTURE_IN_PROGRESS,
    });
    expect((await app.runUntyped('edit.escape')).status).toBe('finished'); // the user's escape still runs
    preview.cancel();
  });
});

describe('scope helpers (MCP-SPEC §4.1)', () => {
  const ctxOf = (app: EditorApp, run?: RunContext) => operatorContext(app, run);

  it('user runs read and write the session', () => {
    const app = kernelApp({ snapshot: twoCharacterDoc() });
    select(app, [W.handL]);
    const ctx = ctxOf(app);
    expect(selectionOf(ctx)).toBe(app.session.getState().selection);
    expect(scopedCharacterOf(ctx)).toBe(app.session.getState().activeCharacter);
    const character = app.session.getState().activeCharacter;
    if (character === null) throw new Error('no active character');
    expect(scopedClipOf(ctx, character)).toBe(app.session.getState().activeClip[character] ?? null);
    const next: Selection = { ...app.session.getState().selection, controls: [W.lowerArmL] };
    setSelectionOf(ctx, next);
    expect(app.session.getState().selection).toBe(next);
  });

  it('actor runs read the scope (missing parts empty, never the user selection) and never write', () => {
    const app = kernelApp({ snapshot: twoCharacterDoc() });
    select(app, [W.handL]);
    const empty = ctxOf(app, AS_AGENT);
    expect(selectionOf(empty).controls).toEqual([]);
    expect(selectionOf(empty).keys.size).toBe(0);
    expect(selectionOf(empty).channels).toEqual([]);
    const scoped = ctxOf(app, {
      ...AS_AGENT,
      runScope: { character: SECOND.character, clip: SECOND.clip, selection: { controls: [SECOND.lowerArmL] } },
    });
    expect(selectionOf(scoped).controls).toEqual([SECOND.lowerArmL]);
    expect(scopedCharacterOf(scoped)).toBe(SECOND.character);
    expect(scopedClipOf(scoped, SECOND.character)).toBe(SECOND.clip);
    // A scope clip of another character falls back to that character's active clip.
    expect(scopedClipOf(scoped, W.character)).toBe(app.session.getState().activeClip[W.character] ?? null);
    // Without a scope character: the session's.
    expect(scopedCharacterOf(empty)).toBe(app.session.getState().activeCharacter);
    const before = app.session.getState().selection;
    setSelectionOf(scoped, { ...before, controls: [W.cog] });
    expect(app.session.getState().selection).toBe(before);
  });
});

describe('EditorHistory.entries() (MCP-SPEC §4.1)', () => {
  it('lists both stacks oldest first, frozen, with stable ids', async () => {
    const app = waveApp();
    registerRename(app);
    for (const name of ['a', 'b', 'c']) await app.runUntyped('test.rename', { name }, name === 'b' ? AS_AGENT : {});
    const first = app.history.entries();
    expect(first.undo.map((step) => step.label)).toEqual(['Rename to a', 'AI: Rename to b', 'Rename to c']);
    expect(first.redo).toEqual([]);
    expect(Object.isFrozen(first.undo)).toBe(true);
    expect(Object.isFrozen(first.undo[0])).toBe(true);
    const ids = first.undo.map((step) => step.id);
    app.history.undo();
    app.history.undo();
    const second = app.history.entries();
    expect(second.undo.map((step) => step.id)).toEqual([ids[0]]);
    // Redo: the next redo first (chronological order of the undone steps).
    expect(second.redo.map((step) => step.id)).toEqual([ids[1], ids[2]]);
    expect(second.redo[0]?.actor).toEqual(AGENT);
    app.history.redo();
    expect(app.history.entries().undo.map((step) => step.id)).toEqual([ids[0], ids[1]]);
  });

  it('caps the change journal oldest first and drops a step’s changes with its doc part', () => {
    const store = createNaiveStore();
    store.load(waveDoc());
    const app = waveApp();
    const history = createEditorHistory({
      store,
      session: app.session,
      now: () => 0,
      locate: () => null,
      restoreSelection: () => {},
      reconcile: () => {},
      navigated: () => {},
      journalCap: 5,
    });
    const change = { table: 'clips', id: W.clip, before: undefined, after: undefined } as never;
    history.record({
      label: 'AI: one',
      docTxId: 'tx1',
      overrides: null,
      actor: AGENT,
      changes: [change, change, change],
    });
    history.record({ label: 'AI: two', docTxId: 'tx2', overrides: null, actor: AGENT, changes: [change, change] });
    expect(history.entries().undo.map((step) => step.changes?.length ?? null)).toEqual([3, 2]);
    history.record({ label: 'AI: three', docTxId: 'tx3', overrides: null, actor: AGENT, changes: [change] });
    expect(history.entries().undo.map((step) => step.changes?.length ?? null)).toEqual([null, 2, 1]);
    history.forgetDocEntry('tx3');
    expect(history.entries().undo.map((step) => step.label)).toEqual(['AI: one', 'AI: two']);
    expect(CHANGE_JOURNAL_CAP).toBe(200_000);
  });
});

describe('presence registry (MCP-SPEC §4.1)', () => {
  it('notifies on changes, ignores identical upserts, caps focus controls and removes peers', () => {
    let now = 10;
    const presence = createPresenceRegistry({ now: () => now });
    let events = 0;
    const off = presence.subscribe(() => events++);
    const controls = Array.from({ length: 80 }, (_, i) => `rig:c${i}` as ControlId);
    const peer = {
      id: AGENT.id,
      kind: 'agent' as const,
      name: AGENT.name,
      color: '--presence-agent',
      focus: { character: W.character, clip: W.clip, controls, frame: 12 },
      activity: 'Set pose (3 controls) @ f12',
    };
    presence.upsert(peer);
    expect(events).toBe(1);
    expect(presence.version).toBe(1);
    expect(presence.get(AGENT.id)?.since).toBe(10);
    expect(presence.get(AGENT.id)?.focus?.controls).toHaveLength(PRESENCE_MAX_CONTROLS);
    now = 20;
    presence.upsert({ ...peer, focus: { ...peer.focus, controls: [...controls] } });
    expect(events).toBe(1); // same content (also after the cap): no event, `since` kept
    expect(presence.get(AGENT.id)?.since).toBe(10);
    presence.upsert({ ...peer, activity: null });
    expect(events).toBe(2);
    expect(presence.get(AGENT.id)?.since).toBe(20);
    const list = presence.list();
    expect(Object.isFrozen(list)).toBe(true);
    expect(presence.list()).toBe(list);
    presence.remove('nobody');
    expect(events).toBe(2);
    presence.remove(AGENT.id);
    expect(events).toBe(3);
    expect(presence.list()).toEqual([]);
    off();
    presence.upsert(peer);
    expect(events).toBe(3);
    expect(() => presence.upsert({ ...peer, id: '' })).toThrow(/non-empty id/);
  });

  it('is part of every kernel app', () => {
    const app = waveApp();
    expect(app.presence.list()).toEqual([]);
  });
});
