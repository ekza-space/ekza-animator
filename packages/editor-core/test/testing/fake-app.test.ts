import { EkzaError } from '@ekza-animator/anim-core';
import type { ChannelValues, ClipId, ControlId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { createFakeEditorApp, createFakeServices, type FakeEditorApp } from '../../src/testing';
import type { OperatorDef } from '../../src/types';
import { humanoidSkeleton, WAVE, waveDoc } from './fixtures';

function waveApp(): FakeEditorApp {
  return createFakeEditorApp({ snapshot: waveDoc(), skeleton: humanoidSkeleton() });
}

const rename = (name: string): OperatorDef<{ readonly name: string }> => ({
  id: 'test.rename',
  label: 'Rename Clip',
  category: 'clip',
  scope: 'global',
  flags: { undo: true },
  apply: (ctx, args) => ctx.tx?.patch('clips', WAVE.clip, { name: args.name === '' ? name : args.name }),
});

const selectControls = (ids: readonly ControlId[]) => (app: FakeEditorApp) =>
  app.session.setState({ selection: { ...app.session.getState().selection, controls: ids } });

describe('createFakeEditorApp (test kit)', () => {
  it('loads the snapshot and activates the first character and its first clip', () => {
    const app = waveApp();
    const state = app.session.getState();
    expect(state.projectName).toBe('Wave (synthetic)');
    expect(state.activeCharacter).toBe(WAVE.character);
    expect(state.activeClip).toEqual({ [WAVE.character]: WAVE.clip });
    expect(state.dirty).toBe(false);
    expect(app.characters.list().map((runtime) => runtime.id)).toEqual([WAVE.character]);
    expect(app.evaluation.clipFrame(WAVE.character)).toBe(0);
    expect(app.prefs.getState()).toMatchObject({ navProfile: 'maya', autoKey: false, firstRunDone: true });
    expect(createFakeEditorApp({ platform: 'mac' }).prefs.getState().navProfile).toBe('trackpad');
  });

  it('works without a document or skeleton', () => {
    const app = createFakeEditorApp();
    expect(app.session.getState().activeCharacter).toBeNull();
    expect(app.characters.list()).toEqual([]);
    expect(app.evaluation.tick()).toBe(true);
  });

  describe('operator registry and runner', () => {
    it('records every run; unknown operators are cancelled', async () => {
      const app = waveApp();
      const result = await app.run('time.setFrame', { frame: 12 });
      expect(result).toEqual({ status: 'cancelled', reason: "unknown operator 'time.setFrame'" });
      await app.runUntyped('acme.custom', { x: 1 }, { panel: 'graph' });
      expect(app.calls).toEqual([
        { id: 'time.setFrame', args: { frame: 12 } },
        { id: 'acme.custom', args: { x: 1 } },
      ]);
      expect(app.operators.poll('acme.custom')).toEqual({ ok: false, reason: "unknown operator 'acme.custom'" });
    });

    it('runs a registered undoable operator as one transaction and one history step', async () => {
      const app = waveApp();
      app.contribute({ kind: 'operator', def: rename('x') as unknown as OperatorDef<unknown, unknown, unknown> });
      selectControls([WAVE.lowerArmL])(app);
      expect(await app.runUntyped('test.rename', { name: 'hello' })).toEqual({ status: 'finished', value: undefined });
      expect(app.store.get('clips', WAVE.clip)?.name).toBe('hello');
      expect(app.store.undo.peekUndo()?.label).toBe('Rename Clip');
      expect(app.history.peekUndo()).toMatchObject({ label: 'Rename Clip', docTxId: app.store.undo.peekUndo()?.txId });
      expect(app.session.getState().dirty).toBe(true);

      selectControls([])(app);
      const undone = app.history.undo();
      expect(undone).toMatchObject({ label: 'Rename Clip', overridesRestored: false, warnings: [] });
      expect(app.store.get('clips', WAVE.clip)?.name).toBe('wave');
      // The selection the step was made with comes back.
      expect(app.session.getState().selection.controls).toEqual([WAVE.lowerArmL]);
      app.history.redo();
      expect(app.store.get('clips', WAVE.clip)?.name).toBe('hello');
    });

    it('cancels on a failed poll, before and after prepare', async () => {
      const app = waveApp();
      let allow = true;
      app.operators.register<void, void, number>({
        id: 'test.gated',
        label: 'Gated',
        category: 'test',
        scope: 'global',
        poll: () => (allow ? true : { ok: false, reason: 'not now' }),
        prepare: async () => {
          allow = false;
          return 1;
        },
        apply: () => undefined,
      });
      expect(await app.runUntyped('test.gated')).toEqual({ status: 'cancelled', reason: 'not now' });
      expect(await app.runUntyped('test.gated')).toEqual({ status: 'cancelled', reason: 'not now' });
    });

    it('rolls back the document and the session when apply throws', async () => {
      const app = waveApp();
      app.operators.register({
        id: 'test.broken',
        label: 'Broken',
        category: 'test',
        scope: 'global',
        flags: { undo: true },
        apply: (ctx) => {
          ctx.tx?.patch('clips', WAVE.clip, { name: 'half-done' });
          ctx.app.session.setState({ dialog: 'about' });
          throw new EkzaError('unsupported', 'cannot finish');
        },
      });
      const before = app.store.snapshot();
      expect(await app.runUntyped('test.broken')).toEqual({
        status: 'failed',
        error: { code: 'unsupported', message: 'cannot finish' },
      });
      expect(app.store.snapshot()).toEqual(before);
      expect(app.session.getState().dialog).toBeNull();
      expect(app.history.canUndo()).toBe(false);
      app.operators.register({
        id: 'test.crash',
        label: 'Crash',
        category: 'test',
        scope: 'global',
        apply: () => {
          throw new Error('plain error');
        },
      });
      expect(await app.runUntyped('test.crash')).toMatchObject({ status: 'failed', error: { code: 'internal' } });
    });

    it('reports a throwing poll or prepare as failed', async () => {
      const app = waveApp();
      app.operators.register({
        id: 'test.badPoll',
        label: 'Bad poll',
        category: 'test',
        scope: 'global',
        poll: () => {
          throw new EkzaError('unsupported', 'poll exploded');
        },
        apply: () => undefined,
      });
      app.operators.register({
        id: 'test.badPrepare',
        label: 'Bad prepare',
        category: 'test',
        scope: 'global',
        prepare: () => Promise.reject(new EkzaError('asset-missing', 'gone')),
        apply: () => undefined,
      });
      expect(await app.runUntyped('test.badPoll')).toMatchObject({ status: 'failed', error: { code: 'unsupported' } });
      expect(await app.runUntyped('test.badPrepare')).toMatchObject({
        status: 'failed',
        error: { code: 'asset-missing' },
      });
    });

    it('throws nested-run when apply calls app.run', async () => {
      const app = waveApp();
      app.operators.register({
        id: 'test.nested',
        label: 'Nested',
        category: 'test',
        scope: 'global',
        apply: (ctx) => {
          void ctx.app.runUntyped('test.other');
        },
      });
      expect(await app.runUntyped('test.nested')).toMatchObject({ status: 'failed', error: { code: 'nested-run' } });
    });

    it('cancels while a gesture preview is active', async () => {
      const app = waveApp();
      app.contribute({ kind: 'operator', def: rename('x') as unknown as OperatorDef<unknown, unknown, unknown> });
      const preview = app.store.beginPreview('Drag');
      expect(await app.runUntyped('test.rename', { name: 'y' })).toEqual({
        status: 'cancelled',
        reason: 'gesture in progress',
      });
      preview.cancel();
    });

    it('adds no step for an operator that navigates the history, so redo survives', async () => {
      const app = waveApp();
      app.contribute({ kind: 'operator', def: rename('x') as unknown as OperatorDef<unknown, unknown, unknown> });
      app.operators.register({
        id: 'test.setPose',
        label: 'Edit Pose',
        category: 'test',
        scope: 'global',
        apply: (ctx) => ctx.app.session.setState({ overrides: new Map([[WAVE.lowerArmL, { rz: 0.5 }]]) }),
      });
      const navigate = (direction: 'undo' | 'redo'): OperatorDef<unknown, unknown, unknown> => ({
        id: `test.${direction}`,
        label: direction,
        category: 'edit',
        scope: 'global',
        apply: (ctx) => (direction === 'undo' ? ctx.app.history.undo() : ctx.app.history.redo()),
      });
      app.contribute({ kind: 'operator', def: navigate('undo') });
      app.contribute({ kind: 'operator', def: navigate('redo') });

      await app.runUntyped('test.rename', { name: 'hello' });
      await app.runUntyped('test.setPose');
      await app.runUntyped('test.undo');
      expect(app.session.getState().overrides.has(WAVE.lowerArmL)).toBe(false);
      await app.runUntyped('test.undo');
      expect(app.store.get('clips', WAVE.clip)?.name).toBe('wave');
      expect(app.history.canUndo()).toBe(false);
      expect(app.store.undo.canRedo()).toBe(true);
      expect(app.history.peekRedo()?.label).toBe('Rename Clip');

      await app.runUntyped('test.redo');
      expect(app.store.get('clips', WAVE.clip)?.name).toBe('hello');
      expect(app.history.peekUndo()?.docTxId).toBe(app.store.undo.peekUndo()?.txId);
      await app.runUntyped('test.redo');
      expect(app.session.getState().overrides.get(WAVE.lowerArmL)).toEqual({ rz: 0.5 });
      expect(app.history.canRedo()).toBe(false);
      expect(app.history.peekUndo()?.label).toBe('Edit Pose');
    });

    it('owns a doc entry only when apply committed it: undoable: false commits and doc undos add none', async () => {
      const app = waveApp();
      app.contribute({ kind: 'operator', def: rename('x') as unknown as OperatorDef<unknown, unknown, unknown> });
      app.operators.register({
        id: 'test.navigateCamera',
        label: 'Navigate',
        category: 'test',
        scope: 'global',
        apply: (ctx) => {
          const preview = ctx.app.store.beginPreview('Navigate');
          preview.update((tx) => tx.patch('project', 'project', { name: 'moved' }));
          preview.commit({ undoable: false });
        },
      });
      app.operators.register({
        id: 'test.storeUndo',
        label: 'Store undo',
        category: 'test',
        scope: 'global',
        apply: (ctx) => ctx.app.store.undo.undo(),
      });
      await app.runUntyped('test.rename', { name: 'first' });
      await app.runUntyped('test.rename', { name: 'second' });
      const step = app.history.peekUndo();
      await app.runUntyped('test.navigateCamera');
      expect(app.store.get('project', 'project')?.name).toBe('moved');
      expect(app.history.peekUndo()).toBe(step);
      // The doc undo stack's top is now the older 'first' entry, which apply did not create.
      await app.runUntyped('test.storeUndo');
      expect(app.store.get('clips', WAVE.clip)?.name).toBe('first');
      expect(app.history.peekUndo()).toBe(step);
      expect(app.store.undo.canRedo()).toBe(true);
    });

    it('extends the previous step when the store coalesces the transaction into its entry', async () => {
      const app = waveApp();
      app.operators.register<{ readonly v: number }, void, void>({
        id: 'test.nudge',
        label: 'Nudge',
        category: 'test',
        scope: 'global',
        apply: (ctx, args) =>
          ctx.app.store.transact({ label: 'Nudge', coalesceKey: 'nudge', coalesceMs: 60_000 }, (tx) =>
            tx.patch('keys', WAVE.keys[0], { v: args.v }),
          ),
      });
      await app.runUntyped('test.nudge', { v: 1 });
      await app.runUntyped('test.nudge', { v: 2 });
      expect(app.history.peekUndo()?.docTxId).toBe(app.store.undo.peekUndo()?.txId);
      app.history.undo();
      expect(app.history.canUndo()).toBe(false);
      expect(app.store.undo.canUndo()).toBe(false);
      expect(app.store.get('keys', WAVE.keys[0])?.v).toBeCloseTo(Math.PI / 6, 15);
    });

    it('records override edits as history steps that undo on the same frame only', async () => {
      const app = waveApp();
      const edit = (values: ChannelValues) =>
        app.operators.register({
          id: `test.override.${String(values.rz)}`,
          label: 'Edit Pose',
          category: 'test',
          scope: 'global',
          apply: (ctx) => {
            const overrides = new Map(ctx.app.session.getState().overrides);
            overrides.set(WAVE.lowerArmL, values);
            ctx.app.session.setState({ overrides });
          },
        });
      edit({ rz: 0.1 });
      edit({ rz: 0.2 });
      await app.runUntyped('test.override.0.1');
      await app.runUntyped('test.override.0.2');
      expect(app.history.peekUndo()?.overrides?.before.get(WAVE.lowerArmL)).toEqual({ rz: 0.1 });
      expect(app.history.undo()?.overridesRestored).toBe(true);
      expect(app.session.getState().overrides.get(WAVE.lowerArmL)).toEqual({ rz: 0.1 });
      app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 3 } });
      const result = app.history.undo();
      expect(result?.overridesRestored).toBe(false);
      expect(result?.warnings).toHaveLength(1);
      app.history.dropOverrides({ character: WAVE.character });
      expect(app.history.canRedo()).toBe(false);
    });
  });

  it('routes contributions to the registries and removes them on dispose', () => {
    const app = waveApp();
    const disposeImporter = app.contribute({
      kind: 'importer',
      def: { id: 'gltf-model', label: 'glTF', extensions: ['glb', 'vrm'], op: 'file.importModel' },
    });
    app.contribute({ kind: 'menu', def: { id: 'file.open', menu: 'file', op: 'file.open', group: 'io', order: 1 } });
    app.contribute({
      kind: 'keymap',
      bindings: [{ chord: { code: 'KeyS', mod: true }, op: 'file.save', scope: 'global' }],
    });
    expect(app.importers.list().map((def) => def.id)).toEqual(['gltf-model']);
    expect(() =>
      app.contribute({ kind: 'importer', def: { id: 'gltf-model', label: 'dup', extensions: [], op: 'file.open' } }),
    ).toThrow(EkzaError);
    disposeImporter();
    expect(app.importers.get('gltf-model')).toBeUndefined();
    expect(app.menus.get('file.open')?.op).toBe('file.open');

    const input = { code: 'KeyS', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, repeat: false };
    expect(app.keymap.resolve(input, ['graph', 'global'], 'press')?.op).toBe('file.save');
    expect(app.keymap.resolve({ ...input, shiftKey: true }, ['global'], 'press')).toBeNull();
    expect(app.keymap.label({ code: 'KeyS', mod: true, shift: true })).toBe('Ctrl+Shift+S');
    const mac = createFakeEditorApp({ platform: 'mac' });
    expect(mac.keymap.label({ code: 'KeyS', mod: true, shift: true })).toBe('⇧⌘S');
  });

  it('uses recording services by default and accepts overrides', async () => {
    const services = createFakeServices();
    const app = createFakeEditorApp({ services });
    app.services.files.download('a.glb', new Uint8Array([1]), 'model/gltf-binary');
    app.services.notify.toast({ kind: 'info', text: 'hi' });
    await app.services.clipboard.writeText('copied');
    expect(await app.services.clipboard.readText()).toBe('copied');
    expect(services.downloads.map((d) => d.fileName)).toEqual(['a.glb']);
    expect(services.toasts).toEqual([{ kind: 'info', text: 'hi' }]);
    const record = await app.services.assets.put(new Uint8Array(0), { name: 'empty.vrm', ext: 'vrm', role: 'model' });
    expect(record.id).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await app.services.assets.has(record.id)).toBe(true);
    await expect(app.services.assets.get('0'.repeat(64) as typeof record.id)).rejects.toMatchObject({
      code: 'asset-missing',
    });
  });

  it('plays back in scene frames and loops within the active clip', () => {
    const app = waveApp();
    app.session.setState({ time: { ...app.session.getState().time, playing: true } });
    expect(app.playback.advance(1_000)).toBe(false); // first tick only starts the clock
    expect(app.playback.advance(1_500)).toBe(true);
    expect(app.session.getState().time.sceneFrame).toBeCloseTo(15, 9);
    app.playback.advance(2_100);
    expect(app.session.getState().time.sceneFrame).toBeCloseTo(3, 9); // 33 wraps into [0, 30)
    app.session.setState({ time: { ...app.session.getState().time, loop: 'once' } });
    app.playback.advance(3_100);
    expect(app.session.getState().time).toMatchObject({ sceneFrame: 30, playing: false });
  });

  it('requests a frame when the pose is invalidated', () => {
    const app = waveApp();
    let requests = 0;
    app.setFrameRequester(() => requests++);
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 4 } });
    app.store.transact({ label: 'Edit' }, (tx) => tx.patch('keys', WAVE.keys[0], { v: 0 }));
    expect(requests).toBe(2);
    app.dispose();
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 5 } });
    expect(requests).toBe(2);
  });

  it('recompiles a runtime when its controls change', () => {
    const app = waveApp();
    const events: string[] = [];
    app.characters.subscribe((event) => events.push(event.type));
    const before = app.characters.get(WAVE.character)?.program;
    app.store.transact({ label: 'Hide' }, (tx) => tx.softDelete('controls', WAVE.handL));
    expect(events).toEqual(['recompiled']);
    expect(app.characters.get(WAVE.character)?.program).not.toBe(before);
    expect(app.characters.get(WAVE.character)?.program.controlIds).not.toContain(WAVE.handL);
    expect(app.evaluation.compiledCurve(WAVE.curve).keyCount).toBe(3);
    const clip: ClipId = WAVE.clip;
    expect(app.characters.get(WAVE.character)?.sampler(clip).keyTimes(null)).toEqual([0, 15, 30]);
  });
});
