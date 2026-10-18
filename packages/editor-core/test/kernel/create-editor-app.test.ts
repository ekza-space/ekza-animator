// createEditorApp over the real sibling packages. Until WP-1 (anim-core curve engine), WP-2 (memory store, scene
// clock) and WP-3 (curve cache, sampler, rig compiler) are merged their stubs throw `not-implemented`, so these
// tests skip themselves (MVP-SPEC §8.1: blocked tests name the blocking WP) and run as soon as the packages land; the
// model-import case also needs WP-4 (io parse, skeleton, format).
import { type AnimCurve, curveEngine, EkzaError } from '@ekza-animator/anim-core';
import {
  type AssetId,
  type CameraId,
  type CameraRecord,
  createMemoryStore,
  newId,
  type Partition,
  sceneToClipFrame,
  seededIdSource,
} from '@ekza-animator/doc';
import { readFixture } from '@ekza-animator/doc/testing';
import { detectModelFormat, parseGlb, skeletonFromGltf } from '@ekza-animator/io';
import { autoRig, compileRig, createCurveCache, writeRigDefinition } from '@ekza-animator/rig';
import { describe, expect, it } from 'vitest';
import {
  applyChannelEdits,
  beginChannelEditGesture,
  createEditorApp,
  createMemoryAssetStore,
  defaultPrefs,
  insertKeyOnCurve,
} from '../../src';
import { DEFAULT_DEPS } from '../../src/app/deps';
import { createKernelApp } from '../../src/app/kernel';
import { createFakeServices } from '../../src/testing';
import { placeholderContainer } from '../../src/testing/deps';
import type { EditorApp } from '../../src/types';
import { addOperator, DEG, edit, humanoidSkeleton, setFrame, W, waveDoc } from './support';

function implemented(probe: () => unknown): boolean {
  try {
    probe();
    return true;
  } catch (error) {
    return !(error instanceof EkzaError && error.code === 'not-implemented');
  }
}

const EMPTY: AnimCurve = { keys: [], weighted: false, pre: 'constant', post: 'constant' };
const WP1 = implemented(() => curveEngine.compile(EMPTY));
const WP2 =
  implemented(() => createMemoryStore()) &&
  implemented(() => sceneToClipFrame({ num: 30, den: 1 }, { fps: { num: 30, den: 1 }, sceneStart: 0 }, 0));
const WP3 =
  WP2 &&
  implemented(() => createCurveCache(createMemoryStore(), curveEngine)) &&
  implemented(() => compileRig(undefined as never, undefined as never));
const READY = WP1 && WP2 && WP3;
const WP4 = implemented(() => detectModelFormat({ asset: { version: '2.0' } }));

describe.skipIf(!READY)(
  'createEditorApp over the real packages (blocked by WP-1, WP-2, WP-3; the import case also by WP-4)',
  () => {
    function realApp() {
      const store = createMemoryStore();
      store.load(waveDoc());
      return createEditorApp({ services: createFakeServices(), store });
    }

    it("creates a working kernel with doc's memory store by default", () => {
      const app = createEditorApp({ services: createFakeServices() });
      expect(app.store.list('characters')).toEqual([]);
      expect(app.prefs.getState()).toEqual(defaultPrefs('other'));
      expect(app.session.getState().activeCharacter).toBeNull();
      app.dispose();
    });

    it('evaluates the wave clip with the AnimX engine', () => {
      const app = realApp();
      const rz = (frame: number) => {
        setFrame(app, frame);
        return app.evaluation.channelValues(W.lowerArmL).rz / DEG;
      };
      expect(rz(0)).toBeCloseTo(30, 9);
      expect(rz(15)).toBeCloseTo(-30, 9);
      expect(rz(30)).toBeCloseTo(30, 9);
    });

    it('keys, inserts shape-preserving keys and undoes through the editor history', () => {
      const app = realApp();
      setFrame(app, 20);
      edit(app, 'Key', (tx) =>
        applyChannelEdits(app, tx, [{ control: W.lowerArmL, channel: 'rz', value: 10 * DEG }], { key: 'force' }),
      );
      const samples = Array.from({ length: 121 }, (_, i) => i / 4);
      const value = (f: number) => curveEngine.evaluate(app.evaluation.compiledCurve(W.curve), f);
      const before = samples.map(value);
      edit(app, 'Insert Key', (tx) => insertKeyOnCurve(app, tx, W.curve, 7.5));
      samples.forEach((f, i) => expect(value(f)).toBeCloseTo(before[i] as number, 9));
      app.history.undo();
      app.history.undo();
      expect(app.store.query.keysOfCurve(W.curve).map((key) => key.t)).toEqual([0, 15, 30]);
    });

    /** The real kernel bindings, with runtimes built from the synthetic skeleton (the wave doc has no model bytes). */
    function realKernel(): EditorApp {
      const store = createMemoryStore();
      store.load(waveDoc());
      const skeleton = humanoidSkeleton();
      return createKernelApp(
        { services: createFakeServices(), store, builtins: false },
        {
          ...DEFAULT_DEPS,
          loadModel: (character) => ({ container: placeholderContainer(character.asset as AssetId), skeleton }),
        },
      );
    }

    it('compiles the rig and evaluates poses once per change with the real rig program and sampler', () => {
      const app = realKernel();
      const runtime = app.characters.get(W.character);
      expect(runtime).toBeDefined();
      expect(app.evaluation.tick()).toBe(true);
      expect(app.evaluation.tick()).toBe(false);
      const at0 = Array.from(runtime?.pose.boneWorld ?? []);
      setFrame(app, 15);
      expect(app.evaluation.tick()).toBe(true);
      expect(Array.from(runtime?.pose.boneWorld ?? [])).not.toEqual(at0);
      const out = runtime?.program.allocPose();
      if (runtime === undefined || out === undefined) throw new Error('no runtime');
      app.evaluation.evaluateAt(W.character, W.clip, 15, out);
      expect(Array.from(out.boneWorld)).toEqual(Array.from(runtime.pose.boneWorld));
      app.session.setState({ overrides: new Map([[W.upperArmL, { rz: 0.5 }]]) });
      expect(app.evaluation.tick()).toBe(true);
      expect(Array.from(runtime.pose.boneWorld)).not.toEqual(Array.from(out.boneWorld));
    });

    it('undo-all and redo-all are exact over the memory store (operators, gestures, direct commits, coalescing)', async () => {
      const camera: CameraRecord = {
        id: 'cam_ShotCamera000001' as CameraId,
        name: 'shotCam',
        projection: 'perspective',
        fovY: 0.6,
        orthoHeight: 2,
        near: 0.01,
        far: 100,
        transform: { t: [0, 1, 3], q: [0, 0, 0, 1], s: [1, 1, 1] },
        target: [0, 1, 0],
        aspect: null,
        locked: true,
        order: 'a0',
        deleted: null,
      };
      const doc = waveDoc();
      const store = createMemoryStore();
      store.load({ ...doc, tables: { ...doc.tables, cameras: { [camera.id]: camera } } });
      const app = createEditorApp({ services: createFakeServices(), store });
      const initial = app.store.snapshot();
      addOperator<{ readonly name: string }>(app, {
        id: 'test.rename',
        label: 'Rename Clip',
        category: 'clip',
        scope: 'global',
        flags: { undo: true },
        apply: (ctx, args) => ctx.tx?.patch('clips', W.clip, { name: args.name }),
      });
      setFrame(app, 5);
      await app.runUntyped('test.rename', { name: 'one' });
      const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
      gesture.update([
        { control: W.lowerArmL, channel: 'rz', value: 0.2 }, // keyed, auto-key off → override
        { control: W.upperArmL, channel: 'rz', value: 0.1 }, // unkeyed → static value
      ]);
      gesture.update([
        { control: W.lowerArmL, channel: 'rz', value: 0.3 },
        { control: W.upperArmL, channel: 'rz', value: 0.4 },
      ]);
      gesture.commit();
      const nudge = (v: number) =>
        app.store.transact({ label: 'Nudge', coalesceKey: 'nudge', coalesceMs: 60_000 }, (tx) =>
          tx.patch('keys', W.keys[1], { v }),
        );
      nudge(-0.1);
      nudge(-0.2);
      edit(app, 'Unlock Camera', (tx) => tx.patch('cameras', camera.id, { locked: false }));
      // Shot-camera navigation: committed outside the undo stack (§4.11.16), touching the same record.
      const navigate = app.store.beginPreview('Move Shot Camera');
      navigate.update((tx) => tx.patch('cameras', camera.id, { target: [1, 1, 0] }));
      navigate.commit({ undoable: false });
      expect(app.session.getState().dirty).toBe(true);

      const labels: string[] = [];
      for (let step = app.history.undo(); step !== null; step = app.history.undo()) {
        expect(step.warnings).toEqual([]);
        labels.push(step.label);
      }
      expect(labels).toEqual(['Unlock Camera', 'Nudge', 'Rotate', 'Rename Clip']);
      const undone = app.store.snapshot();
      expect(undone.tables.cameras[camera.id]).toEqual({ ...camera, target: [1, 1, 0] });
      expect({ ...undone, tables: { ...undone.tables, cameras: initial.tables.cameras } }).toEqual(initial);
      expect(app.session.getState().overrides.size).toBe(0);
      for (let step = app.history.redo(); step !== null; step = app.history.redo()) expect(step.warnings).toEqual([]);
      expect(app.store.get('clips', W.clip)?.name).toBe('one');
      expect(app.store.get('keys', W.keys[1])?.v).toBe(-0.2);
      expect(app.store.get('cameras', camera.id)).toMatchObject({ locked: false, target: [1, 1, 0] });
      expect(app.session.getState().overrides.get(W.lowerArmL)).toEqual({ rz: 0.3 });
      expect(app.evaluation.channelValues(W.upperArmL).rz).toBeCloseTo(0.4, 15);
    });

    it('keeps the history and the dirty flag when partitions close and reopen; a load clears both', async () => {
      const app = realApp();
      edit(app, 'Rename', (tx) => tx.patch('clips', W.clip, { name: 'x' }));
      const partition: Partition = `clip:${W.clip}`;
      app.store.close(partition);
      await app.store.open(partition);
      expect(app.store.query.keysOfCurve(W.curve)).toHaveLength(3);
      expect(app.history.peekUndo()?.label).toBe('Rename');
      expect(app.session.getState().dirty).toBe(true);
      app.store.load(waveDoc());
      expect(app.history.canUndo()).toBe(false);
      expect(app.session.getState().dirty).toBe(false);
    });

    it.skipIf(!WP4)(
      'creates the runtime of an imported model asynchronously through the asset store (WP-4)',
      async () => {
        const assets = createMemoryAssetStore();
        const services = { ...createFakeServices(), assets };
        const app = createEditorApp({ services, idSource: seededIdSource(7), builtins: false });
        const events: string[] = [];
        app.characters.subscribe((e) => events.push(e.type));
        const bytes = readFixture('seed-san.vrm');
        const asset = await assets.put(bytes, { name: 'seed-san.vrm', ext: 'vrm', role: 'model' });
        const container = await parseGlb(bytes);
        const skeleton = skeletonFromGltf(container);
        const character = newId('character');
        const rig = newId('rig');
        const def = autoRig(skeleton, { character, rig });
        app.store.transact({ label: 'Import' }, (tx) => {
          tx.put('assets', asset);
          tx.put('characters', {
            id: character,
            name: 'Seed-san',
            asset: asset.id,
            source: { kind: 'asset', asset: asset.id },
            format: detectModelFormat(container.json),
            rig,
            placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
            order: 'a0',
            deleted: null,
          });
          writeRigDefinition(tx, def);
        });
        expect(app.characters.get(character)).toBeUndefined(); // parsing the asset is asynchronous
        await (app.characters as unknown as { settled(): Promise<void> }).settled();
        const runtime = app.characters.get(character);
        expect(events).toEqual(['added']);
        expect(runtime?.skeleton.nodes.length).toBe(skeleton.nodes.length);
        expect(runtime?.program.controlIds.length).toBe(def.controls.length);
        expect(app.evaluation.tick()).toBe(true);
        // Rest pose: no clip, every control at its rest transform.
        const rest = runtime?.program.allocPose();
        if (runtime === undefined || rest === undefined) throw new Error('no runtime');
        runtime.program.evaluate(runtime.program.allocChannels(), rest);
        expect(Array.from(runtime.pose.boneWorld)).toEqual(Array.from(rest.boneWorld));
        app.dispose();
      },
    );
  },
);
