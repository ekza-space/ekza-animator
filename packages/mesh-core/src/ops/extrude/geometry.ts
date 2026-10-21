// Extrude geometry (M6A-SPEC §5.8 steps 4–5, §5.9): the region frame, per-vertex offset and even-thickness data read
// from the pre-op mesh, and the cap transform in the spec's order — (a) offset inside the region surface, (b)
// thickness along the even-thickness normal, (c) local scale, (d) local rotate (R = Rz·Ry·Rx), (e) local translate —
// about the region's pivot in its frame (or world axes with `space: 'world'`). A mirrored partner region uses the
// conjugate S ∘ T ∘ S of its source region's transform (§5.14: the reflected frame S·F, identical numbers).
import type { ParamValue, ReadonlyXf } from '@ekza-studio/anim-core';
import type { EditMesh, OpFrame } from '../../types';
import {
  type Affine,
  apply,
  compose,
  fromColumns,
  invert,
  mul3,
  placementAffine,
  rotationXYZ,
  transpose3,
} from './shared/affine';
import {
  type V3,
  add,
  cornerAt,
  cross,
  dot,
  faceCentroid,
  length,
  newell,
  normalize,
  num,
  pos,
  scale,
  str,
  sub,
} from './shared/util';

/** §5.8 step 4: pivot = area-weighted centroid, Z = normalized area-weighted normal, X from +Y (+Z near ±Y), Y = Z × X. */
export function frameOf(m: EditMesh, faces: ArrayLike<number>): { pivot: V3; x: V3; y: V3; z: V3 } {
  let sum: V3 = [0, 0, 0];
  let weighted: V3 = [0, 0, 0];
  let area = 0;
  let plain: V3 = [0, 0, 0];
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i] as number;
    const nv = newell(m, f);
    const a = length(nv) / 2;
    const centroid = faceCentroid(m, f);
    sum = add(sum, nv);
    weighted = add(weighted, scale(centroid, a));
    plain = add(plain, centroid);
    area += a;
  }
  const pivot = area > 0 ? scale(weighted, 1 / area) : scale(plain, 1 / Math.max(1, faces.length));
  return { pivot, ...axesFromNormal(normalize(sum, [0, 1, 0])) };
}

/** Frame axes for a normal Z: X = normalized U − (U·Z)Z with U = +Y (or +Z when |Z·Y| > 0.9), Y = Z × X. */
export function axesFromNormal(z: Readonly<V3>): { x: V3; y: V3; z: V3 } {
  const u: V3 = Math.abs(z[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const x = normalize(sub(u, scale(z, dot(u, z))), [1, 0, 0]);
  const y = cross(z, x);
  return { x, y, z: [z[0], z[1], z[2]] };
}

/** Per-vertex data of the cap read from the pre-op mesh (offset bisector, even-thickness normal). */
export interface CapData {
  /** Pre-op position. */
  readonly p: V3;
  /** Even-thickness direction (unit) and its scale 1 / max(0.25, min_f n_v·n_f). */
  readonly n: V3;
  readonly thick: number;
  /** In-plane inward bisector (unit) and 1 / sin(θ/2); null for interior vertices or no clear boundary. */
  readonly bisector: V3 | null;
  readonly invSin: number;
  /** 0.5 × the shortest region edge at the vertex (the clamp limit). */
  readonly limit: number;
}

/** Unit normal of face `f` (Newell) and its interior angle at vertex `v`. */
function faceAt(m: EditMesh, f: number, v: number): { n: V3; angle: number } {
  const c = cornerAt(m, f, v);
  const p = pos(m, v);
  const a = normalize(sub(pos(m, m.cornerVert(m.cornerPrev(c))), p), [0, 0, 0]);
  const b = normalize(sub(pos(m, m.cornerVert(m.cornerNext(c))), p), [0, 0, 0]);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  return { n: normalize(newell(m, f), [0, 1, 0]), angle: Number.isFinite(angle) ? angle : 0 };
}

/**
 * The cap data of vertex `v` over the region `faces` around it; `prev`/`next` are the boundary neighbours (u → v → w
 * as the region runs them, −1 for an interior vertex).
 */
export function capData(m: EditMesh, v: number, faces: readonly number[], prev: number, next: number): CapData {
  const p = pos(m, v);
  let sum: V3 = [0, 0, 0];
  const normals: V3[] = [];
  for (const f of faces) {
    const { n, angle } = faceAt(m, f, v);
    normals.push(n);
    sum = add(sum, scale(n, angle > 0 ? angle : 1e-12));
  }
  const n = normalize(sum, normals[0] ?? [0, 1, 0]);
  let minDot = 1;
  for (const nf of normals) minDot = Math.min(minDot, dot(n, nf));
  const thick = 1 / Math.max(0.25, minDot);
  // The clamp limit: half the shortest region edge at v.
  let shortest = Infinity;
  for (const f of faces) {
    const c = cornerAt(m, f, v);
    shortest = Math.min(shortest, length(sub(pos(m, m.cornerVert(m.cornerNext(c))), p)));
    shortest = Math.min(shortest, length(sub(pos(m, m.cornerVert(m.cornerPrev(c))), p)));
  }
  const limit = Number.isFinite(shortest) ? 0.5 * shortest : 0;
  if (prev === -1 || next === -1) return { p, n, thick, bisector: null, invSin: 1, limit };
  const inPlane = (d: V3): V3 => normalize(sub(d, scale(n, dot(d, n))), [0, 0, 0]);
  const e1 = inPlane(sub(pos(m, prev), p));
  const e2 = inPlane(sub(pos(m, next), p));
  const inward = normalize(cross(n, sub(pos(m, next), pos(m, prev))), [0, 0, 0]);
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(e1, e2))));
  let b = add(e1, e2);
  if (length(b) < 1e-9) b = inward;
  b = normalize(b, inward);
  if (dot(b, inward) < 0) b = scale(b, -1);
  const s = Math.sin(theta / 2);
  return { p, n, thick, bisector: b, invSin: s > 1e-9 ? 1 / s : 1, limit };
}

/** The extrude args that move the cap (positions only). */
export const PLACEMENT_ARGS: ReadonlySet<string> = new Set([
  'localTranslateX',
  'localTranslateY',
  'localTranslateZ',
  'localRotateX',
  'localRotateY',
  'localRotateZ',
  'localScaleX',
  'localScaleY',
  'localScaleZ',
  'offset',
  'thickness',
  'space',
]);

/** §5.8 (c)–(e) about `pivot` in the frame (local space) or world axes (world space). */
export function capTransform(
  args: Readonly<Record<string, ParamValue>>,
  frame: { readonly pivot: V3; readonly x: V3; readonly y: V3; readonly z: V3 },
  placement: ReadonlyXf,
): Affine {
  const K = mul3(rotationXYZ(num(args, 'localRotateX'), num(args, 'localRotateY'), num(args, 'localRotateZ')), [
    num(args, 'localScaleX', 1),
    0,
    0,
    0,
    num(args, 'localScaleY', 1),
    0,
    0,
    0,
    num(args, 'localScaleZ', 1),
  ]);
  const t: V3 = [num(args, 'localTranslateX'), num(args, 'localTranslateY'), num(args, 'localTranslateZ')];
  const c = frame.pivot;
  if (str(args, 'space', 'local') === 'world') {
    // T(p) = L⁻¹(c_w + K (L(p) − c_w) + t), L = the placement.
    const L = placementAffine(placement);
    const Linv = invert(L);
    if (Linv !== null) {
      const cw = apply(L, c);
      const inner: Affine = { m: K, t: sub(add(cw, t), apply({ m: K, t: [0, 0, 0] }, cw)) };
      return compose(Linv, compose(inner, L));
    }
  }
  const A = fromColumns(frame.x, frame.y, frame.z);
  const lin = mul3(A, mul3(K, transpose3(A)));
  const shift = apply({ m: A, t: [0, 0, 0] }, t);
  const moved = apply({ m: lin, t: [0, 0, 0] }, c);
  return { m: lin, t: add(sub(c, moved), shift) };
}

/**
 * §5.8 (a)–(b) for one vertex: the offset inside the region surface (clamped at the limit; `clamped` counts it) and
 * the thickness along the even-thickness normal.
 */
export function offsetAndThickness(
  d: CapData,
  offset: number,
  thickness: number,
  clamped: { count: number; max: number },
): V3 {
  let p = d.p;
  if (offset > 0 && d.bisector !== null) {
    let dist = offset * d.invSin;
    if (dist > d.limit) {
      dist = d.limit;
      clamped.count++;
      clamped.max = Math.max(clamped.max, offset - dist / d.invSin);
    }
    p = add(p, scale(d.bisector, dist));
  }
  if (thickness !== 0) p = add(p, scale(d.n, thickness * d.thick));
  return p;
}

/** An `OpFrame` from a frame placed by `transform` (pivot moved, axes as the args frame). */
export function opFrame(
  frame: { readonly pivot: V3; readonly x: V3; readonly y: V3; readonly z: V3 },
  transform: Affine,
  thickness: number,
  axes?: readonly [V3, V3, V3],
): OpFrame {
  const base = add(frame.pivot, scale(frame.z, thickness));
  const pivot = apply(transform, base);
  const [x, y, z] = axes ?? [frame.x, frame.y, frame.z];
  return { pivot, axes: [x, y, z] };
}
