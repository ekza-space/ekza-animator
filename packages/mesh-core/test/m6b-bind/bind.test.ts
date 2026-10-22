// C4 `bindSkin` (M6B-SPEC §5.9, §4.2): output invariants of every method, P-S4 (symmetrized bind), determinism,
// the point mask (masked re-solve: every other point bit-equal; the §0.4.4 "Bind Unweighted Points" fix), the joint
// mask (one joint = rigid attach, helpers only when masked in, the empty mask), palette rules, rigid islands,
// closest, rigidify, unreachable islands, visibility against the reference TriangleBvh and autoWeightPoints.
import { EkzaError } from '@ekza-studio/anim-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  autoWeightPoints,
  type BindMethod,
  bindSkin,
  type MeshData,
  type SkinBindArgs,
  type SkinGeometry,
  type SkinSkeleton,
  type SkinWeights,
  skinGeometryOf,
  skinIslands,
  TriangleBvh,
} from '../../src';
import { pointTriangles } from '../../src/skin/geometry';
import { boneSegments, Occluder, segmentClosest } from '../../src/skin/visibility';
import { body, bodySkeletonRows, cubeLad, cubeLadRows, skeletonOf, tube, tubeCharacter, tubes } from './fixtures';
import { cubeLadTruth, DEFAULT_ARGS } from './goldens';

const METHODS: readonly BindMethod[] = ['auto-lowpoly', 'heat', 'rigid-islands', 'closest'];

type Args = SkinBindArgs & { readonly symmetrize: boolean };
const args = (patch: Partial<Args> = {}): Args => ({ ...DEFAULT_ARGS, ...patch });

/** (key, weight) pairs of a point, in stored order. */
function vector(skin: SkinWeights, v: number): [string, number][] {
  const out: [string, number][] = [];
  for (let k = 0; k < 4; k++) {
    const w = skin.weights[4 * v + k] as number;
    if (w > 0) out.push([skin.palette[skin.joints[4 * v + k] as number]?.key as string, w]);
  }
  return out;
}

/** §4.2 SkinWeights invariants after a bind: ≤ 4 influences, Σ = 1 ± 1e-6, descending (ties: smaller palette index),
 *  unused slots 0, every palette joint used (full run) and listed in skeleton order. */
function expectValid(skin: SkinWeights, skeleton: SkinSkeleton, full = true): void {
  const used = new Set<number>();
  const problems: string[] = [];
  for (let v = 0; v < skin.points; v++) {
    let sum = 0;
    let last = Number.POSITIVE_INFINITY;
    let lastIndex = -1;
    let ended = false;
    for (let k = 0; k < 4; k++) {
      const w = skin.weights[4 * v + k] as number;
      const j = skin.joints[4 * v + k] as number;
      if (!(w >= 0)) problems.push(`point ${v}: negative weight`);
      if (w === 0) {
        ended = true;
        if (j !== 0) problems.push(`point ${v}: unused slot ${k} names joint ${j}`);
        continue;
      }
      if (ended) problems.push(`point ${v}: a weight after an unused slot`);
      if (w > last) problems.push(`point ${v}: not descending`);
      if (w === last && j <= lastIndex) problems.push(`point ${v}: a tie not in palette order`);
      last = w;
      lastIndex = j;
      used.add(j);
      sum += w;
    }
    if (!(Math.abs(sum - 1) <= 1e-6)) problems.push(`point ${v}: sum ${sum}`);
  }
  expect(problems).toEqual([]);
  if (!full) return;
  expect(used.size).toBe(skin.palette.length);
  const order = skin.palette.map((entry) => skeleton.keys.indexOf(entry.key));
  expect(order.every((j) => j >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
}

function bodyCase(style: 'smooth' | 'segmented'): { mesh: MeshData; skeleton: SkinSkeleton; geom: SkinGeometry } {
  const mesh = body(style);
  const skeleton = skeletonOf(bodySkeletonRows());
  return { mesh, skeleton, geom: skinGeometryOf(mesh, skeleton.height) };
}

describe('bindSkin: invariants of every method', () => {
  for (const method of METHODS) {
    it(`${method}: the generated bodies, the Cube Lad and the tube character`, () => {
      for (const style of ['smooth', 'segmented'] as const) {
        const { geom, skeleton } = bodyCase(style);
        const { skin, report } = bindSkin(geom, skeleton, args({ method }), null);
        expectValid(skin, skeleton);
        expect(report.islands).toBe(skinIslands(geom).count);
      }
      const truth = cubeLadTruth();
      const lad = cubeLad(truth);
      const ladSkeleton = skeletonOf(cubeLadRows(truth));
      expectValid(bindSkin(skinGeometryOf(lad.mesh, 1.7), ladSkeleton, args({ method }), null).skin, ladSkeleton);
      const character = tubeCharacter();
      const geom = skinGeometryOf(character.mesh, character.skeleton.height);
      expectValid(
        bindSkin(geom, character.skeleton, args({ method, symmetrize: false }), null).skin,
        character.skeleton,
      );
    });
  }

  it('is deterministic: the same input gives bit-identical layers (P-S5, Node side)', () => {
    for (const method of METHODS) {
      const { geom, skeleton } = bodyCase('smooth');
      const a = bindSkin(geom, skeleton, args({ method }), null).skin;
      const b = bindSkin(geom, skeleton, args({ method }), null).skin;
      expect(Array.from(b.joints)).toEqual(Array.from(a.joints));
      expect(Array.from(b.weights)).toEqual(Array.from(a.weights));
      expect(b.palette).toEqual(a.palette);
    }
  });

  // The option-box values that produce 5-entry unions and tied mirror pairs on seam points (partner = self): the
  // 4-influence cut, rigidify and the f32 residual must all be mirror-aware.
  const SYMMETRY_VARIANTS: readonly (readonly [string, Partial<Args>])[] = [
    ['defaults', {}],
    ['pruneBelow 0', { pruneBelow: 0 }],
    ['stiffness 0.1, pruneBelow 0', { stiffness: 0.1, pruneBelow: 0 }],
    ['hierarchy false', { hierarchy: false }],
    ['hierarchy false, pruneBelow 0, dropoff 0.1', { hierarchy: false, pruneBelow: 0, dropoff: 0.1 }],
    ['rigidifyAbove 0.5, pruneBelow 0', { rigidifyAbove: 0.5, pruneBelow: 0 }],
  ];

  /** Asymmetric points of a symmetrized bind: w(v) ≠ M(w(p(v))), seam points included (p(v) = v). */
  function asymmetric(geom: SkinGeometry, skeleton: SkinSkeleton, skin: SkinWeights): string[] {
    const mirrorKey = (key: string): string => {
      const j = skeleton.keys.indexOf(key);
      const m = skeleton.mirror[j] as number;
      return m >= 0 ? (skeleton.keys[m] as string) : key;
    };
    const bad: string[] = [];
    for (let v = 0; v < skin.points; v++) {
      const p = geom.partner[v] as number;
      if (p < 0) {
        bad.push(`point ${v}: no partner`);
        continue;
      }
      const own = new Map(vector(skin, v));
      const other = vector(skin, p).map(([key, w]) => [mirrorKey(key), w] as const);
      if (other.length !== own.size || other.some(([key, w]) => own.get(key) !== w)) {
        bad.push(`point ${v}${p === v ? ' (seam)' : ''}: ${JSON.stringify(vector(skin, v))}`);
      }
    }
    return bad;
  }

  for (const [label, patch] of SYMMETRY_VARIANTS) {
    it(`P-S4: on the symmetric generated bodies w(v) = M(w(p(v))) exactly after a symmetrized bind (${label})`, () => {
      for (const style of ['smooth', 'segmented'] as const) {
        for (const method of METHODS) {
          const { geom, skeleton } = bodyCase(style);
          const { skin } = bindSkin(geom, skeleton, args({ ...patch, method, symmetrize: true }), null);
          expect(asymmetric(geom, skeleton, skin), `${style} ${method}`).toEqual([]);
          expectValid(skin, skeleton);
        }
      }
    });
  }

  it('P-S4 holds with a left-before-right skeleton order (the tie rule is mirror-invariant)', () => {
    for (const style of ['smooth', 'segmented'] as const) {
      const mesh = body(style);
      const rows = bodySkeletonRows();
      // Every right row is directly followed by its left row (bothSides): swap them so left comes first.
      const swapped = [...rows];
      for (let i = 0; i + 1 < swapped.length; i++) {
        const row = swapped[i] as (typeof rows)[number];
        const next = swapped[i + 1] as (typeof rows)[number];
        if (row.key.startsWith('right') && next.key === `left${row.key.slice(5)}`) {
          swapped[i] = next;
          swapped[i + 1] = row;
          i++;
        }
      }
      expect(swapped.findIndex((row) => row.key === 'leftUpperLeg')).toBeLessThan(
        swapped.findIndex((row) => row.key === 'rightUpperLeg'),
      );
      const skeleton = skeletonOf(swapped);
      const geom = skinGeometryOf(mesh, skeleton.height);
      for (const method of METHODS) {
        for (const [, patch] of SYMMETRY_VARIANTS) {
          const { skin } = bindSkin(geom, skeleton, args({ ...patch, method, symmetrize: true }), null);
          expect(asymmetric(geom, skeleton, skin), `${style} ${method}`).toEqual([]);
        }
      }
    }
  });

  it('without symmetrize the bind ignores the partner map; with no partners symmetrize is a no-op', () => {
    const { geom, skeleton } = bodyCase('smooth');
    const lonely: SkinGeometry = { ...geom, partner: new Int32Array(geom.partner.length).fill(-1), paired: 0 };
    const off = bindSkin(geom, skeleton, args({ symmetrize: false }), null).skin;
    const noPartners = bindSkin(lonely, skeleton, args({ symmetrize: true }), null).skin;
    expect(Array.from(noPartners.weights)).toEqual(Array.from(off.weights));
    expect(Array.from(noPartners.joints)).toEqual(Array.from(off.joints));
  });
});

describe('bindSkin: masks and palette rules', () => {
  it('a masked re-solve leaves every other point bit-equal and keeps the previous palette as a prefix', () => {
    const { geom, skeleton } = bodyCase('segmented');
    const before = bindSkin(geom, skeleton, args({ method: 'rigid-islands' }), null).skin;
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: before.points - 1 }), { minLength: 1, maxLength: 60 }),
        fc.constantFrom<BindMethod>(...METHODS),
        (points, method) => {
          const { skin } = bindSkin(geom, skeleton, args({ method, points }), before);
          const masked = new Set(points);
          expect(skin.palette.slice(0, before.palette.length)).toEqual(before.palette);
          for (let v = 0; v < skin.points; v++) {
            if (masked.has(v)) continue;
            for (let k = 0; k < 4; k++) {
              expect(skin.joints[4 * v + k]).toBe(before.joints[4 * v + k]);
              expect(Object.is(skin.weights[4 * v + k], before.weights[4 * v + k])).toBe(true);
            }
          }
          expectValid(skin, skeleton, false);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('Bind Unweighted Points (§0.4.4): the unweighted points get weights, every other point stays bit-equal', () => {
    const { geom, skeleton } = bodyCase('smooth');
    const full = bindSkin(geom, skeleton, args(), null).skin;
    const holes = [3, 17, 40, 41, 42, 100];
    const joints = Uint16Array.from(full.joints);
    const weights = Float32Array.from(full.weights);
    for (const v of holes) for (let k = 0; k < 4; k++) [joints[4 * v + k], weights[4 * v + k]] = [0, 0];
    const previous: SkinWeights = { ...full, joints, weights };
    const { skin } = bindSkin(geom, skeleton, args({ points: holes }), previous);
    expect(holes.map((v) => vector(skin, v).length > 0)).toEqual(holes.map(() => true));
    const others = [...Array(skin.points).keys()].filter((v) => !holes.includes(v));
    const rows = (s: SkinWeights | Uint16Array | Float32Array, v: number) =>
      Array.from((s as Uint16Array | Float32Array).subarray(4 * v, 4 * v + 4));
    expect(others.map((v) => rows(skin.joints, v))).toEqual(others.map((v) => rows(joints, v)));
    expect(others.map((v) => rows(skin.weights, v))).toEqual(others.map((v) => rows(weights, v)));
    expectValid(skin, skeleton, false);
  });

  it('a masked run appends joints the previous palette lacks (palette order rule)', () => {
    const { geom, skeleton } = bodyCase('segmented');
    const before = bindSkin(geom, skeleton, args({ joints: ['hips'] }), null).skin;
    expect(before.palette.map((entry) => entry.key)).toEqual(['hips']);
    const islands = skinIslands(geom);
    const head = Array.from(islands.points.subarray(islands.start[3] as number, islands.start[4] as number));
    const { skin } = bindSkin(geom, skeleton, args({ points: head, method: 'rigid-islands' }), before);
    expect(skin.palette.map((entry) => entry.key)).toEqual(['hips', 'head']);
    for (const v of head) expect(vector(skin, v)).toEqual([['head', 1]]);
  });

  it('one joint = rigid attach; helpers only when masked in; an empty or unknown mask is refused', () => {
    const { geom, skeleton } = bodyCase('smooth');
    for (const method of METHODS) {
      const { skin } = bindSkin(geom, skeleton, args({ method, joints: ['head'] }), null);
      expect(skin.palette.map((entry) => entry.key)).toEqual(['head']);
      for (let v = 0; v < skin.points; v++) expect(vector(skin, v)).toEqual([['head', 1]]);
    }
    const root = bindSkin(geom, skeleton, args({ joints: ['root'] }), null).skin;
    expect(root.palette.map((entry) => entry.key)).toEqual(['root']);
    const auto = bindSkin(geom, skeleton, args(), null).skin;
    expect(auto.palette.some((entry) => entry.key === 'root')).toBe(false);
    for (const joints of [[], ['nope']]) {
      let error: unknown = null;
      try {
        bindSkin(geom, skeleton, args({ joints }), null);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(EkzaError);
      expect((error as EkzaError).code).toBe('skin.empty-mask');
    }
  });

  it('palette entries carry the parent and the mirror partner keys', () => {
    const { geom, skeleton } = bodyCase('smooth');
    const { skin } = bindSkin(geom, skeleton, args(), null);
    const arm = skin.palette.find((entry) => entry.key === 'leftUpperArm');
    expect(arm).toEqual({ key: 'leftUpperArm', parent: 'leftShoulder', mirror: 'rightUpperArm' });
    expect(skin.palette.find((entry) => entry.key === 'spine')).toEqual({ key: 'spine', parent: 'hips', mirror: null });
  });
});

describe('bindSkin: methods', () => {
  it('rigid-islands: one joint per island, the joint nearest the island centroid', () => {
    const { geom, skeleton } = bodyCase('segmented');
    const { skin, report } = bindSkin(geom, skeleton, args({ method: 'rigid-islands' }), null);
    const islands = skinIslands(geom);
    expect(report.rigidIslands).toBe(islands.count);
    expect(report.heatIslands).toBe(0);
    for (let i = 0; i < islands.count; i++) {
      const keys = new Set<string>();
      for (let k = islands.start[i] as number; k < (islands.start[i + 1] as number); k++) {
        const vec = vector(skin, islands.points[k] as number);
        expect(vec.length).toBe(1);
        keys.add((vec[0] as [string, number])[0]);
      }
      expect(keys.size).toBe(1);
    }
  });

  it('closest: a larger dropoff sharpens the falloff; hierarchy keeps j*, its parent and its children', () => {
    const { geom, skeleton } = bodyCase('smooth');
    const soft = bindSkin(
      geom,
      skeleton,
      args({ method: 'closest', dropoff: 1, symmetrize: false, pruneBelow: 0 }),
      null,
    ).skin;
    const sharp = bindSkin(
      geom,
      skeleton,
      args({ method: 'closest', dropoff: 10, symmetrize: false, pruneBelow: 0 }),
      null,
    ).skin;
    let softer = 0;
    for (let v = 0; v < soft.points; v++) {
      expect(sharp.weights[4 * v] as number).toBeGreaterThanOrEqual((soft.weights[4 * v] as number) - 1e-6);
      if ((sharp.weights[4 * v] as number) > (soft.weights[4 * v] as number) + 1e-3) softer++;
    }
    expect(softer).toBeGreaterThan(soft.points / 2);
    const flat = bindSkin(
      geom,
      skeleton,
      args({ method: 'closest', hierarchy: false, symmetrize: false, pruneBelow: 0 }),
      null,
    ).skin;
    expectValid(flat, skeleton);
    const parentOf = (key: string): string | null => {
      const p = skeleton.parent[skeleton.keys.indexOf(key)] as number;
      return p >= 0 ? (skeleton.keys[p] as string) : null;
    };
    for (let v = 0; v < soft.points; v++) {
      const keys = vector(soft, v).map(([key]) => key);
      // {j*, its parent, its children} for one of the influences j*
      const star = keys.some((j) => keys.every((k) => k === j || parentOf(k) === j || parentOf(j) === k));
      expect(star).toBe(true);
    }
  });

  it('heat: every point weighted from the solve, weights in [0, 1]; rigidify makes dominant weights ≥ x rigid', () => {
    const { geom, skeleton } = bodyCase('smooth');
    const heat = bindSkin(geom, skeleton, args({ method: 'heat' }), null);
    expect(heat.report.heatIslands).toBe(1);
    expect(heat.report.cgIterations).toBeGreaterThan(0);
    const rigid = bindSkin(geom, skeleton, args({ method: 'heat', rigidifyAbove: 0.5 }), null).skin;
    expectValid(rigid, skeleton);
    const notRigid = [...Array(rigid.points).keys()].filter((v) => {
      const vec = vector(rigid, v);
      return (vec[0] as [string, number])[1] >= 0.5 && vec.length !== 1;
    });
    expect(notRigid).toEqual([]);
  });

  it('an island that sees no joint binds rigidly to the nearest-centroid joint and is reported (heat)', () => {
    // A box inside a closed box; the bones lie outside both, so the inner box sees nothing.
    const box = (s: number) =>
      tube(
        [
          [0, -s, 0],
          [0, s, 0],
        ],
        s * Math.SQRT2,
        4,
        2,
      );
    const mesh = tubes([box(1), box(0.25)]);
    const skeleton = skeletonOf([
      { key: 'a', parent: null, head: [3, 0, 0] },
      { key: 'b', parent: 'a', head: [3, 1, 0], tail: [3, 2, 0] },
    ]);
    const geom = skinGeometryOf(mesh, skeleton.height);
    const { skin, report } = bindSkin(geom, skeleton, args({ method: 'heat', symmetrize: false }), null);
    expect(Array.from(report.unreachable)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    for (const v of report.unreachable) expect(vector(skin, v)).toEqual([['a', 1]]);
    expectValid(skin, skeleton);
  });
});

describe('visibility', () => {
  it('the occlusion test agrees with the reference TriangleBvh on random rays over the generated bodies', () => {
    for (const style of ['smooth', 'segmented'] as const) {
      const { geom } = bodyCase(style);
      const occluder = new Occluder(geom);
      const reference = new TriangleBvh(geom.positions, geom.tris);
      const incident = pointTriangles(geom);
      const P = geom.positions.length / 3;
      let checked = 0;
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: P - 1 }),
          fc.tuple(
            fc.double({ min: -1, max: 1, noNaN: true }),
            fc.double({ min: -1, max: 1.8, noNaN: true }),
            fc.double({ min: -1, max: 1, noNaN: true }),
          ),
          (v, target) => {
            const o = [0, 1, 2].map(
              (d) => (geom.positions[3 * v + d] as number) + 1.6e-4 * (geom.normals[3 * v + d] as number),
            ) as [number, number, number];
            const dir = [target[0] - o[0], target[1] - o[1], target[2] - o[2]] as const;
            const s = incident.start[v] as number;
            const e = incident.start[v + 1] as number;
            const ignore = new Set(Array.from(incident.tris.subarray(s, e)));
            const expected = reference.raycast(o, dir, 0, 1 - 1e-6, ignore) !== null;
            checked++;
            return occluder.occluded(o[0], o[1], o[2], dir[0], dir[1], dir[2], incident.tris, s, e) === expected;
          },
        ),
        { numRuns: 400 },
      );
      expect(checked).toBeGreaterThanOrEqual(400);
    }
  });

  it('bone segments: head → each child head; a leaf: head → tail', () => {
    const skeleton = skeletonOf(bodySkeletonRows());
    const segs = boneSegments(skeleton, skeleton.deform);
    const hips = skeleton.keys.indexOf('hips');
    const owned = [...Array(segs.count).keys()].filter((s) => segs.owner[s] === hips);
    expect(owned.length).toBe(3); // spine, both upper legs
    const head = skeleton.keys.indexOf('head');
    const leaf = [...Array(segs.count).keys()].filter((s) => segs.owner[s] === head);
    expect(Array.from(segs.b.subarray(3 * (leaf[0] as number), 3 * (leaf[0] as number) + 3))).toEqual([0, 1.6, 0]);
    expect(segs.owner.includes(skeleton.keys.indexOf('root'))).toBe(false);
    const q = new Float64Array(3);
    expect(segmentClosest(segs, leaf[0] as number, 0, 2, 0, q)).toBeCloseTo(0.16, 12);
    expect(Array.from(q)).toEqual([0, 1.6, 0]);
  });
});

describe('autoWeightPoints', () => {
  it('the points nearest the given joints, grown by one ring, ascending', () => {
    const { geom, skeleton } = bodyCase('segmented');
    const points = autoWeightPoints(geom, skeleton, ['head']);
    expect(points.length).toBeGreaterThan(0);
    expect([...points].sort((a, b) => a - b)).toEqual(Array.from(points));
    const islands = skinIslands(geom);
    for (const v of points) expect([2, 3]).toContain(islands.of[v]); // head and neck shells
    expect(autoWeightPoints(geom, skeleton, ['nope']).length).toBe(0);
  });
});
