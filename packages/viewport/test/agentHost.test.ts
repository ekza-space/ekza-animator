// MCP-SPEC §4.3 (D0): the viewport's agent host — the shared renderer and scene, the user's active pane (null before
// any interaction) and its camera, overlay passes drawn in every pane after the control pass, and a temporary pose
// for one draw that writes the nodes' locals from canonical bone worlds and restores the current pose afterwards.
import type { CharacterId } from '@ekza-studio/doc';
import type { LoadedModel } from '@ekza-studio/io/three';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { Group, Object3D, type SkinnedMesh } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { SceneSync } from '../src/sync/SceneSync';
import { createRig, type Rig } from './helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

function modelOf(skeleton: SkeletonDesc): LoadedModel & { readonly nodes: Object3D[] } {
  const root = new Group();
  const nodes = skeleton.nodes.map((node) => {
    const object = new Object3D();
    object.name = node.name;
    object.position.set(...node.restLocal.t);
    object.quaternion.set(...node.restLocal.q);
    return object;
  });
  for (const node of skeleton.nodes)
    (node.parent === -1 ? root : nodes[node.parent])?.add(nodes[node.index] as Object3D);
  return {
    root,
    nodes,
    nodeObjects: nodes,
    skinnedMeshes: [] as SkinnedMesh[],
    vrm: null,
    springBones: null,
    nodeConstraints: null,
    dispose: () => {},
  };
}

describe('ViewportManager.agentHost (MCP-SPEC §4.3)', () => {
  it('exposes the renderer, the scene, the active pane and its camera without changing anything', async () => {
    rig = await createRig();
    rig.layout('split');
    const host = rig.vm.agentHost();
    expect(host.renderer).toBe(rig.renderer);
    expect(host.scene).toBe(rig.vm.scene);
    expect(host.activePaneId()).toBeNull();
    expect(host.paneCamera('pane-right')).toEqual(rig.vm.camera('pane-right'));
  });

  it('takes the pane holding keyboard focus as the active pane, then the last pointer pane', async () => {
    rig = await createRig();
    rig.layout('split');
    const host = rig.vm.agentHost();
    const left = rig.panes.get('pane-left') as HTMLElement;
    const right = rig.panes.get('pane-right') as HTMLElement;
    left.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    expect(host.activePaneId()).toBe('pane-left');
    const button = document.createElement('button');
    button.textContent = 'pane menu';
    right.append(button);
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(host.activePaneId()).toBe('pane-right');
    button.blur();
    expect(host.activePaneId()).toBe('pane-left');
    // focus outside every pane leaves the pointer rule in charge
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    expect(host.activePaneId()).toBe('pane-left');
    outside.remove();
    button.remove();
  });

  it('draws overlay passes in every pane after the control pass until disposed', async () => {
    rig = await createRig();
    rig.layout('split');
    const draws: string[] = [];
    const dispose = rig.vm.agentHost().addOverlayPass({
      id: 'test.presence',
      draw: ({ camera, scene }) => draws.push(`${camera.type}:${scene === rig?.vm.scene}`),
    });
    rig.frame();
    expect(draws).toHaveLength(2);
    expect(draws.every((entry) => entry.endsWith(':true'))).toBe(true);
    dispose();
    draws.length = 0;
    rig.vm.invalidate();
    rig.frame();
    expect(draws).toEqual([]);
  });

  it('poses a model from bone worlds for one draw and restores the pose after it', async () => {
    rig = await createRig();
    rig.layout('single');
    const app = rig.app;
    const character = app.store.list('characters')[0]?.id as CharacterId;
    const clip = app.session.getState().activeClip[character];
    const runtime = app.characters.get(character);
    if (runtime === undefined || clip === undefined) throw new Error('no runtime');
    const model = modelOf(runtime.skeleton);
    (rig.vm as unknown as { readonly sync: SceneSync }).sync.attachModel(character, model);
    rig.frame();
    const before = model.nodes.map((node) => [...node.position.toArray(), ...node.quaternion.toArray()]);
    const other = runtime.program.allocPose();
    app.evaluation.evaluateAt(character, clip, 15, other);
    let inside: number[][] = [];
    const value = rig.vm.agentHost().withPose(character, other.boneWorld, () => {
      inside = model.nodes.map((node) => [...node.position.toArray(), ...node.quaternion.toArray()]);
      return 42;
    });
    expect(value).toBe(42);
    // Inside the draw the nodes carry the evaluated locals of frame 15 (world → local through parents and facing).
    for (let i = 0; i < model.nodes.length; i++) {
      const expected = Array.from(other.boneLocal.subarray(i * 10, i * 10 + 7));
      const got = inside[i] as number[];
      const sameRotation = Math.abs(got.slice(3).reduce((sum, q, k) => sum + q * (expected[3 + k] as number), 0));
      expect([i, got.slice(0, 3).every((t, k) => Math.abs(t - (expected[k] as number)) < 1e-6)]).toEqual([i, true]);
      expect([i, Math.abs(sameRotation - 1) < 1e-6]).toEqual([i, true]);
    }
    // Afterwards the current pose is back.
    expect(model.nodes.map((node) => [...node.position.toArray(), ...node.quaternion.toArray()])).toEqual(before);
  });
});
