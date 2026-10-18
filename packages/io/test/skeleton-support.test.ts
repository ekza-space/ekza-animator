// SkeletonDesc.boneSupport (M2A-SPEC §4.3, §5.2.3; A1): the per-node horizontal support function of the dominant
// vertices, and the foot-region rule (a lower leg's vertices below the ankle count for the foot).
import { readFixture } from '@ekza-animator/doc/testing';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { describe, expect, it } from 'vitest';
import { parseGlb } from '../src/glb/parse';
import { skeletonFromGltf } from '../src/skeleton/read';
import { boneSupportOf, SUPPORT_SAMPLES, SUPPORT_STRIDE, type SupportPrimitive } from '../src/skeleton/support';

/** One primitive with the given vertices: canonical positions and (joint slot, weight) pairs. */
function primitive(
  vertices: readonly {
    readonly at: readonly [number, number, number];
    readonly weights: readonly [number, number][];
  }[],
  skinJoints: readonly number[],
): SupportPrimitive {
  const joints = new Uint32Array(vertices.length * 4);
  const weights = new Float32Array(vertices.length * 4);
  const placed = new Float32Array(vertices.length * 3);
  vertices.forEach((vertex, v) => {
    vertex.weights.forEach(([joint, weight], k) => {
      joints[v * 4 + k] = joint;
      weights[v * 4 + k] = weight;
    });
    placed.set(vertex.at, v * 3);
  });
  return { joints, weights, skinJoints, placed };
}

describe('boneSupportOf', () => {
  it('samples h_k = max (v − p)·(sin θ_k, 0, cos θ_k) and the y range of each node’s dominant vertices', () => {
    const origins: [number, number, number][] = [
      [0, 1, 0],
      [0.5, 0, 0],
    ];
    const support = boneSupportOf(
      [
        primitive(
          [
            { at: [0.1, 1.05, 0], weights: [[0, 1]] },
            {
              at: [0, 0.98, -0.2],
              weights: [
                [0, 0.6],
                [1, 0.4],
              ],
            },
            // Dominated by node 1 (0.7 > 0.3).
            {
              at: [0.5, 0.1, 0.3],
              weights: [
                [0, 0.3],
                [1, 0.7],
              ],
            },
            // No weight: skipped.
            { at: [9, 9, 9], weights: [] },
          ],
          [0, 1],
        ),
      ],
      3,
      origins,
    );
    expect(support).toHaveLength(3);
    const node0 = support[0] as Float32Array;
    expect(node0).toHaveLength(SUPPORT_STRIDE);
    for (let k = 0; k < SUPPORT_SAMPLES; k++) {
      const theta = (2 * Math.PI * k) / SUPPORT_SAMPLES;
      const expected = Math.max(0.1 * Math.sin(theta), -0.2 * Math.cos(theta));
      expect(node0[k]).toBeCloseTo(expected, 6);
    }
    expect(node0[SUPPORT_SAMPLES]).toBeCloseTo(-0.02, 6);
    expect(node0[SUPPORT_SAMPLES + 1]).toBeCloseTo(0.05, 6);
    const node1 = support[1] as Float32Array;
    expect(node1[0]).toBeCloseTo(0.3, 6); // θ = 0: +z
    expect(node1[SUPPORT_SAMPLES]).toBeCloseTo(0.1, 6);
    expect(support[2]).toBeNull();
  });

  it('counts a lower leg’s vertices below the ankle for the foot (heels skinned to the shin)', () => {
    // Node 0 lower leg (knee at y 0.5), node 1 foot (ankle at y 0.08).
    const origins: [number, number, number][] = [
      [0.1, 0.5, 0],
      [0.1, 0.08, 0],
    ];
    const prim = primitive(
      [
        { at: [0.1, 0.3, -0.06], weights: [[0, 1]] }, // calf: stays with the lower leg
        { at: [0.1, 0.02, -0.07], weights: [[0, 1]] }, // heel below the ankle: the foot's
        { at: [0.1, 0.0, 0.15], weights: [[1, 1]] }, // toes
      ],
      [0, 1],
    );
    const plain = boneSupportOf([prim], 2, origins);
    const withFeet = boneSupportOf([prim], 2, origins, [{ lowerLeg: 0, foot: 1 }]);
    const back = SUPPORT_SAMPLES / 2; // θ = 180°: −z
    expect((plain[1] as Float32Array)[back]).toBeCloseTo(-0.15, 6);
    expect((withFeet[1] as Float32Array)[back]).toBeCloseTo(0.07, 6);
    expect((withFeet[1] as Float32Array)[SUPPORT_SAMPLES]).toBeCloseTo(-0.08, 6);
    // The lower leg keeps only its vertex above the ankle.
    expect((withFeet[0] as Float32Array)[back]).toBeCloseTo(0.06, 6);
    expect((withFeet[0] as Float32Array)[SUPPORT_SAMPLES]).toBeCloseTo(-0.2, 6);
  });
});

describe('skeletonFromGltf boneSupport', () => {
  it.each(['seed-san.vrm', 'polybot.vrm'] as const)('measures a heel behind the ankle on %s', async (name) => {
    const skeleton: SkeletonDesc = skeletonFromGltf(await parseGlb(readFixture(name)));
    expect(skeleton.boneSupport).toHaveLength(skeleton.nodes.length);
    for (const side of ['leftFoot', 'rightFoot'] as const) {
      const foot = skeleton.humanoid?.[side] as number;
      // The foot and the joints below it (Seed-san's heel.L), behind their rest positions (canonical −z).
      let back = Number.NEGATIVE_INFINITY;
      skeleton.nodes.forEach((node, i) => {
        let under = false;
        for (let n = i; n !== -1; n = skeleton.nodes[n]?.parent ?? -1) if (n === foot) under = true;
        const values = skeleton.boneSupport?.[i];
        if (!under || values === null || values === undefined) return;
        back = Math.max(back, values[SUPPORT_SAMPLES / 2] as number);
      });
      expect([name, side, back > 0.03]).toEqual([name, side, true]);
    }
    // A UAL-like generic file without a humanoid map still measures (no foot regions).
    const ual = skeletonFromGltf(await parseGlb(readFixture('quaternius-ual.glb')));
    expect(ual.boneSupport?.some((values) => values !== null)).toBe(true);
  });
});
