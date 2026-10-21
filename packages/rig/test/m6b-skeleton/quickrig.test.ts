// Quick Rig v2 kernel (M6B-SPEC §0.4.2; C2 DoD P-J4): the fit on synthesized markers within 0.03 H of every truth
// joint, the One-Click guess within 0.05 H of the truth markers (the Cube Lad's chin included) and bit-identical over
// two runs, on the Cube Lad, the generated body and T-posed Polybot; the minimum-bend rest flexion (a side-view elbow
// depth survives bit-equal, a straight limb gets exactly δmin, a hyper-extended one is pushed to δmin, x and y never
// change); the start checks on an off-centre, a lifted and a −Z-facing Cube Lad; the re-run seeding; projected centres.
import type { HumanBoneName } from '@ekza-studio/doc';
import { TriangleBvh } from '@ekza-studio/mesh-core';
import { describe, expect, it } from 'vitest';
import type { SkeletonId, SkeletonRecord } from '@ekza-studio/doc';
import {
  checkSkeleton,
  DEFAULT_FLEXION,
  fitTemplate,
  GUESS,
  guessMarkers,
  hingeBend,
  markersFromJoints,
  minimumBend,
  placeTemplate,
  projectedCenter,
  QUICK_RIG_CENTRE_MARKERS,
  QUICK_RIG_SIDE_MARKERS,
  type QuickRigMarkers,
  quickRigStartChecks,
  type SkeletonPreset,
  skeletonTemplate,
  type TemplateJoint,
  templateJointRecords,
} from '../../src';
import { boundsOf, cubeLad, dist, type Fixture, generatedBody, polybotTPose, type Triangles, type V3 } from './support';

const FIXTURES = [cubeLad, () => generatedBody('smooth'), () => generatedBody('segmented'), polybotTPose] as const;
const opts = (f: Fixture) => ({ ground: f.ground, hingeBias: 0.15, flexion: DEFAULT_FLEXION });

function templateFor(f: Fixture, preset: SkeletonPreset = 'standard33'): readonly TemplateJoint[] {
  const tpl = skeletonTemplate(preset, { height: f.height, proportions: 'standard', flexion: DEFAULT_FLEXION });
  return placeTemplate(tpl, [0, f.ground, 0]);
}
const fitOf = (f: Fixture, markers: QuickRigMarkers, preset: SkeletonPreset = 'standard33') =>
  fitTemplate(templateFor(f, preset), markers, f.bvh, opts(f));
const at = (joints: readonly TemplateJoint[], key: string): TemplateJoint => {
  const joint = joints.find((j) => j.key === key);
  if (joint === undefined) throw new Error(`no ${key}`);
  return joint;
};

describe('P-J4 fit: every humanoid joint within 0.03 H of the truth on synthesized markers', () => {
  it.each(FIXTURES.map((make) => [make().name, make] as const))('%s', (_name, make) => {
    const f = make();
    const fit = fitOf(f, f.markers);
    const truth = f.joints as Readonly<Record<string, V3>>;
    const compared = fit.filter((joint) => truth[joint.key] !== undefined);
    const off = compared
      .map((joint) => [joint.key, dist(joint.position, truth[joint.key] as V3) / f.height] as const)
      .filter(([, error]) => error > 0.03);
    expect(off).toEqual([]);
    expect(compared.length).toBeGreaterThanOrEqual(21);
  });

  it('joints on markers equal them; neck and head from the chin; the head tail is headTop; left = mirror(right)', () => {
    const f = cubeLad();
    const m = f.markers;
    const fit = fitOf(f, m);
    expect(at(fit, 'hips').position).toEqual(m.pelvis);
    expect(at(fit, 'rightUpperArm').position).toEqual(m.shoulder);
    expect(at(fit, 'rightHand').position).toEqual(m.wrist);
    expect(at(fit, 'rightFoot').position).toEqual(m.ankle);
    expect(at(fit, 'rightToes').position).toEqual(m.toe);
    expect(at(fit, 'head').tail).toEqual(m.headTop);
    const H = m.headTop[1] - f.ground;
    expect(at(fit, 'neck').position).toEqual([0, m.chin[1] - 0.01 * H, m.chin[2]]);
    expect(at(fit, 'head').position).toEqual([0, m.chin[1] + 0.02 * H, m.chin[2]]);
    const left = fit.filter((joint) => joint.key.startsWith('left'));
    expect(left.map((joint) => joint.position)).toEqual(
      left.map((joint) => {
        const right = at(fit, `right${joint.key.slice(4)}`).position;
        return [-right[0], right[1], right[2]];
      }),
    );
    const centre = ['root', 'hips', 'spine', 'chest', 'neck', 'head'];
    expect(centre.filter((key) => !Object.is(at(fit, key).position[0], 0))).toEqual([]);
  });

  it('pure: the same inputs give the same joints bit for bit (preview = commit)', () => {
    for (const make of FIXTURES) {
      const f = make();
      expect(fitOf(f, f.markers)).toEqual(fitOf(f, f.markers));
    }
  });

  it('every preset: the template keys and parents survive the fit; Full 52 places upperChest between chest and neck', () => {
    const f = cubeLad();
    for (const preset of ['lite17', 'core21', 'standard33', 'full52'] as const) {
      const tpl = templateFor(f, preset);
      const fit = fitTemplate(tpl, f.markers, f.bvh, opts(f));
      expect(fit.map((j) => [j.key, j.parent])).toEqual(tpl.map((j) => [j.key, j.parent]));
    }
    const full = fitOf(f, f.markers, 'full52');
    const y = (key: string) => at(full, key).position[1];
    expect(y('chest')).toBeLessThan(y('upperChest'));
    expect(y('upperChest')).toBeLessThan(y('neck'));
  });

  it('missing markers take the template’s proportions on the bounds', () => {
    const f = cubeLad();
    const tpl = templateFor(f);
    const fit = fitTemplate(tpl, {}, f.bvh, opts(f));
    expect(at(fit, 'rightHand').position).toEqual(at(tpl, 'rightHand').position);
    expect(at(fit, 'hips').position).toEqual(at(tpl, 'hips').position);
  });
});

describe('minimum bend (§0.4.2, Q-MVP-16)', () => {
  const f = cubeLad();
  const H = f.height;
  const theta = DEFAULT_FLEXION;
  const required = (A: V3, B: V3, C: V3) => (theta * dist(B, A) * dist(C, B)) / (dist(B, A) + dist(C, B));
  const straight: QuickRigMarkers = { ...f.markers, elbow: [-0.48, 1.33, 0], knee: [-0.1, 0.46, 0] };

  it('a straight limb gets exactly δmin; x and y never change', () => {
    const fit = fitOf(f, straight);
    const A = at(fit, 'rightUpperArm').position;
    const B = at(fit, 'rightLowerArm').position;
    const C = at(fit, 'rightHand').position;
    expect(B[0]).toBe(-0.48);
    expect(B[1]).toBe(1.33);
    expect(B[2]).toBe(-required(A, straight.elbow as V3, C));
    expect(hingeBend(A, B, C, [0, 0, -1])).toBeCloseTo(required(A, straight.elbow as V3, C), 15);
    const knee = at(fit, 'rightLowerLeg').position;
    expect([knee[0], knee[1]]).toEqual([-0.1, 0.46]);
    expect(hingeBend(at(fit, 'rightUpperLeg').position, knee, at(fit, 'rightFoot').position, [0, 0, 1])).toBeCloseTo(
      required(at(fit, 'rightUpperLeg').position, straight.knee as V3, at(fit, 'rightFoot').position),
      15,
    );
    // The template (straight limbs) gets the §5.2 absolute rule: z = −θ·a·b/(a + b).
    const tpl = skeletonTemplate('standard33', { height: H, proportions: 'standard', flexion: theta });
    const a = 0.16 * H;
    const b = 0.14 * H;
    expect(at(tpl, 'rightLowerArm').position[2]).toBeCloseTo((-theta * a * b) / (a + b), 15);
    expect(at(tpl, 'leftLowerLeg').position[2]).toBeCloseTo((theta * 0.2 * H * 0.242 * H) / (0.442 * H), 15);
  });

  it('a side-view elbow depth that bends the arm by ≥ θ survives bit-equal (the AS-MVP-1 step 3 drag)', () => {
    const elbow: V3 = [-0.48, 1.33, -0.02];
    const fit = fitOf(f, { ...f.markers, elbow });
    // toEqual compares numbers with Object.is: bit-equal.
    expect(at(fit, 'rightLowerArm').position).toEqual(elbow);
    expect(at(fit, 'leftLowerArm').position).toEqual([0.48, 1.33, -0.02]);
    const knee: V3 = [-0.1, 0.46, 0.03];
    expect(at(fitOf(f, { ...f.markers, knee }), 'rightLowerLeg').position).toEqual(knee);
  });

  it('a hyper-extended limb (δ < 0) is pushed to δmin, only in z', () => {
    const elbow: V3 = [-0.48, 1.33, 0.01];
    const fit = fitOf(f, { ...f.markers, elbow });
    const A = at(fit, 'rightUpperArm').position;
    const B = at(fit, 'rightLowerArm').position;
    const C = at(fit, 'rightHand').position;
    expect([B[0], B[1]]).toEqual([elbow[0], elbow[1]]);
    expect(hingeBend(A, B, C, [0, 0, -1])).toBeCloseTo(required(A, elbow, C), 14);
    const knee: V3 = [-0.1, 0.46, -0.02];
    const legs = fitOf(f, { ...f.markers, knee });
    const K = at(legs, 'rightLowerLeg').position;
    expect([K[0], K[1]]).toEqual([knee[0], knee[1]]);
    expect(hingeBend(at(legs, 'rightUpperLeg').position, K, at(legs, 'rightFoot').position, [0, 0, 1])).toBeCloseTo(
      required(at(legs, 'rightUpperLeg').position, knee, at(legs, 'rightFoot').position),
      14,
    );
  });

  it('minimumBend returns the same tuple when the bend suffices and moves only along d otherwise', () => {
    const A: V3 = [0, 0, 0];
    const C: V3 = [2, 0, 0];
    const bent: V3 = [1, 0, -0.5];
    expect(minimumBend(A, bent, C, [0, 0, -1], theta)).toBe(bent);
    const out = minimumBend(A, [1, 0, 0], C, [0, 0, -1], theta);
    expect(out).toEqual([1, 0, -theta / 2]);
  });
});

describe('P-J4 guess: within 0.05 H of the truth markers, bit-identical over two runs', () => {
  it.each(FIXTURES.map((make) => [make().name, make] as const))('%s', (_name, make) => {
    const f = make();
    const first = guessMarkers(f.bvh, f.bounds);
    const second = guessMarkers(new TriangleBvh(f.triangles.positions, f.triangles.tris), f.bounds);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    if (first === null) return;
    expect(first.aPose).toBe(false);
    expect(first.armAngle).toBeLessThan((5 * Math.PI) / 180);
    const off = [...QUICK_RIG_CENTRE_MARKERS, ...QUICK_RIG_SIDE_MARKERS]
      .map((name) => [name, dist(first.markers[name], f.markers[name]) / f.height] as const)
      .filter(([, error]) => error > 0.05);
    expect(off).toEqual([]);
    expect(QUICK_RIG_CENTRE_MARKERS.filter((name) => !Object.is(first.markers[name][0], 0))).toEqual([]);
    expect(QUICK_RIG_SIDE_MARKERS.filter((name) => !(first.markers[name][0] < 0))).toEqual([]);
  });

  it('the Cube Lad chin is the topmost of the box neck’s equal rows (the tie rule)', () => {
    const f = cubeLad();
    const chin = guessMarkers(f.bvh, f.bounds)?.markers.chin;
    // The neck box spans 1.40…1.48: the topmost neck row ends at the head's bottom.
    expect(chin?.[1]).toBeGreaterThan(1.47);
    expect(chin?.[1]).toBeLessThanOrEqual(1.48 + f.height / GUESS.rows);
  });

  it('an A-posed variant (arms rotated 35° down) reports aPose with the arm angle', () => {
    const f = cubeLad();
    const t = rotateArms(f.triangles, (35 * Math.PI) / 180);
    const bounds = boundsOf(t);
    const guess = guessMarkers(new TriangleBvh(t.positions, t.tris), bounds);
    expect(guess?.aPose).toBe(true);
    expect(Math.abs((guess?.armAngle ?? 0) - (35 * Math.PI) / 180)).toBeLessThan((8 * Math.PI) / 180);
  });

  it('no leg split → null', () => {
    const block: Triangles = boxTriangles([0, 0.85, 0], [0.4, 1.7, 0.3]);
    expect(guessMarkers(new TriangleBvh(block.positions, block.tris), boundsOf(block))).toBeNull();
  });
});

describe('guess → fit → checkSkeleton: the One-Click path is lint-clean (E2E-SKIN-01 "no error row")', () => {
  const PRESETS: readonly SkeletonPreset[] = ['lite17', 'core21', 'standard33', 'full52'];
  const cases = FIXTURES.flatMap((make) => PRESETS.map((preset) => [make().name, preset, make] as const));
  it.each(cases)('%s, %s', (_name, preset, make) => {
    const f = make();
    const guess = guessMarkers(f.bvh, f.bounds);
    expect(guess).not.toBeNull();
    if (guess === null) return;
    const SKEL = 'skl_g' as SkeletonId;
    const skeleton: SkeletonRecord = {
      id: SKEL,
      character: 'chr_g' as never,
      template: 'vrm-humanoid',
      templateVersion: '1.0.0',
      preset,
      symmetry: true,
      deleted: null,
    };
    const joints = templateJointRecords(fitOf(f, guess.markers, preset), SKEL);
    expect(checkSkeleton({ skeleton, joints, meshes: [] })).toEqual([]);
  });
});

describe('start checks (§0.4.2, CR-AR-3)', () => {
  const check = (t: Triangles) => quickRigStartChecks(boundsOf(t), new TriangleBvh(t.positions, t.tris));

  it('the Cube Lad, the generated body and Polybot pass', () => {
    for (const make of FIXTURES) {
      const f = make();
      expect({ name: f.name, ...quickRigStartChecks(f.bounds, f.bvh) }).toEqual({
        name: f.name,
        centred: true,
        grounded: true,
        facing: true,
      });
    }
  });

  it('off-centre (0.1 m in x), lifted (0.05 m) and −Z-facing (180° about Y) Cube Lads fail their check only', () => {
    const f = cubeLad();
    expect(check(transform(f.triangles, (p) => [p[0] + 0.1, p[1], p[2]]))).toEqual({
      centred: false,
      grounded: true,
      facing: true,
    });
    expect(check(transform(f.triangles, (p) => [p[0], p[1] + 0.05, p[2]]))).toEqual({
      centred: true,
      grounded: false,
      facing: true,
    });
    expect(check(transform(f.triangles, (p) => [-p[0], p[1], -p[2]]))).toEqual({
      centred: true,
      grounded: true,
      facing: false,
    });
  });

  it('a flat or empty model fails every check', () => {
    const empty = { positions: new Float64Array(0), tris: new Uint32Array(0) };
    expect(check(empty)).toEqual({ centred: false, grounded: false, facing: false });
  });
});

describe('re-run seeding (§0.4.2 Re-run)', () => {
  it('seeds the markers from the joints as they are: refitting the seeded markers reproduces the joints (1e-5 m)', () => {
    const f = cubeLad();
    const fit = fitOf(f, f.markers);
    const lookup = (bone: HumanBoneName) => {
      const j = fit.find((joint) => joint.key === bone);
      return j === undefined ? undefined : { position: j.position, tail: j.tail };
    };
    const seeded = markersFromJoints(lookup, f.ground);
    expect(seeded.headTop).toEqual(f.markers.headTop);
    expect(seeded.pelvis).toEqual(f.markers.pelvis);
    expect(seeded.elbow).toEqual(at(fit, 'rightLowerArm').position);
    // Bent elbows and knees are seeded as they are: the refit's δmin of the bent lengths differs by < 1e-5 m, and the
    // fingers follow the bent forearm’s direction (< 3 mm).
    const refit = fitOf(f, seeded);
    const drift = fit
      .map((joint) => [joint.key, dist(at(refit, joint.key).position, joint.position)] as const)
      .filter(([key, d]) => d >= (/Thumb|Index|Middle|Ring|Little/.test(key) ? 3e-3 : 1e-5));
    expect(drift).toEqual([]);
    const all = Object.keys(seeded).sort();
    expect(all).toEqual([...QUICK_RIG_CENTRE_MARKERS, ...QUICK_RIG_SIDE_MARKERS].sort());
  });
});

describe('projectedCenter (§5.3)', () => {
  const box = boxTriangles([0, 0, 0], [1, 1, 0.4]);
  const bvh = new TriangleBvh(box.positions, box.tris);
  it('the slab midpoint along the ray; null without a hit', () => {
    expect(projectedCenter(bvh, [0.1, 0.2, 5], [0, 0, -1], { mode: 'new', fallbackRadius: 0.05 })).toEqual([
      0.1, 0.2, 0,
    ]);
    expect(projectedCenter(bvh, [3, 3, 5], [0, 0, -1], { mode: 'new', fallbackRadius: 0.05 })).toBeNull();
  });
  it('new = the nearest slab; reposition = the slab containing the depth', () => {
    const two = merge(boxTriangles([0, 0, 1], [1, 1, 0.4]), boxTriangles([0, 0, -1], [1, 1, 0.4]));
    const b2 = new TriangleBvh(two.positions, two.tris);
    expect(projectedCenter(b2, [0, 0, 5], [0, 0, -1], { mode: 'new', fallbackRadius: 0 })?.[2]).toBeCloseTo(1, 12);
    expect(
      projectedCenter(b2, [0, 0, 5], [0, 0, -1], { mode: 'reposition', depth: 6, fallbackRadius: 0 })?.[2],
    ).toBeCloseTo(-1, 12);
  });
  it('an open mesh (one hit) uses the hit pushed inward by fallbackRadius', () => {
    const quad: Triangles = {
      positions: new Float64Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
      tris: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
    const hit = projectedCenter(new TriangleBvh(quad.positions, quad.tris), [0, 0, 5], [0, 0, -2], {
      mode: 'new',
      fallbackRadius: 0.1,
    });
    expect(hit?.[2]).toBeCloseTo(-0.1, 12);
  });
});

// ---------- helpers ----------
function transform(t: Triangles, map: (p: V3) => V3): Triangles {
  const positions = new Float64Array(t.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const p = map([t.positions[i] as number, t.positions[i + 1] as number, t.positions[i + 2] as number]);
    positions.set(p, i);
  }
  return { positions, tris: t.tris };
}

/** Rotates every point with |x| > 0.18 (the arms) down by `angle` about the shoulder (±0.18, 1.33, 0). */
function rotateArms(t: Triangles, angle: number): Triangles {
  return transform(t, (p) => {
    if (Math.abs(p[0]) <= 0.181) return p;
    const s = Math.sign(p[0]);
    const dx = p[0] - s * 0.18;
    const dy = p[1] - 1.33;
    const c = Math.cos(angle);
    const n = Math.sin(angle);
    return [s * 0.18 + dx * c + s * dy * n, 1.33 - s * dx * n + dy * c, p[2]];
  });
}

function boxTriangles(c: V3, size: V3): Triangles {
  const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const positions = new Float64Array(24);
  let k = 0;
  for (const z of [-hz, hz]) {
    for (const [x, y] of [
      [-hx, -hy],
      [hx, -hy],
      [hx, hy],
      [-hx, hy],
    ] as const) {
      positions.set([c[0] + x, c[1] + y, c[2] + z], 3 * k++);
    }
  }
  // biome-ignore format: one face per line
  const tris = new Uint32Array([
    4, 5, 6, 4, 6, 7, // +z
    1, 0, 3, 1, 3, 2, // -z
    5, 1, 2, 5, 2, 6, // +x
    0, 4, 7, 0, 7, 3, // -x
    7, 6, 2, 7, 2, 3, // +y
    0, 1, 5, 0, 5, 4, // -y
  ]);
  return { positions, tris };
}

function merge(a: Triangles, b: Triangles): Triangles {
  const positions = new Float64Array(a.positions.length + b.positions.length);
  positions.set(a.positions);
  positions.set(b.positions, a.positions.length);
  const offset = a.positions.length / 3;
  const tris = new Uint32Array(a.tris.length + b.tris.length);
  tris.set(a.tris);
  tris.set(
    Array.from(b.tris, (i) => i + offset),
    a.tris.length,
  );
  return { positions, tris };
}
