import { EkzaError } from '@ekza-animator/anim-core';
import type { ControlId, Tx } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { applyChannelEdits } from '../../src';
import { createNaiveStore } from '../../src/testing';
import { naiveKernelDeps } from '../../src/testing/deps';
import { createKernelApp } from '../../src/app/kernel';
import type { CoalescingOperatorDef } from '../../src/operators/runner';
import { createFakeServices } from '../../src/testing';
import { addOperator, DEG, select, setFrame, W, waveApp, waveDoc, humanoidSkeleton } from './support';

const rename = {
  id: 'test.rename',
  label: 'Rename Clip',
  category: 'clip',
  scope: 'global',
  flags: { undo: true },
  undoLabel: (args: { readonly name: string }) => `Rename to ${args.name}`,
  apply: (ctx: { readonly tx: Tx | null }, args: { readonly name: string }) => {
    ctx.tx?.patch('clips', W.clip, { name: args.name });
    return args.name.length;
  },
} as const;

describe('operator runner (§4.11.0)', () => {
  it('runs an undoable operator as one transaction and one history step labelled by undoLabel', async () => {
    const app = waveApp();
    addOperator(app, rename);
    const result = await app.runUntyped('test.rename', { name: 'hello' });
    expect(result).toEqual({ status: 'finished', value: 5 });
    expect(app.store.get('clips', W.clip)?.name).toBe('hello');
    expect(app.store.undo.peekUndo()?.label).toBe('Rename to hello');
    expect(app.history.peekUndo()).toMatchObject({ label: 'Rename to hello', overrides: null });
    expect(app.history.peekUndo()?.docTxId).toBe(app.store.undo.peekUndo()?.txId);
  });

  it('restores the selection of each step on undo (before) and redo (after)', async () => {
    const app = waveApp();
    addOperator(app, {
      id: 'test.renameAndSelect',
      label: 'Rename',
      category: 'clip',
      scope: 'global',
      flags: { undo: true },
      apply: (ctx) => {
        ctx.tx?.patch('clips', W.clip, { name: 'x' });
        select(ctx.app, [W.handL]);
      },
    });
    select(app, [W.lowerArmL]);
    await app.runUntyped('test.renameAndSelect');
    expect(app.session.getState().selection.controls).toEqual([W.handL]);
    select(app, []);
    app.history.undo();
    expect(app.session.getState().selection.controls).toEqual([W.lowerArmL]);
    app.history.redo();
    expect(app.session.getState().selection.controls).toEqual([W.handL]);
  });

  it('awaits prepare, which may dispatch other operators, then applies with the prepared value', async () => {
    const app = waveApp();
    const order: string[] = [];
    addOperator(app, { id: 'test.inner', label: 'Inner', category: 'test', scope: 'global', apply: () => 21 });
    addOperator<void, number, number>(app, {
      id: 'test.outer',
      label: 'Outer',
      category: 'test',
      scope: 'global',
      prepare: async (ctx) => {
        order.push('prepare');
        const inner = await ctx.app.runUntyped('test.inner');
        return inner.status === 'finished' ? (inner.value as number) : 0;
      },
      apply: (_ctx, _args, prepared) => {
        order.push('apply');
        return prepared * 2;
      },
    });
    expect(await app.runUntyped('test.outer')).toEqual({ status: 'finished', value: 42 });
    expect(order).toEqual(['prepare', 'apply']);
    expect(app.calls.map((call) => call.id)).toEqual(['test.outer', 'test.inner']);
  });

  it('cancels on a failing poll before or after prepare, without applying', async () => {
    const app = waveApp();
    let allow = true;
    let applied = 0;
    addOperator<void, void, void>(app, {
      id: 'test.gated',
      label: 'Gated',
      category: 'test',
      scope: 'global',
      poll: () => (allow ? true : { ok: false, reason: 'not now' }),
      prepare: () => {
        allow = false;
      },
      apply: () => {
        applied++;
      },
    });
    expect(await app.runUntyped('test.gated')).toEqual({ status: 'cancelled', reason: 'not now' });
    allow = true;
    expect(await app.runUntyped('test.gated')).toEqual({ status: 'cancelled', reason: 'not now' });
    expect(applied).toBe(0);
  });

  it('passes the run context to poll, prepare and apply', async () => {
    const app = waveApp();
    const seen: unknown[] = [];
    addOperator(app, {
      id: 'test.ctx',
      label: 'Ctx',
      category: 'test',
      scope: 'graph',
      poll: (ctx) => {
        seen.push(['poll', ctx.panel, ctx.paneId, ctx.app === app]);
        return true;
      },
      prepare: (ctx) => {
        seen.push(['prepare', ctx.panel, ctx.paneId]);
      },
      apply: (ctx) => {
        seen.push(['apply', ctx.panel, ctx.paneId, ctx.tx]);
      },
    });
    await app.runUntyped('test.ctx', undefined, { panel: 'graph', paneId: 'pane-left' });
    await app.runUntyped('time.stop');
    expect(seen).toEqual([
      ['poll', 'graph', 'pane-left', true],
      ['prepare', 'graph', 'pane-left'],
      ['poll', 'graph', 'pane-left', true],
      ['apply', 'graph', 'pane-left', null],
    ]);
  });

  it('cancels while a preview (gesture) is active', async () => {
    const app = waveApp();
    addOperator(app, rename);
    const preview = app.store.beginPreview('Drag');
    expect(await app.runUntyped('test.rename', { name: 'y' })).toEqual({
      status: 'cancelled',
      reason: 'gesture in progress',
    });
    preview.cancel();
    expect((await app.runUntyped('test.rename', { name: 'y' })).status).toBe('finished');
  });

  it('throws nested-run synchronously inside apply; the outer run fails and rolls back', async () => {
    const app = waveApp();
    addOperator(app, rename);
    let thrown: unknown = null;
    addOperator(app, {
      id: 'test.nested',
      label: 'Nested',
      category: 'test',
      scope: 'global',
      flags: { undo: true },
      apply: (ctx) => {
        ctx.tx?.patch('clips', W.clip, { name: 'half' });
        try {
          void ctx.app.runUntyped('test.rename', { name: 'inner' });
        } catch (error) {
          thrown = error;
          throw error;
        }
      },
    });
    expect(await app.runUntyped('test.nested')).toMatchObject({ status: 'failed', error: { code: 'nested-run' } });
    expect(thrown).toBeInstanceOf(EkzaError);
    expect(app.store.get('clips', W.clip)?.name).toBe('wave');
    expect(app.history.canUndo()).toBe(false);
    // Typed run is guarded the same way.
    addOperator(app, {
      id: 'test.nestedTyped',
      label: 'Nested',
      category: 'test',
      scope: 'global',
      apply: (ctx) => {
        void ctx.app.run('time.stop');
      },
    });
    expect(await app.runUntyped('test.nestedTyped')).toMatchObject({ status: 'failed', error: { code: 'nested-run' } });
  });

  it('rolls back the document and the whole session when apply throws; maps error codes', async () => {
    const app = waveApp();
    addOperator(app, {
      id: 'test.broken',
      label: 'Broken',
      category: 'test',
      scope: 'global',
      flags: { undo: true },
      apply: (ctx) => {
        ctx.tx?.patch('clips', W.clip, { name: 'half-done' });
        ctx.app.session.setState({ dialog: 'about', overrides: new Map([[W.lowerArmL, { rz: 1 }]]) });
        throw new EkzaError('unsupported', 'cannot finish');
      },
    });
    const before = app.store.snapshot();
    const session = app.session.getState();
    expect(await app.runUntyped('test.broken')).toEqual({
      status: 'failed',
      error: { code: 'unsupported', message: 'cannot finish' },
    });
    expect(app.store.snapshot()).toEqual(before);
    expect(app.session.getState()).toBe(session);
    expect(app.history.canUndo()).toBe(false);
    addOperator(app, {
      id: 'test.crash',
      label: 'Crash',
      category: 'test',
      scope: 'global',
      apply: () => {
        throw new TypeError('plain');
      },
    });
    expect(await app.runUntyped('test.crash')).toEqual({
      status: 'failed',
      error: { code: 'internal', message: 'plain' },
    });
    addOperator(app, {
      id: 'test.badPrepare',
      label: 'Bad',
      category: 'test',
      scope: 'global',
      prepare: () => Promise.reject(new EkzaError('asset-missing', 'gone')),
      apply: () => undefined,
    });
    expect(await app.runUntyped('test.badPrepare')).toMatchObject({
      status: 'failed',
      error: { code: 'asset-missing' },
    });
  });

  it('fails with read-only on a read-only document', async () => {
    const store = createNaiveStore();
    store.load(waveDoc(), { readOnly: true });
    const app = createKernelApp(
      { services: createFakeServices(), store, builtins: false },
      naiveKernelDeps(humanoidSkeleton()),
    );
    addOperator(app, rename);
    expect(await app.runUntyped('test.rename', { name: 'x' })).toMatchObject({
      status: 'failed',
      error: { code: 'read-only' },
    });
  });

  it('runs prepares concurrently and applies atomically in completion order', async () => {
    const app = waveApp();
    const gates = new Map<string, () => void>();
    const applied: string[] = [];
    for (const name of ['slow', 'fast']) {
      addOperator<void, void, void>(app, {
        id: `test.${name}`,
        label: name,
        category: 'test',
        scope: 'global',
        flags: { undo: true },
        prepare: () => new Promise<void>((resolve) => gates.set(name, resolve)),
        apply: (ctx) => {
          applied.push(name);
          ctx.tx?.patch('clips', W.clip, { name });
        },
      });
    }
    const slow = app.runUntyped('test.slow');
    const fast = app.runUntyped('test.fast');
    await Promise.resolve();
    gates.get('fast')?.();
    await fast;
    gates.get('slow')?.();
    await slow;
    expect(applied).toEqual(['fast', 'slow']);
    expect(app.store.get('clips', W.clip)?.name).toBe('slow');
    app.history.undo();
    expect(app.store.get('clips', W.clip)?.name).toBe('fast');
    app.history.undo();
    expect(app.store.get('clips', W.clip)?.name).toBe('wave');
  });

  it('names the step after the annotated transaction label', async () => {
    const app = waveApp();
    addOperator(app, {
      id: 'test.deleteKeys',
      label: 'Delete Keys',
      category: 'graph',
      scope: 'global',
      flags: { undo: true },
      apply: (ctx) => {
        ctx.tx?.remove('keys', W.keys[1]);
        ctx.tx?.annotate({ label: 'Delete 1 Key' });
      },
    });
    await app.runUntyped('test.deleteKeys');
    expect(app.history.peekUndo()?.label).toBe('Delete 1 Key');
  });

  it('coalesces opted-in runs (Channel Box nudges): doc parts through the store, override parts in the history', async () => {
    let now = 1_000;
    const store = createNaiveStore({ now: () => now });
    store.load(waveDoc());
    const app = createKernelApp(
      { services: createFakeServices(), store, builtins: false, now: () => now },
      naiveKernelDeps(humanoidSkeleton()),
    );
    setFrame(app, 5);
    const nudge: CoalescingOperatorDef<{ readonly control: ControlId; readonly rz: number }> = {
      id: 'test.nudge',
      label: 'Nudge',
      category: 'channel',
      scope: 'channelBox',
      flags: { undo: true },
      coalesce: (args) => ({ key: `nudge:${args.control}.rz`, ms: 500 }),
      apply: (ctx, args) => {
        if (ctx.tx !== null) {
          applyChannelEdits(ctx.app, ctx.tx, [{ control: args.control, channel: 'rz', value: args.rz }], {
            key: 'auto',
          });
        }
      },
    };
    app.operators.register(nudge);
    // Unkeyed channel: static values (document), merged by the store into one entry and one step.
    for (const rz of [0.1, 0.2, 0.3]) {
      await app.runUntyped('test.nudge', { control: W.upperArmL, rz });
      now += 100;
    }
    // Keyed channel, auto-key off: overrides only, merged by the history.
    for (const rz of [0.5, 0.6]) {
      await app.runUntyped('test.nudge', { control: W.lowerArmL, rz });
      now += 100;
    }
    now += 1_000; // outside the window: a new step
    await app.runUntyped('test.nudge', { control: W.lowerArmL, rz: 0.7 });
    const overrides = () => app.session.getState().overrides.get(W.lowerArmL);
    const upperRz = () => app.evaluation.channelValues(W.upperArmL).rz;

    expect(app.history.undo()?.label).toBe('Nudge');
    expect(overrides()).toEqual({ rz: 0.6 });
    expect(app.history.undo()?.overridesRestored).toBe(true);
    expect(overrides()).toBeUndefined();
    expect(upperRz()).toBeCloseTo(0.3, 15);
    app.history.undo();
    expect(upperRz()).toBe(0);
    expect(app.history.canUndo()).toBe(false);
    expect(app.store.undo.canUndo()).toBe(false);
  });

  it('records no step for an undoable operator that changed nothing', async () => {
    const app = waveApp();
    addOperator(app, {
      id: 'test.noop',
      label: 'Noop',
      category: 'test',
      scope: 'global',
      flags: { undo: true },
      apply: () => 1,
    });
    expect(await app.runUntyped('test.noop')).toEqual({ status: 'finished', value: 1 });
    expect(app.store.undo.canUndo()).toBe(false);
    expect(app.history.canUndo()).toBe(false);
  });

  it('records override edits of any operator at the active clip frame, but not when the run moved the frame', async () => {
    const app = waveApp();
    setFrame(app, 5);
    const setOverride = (id: `${string}.${string}`, values: { readonly rz: number }, frame?: number) =>
      addOperator(app, {
        id,
        label: 'Edit Pose',
        category: 'test',
        scope: 'global',
        apply: (ctx) => {
          if (frame !== undefined) setFrame(ctx.app, frame);
          ctx.app.session.setState({ overrides: new Map([[W.lowerArmL, values]]) });
        },
      });
    setOverride('test.pose', { rz: 0.4 });
    await app.runUntyped('test.pose');
    expect(app.history.peekUndo()?.overrides).toMatchObject({ character: W.character, clip: W.clip, clipFrame: 5 });
    app.history.undo();
    expect(app.session.getState().overrides.size).toBe(0);
    app.history.redo();
    expect(app.session.getState().overrides.get(W.lowerArmL)).toEqual({ rz: 0.4 });

    setOverride('test.poseElsewhere', { rz: 0.9 }, 9);
    const steps = app.history.peekUndo();
    await app.runUntyped('test.poseElsewhere');
    expect(app.session.getState().overrides.get(W.lowerArmL)).toEqual({ rz: 0.9 });
    // The frame moved during the run: the old overrides were discarded and the new ones are not a step.
    expect(app.history.peekUndo()).not.toBe(steps);
    expect(app.history.canUndo()).toBe(false);
  });

  it('consumes overrides when keying: the earlier override step loses its part, the key step restores it', async () => {
    const app = waveApp();
    setFrame(app, 5);
    addOperator(app, {
      id: 'test.rotate',
      label: 'Rotate',
      category: 'test',
      scope: 'global',
      flags: { undo: true },
      apply: (ctx) => {
        if (ctx.tx !== null)
          applyChannelEdits(ctx.app, ctx.tx, [{ control: W.lowerArmL, channel: 'rz', value: 10 * DEG }], {
            key: 'auto',
          });
      },
    });
    addOperator(app, {
      id: 'test.key',
      label: 'Set Key',
      category: 'test',
      scope: 'global',
      flags: { undo: true },
      apply: (ctx) => {
        const value = ctx.app.evaluation.channelValues(W.lowerArmL).rz;
        if (ctx.tx !== null)
          applyChannelEdits(ctx.app, ctx.tx, [{ control: W.lowerArmL, channel: 'rz', value }], { key: 'force' });
      },
    });
    await app.runUntyped('test.rotate');
    expect(app.session.getState().overrides.get(W.lowerArmL)).toEqual({ rz: 10 * DEG });
    expect(app.history.peekUndo()).toMatchObject({ label: 'Rotate', docTxId: null });
    await app.runUntyped('test.key');
    expect(app.session.getState().overrides.size).toBe(0);
    expect(app.store.query.keysOfCurve(W.curve).map((key) => key.t)).toEqual([0, 5, 15, 30]);
    // One step: undo removes the key and brings the unkeyed pose back; nothing older is left.
    const undone = app.history.undo();
    expect(undone).toMatchObject({ label: 'Set Key', overridesRestored: true, warnings: [] });
    expect(app.store.query.keysOfCurve(W.curve).map((key) => key.t)).toEqual([0, 15, 30]);
    expect(app.session.getState().overrides.get(W.lowerArmL)).toEqual({ rz: 10 * DEG });
    expect(app.history.canUndo()).toBe(false);
    app.history.redo();
    expect(app.session.getState().overrides.size).toBe(0);
    expect(app.store.query.keysOfCurve(W.curve)).toHaveLength(4);
  });

  it('resolves typed run arguments and reports unknown operators', async () => {
    const app = waveApp();
    expect(await app.run('time.setFrame', { frame: 3 })).toEqual({
      status: 'cancelled',
      reason: "unknown operator 'time.setFrame'",
    });
    const control: ControlId = W.lowerArmL;
    expect(await app.runUntyped('select.controls', { ids: [control], mode: 'replace' })).toMatchObject({
      status: 'cancelled',
    });
    expect(app.calls).toEqual([
      { id: 'time.setFrame', args: { frame: 3 } },
      { id: 'select.controls', args: { ids: [control], mode: 'replace' } },
    ]);
  });
});
