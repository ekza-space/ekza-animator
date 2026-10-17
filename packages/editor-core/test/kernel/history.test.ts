import { EkzaError } from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId } from '@ekza-animator/doc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyChannelEdits, beginChannelEditGesture } from '../../src';
import { HISTORY_COALESCE_MS, HISTORY_LIMIT } from '../../src/history/history';
import { createKernelApp } from '../../src/app/kernel';
import { createFakeServices } from '../../src/testing';
import { naiveKernelDeps } from '../../src/testing/deps';
import type { EditorApp, OverrideDelta } from '../../src/types';
import { addOperator, DEG, edit, humanoidSkeleton, setFrame, twoCharacterDoc, W, waveApp, waveDoc } from './support';

function registerEditOps(app: EditorApp): void {
  addOperator<{ readonly name: string }>(app, {
    id: 'test.rename',
    label: 'Rename Clip',
    category: 'clip',
    scope: 'global',
    flags: { undo: true },
    apply: (ctx, args) => ctx.tx?.patch('clips', W.clip, { name: args.name }),
  });
  addOperator<{ readonly control: ControlId; readonly rz: number }>(app, {
    id: 'test.pose',
    label: 'Edit Pose',
    category: 'pose',
    scope: 'global',
    flags: { undo: true },
    apply: (ctx, args) => {
      if (ctx.tx !== null) {
        applyChannelEdits(ctx.app, ctx.tx, [{ control: args.control, channel: 'rz', value: args.rz }], { key: 'auto' });
      }
    },
  });
}

const overrideOf = (app: EditorApp, control: ControlId = W.lowerArmL): ChannelValues | undefined =>
  app.session.getState().overrides.get(control);

describe('editor history (ADR 0013)', () => {
  it('interleaves operator doc steps, override steps, gesture steps and direct commits', async () => {
    const app = waveApp();
    registerEditOps(app);
    setFrame(app, 5);
    await app.runUntyped('test.rename', { name: 'one' }); // doc
    await app.runUntyped('test.pose', { control: W.lowerArmL, rz: 0.2 }); // keyed channel, auto-key off → override
    const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
    gesture.update([{ control: W.upperArmL, channel: 'rz', value: 0.1 }]); // unkeyed → static value (doc)
    gesture.update([{ control: W.upperArmL, channel: 'rz', value: 0.3 }]);
    gesture.commit();
    edit(app, 'Direct Edit', (tx) => tx.patch('clips', W.clip, { loop: false }));
    expect(app.history.peekUndo()?.label).toBe('Direct Edit');

    // State after each undo, by step label.
    const after: Record<string, unknown> = {};
    for (let step = app.history.undo(); step !== null; step = app.history.undo()) {
      expect(step.warnings).toEqual([]);
      after[step.label] = {
        name: app.store.get('clips', W.clip)?.name,
        loop: app.store.get('clips', W.clip)?.loop,
        upperArmRz: app.evaluation.channelValues(W.upperArmL).rz,
        override: overrideOf(app) ?? null,
      };
    }
    expect(after).toEqual({
      'Direct Edit': { name: 'one', loop: true, upperArmRz: expect.any(Number) as unknown, override: { rz: 0.2 } },
      Rotate: { name: 'one', loop: true, upperArmRz: 0, override: { rz: 0.2 } },
      'Edit Pose': { name: 'one', loop: true, upperArmRz: 0, override: null },
      'Rename Clip': { name: 'wave', loop: true, upperArmRz: 0, override: null },
    });
    expect(Object.keys(after)).toEqual(['Direct Edit', 'Rotate', 'Edit Pose', 'Rename Clip']);
    expect(app.store.undo.canUndo()).toBe(false);

    for (let step = app.history.redo(); step !== null; step = app.history.redo()) expect(step.warnings).toEqual([]);
    expect(app.store.get('clips', W.clip)).toMatchObject({ name: 'one', loop: false });
    expect(overrideOf(app)).toEqual({ rz: 0.2 });
    expect(app.evaluation.channelValues(W.upperArmL).rz).toBeCloseTo(0.3, 15);
  });

  it('clears the redo stack on any new step', async () => {
    const app = waveApp();
    registerEditOps(app);
    await app.runUntyped('test.rename', { name: 'a' });
    app.history.undo();
    expect(app.history.canRedo()).toBe(true);
    edit(app, 'Other', (tx) => tx.patch('clips', W.clip, { loop: false }));
    expect(app.history.canRedo()).toBe(false);
  });

  it('turns every direct undoable commit into a step: transactions and preview commits, not undoable: false', () => {
    const app = waveApp();
    edit(app, 'Move Key', (tx) => tx.patch('keys', W.keys[1], { t: 16 }));
    const preview = app.store.beginPreview('Drag Key');
    preview.update((tx) => tx.patch('keys', W.keys[1], { t: 17 }));
    preview.commit();
    const camera = app.store.beginPreview('Move Shot Camera');
    camera.update((tx) => tx.patch('project', 'project', { name: 'moved' }));
    camera.commit({ undoable: false });
    expect(app.history.peekUndo()?.label).toBe('Drag Key');
    app.history.undo();
    expect(app.store.get('keys', W.keys[1])?.t).toBe(16);
    app.history.undo();
    expect(app.store.get('keys', W.keys[1])?.t).toBe(15);
    expect(app.history.canUndo()).toBe(false);
    expect(app.store.get('project', 'project')?.name).toBe('moved');
  });

  it('extends a step when the store coalesces, and forgets it when coalesced edits cancel out', () => {
    let now = 1_000;
    const store = naiveKernelDeps(null).createStore();
    store.load(waveDoc());
    const app = createKernelApp(
      { services: createFakeServices(), store, builtins: false, now: () => now },
      naiveKernelDeps(humanoidSkeleton()),
    );
    const nudge = (v: number) =>
      app.store.transact({ label: 'Nudge', coalesceKey: 'nudge', coalesceMs: 60_000 }, (tx) =>
        tx.patch('keys', W.keys[0], { v }),
      );
    const original = app.store.get('keys', W.keys[0])?.v;
    nudge(1);
    nudge(2);
    expect(app.history.peekUndo()?.docTxId).toBe(app.store.undo.peekUndo()?.txId);
    app.history.undo();
    expect(app.history.canUndo()).toBe(false);
    expect(app.store.get('keys', W.keys[0])?.v).toBe(original);

    app.history.redo();
    expect(app.store.get('keys', W.keys[0])?.v).toBe(2);

    app.store.load(waveDoc());
    nudge(1);
    now += 10;
    nudge(original ?? 0); // back to the original value: the coalesced entry disappears
    expect(app.store.undo.canUndo()).toBe(false);
    expect(app.history.canUndo()).toBe(false);
  });

  it('coalesces override-only steps with the same key inside the window', () => {
    let now = 0;
    const store = naiveKernelDeps(null).createStore();
    store.load(waveDoc());
    const app = createKernelApp(
      { services: createFakeServices(), store, builtins: false, now: () => now },
      naiveKernelDeps(humanoidSkeleton()),
    );
    const delta = (before: number | undefined, after: number): OverrideDelta => ({
      character: W.character,
      clip: W.clip,
      clipFrame: 0,
      before: before === undefined ? new Map() : new Map([[W.lowerArmL, { rz: before }]]),
      after: new Map([[W.lowerArmL, { rz: after }]]),
    });
    app.history.record({ label: 'Nudge', docTxId: null, overrides: delta(undefined, 1), coalesceKey: 'cb.rz' });
    now += HISTORY_COALESCE_MS / 2;
    app.history.record({ label: 'Nudge', docTxId: null, overrides: delta(1, 2), coalesceKey: 'cb.rz' });
    const merged = app.history.peekUndo();
    expect(merged?.overrides?.before.size).toBe(0);
    expect(merged?.overrides?.after.get(W.lowerArmL)).toEqual({ rz: 2 });
    now += HISTORY_COALESCE_MS * 2;
    app.history.record({ label: 'Nudge', docTxId: null, overrides: delta(2, 3), coalesceKey: 'cb.rz' });
    expect(app.history.peekUndo()).not.toBe(merged);
    app.session.setState({ overrides: new Map([[W.lowerArmL, { rz: 3 }]]) });
    app.history.undo();
    expect(overrideOf(app)).toEqual({ rz: 2 });
    app.history.undo();
    expect(overrideOf(app)).toBeUndefined();
    expect(app.history.canUndo()).toBe(false);
    // Empty steps are ignored.
    app.history.record({ label: 'Nothing', docTxId: null, overrides: null });
    expect(app.history.canUndo()).toBe(false);
  });

  it('skips a doc part that is no longer on top, with a warning', async () => {
    const app = waveApp();
    registerEditOps(app);
    await app.runUntyped('test.rename', { name: 'a' });
    app.store.undo.undo(); // someone bypassed the editor history
    const result = app.history.undo();
    expect(result).toMatchObject({ label: 'Rename Clip', doc: null, overridesRestored: false });
    expect(result?.warnings).toHaveLength(1);
    expect(app.history.canUndo()).toBe(false);
  });

  it('keeps its stacks when the doc undo throws (preview active)', async () => {
    const app = waveApp();
    registerEditOps(app);
    await app.runUntyped('test.rename', { name: 'a' });
    const preview = app.store.beginPreview('Drag');
    expect(() => app.history.undo()).toThrow(EkzaError);
    expect(app.history.canUndo()).toBe(true);
    preview.cancel();
    app.history.undo();
    expect(app.store.get('clips', W.clip)?.name).toBe('wave');
  });

  it('drops override parts on frame change and clip switch; steps left empty disappear', async () => {
    const app = createKernelApp(
      {
        services: createFakeServices(),
        store: (() => {
          const store = naiveKernelDeps(null).createStore();
          store.load(twoCharacterDoc());
          return store;
        })(),
        builtins: false,
      },
      naiveKernelDeps(humanoidSkeleton()),
    );
    registerEditOps(app);
    setFrame(app, 5);
    await app.runUntyped('test.rename', { name: 'a' });
    await app.runUntyped('test.pose', { control: W.lowerArmL, rz: 0.3 });
    expect(overrideOf(app)).toEqual({ rz: 0.3 });
    // Another clip becomes active: overrides and their history parts go, the doc step stays.
    edit(app, 'New Clip', (tx) =>
      tx.put('clips', {
        ...(tx.get('clips', W.clip) as NonNullable<ReturnType<typeof tx.get<'clips'>>>),
        id: 'clp_SecondClip0000001' as typeof W.clip,
        name: 'other',
        order: 'a1',
      }),
    );
    app.session.setState({
      activeClip: { ...app.session.getState().activeClip, [W.character]: 'clp_SecondClip0000001' as typeof W.clip },
    });
    expect(overrideOf(app)).toBeUndefined();
    expect(app.history.peekUndo()?.label).toBe('New Clip');
    app.history.undo();
    expect(app.history.peekUndo()?.label).toBe('Rename Clip');
  });

  it('is cleared by a document load', async () => {
    const app = waveApp();
    registerEditOps(app);
    await app.runUntyped('test.rename', { name: 'a' });
    app.store.load(waveDoc());
    expect(app.history.canUndo()).toBe(false);
    expect(app.history.canRedo()).toBe(false);
  });

  it('keeps at most HISTORY_LIMIT steps', () => {
    const app = waveApp();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      app.history.record({
        label: `step ${i}`,
        docTxId: null,
        overrides: {
          character: W.character,
          clip: W.clip,
          clipFrame: 0,
          before: new Map(),
          after: new Map([[W.lowerArmL, { rz: i }]]),
        },
      });
    }
    let count = 0;
    let last = '';
    for (let step = app.history.undo(); step !== null; step = app.history.undo()) {
      count++;
      last = step.label;
    }
    expect(count).toBe(HISTORY_LIMIT);
    expect(last).toBe('step 5');
  });

  it('notifies subscribers on record, navigation, drops and clear', async () => {
    const app = waveApp();
    registerEditOps(app);
    let count = 0;
    const unsubscribe = app.history.subscribe(() => count++);
    setFrame(app, 3);
    await app.runUntyped('test.pose', { control: W.lowerArmL, rz: 0.1 });
    app.history.undo();
    app.history.redo();
    setFrame(app, 4); // drops the override step
    app.history.clear();
    expect(count).toBe(4);
    unsubscribe();
  });

  it('undo-all returns to the initial document and pose, redo-all to the final one (random sessions)', async () => {
    const controls = [W.lowerArmL, W.upperArmL] as const;
    const action = fc.oneof(
      fc.record({ kind: fc.constant('rename' as const), name: fc.stringMatching(/^[a-z]{1,6}$/) }),
      fc.record({
        kind: fc.constant('pose' as const),
        control: fc.constantFrom(0 as const, 1 as const),
        rz: fc.double({ min: -3, max: 3, noNaN: true }),
      }),
      fc.record({
        kind: fc.constant('drag' as const),
        control: fc.constantFrom(0 as const, 1 as const),
        values: fc.array(fc.double({ min: -3, max: 3, noNaN: true }), { minLength: 1, maxLength: 4 }),
      }),
      fc.record({ kind: fc.constant('direct' as const), v: fc.double({ min: -3, max: 3, noNaN: true }) }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(action, { minLength: 1, maxLength: 12 }), fc.boolean(), async (actions, autoKey) => {
        const app = waveApp();
        registerEditOps(app);
        app.prefs.setState({ autoKey });
        setFrame(app, 7);
        const initialDoc = app.store.snapshot();
        for (const a of actions) {
          if (a.kind === 'rename') await app.runUntyped('test.rename', { name: a.name });
          else if (a.kind === 'pose') await app.runUntyped('test.pose', { control: controls[a.control], rz: a.rz });
          else if (a.kind === 'direct') edit(app, 'Direct', (tx) => tx.patch('keys', W.keys[2], { v: a.v }));
          else {
            const gesture = beginChannelEditGesture(app, 'Drag', { key: 'auto' });
            for (const value of a.values) gesture.update([{ control: controls[a.control], channel: 'rz', value }]);
            gesture.commit();
          }
        }
        const finalDoc = app.store.snapshot();
        const finalOverrides = app.session.getState().overrides;
        while (app.history.undo() !== null) {
          // undo everything
        }
        expect(app.store.snapshot()).toEqual(initialDoc);
        expect(app.session.getState().overrides.size).toBe(0);
        while (app.history.redo() !== null) {
          // redo everything
        }
        expect(app.store.snapshot()).toEqual(finalDoc);
        expect(new Map(app.session.getState().overrides)).toEqual(new Map(finalOverrides));
      }),
      { numRuns: 60 },
    );
  });

  it('restores rotation values of the wave curve exactly', async () => {
    const app = waveApp();
    registerEditOps(app);
    app.prefs.setState({ autoKey: true });
    setFrame(app, 15);
    await app.runUntyped('test.pose', { control: W.lowerArmL, rz: -45 * DEG });
    expect(app.store.get('keys', W.keys[1])?.v).toBeCloseTo(-45 * DEG, 15);
    app.history.undo();
    expect(app.store.get('keys', W.keys[1])?.v).toBe(-Math.PI / 6);
  });
});
