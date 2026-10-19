// The geometric oracle of the clamp property (M6A-SPEC §9 B5 "no inverted faces and no coincident points for any
// fraction in 0…1"), black-box: a bevel result is compared with a reference run of the same op on the same input at a
// tiny width (fraction 0.001 where the op accepts it). The bevel's topology does not depend on the width, so the two
// results have the same elements, and the reference shows each face and edge as it was before anything could pass
// anything. Problems:
// - `flipped`: a face whose Newell normal turned against the reference's (an inverted face);
// - `twisted`: a quad with a corner triangle (one of the triangles of its two diagonal splits) turned against the
//   reference's: a strip twisted into a bow-tie, which keeps its Newell normal;
// - `crossing`: an n-gon (n ≥ 5) whose outline crosses itself where the reference's does not (both projected along
//   the reference's Newell normal);
// - `unreported crossing`: an n-gon whose outline crosses itself at any width (a strip kept through an in-line vertex
//   on a fold, M6A-B5-4) that Mesh Check reports neither `nonplanar-ngon` nor `ngon-degenerate`;
// - `reversed`: an edge whose direction turned against the reference's (two new vertices passed each other along an
//   edge: the shrunk face beyond is rotated, the strip along it twisted; a Newell normal survives a 180° rotation);
// - `zero-area-face`, `zero-length-edge`: Mesh Check's own codes on the result.
// Signs within float32 rounding of zero (the straight corners a slide leaves on an edge) count as no sign.
// No Node APIs here (the Chromium run may import it).
import type { ParamValues } from '@ekza-animator/anim-core';
import {
  checkMesh,
  type ComponentSelection,
  type EditMesh,
  editMeshFrom,
  isRefusal,
  type MeshData,
  type MeshOp,
  type OpContext,
} from '../../../src';
import { ctxOf, faceVerts } from './harness';

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

function point(m: EditMesh, v: number): V3 {
  const p = m.position;
  return [p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number];
}

function newell(points: readonly V3[]): V3 {
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as V3;
    const b = points[(i + 1) % points.length] as V3;
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

const triangle = (a: V3, b: V3, c: V3): V3 => cross(sub(b, a), sub(c, a));

/** Relative float32 rounding of stored positions, with a safety factor (2⁻²³ ≈ 1.2e-7). */
const FLOAT32_NOISE = 1e-6;

/**
 * Indices of the corners of quad `q` whose corner triangle (previous, corner, next) faces against the same triangle
 * of `q0`. A corner of either quad whose triangle is within float32 rounding of straight (a slide on an edge leaves a
 * straight corner) or that turns by less than 1e-3 rad in `q0` has no sign to compare and is skipped.
 */
function turnedCorners(q: readonly V3[], q0: readonly V3[]): number[] {
  const out: number[] = [];
  const corner = (list: readonly V3[], i: number, minTurn: number): { readonly t: V3; readonly flat: boolean } => {
    const a = list[(i + 3) % 4] as V3;
    const b = list[i] as V3;
    const c = list[(i + 1) % 4] as V3;
    const u = norm(sub(b, a));
    const v = norm(sub(c, b));
    const size = Math.max(...a.map(Math.abs), ...b.map(Math.abs), ...c.map(Math.abs));
    const t = triangle(a, b, c);
    return { t, flat: !(norm(t) > FLOAT32_NOISE * size * (u + v)) || !(norm(t) > minTurn * u * v) };
  };
  for (let i = 0; i < 4; i++) {
    const now = corner(q, i, 0);
    const before = corner(q0, i, 1e-3);
    if (now.flat || before.flat) continue;
    if (!(dot(now.t, before.t) > 0)) out.push(i);
  }
  return out;
}

/**
 * Whether the closed outline, projected onto the plane normal to `n`, has two non-adjacent edges properly crossing
 * (beyond float32 rounding).
 */
function crosses(points: readonly V3[], n: V3): boolean {
  const l = norm(n);
  if (!(l > 0)) return false;
  const z: V3 = [n[0] / l, n[1] / l, n[2] / l];
  const seed: V3 = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const xl = cross(seed, z);
  const x: V3 = [xl[0] / norm(xl), xl[1] / norm(xl), xl[2] / norm(xl)];
  const y = cross(z, x);
  const flat = points.map((p) => [dot(p, x), dot(p, y)] as const);
  // Sides within float32 rounding count as zero: the corners a slide leaves on an edge are collinear.
  const size = Math.max(...points.flatMap((p) => p.map(Math.abs)));
  const side = (a: readonly number[], b: readonly number[], c: readonly number[]): number => {
    const ux = (b[0] as number) - (a[0] as number);
    const uy = (b[1] as number) - (a[1] as number);
    const vx = (c[0] as number) - (a[0] as number);
    const vy = (c[1] as number) - (a[1] as number);
    const s = ux * vy - uy * vx;
    return Math.abs(s) > FLOAT32_NOISE * size * (Math.hypot(ux, uy) + Math.hypot(vx, vy)) ? s : 0;
  };
  const k = flat.length;
  for (let i = 0; i < k; i++) {
    for (let j = i + 2; j < k; j++) {
      if (i === 0 && j === k - 1) continue;
      const a = flat[i] as readonly number[];
      const b = flat[(i + 1) % k] as readonly number[];
      const c = flat[j] as readonly number[];
      const d = flat[(j + 1) % k] as readonly number[];
      const s1 = side(a, b, c);
      const s2 = side(a, b, d);
      const s3 = side(c, d, a);
      const s4 = side(c, d, b);
      if (s1 * s2 < 0 && s3 * s4 < 0) return true;
    }
  }
  return false;
}

/**
 * The problems of bevel result `m` against reference result `ref` (same topology; see the header). `strict` (the
 * default) is for chamfers and Roundness ≤ 0.5; off, for Roundness above 0.5, where the profiles of strips meeting at
 * a corner pass beyond it and can cross each other or the faces around at any width (M6A-B5-15): crossing n-gons then
 * only need Mesh Check's report, and `zero-area-face` and `zero-length-edge` count when the reference has not got them.
 */
export function twistProblems(m: EditMesh, ref: EditMesh, strict = true): string[] {
  const out: string[] = [];
  if (m.counts.points !== ref.counts.points || m.counts.edges !== ref.counts.edges) {
    return [`topology differs from the reference (${m.counts.points}/${m.counts.edges} vs ${ref.counts.points}/…)`];
  }
  const problems = checkMesh(m);
  const reported = new Set<number>();
  for (const problem of problems) {
    if (problem.code === 'nonplanar-ngon' || problem.code === 'ngon-degenerate') {
      for (const f of problem.elements) reported.add(f);
    }
  }
  for (let f = 0; f < m.counts.faces; f++) {
    const vs = faceVerts(m, f);
    if (faceVerts(ref, f).join() !== vs.join()) return [`face ${f} differs from the reference`];
    const pts = vs.map((v) => point(m, v));
    const pts0 = vs.map((v) => point(ref, v));
    const n = newell(pts);
    const n0 = newell(pts0);
    if (norm(n0) > 0 && !(dot(n, n0) > 0)) out.push(`flipped face ${f}`);
    if (vs.length === 4 && turnedCorners(pts, pts0).length > 0) out.push(`twisted face ${f}`);
    // Both outlines are projected along the reference's normal: a non-planar n-gon's own normal turns with the width.
    if (vs.length >= 5 && (crosses(pts, n0) || crosses(pts, n))) {
      if (strict && !crosses(pts0, n0)) out.push(`crossing face ${f}`);
      else if (!reported.has(f)) out.push(`unreported crossing face ${f}`);
    }
  }
  for (let e = 0; e < m.counts.edges; e++) {
    const a = m.edgeVert(e, 0);
    const b = m.edgeVert(e, 1);
    const d0 = sub(point(ref, b), point(ref, a));
    if (norm(d0) > 0 && !(dot(sub(point(m, b), point(m, a)), d0) > 0)) out.push(`reversed edge ${e}`);
  }
  const known = new Set<string>();
  if (!strict) {
    for (const problem of checkMesh(ref)) for (const x of problem.elements) known.add(`${problem.code} ${x}`);
  }
  for (const problem of problems) {
    if (problem.code === 'zero-area-face' || problem.code === 'zero-length-edge') {
      const fresh = Array.from(problem.elements).filter((x) => !known.has(`${problem.code} ${x}`));
      if (fresh.length > 0) out.push(`${problem.code} ${fresh.join(',')}`);
    }
  }
  return out;
}

/**
 * The reference widths, smallest first, as shares of the real run's (an absolute offset) or as fractions (at most
 * the real one): the first that the op accepts is the reference. A width far below its edges is first-order (nothing
 * can pass anything yet), but at a very acute corner the smallest ones leave slivers thinner than ε (a refusal).
 */
const REFERENCE_SCALES = [1e-3, 3e-3, 1e-2, 3e-2, 0.1] as const;

/**
 * Runs `bevel` on a copy of `data` at the smallest reference width it accepts, the reference for `twistProblems`;
 * null when it refuses them all.
 */
export function referenceRun(
  bevel: MeshOp,
  data: MeshData,
  sel: ComponentSelection,
  args: ParamValues,
  ctx?: OpContext,
): EditMesh | null {
  const fraction = typeof args['fraction'] === 'number' ? args['fraction'] : 0.5;
  const offset = typeof args['offset'] === 'number' ? args['offset'] : 0.05;
  for (const scale of REFERENCE_SCALES) {
    const ref = editMeshFrom(data);
    const small: ParamValues = { ...args, fraction: Math.min(fraction, scale), offset: offset * scale };
    ref.begin(bevel.id);
    const result = bevel.run(ref, sel, small, ctx ?? ctxOf(ref));
    if (isRefusal(result)) {
      ref.abort();
      continue;
    }
    ref.end();
    return ref;
  }
  return null;
}
