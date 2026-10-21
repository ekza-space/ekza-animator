// Mesh-click picking (M1-stretch): CPU raycast with the current skinning, dominant joint of the hit triangle, mask and
// display gating, lowest priority, and the select tool turning a mesh hit into a control selection.
import { EkzaError } from '@ekza-studio/anim-core';
import type { CharacterId, ControlId } from '@ekza-studio/doc';
import { VIEWPORT_TOOL } from '@ekza-studio/editor-core';
import type { LoadedModel } from '@ekza-studio/io/three';
import { controlForNode, type SkeletonDesc } from '@ekza-studio/rig';
import {
  Bone,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { PickResult } from '../src';
import { dominantJoint } from '../src/picking/meshPicker';
import type { SceneSync } from '../src/sync/SceneSync';
import { SelectBehaviour } from '../src/tools/selectTool';
import type { ViewportToolHost } from '../src/tools/host';
import { createRig, fixtures, pointer, type Rig } from './helpers';

const LEFT_LOWER_ARM = 10;
const LEFT_HAND = 11;
const LEFT_INDEX = 12;
const CHEST = 3;
const PANE = 'pane-single';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

/** A display model over the synthetic skeleton: one Bone per node, in node order, under a root group. */
function boneModel(skeleton: SkeletonDesc): LoadedModel & { readonly bones: Bone[] } {
  const root = new Group();
  const bones = skeleton.nodes.map((node) => {
    const bone = new Bone();
    bone.name = node.name;
    bone.position.set(...node.restLocal.t);
    bone.quaternion.set(...node.restLocal.q);
    bone.scale.set(...node.restLocal.s);
    return bone;
  });
  for (const node of skeleton.nodes) (node.parent === -1 ? root : bones[node.parent])?.add(bones[node.index] as Bone);
  root.updateMatrixWorld(true);
  return {
    root,
    bones,
    nodeObjects: bones,
    skinnedMeshes: [],
    vrm: null,
    springBones: null,
    nodeConstraints: null,
    dispose: () => {},
  };
}

/** A small box at a joint's rest position, skinned 100 % to that joint (bound at rest). */
function skinnedBox(model: ReturnType<typeof boneModel>, joint: number, size = 0.08): SkinnedMesh {
  const centre = (model.bones[joint] as Bone).getWorldPosition(new Vector3());
  const geometry = new BoxGeometry(size, size, size).translate(centre.x, centre.y, centre.z);
  const count = geometry.getAttribute('position').count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    indices[i * 4] = joint;
    weights[i * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(weights, 4));
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
  model.root.add(mesh);
  model.root.updateMatrixWorld(true);
  mesh.bind(new Skeleton(model.bones));
  return mesh;
}

/** SceneSync is internal; tests attach display models the way the registry's 'display' event would. */
function attach(r: Rig, model: LoadedModel): CharacterId {
  const character = r.app.store.list('characters')[0]?.id as CharacterId;
  (r.vm as unknown as { readonly sync: SceneSync }).sync.attachModel(character, model);
  return character;
}

function enableMeshMask(r: Rig, meshes: boolean): void {
  const tools = r.app.session.getState().tools;
  r.app.session.setState({ tools: { ...tools, selectionMask: { ...tools.selectionMask, meshes } } });
}

/** What the rig maps a node to: null while WP-3's controlForNode is a stub. */
function expectedControl(r: Rig, character: CharacterId, node: number): ControlId | null {
  const runtime = r.app.characters.get(character);
  if (runtime === undefined) return null;
  try {
    return controlForNode(runtime.program, node);
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') return null;
    throw error;
  }
}

const meshHit = (hits: readonly PickResult[]) => hits.find((hit) => hit.kind === 'mesh') ?? null;

describe('mesh picking', () => {
  it('hits the skinned surface where the current pose put it, naming the dominant joint', async () => {
    rig = await createRig();
    rig.layout('single');
    const { skeleton } = await fixtures();
    const model = boneModel(skeleton);
    const restHand = (model.bones[LEFT_HAND] as Bone).getWorldPosition(new Vector3());
    skinnedBox(model, LEFT_HAND);
    const character = attach(rig, model);
    enableMeshMask(rig, true);
    rig.frame();

    const posedHand = (model.bones[LEFT_HAND] as Bone).getWorldPosition(new Vector3());
    const at = rig.vm.project(PANE, [posedHand.x, posedHand.y, posedHand.z]);
    const rest = rig.vm.project(PANE, [restHand.x, restHand.y, restHand.z]);
    if (at === null || rest === null) throw new Error('hand not in view');
    // The wave pose moves the hand well away from its rest position: the raycast must use the posed skin.
    expect(Math.hypot(at.x - rest.x, at.y - rest.y)).toBeGreaterThan(20);

    expect(meshHit(rig.vm.pickCandidates(PANE, at.x, at.y))).toEqual({
      kind: 'mesh',
      character,
      node: LEFT_HAND,
      control: expectedControl(rig, character, LEFT_HAND),
    });
    expect(meshHit(rig.vm.pickCandidates(PANE, rest.x, rest.y))).toBeNull();
  });

  it('follows pose changes after the first pick (bounding sphere refreshed per pose)', async () => {
    rig = await createRig();
    rig.layout('single');
    const { skeleton } = await fixtures();
    const model = boneModel(skeleton);
    skinnedBox(model, LEFT_HAND);
    attach(rig, model);
    enableMeshMask(rig, true);
    const handAt = (frame: number) => {
      rig?.app.session.setState({ time: { ...(rig?.app.session.getState().time ?? never()), sceneFrame: frame } });
      rig?.frame();
      const p = (model.bones[LEFT_HAND] as Bone).getWorldPosition(new Vector3());
      return rig?.vm.project(PANE, [p.x, p.y, p.z]) ?? never();
    };
    const a = handAt(0);
    expect(meshHit(rig.vm.pickCandidates(PANE, a.x, a.y))?.kind).toBe('mesh');
    const b = handAt(15);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(20);
    expect(meshHit(rig.vm.pickCandidates(PANE, b.x, b.y))?.kind).toBe('mesh');
    expect(meshHit(rig.vm.pickCandidates(PANE, a.x, a.y))).toBeNull();
  });

  it('maps a rigid mesh to its nearest node ancestor and keeps the lowest priority', async () => {
    rig = await createRig();
    rig.layout('single');
    const { skeleton } = await fixtures();
    const model = boneModel(skeleton);
    const chest = model.bones[CHEST] as Bone;
    const holder = new Group(); // not a skeleton node: the hit walks up to the chest
    holder.add(new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshBasicMaterial()));
    chest.add(holder);
    attach(rig, model);
    enableMeshMask(rig, true);
    rig.frame();
    const p = chest.getWorldPosition(new Vector3());
    const at = rig.vm.project(PANE, [p.x, p.y, p.z]) ?? never();
    const hits = rig.vm.pickCandidates(PANE, at.x, at.y);
    expect(meshHit(hits)).toMatchObject({ kind: 'mesh', node: CHEST });
    expect(hits.at(-1)?.kind).toBe('mesh');
  });

  it('needs the meshes selection mask and the pane mesh display, and skips hidden meshes', async () => {
    rig = await createRig();
    rig.layout('single');
    const { skeleton } = await fixtures();
    const model = boneModel(skeleton);
    const box = skinnedBox(model, LEFT_HAND);
    attach(rig, model);
    rig.frame();
    const hand = (model.bones[LEFT_HAND] as Bone).getWorldPosition(new Vector3());
    const at = rig.vm.project(PANE, [hand.x, hand.y, hand.z]) ?? never();
    expect(meshHit(rig.vm.pickCandidates(PANE, at.x, at.y))).toBeNull(); // default mask: controls only
    enableMeshMask(rig, true);
    expect(meshHit(rig.vm.pickCandidates(PANE, at.x, at.y))).not.toBeNull();
    box.visible = false;
    expect(meshHit(rig.vm.pickCandidates(PANE, at.x, at.y))).toBeNull();
    box.visible = true;
    await rig.app.run('view.display.toggle', { flag: 'mesh', paneId: PANE });
    expect(meshHit(rig.vm.pickCandidates(PANE, at.x, at.y))).toBeNull();
  });

  it('the select tool selects the control a mesh hit maps to; a click on a mesh without one selects nothing', async () => {
    rig = await createRig();
    const r = rig;
    const target = r.app.store.list('controls')[0]?.id as ControlId;
    let hit: PickResult = { kind: 'mesh', character: 'chr_x' as CharacterId, node: 1, control: target };
    const host: ViewportToolHost = {
      ...r.vm.toolHost,
      pickCandidates: () => [hit],
    };
    const behaviour = new SelectBehaviour(r.app, host);
    behaviour.click(PANE, 10, 10, 'replace');
    hit = { kind: 'mesh', character: 'chr_x' as CharacterId, node: 1, control: null };
    behaviour.click(PANE, 40, 40, 'replace');
    expect(r.app.calls.filter((c) => c.id === 'select.controls').map((c) => c.args)).toEqual([
      { ids: [target], mode: 'replace' },
      { ids: [], mode: 'replace' },
    ]);
  });

  it('a viewport click on the mesh goes through the select tool', async () => {
    rig = await createRig();
    rig.layout('single');
    const { skeleton } = await fixtures();
    const model = boneModel(skeleton);
    skinnedBox(model, LEFT_HAND);
    const character = attach(rig, model);
    enableMeshMask(rig, true);
    rig.app.session.setState({
      tools: {
        ...rig.app.session.getState().tools,
        viewport: VIEWPORT_TOOL.select,
        selectionMask: { controls: false, joints: false, meshes: true, groups: false },
      },
    });
    rig.frame();
    const hand = (model.bones[LEFT_HAND] as Bone).getWorldPosition(new Vector3());
    const at = rig.vm.project(PANE, [hand.x, hand.y, hand.z]) ?? never();
    const element = rig.panes.get(PANE) as HTMLElement;
    const rect = element.getBoundingClientRect();
    pointer(element, 'pointerdown', rect.left + at.x, rect.top + at.y);
    pointer(element, 'pointerup', rect.left + at.x, rect.top + at.y);
    // Until WP-3's controlForNode exists the hit maps to no control: an empty replace selection.
    const control = expectedControl(rig, character, LEFT_HAND);
    expect(rig.app.calls.filter((c) => c.id === 'select.controls').map((c) => c.args)).toEqual([
      { ids: control === null ? [] : [control], mode: 'replace' },
    ]);
  });
});

describe('dominantJoint', () => {
  it('weighs skin weights by the barycentric coordinates of the hit point', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    geometry.setAttribute(
      'skinIndex',
      new BufferAttribute(new Uint16Array([LEFT_HAND, LEFT_INDEX, 0, 0, LEFT_INDEX, 0, 0, 0, LEFT_INDEX, 0, 0, 0]), 4),
    );
    geometry.setAttribute(
      'skinWeight',
      new BufferAttribute(new Float32Array([0.75, 0.25, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4),
    );
    const bones = Array.from({ length: 13 }, () => new Bone());
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
    mesh.bind(new Skeleton(bones));
    const face = { a: 0, b: 1, c: 2, normal: new Vector3(), materialIndex: 0 };
    expect(dominantJoint(mesh, face, new Vector3(1, 0, 0))).toBe(bones[LEFT_HAND]);
    expect(dominantJoint(mesh, face, new Vector3(0.2, 0.4, 0.4))).toBe(bones[LEFT_INDEX]);
    // Equal influence (0.75 · 0.5 = 0.25 · 0.5 + 0.25, exact in binary): the lower joint index wins.
    expect(dominantJoint(mesh, face, new Vector3(0.5, 0.25, 0))).toBe(bones[LEFT_HAND]);
    expect(dominantJoint(mesh, face, null)).toBe(bones[LEFT_INDEX]);
    expect(dominantJoint(mesh, face, new Vector3(1, 0, 0))).not.toBe(bones[LEFT_LOWER_ARM]);
  });
});

function never(): never {
  throw new Error('unreachable');
}
