// The Rig & Skin skinned display (M6B-SPEC §5.1 Display; C1) on a real WebGL canvas with the real editor kernel: a
// model character (an arm box adopted by `char.fromModel`, two joints, bound to its nearest joint, its rig from
// `rig.autoRig.update`) shows through one SkinnedSurface host in Rig & Skin only; the bones follow the pose (a lower
// bone turned 90° moves the forearm's pixels up); a weight edit rebuilds the surface; leaving the workspace removes it.
import type { Disposer } from '@ekza-studio/anim-core';
import {
  type CharacterId,
  type JointId,
  type JointRecord,
  type MeshId,
  type SkeletonId,
  seededIdSource,
} from '@ekza-studio/doc';
import {
  attachMeshes,
  createEditorApp,
  createMemoryBlobStore,
  type EditorApp,
  type KernelMeshRuntimes,
  loadMeshKernel,
} from '@ekza-studio/editor-core';
import { createFakeServices } from '@ekza-studio/editor-core/testing';
import { type SkinWeights, withSkin } from '@ekza-studio/mesh-core';
import { Matrix4, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadMeshView, type MeshLayerHost } from '../src';
import { SkinnedCharacterDisplay } from '../src/rig/skinned';
import { DEFAULT_DISPLAY, meshPaneDisplay } from '../src';

const W = 400;
const H = 300;
const BACKGROUND = 0x202020;
const disposers: Disposer[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});
beforeAll(async () => {
  await loadMeshKernel();
});

async function ok<T>(app: EditorApp, id: string, args?: unknown): Promise<T> {
  const result = await app.runUntyped(id, args);
  if (result.status !== 'finished') throw new Error(`${id}: ${JSON.stringify(result)}`);
  return result.value as T;
}

/** An arm character: joints `upper` (−0.5, 0, 0) and `lower` (0, 0, 0); points with x > 0 on `lower`. */
async function armCharacter(): Promise<{ app: EditorApp; character: CharacterId; mesh: MeshId; skeleton: SkeletonId }> {
  const app = createEditorApp({
    services: { ...createFakeServices(), blobs: createMemoryBlobStore() },
    idSource: seededIdSource(3),
    builtins: true,
  });
  app.prefs.setState({ firstRunDone: true });
  const meshes = attachMeshes(app) as KernelMeshRuntimes;
  disposers.push(() => app.dispose());
  const { mesh: cube } = await ok<{ mesh: MeshId }>(app, 'mesh.create.cube', {
    width: 1,
    height: 0.2,
    depth: 0.2,
    subdivisionsWidth: 4,
  });
  const made = await ok<{ character: CharacterId; skeleton: SkeletonId }>(app, 'char.fromModel', { objects: [cube] });
  const mesh = app.store.query.meshesOfOwner(made.character)[0]?.id as MeshId;
  const joint = (id: string, parent: string | null, x: number, order: string): JointRecord => ({
    id: id as JointId,
    skeleton: made.skeleton,
    parent: parent as JointId | null,
    order,
    name: id.slice(4),
    humanBone: null,
    restPosition: [x, 0, 0],
    restRotation: [0, 0, 0, 1],
    tail: null,
    side: 'C',
    mirror: null,
    deleted: null,
    role: 'bone',
    key: id.slice(4),
  });
  const data = app.meshes.get(mesh)?.data();
  if (data === null || data === undefined) throw new Error('no data');
  const P = data.counts.points;
  const skin: SkinWeights = {
    points: P,
    palette: [
      { key: 'jnt_upper', parent: null, mirror: null },
      { key: 'jnt_lower', parent: 'jnt_upper', mirror: null },
    ],
    joints: Uint16Array.from({ length: 4 * P }, (_, i) =>
      i % 4 === 0 && (data.position[3 * (i / 4)] as number) > 1e-6 ? 1 : 0,
    ),
    weights: Float32Array.from({ length: 4 * P }, (_, i) => (i % 4 === 0 ? 1 : 0)),
  };
  app.store.transact({ label: 'joints and bind (test)' }, (tx) => {
    tx.put('joints', joint('jnt_upper', null, -0.5, 'a0'));
    tx.put('joints', joint('jnt_lower', 'jnt_upper', 0, 'a1'));
    meshes.writeData(tx, mesh, withSkin(data, skin));
    tx.patch('meshes', mesh, { skin: { skeleton: made.skeleton, bind: null } });
  });
  await ok(app, 'rig.autoRig.update', { character: made.character });
  await (app.characters as unknown as { settled(): Promise<void> }).settled();
  return { app, character: made.character, mesh, skeleton: made.skeleton };
}

function harness() {
  const element = document.createElement('canvas');
  Object.assign(element.style, { position: 'fixed', left: '0px', top: '0px', width: `${W}px`, height: `${H}px` });
  document.body.append(element);
  const renderer = new WebGLRenderer({ canvas: element, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(BACKGROUND, 1);
  const scene = new Scene();
  const hosts = new Set<MeshLayerHost>();
  const camera = new OrthographicCamera(-2, 2, 1.5, -1.5, 0.05, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.layers.enableAll();
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const gl = renderer.getContext();
  const out = new Uint8Array(4);
  disposers.push(() => {
    renderer.dispose();
    element.remove();
  });
  return {
    hosts,
    target: {
      addMeshLayer(host: MeshLayerHost): Disposer {
        hosts.add(host);
        scene.add(host.root);
        return () => {
          hosts.delete(host);
          host.root.removeFromParent();
        };
      },
      invalidate() {},
    },
    /** Whether the pixel of world point `p` shows something drawn after a render. */
    drawn(p: readonly [number, number, number]): boolean {
      const display = meshPaneDisplay({ ...DEFAULT_DISPLAY, shading: 'shaded' });
      for (const host of hosts) host.applyPane(display, 'pane-persp');
      scene.updateMatrixWorld();
      renderer.render(scene, camera);
      const v = new Vector3(...p).project(camera);
      const x = Math.floor(((v.x + 1) / 2) * W);
      const y = Math.floor(((1 - v.y) / 2) * H);
      gl.readPixels(x, H - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      const bg = [(BACKGROUND >> 16) & 255, (BACKGROUND >> 8) & 255, BACKGROUND & 255];
      return [0, 1, 2].some((i) => Math.abs((out[i] as number) - (bg[i] as number)) > 2);
    },
  };
}

describe('SkinnedCharacterDisplay (§5.1)', () => {
  it('shows the bound mesh in Rig & Skin only and follows the pose', async () => {
    const { app, character } = await armCharacter();
    const h = harness();
    const mod = await loadMeshView();
    const display = new SkinnedCharacterDisplay(app, h.target, mod, { theme: mod.DEFAULT_MESH_VIEW_THEME });
    disposers.push(() => display.dispose());
    expect(h.hosts.size).toBe(0); // Animate: the ModelLoader path.
    app.session.setState({
      workspace: 'rig',
      rig: { ...app.session.getState().rig, character },
    });
    expect(h.hosts.size).toBe(1);
    expect(h.drawn([0.35, 0, 0])).toBe(true);
    expect(h.drawn([0, 0.35, 0])).toBe(false);
    // Turn the lower bone 90° about Z at the elbow (the kernel's pose buffers, one new pose version).
    const runtime = app.characters.get(character);
    if (runtime === undefined) throw new Error('no runtime');
    const lower = runtime.skeleton.nodes.findIndex((node) => node.name === 'lower');
    runtime.pose.boneWorld.set(new Matrix4().makeRotationZ(Math.PI / 2).elements, 16 * lower);
    runtime.pose.version++;
    expect(display.update()).toBe(true);
    expect(h.drawn([0.35, 0, 0])).toBe(false);
    expect(h.drawn([0, 0.35, 0])).toBe(true);
    expect(display.update()).toBe(false); // once per pose version
    app.session.setState({ workspace: 'animate' });
    expect(h.hosts.size).toBe(0);
  });
});
