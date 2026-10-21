import { quatAngle, type Quat } from '@ekza-studio/anim-core';
import { type LicensedFixture, readFixture } from '@ekza-studio/doc/testing';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { parseGlb } from '../src/glb/parse';
import { skeletonFromGltf } from '../src/skeleton/read';
import { restWorlds } from '../src/skeleton/rest';
import { loadGltfInNode, withNodeImageStub } from '../src/testing';
import { createThreeModelLoader } from '../src/three';

async function load(name: LicensedFixture) {
  const c = await parseGlb(readFixture(name));
  const skeleton = skeletonFromGltf(c);
  const loader = createThreeModelLoader({ decoderPath: '/decoders/' });
  const model = await withNodeImageStub(() => loader.load(c, skeleton));
  return { c, skeleton, model, handle: model.handle };
}

describe('io/three createThreeModelLoader', () => {
  it.each<LicensedFixture>(['polybot.vrm', 'seed-san.vrm', 'quaternius-ual.glb'])(
    'loads %s under a canonical root with objects by SkeletonDesc index',
    async (name) => {
      const { skeleton, model, handle } = await load(name);
      expect(model.kind).toBe('three');
      expect(handle.nodeObjects).toHaveLength(skeleton.nodes.length);
      expect(handle.nodeObjects.every((o) => o !== null)).toBe(true);
      expect(handle.skinnedMeshes.length).toBeGreaterThan(0);
      const [x, y, z, w] = skeleton.facing;
      expect(handle.root.quaternion.toArray()).toEqual([x, y, z, w]);
      // Canonical worlds of the loaded objects equal the SkeletonDesc rest worlds (facing applied once, at the root).
      handle.root.updateMatrixWorld(true);
      const worlds = restWorlds(skeleton);
      let maxDistance = 0;
      let maxAngle = 0;
      skeleton.nodes.forEach((node, i) => {
        const p = new Vector3();
        const q = new Quaternion();
        handle.nodeObjects[i]?.matrixWorld.decompose(p, q, new Vector3());
        const world = worlds[i];
        if (world === undefined) return;
        maxDistance = Math.max(maxDistance, Math.hypot(p.x - world.t[0], p.y - world.t[1], p.z - world.t[2]));
        maxAngle = Math.max(maxAngle, quatAngle([q.x, q.y, q.z, q.w], world.q));
        expect(node.index).toBe(i);
      });
      expect(maxDistance).toBeLessThan(1e-5);
      expect(maxAngle).toBeLessThan(1e-5);
      model.dispose();
      expect(handle.root.parent).toBeNull();
    },
  );

  it('loads VRMs with autoUpdateHumanBones off and exposes spring bones and node constraints', async () => {
    const { handle } = await load('seed-san.vrm');
    expect(handle.vrm?.humanoid.autoUpdateHumanBones).toBe(false);
    expect(handle.springBones).not.toBeNull();
    expect(handle.nodeConstraints).not.toBeNull();
    handle.springBones?.update(1 / 30);
    handle.springBones?.reset();
    const polybot = await load('polybot.vrm');
    expect(polybot.handle.vrm?.meta.metaVersion).toBe('0');
    // rotateVRM0 is never called: the VRM scene itself stays unrotated.
    expect(polybot.handle.vrm?.scene.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    const ual = await load('quaternius-ual.glb');
    expect(ual.handle.vrm).toBeNull();
    expect(ual.handle.springBones).toBeNull();
    expect(ual.handle.nodeConstraints).toBeNull();
  });

  it('displays the meshopt-compressed fixture with the self-contained decoder', async () => {
    const { handle } = await load('quaternius-idle-meshopt.glb');
    const mesh = handle.skinnedMeshes[0];
    expect(mesh?.geometry.getAttribute('position').count).toBeGreaterThan(1000);
    expect(handle.nodeObjects.every((o) => o !== null)).toBe(true);
  });

  it('asks for the renderer before KTX2 textures', async () => {
    const c = await parseGlb(readFixture('polybot.vrm'));
    const ktx = { ...c, json: { ...c.json, extensionsUsed: ['KHR_texture_basisu'] } };
    const loader = createThreeModelLoader({ decoderPath: '/decoders' });
    await expect(loader.load(ktx, skeletonFromGltf(c))).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('VRMC_node_constraint preview (US-26)', () => {
  /** Rest-relative local rotation q_rest⁻¹ · q of an object. */
  const restRelative = (q: Quaternion, rest: Quaternion): Quat => {
    const r = rest.clone().invert().multiply(q);
    return [r.x, r.y, r.z, r.w];
  };

  it("posing Seed-san's upper_arm.L drives robo_upper_arm.L to the same rest-relative rotation (1e-6)", async () => {
    const { skeleton, handle } = await load('seed-san.vrm');
    const index = (name: string) => skeleton.nodes.findIndex((n) => n.name === name);
    const arm = handle.nodeObjects[index('upper_arm.L')];
    const robo = handle.nodeObjects[index('robo_upper_arm.L')];
    if (arm === null || arm === undefined || robo === null || robo === undefined) throw new Error('nodes missing');
    const armRest = arm.quaternion.clone();
    const roboRest = robo.quaternion.clone();
    // The kernel's write for a posed fk.upperArm.L: a new raw local rotation (rest · delta).
    const delta = new Quaternion().setFromAxisAngle(new Vector3(0.2, 0.3, 1).normalize(), 0.9);
    arm.quaternion.copy(armRest).multiply(delta);
    handle.root.updateMatrixWorld(true);
    handle.nodeConstraints?.update();
    expect(quatAngle(restRelative(robo.quaternion, roboRest), restRelative(arm.quaternion, armRest))).toBeLessThan(
      1e-6,
    );
    expect(quatAngle(restRelative(robo.quaternion, roboRest), [delta.x, delta.y, delta.z, delta.w])).toBeLessThan(1e-6);
  });

  it('gives the same result through the io/testing Node harness', async () => {
    const bytes = readFixture('seed-san.vrm');
    const skeleton = skeletonFromGltf(await parseGlb(bytes));
    const loaded = await loadGltfInNode(bytes);
    const arm = loaded.nodeByIndex[skeleton.nodes.findIndex((n) => n.name === 'upper_arm.L')];
    const robo = loaded.nodeByIndex[skeleton.nodes.findIndex((n) => n.name === 'robo_upper_arm.L')];
    if (arm === null || arm === undefined || robo === null || robo === undefined) throw new Error('nodes missing');
    const roboRest = robo.quaternion.clone();
    const armRest = arm.quaternion.clone();
    arm.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.6));
    loaded.scene.updateMatrixWorld(true);
    loaded.vrm?.nodeConstraintManager?.update();
    expect(quatAngle(restRelative(robo.quaternion, roboRest), restRelative(arm.quaternion, armRest))).toBeLessThan(
      1e-6,
    );
  });
});
