import { flipYawVec3, quatAngle, type Quat } from '@ekza-animator/anim-core';
import type { HumanBoneName } from '@ekza-animator/doc';
import { type LicensedFixture, readFixture, readSyntheticFixture } from '@ekza-animator/doc/testing';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { parseGlb } from '../src/glb/parse';
import { skeletonFingerprint, skeletonFromGltf, VRM0_FACING } from '../src/skeleton/read';
import { humanoidRestPositions, restWorlds } from '../src/skeleton/rest';
import { GltfBuilder } from '../src/testing/glb';
import { loadGltfInNode, readGlbJson, skeletonNodeOrder } from '../src/testing';

async function load(name: LicensedFixture): Promise<SkeletonDesc> {
  return skeletonFromGltf(await parseGlb(readFixture(name)));
}

describe('skeletonFromGltf', () => {
  it.each<LicensedFixture>(['polybot.vrm', 'seed-san.vrm', 'quaternius-ual.glb'])(
    'orders %s like the test kit and matches three.js rest worlds',
    async (name) => {
      const bytes = readFixture(name);
      const skeleton = skeletonFromGltf(await parseGlb(bytes));
      expect(skeleton.nodes.map((n) => n.gltfIndex)).toEqual(skeletonNodeOrder(readGlbJson(bytes)));
      skeleton.nodes.forEach((node, i) => {
        expect(node.index).toBe(i);
        expect(node.parent).toBeLessThan(i);
      });
      const loaded = await loadGltfInNode(bytes);
      loaded.scene.updateMatrixWorld(true);
      const worlds = restWorlds(skeleton);
      const problems: string[] = [];
      skeleton.nodes.forEach((node, i) => {
        const object = loaded.nodeByIndex[i];
        if (object === null || object === undefined) return;
        const p = new Vector3();
        const q = new Quaternion();
        object.matrixWorld.decompose(p, q, new Vector3());
        let expected = [p.x, p.y, p.z] as [number, number, number];
        let expectedQ: Quat = [q.x, q.y, q.z, q.w];
        if (skeleton.format === 'vrm0') {
          // Canonical space applies the π-yaw facing at the root: positions (−x, y, −z), rotations facing · q.
          expected = flipYawVec3(expected);
          const f = new Quaternion(0, 1, 0, 0).multiply(q);
          expectedQ = [f.x, f.y, f.z, f.w];
        }
        const world = worlds[i];
        if (world === undefined) return;
        const dp = Math.hypot(world.t[0] - expected[0], world.t[1] - expected[1], world.t[2] - expected[2]);
        if (dp > 1e-5) problems.push(`${node.name} position off by ${dp}`);
        if (quatAngle(world.q, expectedQ) > 1e-5) problems.push(`${node.name} rotation`);
      });
      expect(problems).toEqual([]);
    },
  );

  it('reads the VRM 0.x humanoid with thumb aliases and π-yaw facing (Polybot)', async () => {
    const s = await load('polybot.vrm');
    expect(s.format).toBe('vrm0');
    expect(s.facing).toEqual(VRM0_FACING);
    expect(s.humanoid?.leftThumbMetacarpal).toBeDefined();
    expect(s.humanoid?.hips).toBeDefined();
    expect(Object.keys(s.humanoid ?? {})).toHaveLength(31);
    // Canonical facing check (§4.11.9): f = normalize((W(lUpperLeg) − W(rUpperLeg)) × (W(head) − W(hips))).
    // Polybot's head sits 2.8° forward of its hips, so the raw facing vector tilts by that much (0.9988); its
    // horizontal projection is exactly +Z (see docs/wp-notes/wp-4.md on the 0.999 threshold of E2E-03).
    const f = facingOf(humanoidRestPositions(s));
    expect(f[2]).toBeGreaterThan(0.998);
    expect(f[2] / Math.hypot(f[0], f[2])).toBeGreaterThan(0.9999);
  });

  it('reads the VRM 1.0 humanoid, spring joints and node constraints (Seed-san)', async () => {
    const s = await load('seed-san.vrm');
    expect(s.format).toBe('vrm1');
    expect(s.facing).toEqual([0, 0, 0, 1]);
    expect(Object.keys(s.humanoid ?? {})).toHaveLength(51);
    expect(facingOf(humanoidRestPositions(s))[2]).toBeGreaterThan(0.999);
    const hipsY = humanoidRestPositions(s).hips?.[1] ?? 0;
    expect(Math.abs(hipsY - 0.7956)).toBeLessThan(1e-4);
    const names = (indices: readonly number[]) => indices.map((i) => s.nodes[i]?.name);
    // VRMC_springBone lists the moving joints of each chain; the static chain roots are not spring joints.
    expect(names(s.springJoints)).toEqual(expect.arrayContaining(['hair_tail_1', 'hair_A.001', 'robo_wire']));
    expect(names(s.springJoints)).not.toContain('hair_A');
    expect(s.springJoints).toHaveLength(28);
    expect(s.springJoints.some((i) => Object.values(s.humanoid ?? {}).includes(i))).toBe(false);
    const robo = s.nodes.find((n) => n.name === 'robo_upper_arm.L');
    const arm = s.nodes.find((n) => n.name === 'upper_arm.L');
    expect(s.nodeConstraints).toContainEqual({
      type: 'rotation',
      source: arm?.index,
      destination: robo?.index,
      weight: 1,
    });
    expect(s.constrainedNodes).toContain(robo?.index);
    expect(s.nodeConstraints).toHaveLength(23);
  });

  it('measures bone radii for every humanoid bone of both VRM fixtures and a mesh height', async () => {
    for (const name of ['polybot.vrm', 'seed-san.vrm'] as const) {
      const s = await load(name);
      const missing = Object.entries(s.humanoid ?? {}).filter(([, node]) => s.boneRadii[node] === null);
      expect(missing).toEqual([]);
      expect(s.heightSource).toBe('mesh');
      for (const node of Object.values(s.humanoid ?? {})) {
        const r = s.boneRadii[node] as number;
        expect(r).toBeGreaterThan(0.005);
        expect(r).toBeLessThan(0.5 * s.height);
      }
    }
    expect((await load('seed-san.vrm')).height).toBeCloseTo(1.58, 2);
    expect((await load('polybot.vrm')).height).toBeCloseTo(1.064, 2);
  });

  it('has null radii and a joint-based height for the meshopt-compressed fixture', async () => {
    const s = await load('quaternius-idle-meshopt.glb');
    expect(s.boneRadii.every((r) => r === null)).toBe(true);
    expect(s.heightSource).toBe('joints');
    expect(s.height).toBeGreaterThan(1.5);
    expect(s.height).toBeLessThan(2.2);
    expect(s.humanoid).toBeNull();
  });

  it('marks joints and meshes and reads a generic rig (UAL)', async () => {
    const s = await load('quaternius-ual.glb');
    expect(s.format).toBe('gltf');
    expect(s.nodes.filter((n) => n.isJoint)).toHaveLength(53);
    expect(s.nodes.find((n) => n.name === 'Mannequin')?.hasMesh).toBe(true);
    expect(s.springJoints).toEqual([]);
    expect(s.heightSource).toBe('mesh');
    expect(s.height).toBeCloseTo(1.83, 1);
  });

  it('computes the fingerprint like the synthetic fixture and keeps it stable', async () => {
    const synthetic = readSyntheticFixture('humanoid-skeleton.json') as SkeletonDesc;
    expect(skeletonFingerprint(synthetic.nodes)).toBe(synthetic.fingerprint);
    const a = await load('seed-san.vrm');
    const b = await load('seed-san.vrm');
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(a.fingerprint).not.toBe((await load('polybot.vrm')).fingerprint);
  });

  it('decomposes matrix nodes, warns on shear and non-unit rotations, reads heightScale', async () => {
    const b = new GltfBuilder();
    const json = b.json as Record<string, unknown>;
    json['nodes'] = [
      { name: 'm', matrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 2, 3, 1], children: [1, 2] },
      { name: 'shear', matrix: [1, 0, 0, 0, 0.5, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      { name: 'q', rotation: [0, 0, 0, 2] },
    ];
    json['extras'] = { ekza: { avatar: { heightScale: 1.25 } } };
    const s = skeletonFromGltf(await parseGlb(b.build()));
    expect(s.nodes[0]?.hasMatrix).toBe(true);
    expect(s.nodes[0]?.restLocal.t).toEqual([1, 2, 3]);
    expect(s.nodes[0]?.restLocal.s).toEqual([2, 2, 2]);
    expect(s.nodes[2]?.restLocal.q).toEqual([0, 0, 0, 1]);
    expect(s.warnings.join('\n')).toMatch(/shear/);
    expect(s.warnings.join('\n')).toMatch(/non-unit rotation/);
    expect(s.ekzaHeightScale).toBe(1.25);
    expect(s.boneRadii).toEqual([null, null, null]);
  });

  it('warns about unknown or duplicate humanoid bones and missing required bones', async () => {
    const b = new GltfBuilder();
    const json = b.json as Record<string, unknown>;
    json['nodes'] = [{ name: 'hips', children: [1] }, { name: 'spine' }];
    json['extensions'] = {
      VRMC_vrm: {
        humanoid: { humanBones: { hips: { node: 0 }, spine: { node: 0 }, tail: { node: 1 }, head: { node: 9 } } },
      },
    };
    const s = skeletonFromGltf(await parseGlb(b.build()));
    expect(s.humanoid).toEqual({ hips: 0 });
    const text = s.warnings.join('\n');
    expect(text).toMatch(/same node/);
    expect(text).toMatch(/Unknown VRM humanoid bone 'tail'/);
    expect(text).toMatch(/'head' references a missing node/);
    expect(text).toMatch(/lacks required bones/);
  });
});

function facingOf(p: Partial<Record<HumanBoneName, readonly [number, number, number]>>): [number, number, number] {
  const sub = (a: readonly number[] | undefined, b: readonly number[] | undefined) => [
    (a?.[0] ?? 0) - (b?.[0] ?? 0),
    (a?.[1] ?? 0) - (b?.[1] ?? 0),
    (a?.[2] ?? 0) - (b?.[2] ?? 0),
  ];
  const lr = sub(p.leftUpperLeg, p.rightUpperLeg);
  const up = sub(p.head, p.hips);
  const f = [
    (lr[1] as number) * (up[2] as number) - (lr[2] as number) * (up[1] as number),
    (lr[2] as number) * (up[0] as number) - (lr[0] as number) * (up[2] as number),
    (lr[0] as number) * (up[1] as number) - (lr[1] as number) * (up[0] as number),
  ];
  const len = Math.hypot(f[0] as number, f[1] as number, f[2] as number);
  return [(f[0] as number) / len, (f[1] as number) / len, (f[2] as number) / len];
}
