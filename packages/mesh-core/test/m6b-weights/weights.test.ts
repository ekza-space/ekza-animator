// C6 weight kernel (C5 MVP subset; M6B-SPEC §5.10–§5.13, §5.26): the §5.10 contract on single points (Maya's Replace
// example, holds, the ancestor remainder, unweighted points, the 4-influence cut), the palette append rule, P-S1 over
// random edit sequences and holds, P-S2 (replay, s_max, incremental = batch for every op with and without mirror,
// preview = commit), P-S3 (Mirror Skin Weights involution, mirrored strokes, centre joints), P-S6 (compact), the
// utilities (smooth with expand, prune, normalize), `checkSkin` and `skinDirty`.
import { EkzaError } from '@ekza-studio/anim-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  beginStroke,
  checkSkin,
  editWeights,
  mirrorWeights,
  type PaintOp,
  type SkinGeometry,
  type SkinWeights,
  skinDirty,
  type StrokeStamp,
  type WeightContext,
  type WeightEdit,
} from '../../src';
import { graphOf } from '../../src/skin/stroke';
import { skeletonOf } from '../m6b-bind/fixtures';
import { asymmetric, boundBody, context, invalidPoints, leftPoints, mirrorKey, pointsNear, vectorOf } from './support';

// ---------- a tiny fixture: a chain root → hips → spine → left/right arm, four points ----------

const chain = skeletonOf([
  { key: 'root', parent: null, head: [0, 0, 0], deform: false },
  { key: 'hips', parent: 'root', head: [0, 1, 0] },
  { key: 'spine', parent: 'hips', head: [0, 1.2, 0] },
  { key: 'leftArm', parent: 'spine', head: [0.2, 1.4, 0] },
  { key: 'rightArm', parent: 'spine', head: [-0.2, 1.4, 0] },
  { key: 'leftHand', parent: 'leftArm', head: [0.5, 1.4, 0], tail: [0.6, 1.4, 0] },
  { key: 'rightHand', parent: 'rightArm', head: [-0.5, 1.4, 0], tail: [-0.6, 1.4, 0] },
]);

/** Four points: two left (x 0.3, 0.4), their partners on the right, one triangle strip between them. */
const tinyGeometry: SkinGeometry = {
  positions: Float64Array.from([0.3, 1.4, 0, 0.4, 1.4, 0, -0.3, 1.4, 0, -0.4, 1.4, 0, 0, 1.4, 0]),
  tris: Uint32Array.from([0, 1, 4, 2, 4, 3]),
  normals: new Float64Array(15).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)),
  partner: Int32Array.from([2, 3, 0, 1, 4]),
  paired: 1,
};

function skinOf(rows: readonly (readonly (readonly [string, number])[])[], palette: readonly string[]): SkinWeights {
  const joints = new Uint16Array(4 * rows.length);
  const weights = new Float32Array(4 * rows.length);
  rows.forEach((row, v) => {
    row.forEach(([key, w], k) => {
      joints[4 * v + k] = palette.indexOf(key);
      weights[4 * v + k] = w;
    });
  });
  return {
    points: rows.length,
    palette: palette.map((key) => ({ key, parent: null, mirror: null })),
    joints,
    weights,
  };
}

const tiny = (holds: readonly string[] = []): WeightContext => ({
  skeleton: chain,
  geometry: tinyGeometry,
  holds: new Set(holds),
});

const at = (skin: SkinWeights, v: number): Record<string, number> => Object.fromEntries(vectorOf(skin, v));

describe('§5.10 normalization contract on single points', () => {
  it("Maya's example: Replace, w = 0, value 1, opacity 0.5 → 0.5; the rest shrinks to fit", () => {
    const skin = skinOf([[['spine', 1]], [['spine', 1]], [['spine', 1]], [['spine', 1]], [['spine', 1]]], ['spine']);
    const out = editWeights(
      skin,
      { kind: 'flood', points: [0], joint: 'leftArm', op: 'replace', value: 1, opacity: 0.5, mirror: false },
      tiny(),
    );
    expect(at(out.skin, 0)).toEqual({ leftArm: 0.5, spine: 0.5 });
    expect(Array.from(out.changed)).toEqual([0]);
    // The new joint is appended at the palette end; the input is untouched.
    expect(out.skin.palette.map((e) => e.key)).toEqual(['spine', 'leftArm']);
    expect(out.skin.palette[1]).toEqual({ key: 'leftArm', parent: 'spine', mirror: 'rightArm' });
    expect(at(skin, 0)).toEqual({ spine: 1 });
  });

  it('held joints never change; the free ones share what is left; a held active joint is refused', () => {
    const skin = skinOf(
      [
        [
          ['spine', 0.5],
          ['leftArm', 0.3],
          ['hips', 0.2],
        ],
        [['spine', 1]],
        [['spine', 1]],
        [['spine', 1]],
        [['spine', 1]],
      ],
      ['spine', 'leftArm', 'hips'],
    );
    const out = editWeights(
      skin,
      { kind: 'set', points: [0], joint: 'leftArm', value: 0.6, mode: 'set' },
      tiny(['spine']),
    );
    const row = at(out.skin, 0);
    expect(row['spine']).toBe(Math.fround(0.5));
    expect(row['leftArm']).toBeCloseTo(0.5, 6); // clamped to avail = 1 − 0.5
    expect(row['hips'] ?? 0).toBeCloseTo(0, 6);
    expect(() =>
      editWeights(skin, { kind: 'set', points: [0], joint: 'spine', value: 0.1, mode: 'set' }, tiny(['spine'])),
    ).toThrow(EkzaError);
    // avail ≤ 0: held weights fill the point — nothing changes.
    const full = editWeights(
      skin,
      { kind: 'set', points: [1], joint: 'leftArm', value: 1, mode: 'set' },
      tiny(['spine']),
    );
    expect(Array.from(full.changed)).toEqual([]);
  });

  it('the remainder goes to the nearest free deforming ancestor; unweighted points start there', () => {
    const skin = skinOf([[['leftArm', 1]], [], [], [], []], ['leftArm']);
    // Lowering the only joint: the remainder goes to spine (its parent).
    const lowered = editWeights(skin, { kind: 'set', points: [0], joint: 'leftArm', value: 0.25, mode: 'set' }, tiny());
    expect(at(lowered.skin, 0)).toEqual({ leftArm: 0.25, spine: 0.75 });
    // With spine held the remainder skips it to hips.
    const skipped = editWeights(
      skin,
      { kind: 'set', points: [0], joint: 'leftArm', value: 0.25, mode: 'set' },
      tiny(['spine']),
    );
    expect(at(skipped.skin, 0)).toEqual({ leftArm: 0.25, hips: 0.75 });
    // An unweighted point: w_a = clamp(t), the rest to the ancestor; t = 0 on it changes nothing.
    const fresh = editWeights(skin, { kind: 'set', points: [1], joint: 'leftHand', value: 0.4, mode: 'set' }, tiny());
    expect(at(fresh.skin, 1)).toEqual({ leftHand: Math.fround(0.4), leftArm: Math.fround(0.6) });
    const zero = editWeights(skin, { kind: 'set', points: [1], joint: 'leftHand', value: 0, mode: 'set' }, tiny());
    expect(Array.from(zero.changed)).toEqual([]);
    // No deforming ancestor (hips' parent is the helper root): the active joint takes it all.
    const top = editWeights(skin, { kind: 'set', points: [2], joint: 'hips', value: 0.3, mode: 'set' }, tiny());
    expect(at(top.skin, 2)).toEqual({ hips: 1 });
  });

  it('a fifth influence drops the smallest free one (never the active joint) and rescales', () => {
    const skin = skinOf(
      [
        [
          ['spine', 0.4],
          ['hips', 0.3],
          ['leftArm', 0.2],
          ['rightArm', 0.1],
        ],
        [],
        [],
        [],
        [],
      ],
      ['spine', 'hips', 'leftArm', 'rightArm'],
    );
    const out = editWeights(skin, { kind: 'set', points: [0], joint: 'leftHand', value: 0.05, mode: 'set' }, tiny());
    const row = at(out.skin, 0);
    expect(Object.keys(row).sort()).toEqual(['hips', 'leftArm', 'leftHand', 'spine']);
    expect(row['leftHand']).toBe(Math.fround(0.05));
    expect(Object.values(row).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(invalidPoints(out.skin)).toEqual([]);
  });

  it('set modes add and mul; normalize repairs sums and is idempotent; prune keeps the largest', () => {
    const skin = skinOf(
      [
        [
          ['spine', 0.5],
          ['leftArm', 0.5],
        ],
        [
          ['spine', 0.6],
          ['leftArm', 0.2],
        ],
        [
          ['spine', 0.97],
          ['hips', 0.03],
        ],
        [],
        [],
      ],
      ['spine', 'leftArm', 'hips'],
    );
    const add = editWeights(skin, { kind: 'set', points: [0], joint: 'leftArm', value: 0.1, mode: 'add' }, tiny());
    expect(at(add.skin, 0)['leftArm']).toBeCloseTo(0.6, 6);
    const mul = editWeights(skin, { kind: 'set', points: [0], joint: 'leftArm', value: 0.5, mode: 'mul' }, tiny());
    expect(at(mul.skin, 0)['leftArm']).toBeCloseTo(0.25, 6);
    const norm = editWeights(skin, { kind: 'normalize', points: null, lockActive: null }, tiny());
    expect(Array.from(norm.changed)).toEqual([1]);
    expect(at(norm.skin, 1)['spine']).toBeCloseTo(0.75, 6);
    const again = editWeights(norm.skin, { kind: 'normalize', points: null, lockActive: null }, tiny());
    expect(Array.from(again.changed)).toEqual([]);
    // lockActive keeps the active joint's value.
    const locked = editWeights(skin, { kind: 'normalize', points: [1], lockActive: 'leftArm' }, tiny());
    expect(at(locked.skin, 1)['leftArm']).toBe(Math.fround(0.2));
    const pruned = editWeights(skin, { kind: 'prune', points: null, below: 0.05 }, tiny());
    expect(at(pruned.skin, 2)).toEqual({ spine: 1 });
    expect(at(pruned.skin, 0)).toEqual(at(skin, 0));
  });

  it('the MVP leaves the post-MVP kinds unimplemented', () => {
    const skin = skinOf([[['spine', 1]], [], [], [], []], ['spine']);
    expect(() => editWeights(skin, { kind: 'hammer', points: [0] }, tiny())).toThrow(/after the MVP/);
  });
});

// ---------- the bound body ----------

const OPS: readonly PaintOp[] = ['replace', 'add', 'scale', 'smooth'];

/** Stamps over a point list: overlapping windows with varying strengths. */
function stampsOver(points: readonly number[], count: number, seed: number): StrokeStamp[] {
  const out: StrokeStamp[] = [];
  const size = Math.max(1, Math.floor(points.length / 3));
  for (let s = 0; s < count; s++) {
    const start = Math.floor(((s * 0.37 + seed * 0.11) % 1) * Math.max(1, points.length - size));
    const chosen = points.slice(start, start + size);
    out.push({
      points: Uint32Array.from(chosen),
      strength: Float32Array.from(chosen.map((_, k) => ((k * 7 + s * 3 + seed) % 10) / 10 + 0.05)),
    });
  }
  return out;
}

function expectSameSkin(a: SkinWeights, b: SkinWeights): void {
  expect(a.palette).toEqual(b.palette);
  expect(Buffer.from(a.joints.buffer, a.joints.byteOffset, a.joints.byteLength)).toEqual(
    Buffer.from(b.joints.buffer, b.joints.byteOffset, b.joints.byteLength),
  );
  expect(Buffer.from(a.weights.buffer, a.weights.byteOffset, a.weights.byteLength)).toEqual(
    Buffer.from(b.weights.buffer, b.weights.byteOffset, b.weights.byteLength),
  );
}

describe('P-S2 stroke determinism', () => {
  const bound = boundBody();
  const arm = pointsNear(bound, [0.475, 1.25, 0], 0.12);

  it('beginStroke … finish() equals editWeights({kind: stroke}) for every op, with and without mirror; preview = commit', () => {
    for (const op of OPS) {
      for (const mirror of [false, true]) {
        const stamps = stampsOver(arm, 6, OPS.indexOf(op));
        const ctx = context(bound, ['spine']);
        const joint = 'leftLowerArm';
        const session = beginStroke(bound.skin, ctx, { joint, op, value: op === 'add' ? 0.3 : 0.8, mirror });
        stamps.forEach((stamp, i) => {
          session.addStamp(stamp);
          // The live preview after each stamp equals the batch over the stamps so far.
          if (i === 2) {
            const prefix = editWeights(
              bound.skin,
              { kind: 'stroke', joint, op, value: op === 'add' ? 0.3 : 0.8, stamps: stamps.slice(0, 3), mirror },
              ctx,
            );
            expectSameSkin(session.current(), prefix.skin);
          }
        });
        const live = session.finish();
        const batch = editWeights(
          bound.skin,
          { kind: 'stroke', joint, op, value: op === 'add' ? 0.3 : 0.8, stamps, mirror },
          ctx,
        );
        expectSameSkin(live.skin, batch.skin);
        expect(Array.from(live.changed)).toEqual(Array.from(batch.changed));
        expect(live.changed.length).toBeGreaterThan(0);
        // Replaying gives bit-equal layers.
        const replay = editWeights(
          bound.skin,
          { kind: 'stroke', joint, op, value: op === 'add' ? 0.3 : 0.8, stamps, mirror },
          ctx,
        );
        expectSameSkin(replay.skin, batch.skin);
        expect(invalidPoints(batch.skin)).toEqual([]);
      }
    }
  });

  it('overlapping Replace/Add/Scale stamps equal one stamp at s_max (no compounding)', () => {
    for (const op of ['replace', 'add', 'scale'] as const) {
      const a: StrokeStamp = { points: Uint32Array.from(arm), strength: new Float32Array(arm.length).fill(0.3) };
      const b: StrokeStamp = { points: Uint32Array.from(arm), strength: new Float32Array(arm.length).fill(0.6) };
      const one: StrokeStamp = { points: Uint32Array.from(arm), strength: new Float32Array(arm.length).fill(0.6) };
      const ctx = context(bound);
      const twice = editWeights(
        bound.skin,
        { kind: 'stroke', joint: 'leftUpperArm', op, value: 0.5, stamps: [a, b, a], mirror: false },
        ctx,
      );
      const once = editWeights(
        bound.skin,
        { kind: 'stroke', joint: 'leftUpperArm', op, value: 0.5, stamps: [one], mirror: false },
        ctx,
      );
      expect(twice.changed.length).toBeGreaterThan(0);
      expectSameSkin(twice.skin, once.skin);
    }
  });

  it('only stamp points (and their partners with mirror) change; addStamp reports them', () => {
    const ctx = context(bound);
    const session = beginStroke(bound.skin, ctx, { joint: 'leftLowerArm', op: 'replace', value: 1, mirror: true });
    const stamp: StrokeStamp = { points: Uint32Array.from(arm), strength: new Float32Array(arm.length).fill(1) };
    const touched = new Set(session.addStamp(stamp));
    for (const v of arm) {
      expect(touched.has(v)).toBe(true);
      expect(touched.has(bound.geometry.partner[v] as number)).toBe(true);
    }
    const { changed } = session.finish();
    for (const v of changed) expect(touched.has(v)).toBe(true);
  });
});

describe('P-S3 mirror weights', () => {
  const bound = boundBody();

  it('Mirror Skin Weights is an involution on the symmetric body; a left edit reaches the right side', () => {
    const left = leftPoints(bound).slice(0, 40);
    const ctx = context(bound);
    const edited = editWeights(
      bound.skin,
      { kind: 'set', points: left, joint: 'leftUpperArm', value: 0.6, mode: 'set' },
      ctx,
    ).skin;
    expect(asymmetric(bound, edited).length).toBeGreaterThan(0);
    const first = mirrorWeights(edited, { direction: 'positive-to-negative', surface: 'partners', points: null }, ctx);
    expect(asymmetric(bound, first.skin)).toEqual([]);
    for (const v of left) {
      const p = bound.geometry.partner[v] as number;
      expect(vectorOf(first.skin, p).get('rightUpperArm')).toBe(vectorOf(edited, v).get('leftUpperArm'));
    }
    // negative-to-positive now copies the right side back: the left side is bit-equal (involution).
    const second = mirrorWeights(
      first.skin,
      { direction: 'negative-to-positive', surface: 'partners', points: null },
      ctx,
    );
    expectSameSkin(second.skin, first.skin);
    expect(Array.from(second.changed)).toEqual([]);
    expect(invalidPoints(first.skin)).toEqual([]);
  });

  it('closest-point mirroring interpolates on the source half; holds keep their weights', () => {
    const left = leftPoints(bound).slice(0, 20);
    const ctx = context(bound, ['spine']);
    const out = mirrorWeights(
      bound.skin,
      { direction: 'positive-to-negative', surface: 'closest-point', points: null },
      ctx,
    );
    expect(invalidPoints(out.skin)).toEqual([]);
    for (let v = 0; v < bound.skin.points; v++) {
      expect(vectorOf(out.skin, v).get('spine')).toBe(vectorOf(bound.skin, v).get('spine'));
    }
    // On the symmetric body the closest point of a partner is the partner itself (within float noise).
    for (const v of left) {
      const p = bound.geometry.partner[v] as number;
      for (const [key, w] of vectorOf(bound.skin, v)) {
        if (key === 'spine') continue;
        expect(vectorOf(out.skin, p).get(mirrorKey(key)) ?? 0).toBeCloseTo(w, 3);
      }
    }
  });

  it('a mirrored stroke on one side leaves w(v) = M(w(p(v))) exactly; a centre joint too', () => {
    const left = pointsNear(bound, [0.475, 1.25, 0], 0.1);
    for (const op of ['replace', 'add', 'scale'] as const) {
      for (const joint of ['leftLowerArm', 'chest']) {
        const stamps = stampsOver(left, 4, 1);
        const out = editWeights(
          bound.skin,
          { kind: 'stroke', joint, op, value: 0.7, stamps, mirror: true },
          context(bound),
        );
        // Scale on chest changes nothing on the arm (no chest weight there).
        expect(out.changed.length > 0 || (op === 'scale' && joint === 'chest'), `${op} ${joint}`).toBe(true);
        expect(asymmetric(bound, out.skin), `${op} ${joint}`).toEqual([]);
      }
    }
    // Centre joint over the seam: both sides stamped with different strengths still end symmetric.
    const seam = pointsNear(bound, [0, 1.1, 0.1], 0.08);
    const stamp: StrokeStamp = {
      points: Uint32Array.from(seam),
      strength: Float32Array.from(seam.map((v) => 0.2 + 0.6 * Math.abs(bound.geometry.positions[3 * v] as number))),
    };
    const centre = editWeights(
      bound.skin,
      { kind: 'stroke', joint: 'chest', op: 'replace', value: 1, stamps: [stamp], mirror: true },
      context(bound),
    );
    expect(asymmetric(bound, centre.skin)).toEqual([]);
  });

  it('seam points end exact after Mirror Skin Weights (the residual is shared by a tied mirror pair)', () => {
    const ctx = context(bound);
    const seam: number[] = [];
    for (let v = 0; v < bound.skin.points; v++) if (bound.geometry.partner[v] === v) seam.push(v);
    expect(seam.length).toBeGreaterThan(0);
    // The review's counterexample: point 0 (x = 0, its own partner) set to leftLowerArm 0.6699950844049455.
    const edited = editWeights(
      bound.skin,
      { kind: 'set', points: [seam[0] as number], joint: 'leftLowerArm', value: 0.6699950844049455, mode: 'set' },
      ctx,
    ).skin;
    const out = mirrorWeights(edited, { direction: 'positive-to-negative', surface: 'partners', points: null }, ctx);
    expect(asymmetric(bound, out.skin)).toEqual([]);
    const row = vectorOf(out.skin, seam[0] as number);
    expect(row.get('leftLowerArm')).toBe(row.get('rightLowerArm'));
    expect(invalidPoints(out.skin)).toEqual([]);
  });

  it('random edits on both sides and on the seam, then Mirror Skin Weights: asymmetric() == [] (fast-check)', () => {
    const P = bound.skin.points;
    const keys = bound.skeleton.keys.filter((_, i) => bound.skeleton.deform[i] === 1);
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            points: fc.array(fc.integer({ min: 0, max: P - 1 }), { minLength: 1, maxLength: 12 }),
            joint: fc.constantFrom(...keys),
            value: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.constantFrom('positive-to-negative' as const, 'negative-to-positive' as const),
        (edits, direction) => {
          const ctx = context(bound);
          let skin = bound.skin;
          for (const e of edits) skin = editWeights(skin, { kind: 'set', mode: 'set', ...e }, ctx).skin;
          const out = mirrorWeights(skin, { direction, surface: 'partners', points: null }, ctx).skin;
          expect(asymmetric(bound, out)).toEqual([]);
          expect(invalidPoints(out)).toEqual([]);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('a mirrored stroke whose stamps cover both v and p(v) on a one-sided joint stays exact', () => {
    const chest = pointsNear(bound, [0, 1.25, 0.1], 0.2);
    expect(chest.some((v) => (bound.geometry.positions[3 * v] as number) > 0.01)).toBe(true);
    expect(chest.some((v) => (bound.geometry.positions[3 * v] as number) < -0.01)).toBe(true);
    for (const op of ['replace', 'add', 'scale', 'smooth'] as const) {
      // Uneven strengths across the centre line (the left side stronger), in two overlapping stamps.
      const strength = (v: number, k: number): number =>
        0.3 + 0.5 * Math.max(0, bound.geometry.positions[3 * v] as number) * 4 + 0.1 * k;
      const stamps: StrokeStamp[] = [0, 1].map((k) => ({
        points: Uint32Array.from(chest),
        strength: Float32Array.from(chest.map((v) => Math.min(1, strength(v, k)))),
      }));
      const out = editWeights(
        bound.skin,
        { kind: 'stroke', joint: 'leftShoulder', op, value: 0.6, stamps, mirror: true },
        context(bound),
      );
      expect(out.changed.length, op).toBeGreaterThan(0);
      expect(asymmetric(bound, out.skin), op).toEqual([]);
      expect(invalidPoints(out.skin), op).toEqual([]);
    }
  });
});

describe('P-S3 mirrored strokes and Flood over random stamps (fast-check)', () => {
  const bound = boundBody();
  const P = bound.skin.points;
  const keys = bound.skeleton.keys.filter((_, i) => bound.skeleton.deform[i] === 1);
  const graph = graphOf(bound.geometry);
  const ring = (v: number): number[] => Array.from(graph.next.slice(graph.start[v], graph.start[v + 1]));
  /** The generated body's triangulation is not mirror-symmetric everywhere (quad diagonals at the toes): Smooth
   *  reads 1-rings, so its exactness holds only where `ring(p(v)) = p(ring(v))`. */
  const symmetricRing = (v: number): boolean => {
    const p = bound.geometry.partner[v] as number;
    const a = ring(v)
      .map((u) => bound.geometry.partner[u] as number)
      .sort((x, y) => x - y);
    const b = ring(p).sort((x, y) => x - y);
    return a.length === b.length && a.every((u, k) => u === b[k]);
  };
  /** Holds closed under the mirror (a one-sided hold is itself an asymmetry). */
  const symmetricHolds = fc
    .subarray(keys, { maxLength: 3 })
    .map((h) => [...new Set(h.flatMap((key) => [key, mirrorKey(key)]))]);

  it('w(v) = M(w(p(v))) after every op, both sides stamped, uneven strengths, symmetric holds', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.array(fc.tuple(fc.integer({ min: 0, max: P - 1 }), fc.double({ min: 0, max: 1, noNaN: true })), {
            minLength: 1,
            maxLength: 40,
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.constantFrom(...OPS),
        fc.constantFrom(...keys),
        fc.double({ min: -1, max: 1, noNaN: true }),
        symmetricHolds,
        (raw, op, joint, value, holds) => {
          if (holds.includes(joint)) return;
          const ctx = context(bound, holds);
          const stamps: StrokeStamp[] = raw.map((stamp) => ({
            points: Uint32Array.from(stamp.map(([v]) => v)),
            strength: Float32Array.from(stamp.map(([, s]) => s)),
          }));
          const v = op === 'add' ? value : Math.abs(value);
          const out = editWeights(bound.skin, { kind: 'stroke', joint, op, value: v, stamps, mirror: true }, ctx);
          expect(invalidPoints(out.skin)).toEqual([]);
          if (op !== 'smooth' || raw.every((stamp) => stamp.every(([u]) => symmetricRing(u)))) {
            expect(asymmetric(bound, out.skin)).toEqual([]);
          }
          // A mirrored Flood stays valid, and Mirror Skin Weights makes any result exact again.
          const flood = editWeights(
            out.skin,
            { kind: 'flood', points: raw[0]?.map(([u]) => u) ?? [], joint, op, value: v, opacity: 0.5, mirror: true },
            ctx,
          ).skin;
          expect(invalidPoints(flood)).toEqual([]);
          const fixed = mirrorWeights(
            flood,
            { direction: 'negative-to-positive', surface: 'partners', points: null },
            ctx,
          );
          expect(asymmetric(bound, fixed.skin)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('Flood and the mirror (M6B-C6-17)', () => {
  const bound = boundBody();
  const all = Array.from({ length: bound.skin.points }, (_, v) => v);

  it('Flood Replace 1 on leftUpperArm over every point leaves no point on rightUpperArm', () => {
    for (const mirror of [false, true]) {
      const out = editWeights(
        bound.skin,
        { kind: 'flood', points: all, joint: 'leftUpperArm', op: 'replace', value: 1, opacity: 1, mirror },
        context(bound),
      ).skin;
      for (let v = 0; v < out.points; v++) {
        expect(vectorOf(out, v).get('rightUpperArm'), `${mirror} ${v}`).toBeUndefined();
        expect(vectorOf(out, v).get('leftUpperArm'), `${mirror} ${v}`).toBe(1);
      }
    }
  });

  it('a mirrored Flood over the full mask equals the one-sided Flood; over one side it reaches the partners', () => {
    const base = { kind: 'flood', points: all, joint: 'leftUpperArm', op: 'replace', value: 0.5, opacity: 1 } as const;
    const plain = editWeights(bound.skin, { ...base, mirror: false }, context(bound)).skin;
    const mirrored = editWeights(bound.skin, { ...base, mirror: true }, context(bound)).skin;
    expect(Array.from(mirrored.weights)).toEqual(Array.from(plain.weights));
    expect(Array.from(mirrored.joints)).toEqual(Array.from(plain.joints));
    for (let v = 0; v < plain.points; v++) expect(vectorOf(plain, v).get('rightUpperArm') ?? 0).not.toBe(0.25);
    const left = leftPoints(bound);
    const oneSide = editWeights(bound.skin, { ...base, points: left, mirror: true }, context(bound)).skin;
    for (const v of left) {
      const p = bound.geometry.partner[v] as number;
      expect(vectorOf(oneSide, v).get('leftUpperArm')).toBe(vectorOf(oneSide, p).get('rightUpperArm'));
    }
    expect(asymmetric(bound, oneSide)).toEqual([]);
  });
});

describe('P-S6 compaction and the palette rules', () => {
  const bound = boundBody();

  it('compact keeps every (joint key, weight) pair, writes the palette in skeleton order and drops unused joints', () => {
    const ctx = context(bound);
    // An unused entry at the palette end (a joint painted and cleared again) and the bind's palette.
    const cleared: SkinWeights = {
      ...bound.skin,
      palette: [...bound.skin.palette, { key: 'unused', parent: null, mirror: null }],
    };
    const out = editWeights(cleared, { kind: 'compact' }, ctx);
    for (let v = 0; v < out.skin.points; v++) {
      const byKey = (a: [string, number], b: [string, number]): number => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      expect([...vectorOf(out.skin, v)].sort(byKey)).toEqual([...vectorOf(cleared, v)].sort(byKey));
    }
    const keys = out.skin.palette.map((e) => e.key);
    expect(keys).not.toContain('unused');
    expect(keys.length).toBe(bound.skin.palette.length);
    const order = keys.map((k) => bound.skeleton.keys.indexOf(k));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('a stroke that adds an influence only appends it: no existing point changes its indices', () => {
    const ctx = context(bound);
    // Every joint of the body is in the bind's palette: clear leftFoot everywhere and compact it away first.
    const all = Array.from({ length: bound.skin.points }, (_, v) => v);
    const zeroed = editWeights(bound.skin, { kind: 'set', points: all, joint: 'leftFoot', value: 0, mode: 'set' }, ctx);
    const before = editWeights(zeroed.skin, { kind: 'compact' }, ctx).skin;
    expect(before.palette.map((e) => e.key)).not.toContain('leftFoot');
    const near = pointsNear(bound, [0.09, 0.05, 0.09], 0.1);
    expect(near.length).toBeGreaterThan(0);
    const out = editWeights(
      before,
      { kind: 'flood', points: near, joint: 'leftFoot', op: 'replace', value: 0.3, opacity: 1, mirror: false },
      ctx,
    );
    expect(out.skin.palette.slice(0, before.palette.length)).toEqual(before.palette);
    const changed = new Set(out.changed);
    for (let v = 0; v < before.points; v++) {
      if (changed.has(v)) continue;
      for (let k = 0; k < 4; k++) {
        expect(out.skin.joints[4 * v + k]).toBe(before.joints[4 * v + k]);
        expect(out.skin.weights[4 * v + k]).toBe(before.weights[4 * v + k]);
      }
    }
    const dirty = skinDirty(before, out.skin);
    expect(dirty.points).toEqual(out.changed);
    expect(dirty.layers).toEqual(['skin.joints', 'skin.weights']);
    expect(skinDirty(before, before).points).toEqual(new Uint32Array(0));
    // Compacting the grown palette rewrites it (every point dirty); compacting a compact palette changes nothing.
    expect(skinDirty(out.skin, editWeights(out.skin, { kind: 'compact' }, ctx).skin).points).toBe('all');
    expect(editWeights(before, { kind: 'compact' }, ctx).changed.length).toBe(0);
    expect(skinDirty(null, before).points).toBe('all');
  });
});

describe('P-S1 normalization after every MVP edit kind (fast-check)', () => {
  const bound = boundBody();
  const keys = bound.skeleton.keys.filter((_, i) => bound.skeleton.deform[i] === 1);
  const P = bound.skin.points;

  const editArb: fc.Arbitrary<
    WeightEdit | { kind: 'mirror'; direction: 'positive-to-negative' | 'negative-to-positive' }
  > = fc.oneof(
    fc.record({
      kind: fc.constant('set' as const),
      points: fc.array(fc.integer({ min: 0, max: P - 1 }), { minLength: 1, maxLength: 30 }),
      joint: fc.constantFrom(...keys),
      value: fc.double({ min: -0.5, max: 1.5, noNaN: true }),
      mode: fc.constantFrom('set' as const, 'add' as const, 'mul' as const),
    }),
    fc.record({
      kind: fc.constant('flood' as const),
      points: fc.array(fc.integer({ min: 0, max: P - 1 }), { minLength: 1, maxLength: 60 }),
      joint: fc.constantFrom(...keys),
      op: fc.constantFrom(...OPS),
      value: fc.double({ min: -1, max: 1, noNaN: true }),
      opacity: fc.double({ min: 0, max: 1, noNaN: true }),
      mirror: fc.boolean(),
    }),
    fc.record({
      kind: fc.constant('smooth' as const),
      points: fc.array(fc.integer({ min: 0, max: P - 1 }), { minLength: 1, maxLength: 40 }),
      factor: fc.double({ min: 0, max: 1, noNaN: true }),
      iterations: fc.integer({ min: 1, max: 3 }),
      expand: fc.integer({ min: -1, max: 2 }),
    }),
    fc.record({
      kind: fc.constant('prune' as const),
      points: fc.constant(null),
      below: fc.double({ min: 0, max: 0.2, noNaN: true }),
    }),
    fc.record({ kind: fc.constant('normalize' as const), points: fc.constant(null), lockActive: fc.constant(null) }),
    fc.record({ kind: fc.constant('compact' as const) }),
    fc.record({
      kind: fc.constant('mirror' as const),
      direction: fc.constantFrom('positive-to-negative' as const, 'negative-to-positive' as const),
    }),
  );

  it('sums, signs, ≤ 4, held pairs bit-equal; normalize idempotent', () => {
    fc.assert(
      fc.property(
        fc.subarray(keys, { maxLength: 4 }),
        fc.array(editArb, { minLength: 1, maxLength: 4 }),
        (holds, edits) => {
          const ctx = context(bound, holds);
          let skin = bound.skin;
          for (const edit of edits) {
            const held = new Map(
              Array.from({ length: P }, (_, v) => [v, holds.map((key) => vectorOf(skin, v).get(key))] as const),
            );
            try {
              skin =
                edit.kind === 'mirror'
                  ? mirrorWeights(skin, { direction: edit.direction, surface: 'partners', points: null }, ctx).skin
                  : editWeights(skin, edit, ctx).skin;
            } catch (error) {
              // Painting or typing on a held joint is refused (§5.10).
              if (error instanceof EkzaError && error.code === 'op-refused') continue;
              throw error;
            }
            expect(invalidPoints(skin)).toEqual([]);
            for (let v = 0; v < P; v++) {
              expect(holds.map((key) => vectorOf(skin, v).get(key))).toEqual(held.get(v));
            }
          }
          const once = editWeights(skin, { kind: 'normalize', points: null, lockActive: null }, ctx).skin;
          const twice = editWeights(once, { kind: 'normalize', points: null, lockActive: null }, ctx);
          expect(Array.from(twice.changed)).toEqual([]);
        },
      ),
      { numRuns: 25, seed: 6 },
    );
  });
});

describe('utilities and checks', () => {
  const bound = boundBody();

  it('smooth moves a point toward its 1-ring; expand grows the affected set', () => {
    const ctx = context(bound);
    const elbow = pointsNear(bound, [0.475, 1.25, 0], 0.07);
    const plain = editWeights(bound.skin, { kind: 'smooth', points: elbow, factor: 1, iterations: 1, expand: 0 }, ctx);
    const grown = editWeights(bound.skin, { kind: 'smooth', points: elbow, factor: 1, iterations: 1, expand: 2 }, ctx);
    expect(grown.changed.length).toBeGreaterThan(plain.changed.length);
    for (const v of plain.changed) expect(elbow).toContain(v);
    expect(invalidPoints(grown.skin)).toEqual([]);
  });

  it('checkSkin reports unweighted, sum, cross-side, dangling, unused and non-deforming points', () => {
    const skin = skinOf(
      [
        [['leftArm', 1]],
        [],
        [
          ['rightArm', 0.8],
          ['spine', 0.1],
        ],
        [['root', 1]],
        [['ghost', 1]],
      ],
      ['leftArm', 'rightArm', 'spine', 'root', 'ghost'],
    );
    const problems = checkSkin(skin, {
      skeleton: chain,
      review: null,
      unreachable: Uint32Array.from([0]),
      geometry: tinyGeometry,
    });
    const codes = Object.fromEntries(problems.map((p) => [p.code, [Array.from(p.points), p.joints]]));
    expect(codes['skin.unweighted-vertex']).toEqual([[1], []]);
    expect(codes['skin.weight-sum']).toEqual([[2], []]);
    expect(codes['skin.unreachable-island']).toEqual([[0], []]);
    expect(codes['skin.non-deforming-weighted']).toEqual([[3], []]);
    expect(codes['skin.dangling-joint']).toEqual([[4], ['ghost']]);
    expect(codes['skin.joint-without-weights']?.[1]).toEqual(['hips', 'leftHand', 'rightHand']);
    expect(codes['skin.cross-side']).toBeUndefined(); // point 2 is right (x −0.3) on a right joint
    const crossed = skinOf([[['rightArm', 1]], [], [], [], []], ['rightArm']);
    const cross = checkSkin(crossed, { skeleton: chain, review: null, unreachable: null, geometry: tinyGeometry });
    expect(cross.find((p) => p.code === 'skin.cross-side')?.points).toEqual(Uint32Array.from([0]));
    expect(checkSkin(null, { skeleton: chain, review: null, unreachable: null })).toEqual([]);
    // The bound body has no error-level problem.
    const body = checkSkin(bound.skin, {
      skeleton: bound.skeleton,
      review: null,
      unreachable: null,
      geometry: bound.geometry,
    });
    expect(
      body.filter((p) => ['skin.unweighted-vertex', 'skin.weight-sum', 'skin.influences'].includes(p.code)),
    ).toEqual([]);
  });
});
