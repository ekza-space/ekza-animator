import { EkzaError } from '@ekza-animator/anim-core';
import type { CharacterRecord, ControlRecord, DocSnapshot } from '@ekza-animator/doc';
import type { GlbContainer } from '@ekza-animator/io';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { describe, expect, it } from 'vitest';
import type { KernelDeps, ModelSource } from '../../src/app/deps';
import { createKernelApp } from '../../src/app/kernel';
import type { KernelCharacters } from '../../src/characters/registry';
import { createFakeServices, type FakeServices } from '../../src/testing';
import { naiveKernelDeps, placeholderContainer } from '../../src/testing/deps';
import type { CharacterEvent, DisplayModel, EditorApp, ModelLoader } from '../../src/types';
import { edit, humanoidSkeleton, SECOND, twoCharacterDoc, W, waveDoc } from './support';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A model loader that records calls and hands out disposable display models. */
function fakeModels() {
  const calls: string[] = [];
  const disposed: DisplayModel[] = [];
  let fail = false;
  const loader: ModelLoader = {
    setRenderer: (renderer) => {
      calls.push(`setRenderer:${String(renderer)}`);
    },
    load: (container) => {
      calls.push(`load:${container.sha256.slice(0, 8)}`);
      if (fail) return Promise.reject(new Error('no GPU'));
      const model: DisplayModel = { kind: 'three', handle: { id: calls.length }, dispose: () => disposed.push(model) };
      return Promise.resolve(model);
    },
  };
  return {
    loader,
    calls,
    disposed,
    failNext: () => {
      fail = true;
    },
  };
}

function build(opts: {
  readonly snapshot?: DocSnapshot;
  readonly loadModel?: KernelDeps['loadModel'];
  readonly deps?: Partial<KernelDeps['rig']>;
  readonly models?: ModelLoader | null;
}): {
  readonly app: EditorApp;
  readonly services: FakeServices;
  readonly characters: KernelCharacters;
  readonly events: string[];
} {
  const base = naiveKernelDeps(humanoidSkeleton());
  const deps: KernelDeps = {
    ...base,
    rig: { ...base.rig, ...opts.deps },
    loadModel: opts.loadModel ?? base.loadModel,
  };
  const store = deps.createStore();
  store.load(opts.snapshot ?? waveDoc());
  const services = { ...createFakeServices(), models: opts.models ?? null };
  const app = createKernelApp({ services, store, builtins: false }, deps);
  const events: string[] = [];
  app.characters.subscribe((e: CharacterEvent) => events.push(`${e.type}:${e.id}`));
  return { app, services, characters: app.characters as KernelCharacters, events };
}

const source = (character: CharacterRecord): ModelSource => ({
  container: placeholderContainer(character.asset),
  skeleton: humanoidSkeleton(),
});

describe('character registry', () => {
  it('creates runtimes after the model loads asynchronously', async () => {
    const gate = deferred<ModelSource>();
    const { app, characters, events } = build({ loadModel: () => gate.promise });
    expect(app.characters.list()).toEqual([]);
    expect(app.characters.get(W.character)).toBeUndefined();
    gate.resolve(source(app.store.get('characters', W.character) as CharacterRecord));
    await characters.settled();
    const runtime = app.characters.get(W.character);
    expect(runtime).toMatchObject({
      id: W.character,
      asset: app.store.get('characters', W.character)?.asset,
      display: null,
    });
    expect(runtime?.program.controlIds).toHaveLength(27);
    expect(events).toEqual([`added:${W.character}`]);
    // The new runtime is evaluated on the next tick.
    expect(app.evaluation.tick()).toBe(true);
  });

  it('loads model bytes through the asset store and reports failures once', async () => {
    const { app, services, characters, events } = build({
      loadModel: async (character, assets) => {
        await assets.get(character.asset);
        return source(character);
      },
    });
    await characters.settled();
    expect(app.characters.list()).toEqual([]);
    expect(services.toasts).toEqual([
      { kind: 'error', text: expect.stringContaining('Could not load "Synthetic Humanoid"') as unknown as string },
    ]);
    expect(events).toEqual([]);
    // The asset arrives and the document is reloaded: the failed character is retried.
    await app.services.assets.put(new Uint8Array(0), { name: 'synthetic-humanoid.vrm', ext: 'vrm', role: 'model' });
    app.store.load(waveDoc());
    await characters.settled();
    expect(app.characters.get(W.character)).toBeDefined();
  });

  it('never creates a runtime for a character deleted while loading; undo brings it back from the cache', async () => {
    const gate = deferred<ModelSource>();
    let loads = 0;
    const { app, characters, events } = build({
      loadModel: () => {
        loads++;
        return gate.promise;
      },
    });
    edit(app, 'Delete', (tx) => tx.softDelete('characters', W.character));
    gate.resolve(source(app.store.getIncludingDeleted('characters', W.character) as CharacterRecord));
    await characters.settled();
    expect(app.characters.list()).toEqual([]);
    app.history.undo();
    expect(app.characters.get(W.character)).toBeDefined(); // synchronous: the parsed model is cached
    expect(loads).toBe(1);
    app.history.redo();
    expect(app.characters.list()).toEqual([]);
    expect(events).toEqual([`added:${W.character}`, `removed:${W.character}`]);
  });

  it('recompiles in place on structural rig changes', () => {
    const { app, events } = build({});
    const runtime = app.characters.get(W.character);
    const program = runtime?.program;
    const sampler = runtime?.sampler(W.clip);
    edit(app, 'Hide', (tx) => tx.softDelete('controls', W.handL));
    expect(events).toEqual([`recompiled:${W.character}`]);
    expect(app.characters.get(W.character)).toBe(runtime);
    expect(runtime?.program).not.toBe(program);
    expect(runtime?.program.controlIds).not.toContain(W.handL);
    expect(runtime?.sampler(W.clip)).not.toBe(sampler);
    expect(runtime?.channels.values).toHaveLength(26 * 9);
    // Edits outside the rig tables do not recompile.
    edit(app, 'Key', (tx) => tx.patch('keys', W.keys[0], { v: 0 }));
    edit(app, 'Clip', (tx) => tx.patch('clips', W.clip, { name: 'x' }));
    edit(app, 'Character', (tx) => tx.patch('characters', W.character, { name: 'Renamed' }));
    expect(events).toHaveLength(1);
    expect(app.characters.get(W.character)).toBe(runtime);
  });

  it('waits for missing rig records and builds when they appear', () => {
    const doc = waveDoc();
    const tables = doc.tables as unknown as Record<string, Record<string, unknown>>;
    const rig = tables['rigs']?.['rig_SyntheticWave001'];
    const { app, events } = build({
      snapshot: { ...doc, tables: { ...doc.tables, rigs: {} } },
    });
    expect(app.characters.list()).toEqual([]);
    edit(app, 'Rig', (tx) => tx.put('rigs', rig as Parameters<typeof tx.put<'rigs'>>[1]));
    expect(events).toEqual([`added:${W.character}`]);
  });

  it('reports a failing rig compile and keeps going', () => {
    const { app, services } = build({
      deps: {
        compileRig: () => {
          throw new EkzaError('unsupported', 'bad rig');
        },
      },
    });
    expect(app.characters.list()).toEqual([]);
    expect(services.toasts[0]).toMatchObject({ kind: 'error', text: 'Could not load "Synthetic Humanoid": bad rig' });
  });

  it('gives no runtime when the loader has no model', () => {
    const { app } = build({ loadModel: () => null });
    expect(app.characters.list()).toEqual([]);
    expect(app.evaluation.channelValues(W.lowerArmL).rz).toBeCloseTo(Math.PI / 6, 12);
  });

  it('lists runtimes in character order and rebuilds a character whose asset changed', () => {
    const { app, events } = build({ snapshot: twoCharacterDoc() });
    expect(app.characters.list().map((r) => r.id)).toEqual([W.character, SECOND.character]);
    edit(app, 'Reorder', (tx) => tx.patch('characters', W.character, { order: 'a2' }));
    expect(app.characters.list().map((r) => r.id)).toEqual([SECOND.character, W.character]);
    const before = app.characters.get(SECOND.character);
    edit(app, 'Asset', (tx) =>
      tx.patch('characters', SECOND.character, { asset: 'f'.repeat(64) as CharacterRecord['asset'] }),
    );
    expect(app.characters.get(SECOND.character)).not.toBe(before);
    expect(app.characters.get(SECOND.character)?.asset).toBe('f'.repeat(64));
    expect(events.slice(-2)).toEqual([`removed:${SECOND.character}`, `added:${SECOND.character}`]);
  });

  it('loads display models only after setRenderer, emits display and disposes them with the runtime', async () => {
    const models = fakeModels();
    const { app, characters, events } = build({ models: models.loader });
    await Promise.resolve();
    expect(models.calls).toEqual([]);
    expect(app.services.models).not.toBe(models.loader);
    app.services.models?.setRenderer('gl');
    await characters.settled();
    expect(models.calls).toEqual(['setRenderer:gl', 'load:e3b0c442']);
    const runtime = app.characters.get(W.character);
    const display = runtime?.display;
    expect(display?.kind).toBe('three');
    // The runtime itself was created synchronously, before this test subscribed.
    expect(events).toEqual([`display:${W.character}`]);
    edit(app, 'Delete', (tx) => tx.softDelete('characters', W.character));
    expect(models.disposed).toEqual([display]);
    expect(runtime?.display).toBeNull();
  });

  it('warns when a display model fails to load; disposes models that arrive after removal', async () => {
    const models = fakeModels();
    models.failNext();
    const { app, services, characters } = build({ models: models.loader });
    app.services.models?.setRenderer('gl');
    await characters.settled();
    expect(services.toasts).toEqual([
      { kind: 'warning', text: 'The model of a character could not be displayed: no GPU' },
    ]);
    expect(app.characters.get(W.character)?.display).toBeNull();

    const late = fakeModels();
    const second = build({ models: late.loader });
    edit(second.app, 'Delete', (tx) => tx.softDelete('characters', W.character));
    second.app.services.models?.setRenderer('gl');
    await second.characters.settled();
    expect(late.disposed).toHaveLength(1);
  });

  it('disposes runtimes with the app', () => {
    const models = fakeModels();
    const { app } = build({ models: models.loader });
    const runtime = app.characters.get(W.character);
    app.dispose();
    expect(app.characters.list()).toEqual([]);
    expect(runtime).toBeDefined();
    app.dispose(); // idempotent
  });
});

describe('model sources', () => {
  it('builds runtimes from SkeletonDesc data only (no three.js)', () => {
    const skeleton: SkeletonDesc = humanoidSkeleton();
    const container: GlbContainer = placeholderContainer('a'.repeat(64) as CharacterRecord['asset']);
    expect(container.bytes.byteLength).toBe(0);
    expect(skeleton.nodes.length).toBeGreaterThan(20);
    const controls: ControlRecord[] = Object.values(waveDoc().tables.controls);
    expect(controls.every((control) => control.drives === null || 'humanoid' in control.drives.bone)).toBe(true);
  });
});
