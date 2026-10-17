import { mat4Compose, mat4Multiply, type Quat } from '@ekza-animator/anim-core';
import type { CharacterId, ControlRecord } from '@ekza-animator/doc';
import type { FakeEditorApp } from '@ekza-animator/editor-core/testing';
import { createFakeEditorApp } from '@ekza-animator/editor-core/testing';
import type { LoadedModel } from '@ekza-animator/io/three';
import type { SkeletonDesc } from '@ekza-animator/rig';
import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  Quaternion,
  Scene,
  type SkinnedMesh,
  WebGLRenderer,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlLayer } from '../src/controls/ControlLayer';
import { LAYER } from '../src/layers';
import { SkeletonLayer } from '../src/overlays/skeleton';
import { SceneSync } from '../src/sync/SceneSync';
import { fixtures } from './helpers';

const LEFT_HAND = 11;
const LEFT_INDEX = 12;

interface Setup {
  readonly app: FakeEditorApp;
  readonly scene: Scene;
  readonly controls: ControlLayer;
  readonly sync: SceneSync;
  readonly character: CharacterId;
}

let current: Setup | null = null;
afterEach(() => {
  current?.sync.dispose();
  current?.app.dispose();
  current = null;
});

async function setup(skeletonPatch?: Partial<SkeletonDesc>): Promise<Setup> {
  const { snapshot, skeleton } = await fixtures();
  const app = createFakeEditorApp({ snapshot, skeleton: { ...skeleton, ...skeletonPatch } });
  const scene = new Scene();
  scene.matrixWorldAutoUpdate = false;
  const controls = new ControlLayer();
  const sync = new SceneSync({ app, scene, controls, skeleton: new SkeletonLayer(), onChange: () => {} });
  const character = app.store.list('characters')[0]?.id as CharacterId;
  current = { app, scene, controls, sync, character };
  return current;
}

/** A display model built from the skeleton: one Object3D per node under a root group (what io/three provides). */
function modelOf(skeleton: SkeletonDesc, extras?: Partial<LoadedModel>): LoadedModel & { readonly nodes: Object3D[] } {
  const root = new Group();
  const nodes = skeleton.nodes.map((node) => {
    const object = new Object3D();
    object.name = node.name;
    object.position.set(...node.restLocal.t);
    object.quaternion.set(...node.restLocal.q);
    return object;
  });
  for (const node of skeleton.nodes) {
    const parent = node.parent === -1 ? root : nodes[node.parent];
    parent?.add(nodes[node.index] as Object3D);
  }
  return {
    root,
    nodes,
    nodeObjects: nodes,
    skinnedMeshes: [] as SkinnedMesh[],
    vrm: null,
    springBones: null,
    nodeConstraints: null,
    dispose: () => {},
    ...extras,
  };
}

function control(app: FakeEditorApp, key: string): ControlRecord {
  const record = app.store.list('controls').find((c) => c.key === key);
  if (record === undefined) throw new Error(`no control ${key}`);
  return record;
}

describe('SceneSync', () => {
  it('writes bone locals, updates world matrices once, then runs node constraints and their destination subtrees', async () => {
    const { skeleton } = await fixtures();
    const patch: Partial<SkeletonDesc> = {
      nodeConstraints: [{ type: 'rotation', source: LEFT_HAND, destination: LEFT_INDEX, weight: 1 }],
      constrainedNodes: [LEFT_INDEX],
    };
    const s = await setup(patch);
    const runtime = s.app.characters.get(s.character);
    if (runtime === undefined) throw new Error('no runtime');
    const hand = control(s.app, 'fk.hand.L');
    s.app.session.setState({ overrides: new Map([[hand.id, { rx: 0.4, ry: -0.2, rz: 0.7 }]]) });
    s.app.evaluation.tick();

    const constrainedTurn: Quat = [0, Math.sin(0.3), 0, Math.cos(0.3)];
    const seen: { local: number[]; world: number[] }[] = [];
    let model: ReturnType<typeof modelOf> | null = null;
    const update = vi.fn<() => void>(() => {
      const source = model?.nodes[LEFT_HAND] as Object3D;
      seen.push({ local: source.quaternion.toArray(), world: source.matrixWorld.toArray() });
      model?.nodes[LEFT_INDEX]?.quaternion.set(...constrainedTurn);
    });
    model = modelOf({ ...skeleton, ...patch }, { nodeConstraints: { update } });
    const child = new Object3D();
    child.position.set(0, 0.05, 0);
    model.nodes[LEFT_INDEX]?.add(child);
    const updateWorld = vi.spyOn(s.scene, 'updateMatrixWorld');

    s.sync.attachModel(s.character, model);
    expect(s.sync.update({ springs: false, nowMs: 0 })).toBe(true);

    expect(updateWorld).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    // When the constraint ran, the kernel locals were in place and world matrices were current.
    const local = runtime.pose.boneLocal.slice(LEFT_HAND * 10 + 3, LEFT_HAND * 10 + 7);
    seen[0]?.local.forEach((v, i) => expect(v).toBeCloseTo(local[i] ?? Number.NaN, 12));
    const world = runtime.pose.boneWorld.slice(LEFT_HAND * 16, LEFT_HAND * 16 + 16);
    seen[0]?.world.forEach((v, i) => expect(v).toBeCloseTo(world[i] ?? Number.NaN, 9));
    // The destination's subtree follows the constrained rotation in the same update.
    const destination = model.nodes[LEFT_INDEX] as Object3D;
    const expected = new Matrix4()
      .copy(destination.parent?.matrixWorld ?? new Matrix4())
      .multiply(new Matrix4().compose(destination.position, new Quaternion(...constrainedTurn), destination.scale))
      .multiply(child.matrix);
    child.matrixWorld.toArray().forEach((v, i) => expect(v).toBeCloseTo(expected.elements[i] ?? Number.NaN, 9));

    // Nothing changed: no further work.
    expect(s.sync.update({ springs: false, nowMs: 16 })).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('runs the spring-bone preview only while enabled, and resets it when it stops', async () => {
    const s = await setup();
    const springs = { update: vi.fn<(deltaSeconds: number) => void>(), reset: vi.fn<() => void>() };
    const { skeleton } = await fixtures();
    s.sync.attachModel(s.character, modelOf(skeleton, { springBones: springs }));
    s.sync.update({ springs: false, nowMs: 0 });
    expect(springs.update).not.toHaveBeenCalled();
    s.sync.update({ springs: true, nowMs: 1000 });
    s.sync.update({ springs: true, nowMs: 1016 });
    expect(springs.update).toHaveBeenCalledTimes(2);
    expect(springs.update.mock.calls[1]?.[0]).toBeCloseTo(0.016, 6);
    s.sync.update({ springs: false, nowMs: 1032 });
    expect(springs.reset).toHaveBeenCalledTimes(1);
  });

  it('puts meshes on the mesh layer and toggles x-ray on their materials, restoring them afterwards', async () => {
    const s = await setup();
    const { skeleton } = await fixtures();
    const model = modelOf(skeleton);
    const material = new MeshStandardMaterial({ transparent: false, opacity: 1 });
    const mesh = new Mesh(new BoxGeometry(), material);
    model.nodes[1]?.add(mesh);
    s.sync.attachModel(s.character, model);
    expect(mesh.layers.isEnabled(LAYER.mesh)).toBe(true);
    expect(mesh.layers.isEnabled(LAYER.always)).toBe(false);
    s.sync.setXray(true);
    expect([material.transparent, material.opacity, material.depthWrite]).toEqual([true, 0.5, false]);
    s.sync.setXray(false);
    expect([material.transparent, material.opacity, material.depthWrite]).toEqual([false, 1, true]);
  });

  it('x-ray really blends meshes on screen and switches back (shader variant follows `transparent`)', async () => {
    const s = await setup();
    const { skeleton } = await fixtures();
    const model = modelOf(skeleton);
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ color: 0xff0000 }));
    model.root.add(mesh);
    s.sync.attachModel(s.character, model);
    s.sync.update({ springs: false, nowMs: 0 });
    const canvas = document.createElement('canvas');
    const renderer = new WebGLRenderer({ canvas, antialias: false });
    try {
      renderer.setPixelRatio(1);
      renderer.setSize(16, 16, false);
      renderer.setClearColor(0x0000ff, 1);
      const camera = new OrthographicCamera(-0.25, 0.25, 0.25, -0.25, 0.1, 10);
      camera.position.set(0, 0, 5);
      camera.layers.set(LAYER.mesh);
      camera.updateMatrixWorld();
      const centre = (): [number, number, number] => {
        renderer.render(s.scene, camera);
        const gl = renderer.getContext();
        const pixel = new Uint8Array(4);
        gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0];
      };
      expect(centre()).toEqual([255, 0, 0]);
      s.sync.setXray(true);
      const [r, g, b] = centre();
      expect(Math.abs(r - 128)).toBeLessThanOrEqual(2);
      expect(g).toBe(0);
      expect(Math.abs(b - 128)).toBeLessThanOrEqual(2);
      s.sync.setXray(false);
      expect(centre()).toEqual([255, 0, 0]);
    } finally {
      renderer.dispose();
    }
  });

  it('places controls through the character placement and follows visibility', async () => {
    const s = await setup();
    s.sync.update({ springs: false, nowMs: 0 });
    const head = control(s.app, 'fk.head');
    const before = Float32Array.from(s.controls.entry(head.id)?.world ?? []);
    s.app.store.transact({ label: 'Move character' }, (tx) =>
      tx.patch('characters', s.character, { placement: { t: [1, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } }),
    );
    s.sync.update({ springs: false, nowMs: 16 });
    const after = s.controls.entry(head.id)?.world ?? new Float32Array();
    for (let i = 0; i < before.length; i += 3) {
      expect(after[i]).toBeCloseTo((before[i] ?? 0) + 1, 5);
      expect(after[i + 1]).toBeCloseTo(before[i + 1] ?? 0, 5);
    }
    // World = placement · controlWorld · shape (spot-check against the pose matrices).
    const runtime = s.app.characters.get(s.character);
    const slot = runtime?.program.controlIndex.get(head.id) ?? -1;
    const placed = mat4Multiply(
      mat4Compose({ t: [1, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] }),
      (runtime?.pose.controlWorld ?? new Float64Array(16)).slice(slot * 16, slot * 16 + 16),
    );
    // Every vertex of the head circle lies `size` away from its centre (pose · offset, rotation-free at rest).
    const o = head.shape.offset.t;
    for (let i = 0; i < after.length; i += 3) {
      const d = Math.hypot(
        (after[i] ?? 0) - (placed[12] ?? 0) - o[0],
        (after[i + 1] ?? 0) - (placed[13] ?? 0) - o[1],
        (after[i + 2] ?? 0) - (placed[14] ?? 0) - o[2],
      );
      expect(d).toBeCloseTo(head.shape.size, 5);
    }

    s.app.session.setState({ hiddenControls: new Set([head.id]) });
    expect(s.controls.entry(head.id)?.visible).toBe(false);
    s.app.session.setState({ hiddenControls: new Set() });
    expect(s.controls.entry(head.id)?.visible).toBe(true);
    s.app.store.transact({ label: 'Secondary' }, (tx) => tx.patch('controls', head.id, { hiddenByDefault: true }));
    s.sync.update({ springs: false, nowMs: 32 });
    expect(s.controls.entry(head.id)?.visible).toBe(false);
    s.app.session.setState({ showSecondary: true });
    expect(s.controls.entry(head.id)?.visible).toBe(true);
  });

  it('follows the character registry: removed characters leave the scene', async () => {
    const s = await setup();
    expect(s.sync.characterIds()).toEqual([s.character]);
    s.app.store.transact({ label: 'Delete' }, (tx) => tx.softDelete('characters', s.character));
    expect(s.sync.characterIds()).toEqual([]);
    expect([...s.controls.entries()]).toHaveLength(0);
  });
});
