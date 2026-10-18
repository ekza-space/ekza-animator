import type { HumanBoneName } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import {
  autoRig,
  compileRig,
  flipYawHumanLocal,
  HUMAN_BONE_NAMES,
  HUMAN_BONE_PARENT,
  humanoidRestWorldPositions,
  VRM_REQUIRED_BONES,
  VRM0_BONE_ALIASES,
} from '../src';
import { IDS, maxAbsDiff, restPoseFixture, richHumanoid, syntheticSkeleton, vecAt } from './helpers';

describe('humanoid tables', () => {
  it('lists the 55 VRM 1.0 bones with parents before children', () => {
    expect(HUMAN_BONE_NAMES).toHaveLength(55);
    expect(new Set(HUMAN_BONE_NAMES).size).toBe(55);
    HUMAN_BONE_NAMES.forEach((name, i) => {
      const parent = HUMAN_BONE_PARENT[name];
      expect(parent === null ? name : 'hips').toBe('hips');
      expect(parent === null ? -1 : HUMAN_BONE_NAMES.indexOf(parent)).toBeLessThan(i);
    });
    expect(VRM_REQUIRED_BONES).toHaveLength(15);
    expect(VRM0_BONE_ALIASES['leftThumbProximal']).toBe('leftThumbMetacarpal');
    expect(VRM0_BONE_ALIASES['rightThumbIntermediate']).toBe('rightThumbProximal');
  });
});

describe('humanoidRestWorldPositions', () => {
  it('returns canonical rest positions of the humanoid bones', () => {
    const skeleton = syntheticSkeleton();
    const positions = humanoidRestWorldPositions(skeleton);
    const rest = restPoseFixture().bones;
    for (const [name, node] of Object.entries(skeleton.humanoid ?? {})) {
      expect(maxAbsDiff(positions[name as HumanBoneName] ?? [], (rest[node] as { t: number[] }).t)).toBeLessThan(1e-12);
    }
    expect(positions.leftThumbMetacarpal).toBeUndefined();
    expect(humanoidRestWorldPositions({ ...skeleton, humanoid: null })).toEqual({});
  });

  it('applies the VRM 0.x facing (file positions conjugated by the π yaw)', () => {
    const vrm1 = humanoidRestWorldPositions(richHumanoid());
    const vrm0 = humanoidRestWorldPositions(richHumanoid({ vrm0: true }));
    for (const name of Object.keys(vrm1) as HumanBoneName[]) {
      expect(maxAbsDiff(vrm0[name] ?? [], vrm1[name] ?? [])).toBeLessThan(1e-12);
    }
    expect(vrm0.leftUpperArm?.[0]).toBeGreaterThan(0);
  });

  it('faces +Z in canonical space (MVP-SPEC §4.11.9 facing check)', () => {
    for (const skeleton of [richHumanoid(), richHumanoid({ vrm0: true }), syntheticSkeleton()]) {
      const program = compileRig(autoRig(skeleton, IDS), skeleton);
      const pose = program.allocPose();
      program.evaluate(program.allocChannels(), pose);
      const at = (name: HumanBoneName) => vecAt(pose.boneWorld, (skeleton.humanoid?.[name] as number) * 16 + 12);
      const u = at('leftUpperLeg').map((v, i) => v - (at('rightUpperLeg')[i] as number));
      const v = at('head').map((x, i) => x - (at('hips')[i] as number));
      const f = [
        (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
        (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
        (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
      ];
      expect((f[2] as number) / Math.hypot(...f)).toBeGreaterThan(0.999);
    }
  });
});

describe('flipYawHumanLocal', () => {
  it('conjugates every rotation by the π yaw and is an involution', () => {
    const input = Float64Array.from({ length: 55 * 4 }, (_, i) => Math.sin(i + 1));
    const out = new Float64Array(input.length);
    flipYawHumanLocal(input, out);
    for (let h = 0; h < 55; h++) {
      expect([...out.subarray(h * 4, h * 4 + 4)]).toEqual([
        -(input[h * 4] as number),
        input[h * 4 + 1],
        -(input[h * 4 + 2] as number),
        input[h * 4 + 3],
      ]);
    }
    const back = new Float64Array(out);
    flipYawHumanLocal(back, back);
    expect([...back]).toEqual([...input]);
    const identity = new Float64Array(8);
    identity[3] = 1;
    identity[7] = 1;
    flipYawHumanLocal(identity, identity);
    expect(Object.is(identity[0], 0)).toBe(true);
  });
});
