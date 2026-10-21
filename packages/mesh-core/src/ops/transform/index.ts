// `mesh.transformComponents` (M6A-SPEC §6.1, §5.14 first row, §5.15): Move / Rotate / Scale of components with soft
// weights and symmetry. Positions only (`topology: false`).
//
// Args (all world-space measures; the mesh placement maps them into mesh-local space):
// - `translateX/Y/Z` (metres) along the frame axes, `rotateX/Y/Z` (radians, rotate order xyz: R = Rz·Ry·Rx in the
//   frame), `scaleX/Y/Z` along the frame axes, all about `pivot`:  M = T(pivot)·O·T(t)·R·S·Oᵀ·T(−pivot).
// - `space` picks the frame O: `world` (identity), `object` (the placement's rotation), `component` (`orientation`).
// - `pivot` ([x, y, z], world; selection-bound): null resolves to the bounding-box centre of the picked vertices.
// - `orientation` ([x, y, z, w] quaternion, world; selection-bound): the Component frame; null resolves from the picks
//   (Z = the area-weighted average normal of the selected faces, or of the faces around the selected vertices; X/Y by
//   the region-frame rule of §5.8). It is resolved and recorded in every space, so an adjusted re-run switched to
//   `component` uses the frame of the original selection.
// Selection: the picked components (hidden ones dropped) move their vertices (a visible edge or face moves its
// vertices even when one is shared with hidden geometry). Under symmetry the picks are expanded through the partner
// maps; each moved vertex takes its own side's delta: the source side (the side of the picks, else of the pivot,
// else positive) gets M, the mirror side S·M·S, so partners move by the mirrored delta (rotations and scales about
// S·pivot); seam vertices take the in-plane part (with Preserve Seam they are projected onto the plane); picked
// vertices without a partner get M on their own side only and the run warns `symmetry.unmatched-partner`. With soft
// selection every vertex takes w·Δ, weights from the expanded selection (§5.15).
import { coerceArgs, type ParamValues, type ReadonlyXf } from '@ekza-studio/anim-core';
import { BitSet } from '../../bitset';
import { kernelError } from '../../kernel';
import { refuse } from '../../refusal';
import { hiddenEdge, hiddenFace, hiddenVert } from '../../select/common';
import { softWeights } from '../../soft/weights';
import { expandSelection, unmatchedOf, unmatchedPartnerWarning } from '../../symmetry/expand';
import {
  inPlanePart,
  type MirrorSpace,
  mirrorSpaceOf,
  planeDistance,
  projectOntoPlane,
  rotation,
} from '../../symmetry/space';
import type {
  ComponentSelection,
  EditMesh,
  HiddenSet,
  MeshOp,
  OpContext,
  OpFrame,
  OpResult,
  OpWarning,
  Refusal,
  SymmetryContext,
} from '../../types';
import { TRANSFORM_COMPONENTS } from './descriptor';
import {
  type A34,
  a34,
  a34Invert,
  a34Linear,
  a34Mul,
  a34Point,
  m3,
  m3Diag,
  m3EulerXyz,
  m3FromQuat,
  m3Mul,
  m3Transpose,
  m3Vec,
  quatFromM3,
} from './math';

const NO_SELECTION = 'Select vertices, edges or faces to transform first';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

/** Vertices of the visible selected components of the selection's kind (ascending). */
function pickedVertices(m: EditMesh, sel: ComponentSelection, hidden: HiddenSet | null): BitSet {
  const out = new BitSet(m.counts.points);
  const add = (v: number): void => {
    if (v >= 0) out.add(v);
  };
  if (sel.kind === 'vertex') {
    sel.verts.forEach((v) => {
      if (v < m.counts.points && !hiddenVert(hidden, v)) add(v);
    });
  } else if (sel.kind === 'edge') {
    sel.edges.forEach((e) => {
      if (e >= m.counts.edges || hiddenEdge(hidden, e)) return;
      add(m.edgeVert(e, 0));
      add(m.edgeVert(e, 1));
    });
  } else {
    sel.faces.forEach((f) => {
      if (f >= m.counts.faces || hiddenFace(hidden, f)) return;
      const start = m.faceCorner(f);
      let c = start;
      let guard = 0;
      do {
        add(m.cornerVert(c));
        c = m.cornerNext(c);
      } while (c !== start && ++guard <= m.counts.corners);
    });
  }
  return out;
}

/** The visible components of the selection's own kind. */
function visibleComponents(m: EditMesh, sel: ComponentSelection, hidden: HiddenSet | null): BitSet {
  const kind = sel.kind;
  const set = kind === 'vertex' ? sel.verts : kind === 'edge' ? sel.edges : sel.faces;
  const n = kind === 'vertex' ? m.counts.points : kind === 'edge' ? m.counts.edges : m.counts.faces;
  const out = new BitSet(n);
  set.forEach((i) => {
    if (i >= n) return;
    if (kind === 'vertex' ? hiddenVert(hidden, i) : kind === 'edge' ? hiddenEdge(hidden, i) : hiddenFace(hidden, i))
      return;
    out.add(i);
  });
  return out;
}

function placementLinear(placement: ReadonlyXf): Float64Array {
  return m3Mul(rotation(placement.q), m3Diag(placement.s[0] ?? 1, placement.s[1] ?? 1, placement.s[2] ?? 1));
}

function placementAffine(placement: ReadonlyXf): A34 {
  return a34(placementLinear(placement), [placement.t[0] ?? 0, placement.t[1] ?? 0, placement.t[2] ?? 0]);
}

function vec3Arg(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const out = value.map(Number) as Vec3;
  return out.every(Number.isFinite) ? out : null;
}

function quatArg(value: unknown): Quat | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const out = value.map(Number) as Quat;
  if (!out.every(Number.isFinite)) return null;
  const len = Math.hypot(...out);
  return len > 0 ? (out.map((x) => x / len) as Quat) : null;
}

/** Bounding-box centre (world) of the picked vertices. */
function pickedCentre(m: EditMesh, picked: BitSet, placement: A34): Vec3 {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const p = m.position;
  picked.forEach((v) => {
    const w = a34Point(placement, p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k] as number, w[k] as number);
      hi[k] = Math.max(hi[k] as number, w[k] as number);
    }
  });
  if (!(lo[0] <= hi[0])) return [0, 0, 0];
  return [0.5 * (lo[0] + hi[0]), 0.5 * (lo[1] + hi[1]), 0.5 * (lo[2] + hi[2])];
}

/** Newell normal of a face (area-weighted: |n| = 2 × area), mesh-local. */
function faceNewell(m: EditMesh, f: number): Vec3 {
  const p = m.position;
  let x = 0;
  let y = 0;
  let z = 0;
  const start = m.faceCorner(f);
  let c = start;
  let guard = 0;
  do {
    const a = 3 * m.cornerVert(c);
    const b = 3 * m.cornerVert(m.cornerNext(c));
    x += ((p[a + 1] as number) - (p[b + 1] as number)) * ((p[a + 2] as number) + (p[b + 2] as number));
    y += ((p[a + 2] as number) - (p[b + 2] as number)) * ((p[a] as number) + (p[b] as number));
    z += ((p[a] as number) - (p[b] as number)) * ((p[a + 1] as number) + (p[b + 1] as number));
    c = m.cornerNext(c);
  } while (c !== start && ++guard <= m.counts.corners);
  return [x, y, z];
}

/** The Component frame (world quaternion) of the picks (§5.15, region-frame axes of §5.8). */
function componentFrame(
  m: EditMesh,
  sel: ComponentSelection,
  picked: BitSet,
  hidden: HiddenSet | null,
  placement: ReadonlyXf,
): Quat {
  const sum: Vec3 = [0, 0, 0];
  const addFace = (f: number, unit: boolean): void => {
    const n = faceNewell(m, f);
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > 0)) return;
    const k = unit ? 1 / len : 1;
    sum[0] += n[0] * k;
    sum[1] += n[1] * k;
    sum[2] += n[2] * k;
  };
  if (sel.kind === 'face') {
    sel.faces.forEach((f) => {
      if (f < m.counts.faces && !hiddenFace(hidden, f)) addFace(f, false);
    });
  } else {
    picked.forEach((v) => {
      const first = m.vertEdge(v);
      if (first < 0) return;
      let e = first;
      let guard = 0;
      do {
        const radial = m.edgeCorner(e);
        if (radial >= 0) {
          let c = radial;
          let g2 = 0;
          do {
            const f = m.cornerFace(c);
            if (m.cornerVert(c) === v && !hiddenFace(hidden, f)) addFace(f, true);
            c = m.cornerRadialNext(c);
          } while (c !== radial && ++g2 <= m.counts.corners);
        }
        e = m.edgeDiskNext(e, v);
      } while (e !== first && e >= 0 && ++guard <= m.counts.edges);
    });
  }
  // Normals map to world through the inverse transpose of R·diag(s): R·diag(1/s).
  const s = placement.s;
  const inverseScale = (x: number | undefined): number => (x === undefined || x === 0 ? 1 : 1 / x);
  const z0 = m3Vec(
    m3Mul(rotation(placement.q), m3Diag(inverseScale(s[0]), inverseScale(s[1]), inverseScale(s[2]))),
    sum[0],
    sum[1],
    sum[2],
  );
  const zl = Math.hypot(z0[0], z0[1], z0[2]);
  if (!(zl > 1e-12)) return [0, 0, 0, 1];
  const Z: Vec3 = [z0[0] / zl, z0[1] / zl, z0[2] / zl];
  const U: Vec3 = Math.abs(Z[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const d = U[0] * Z[0] + U[1] * Z[1] + U[2] * Z[2];
  const x0: Vec3 = [U[0] - d * Z[0], U[1] - d * Z[1], U[2] - d * Z[2]];
  const xl = Math.hypot(x0[0], x0[1], x0[2]);
  const X: Vec3 = [x0[0] / xl, x0[1] / xl, x0[2] / xl];
  const Y: Vec3 = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  return quatFromM3(Float64Array.of(X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]));
}

interface Resolved {
  readonly args: ParamValues;
  readonly pivot: Vec3;
  readonly orientation: Quat;
}

/** The world transform M of the args (§ module comment). */
function worldTransform(args: ParamValues, pivot: Vec3, orientation: Quat, placement: ReadonlyXf): A34 {
  const num = (name: string, fallback: number): number => {
    const v = args[name];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  const space = args['space'];
  const O = space === 'object' ? rotation(placement.q) : space === 'component' ? m3FromQuat(orientation) : m3();
  const R = m3EulerXyz(num('rotateX', 0), num('rotateY', 0), num('rotateZ', 0));
  const S = m3Diag(num('scaleX', 1), num('scaleY', 1), num('scaleZ', 1));
  const L = m3Mul(O, m3Mul(R, m3Mul(S, m3Transpose(O))));
  const t = m3Vec(O, num('translateX', 0), num('translateY', 0), num('translateZ', 0));
  const lp = m3Vec(L, pivot[0], pivot[1], pivot[2]);
  return a34(L, [pivot[0] + t[0] - lp[0], pivot[1] + t[1] - lp[1], pivot[2] + t[2] - lp[2]]);
}

/** The local reflection of a mirror space as an affine (p ↦ p − 2(n·p − c)·g). */
function reflectionAffine(space: MirrorSpace): A34 {
  const [n0, n1, n2] = space.n;
  const [g0, g1, g2] = space.g;
  const L = Float64Array.of(
    1 - 2 * g0 * n0,
    -2 * g0 * n1,
    -2 * g0 * n2,
    -2 * g1 * n0,
    1 - 2 * g1 * n1,
    -2 * g1 * n2,
    -2 * g2 * n0,
    -2 * g2 * n1,
    1 - 2 * g2 * n2,
  );
  return a34(L, [2 * space.c * g0, 2 * space.c * g1, 2 * space.c * g2]);
}

/** Everything a run computes once from the pre-op state; `apply` writes positions for a set of args. */
interface Plan {
  readonly moved: Uint32Array; // vertices with weight > 0, ascending
  readonly weight: Float32Array; // per moved vertex
  readonly origin: Float64Array; // 3 per moved vertex (pre-op local positions)
  readonly mode: Uint8Array; // per moved vertex: 0 = M, 1 = S·M·S, 2 = seam
  readonly placement: ReadonlyXf;
  readonly symmetry: SymmetryContext | null;
  readonly space: MirrorSpace | null;
}

const MODE_SOURCE = 0;
const MODE_MIRROR = 1;
const MODE_SEAM = 2;

function applyPlan(m: EditMesh, plan: Plan, M: A34): void {
  const toLocal = a34Invert(placementAffine(plan.placement));
  const Ml = a34Mul(toLocal, a34Mul(M, placementAffine(plan.placement)));
  const S = plan.space === null ? null : reflectionAffine(plan.space);
  const Mm = S === null ? Ml : a34Mul(S, a34Mul(Ml, S));
  const out = new Float64Array(3);
  const preserve = plan.symmetry?.preserveSeam === true;
  for (let k = 0; k < plan.moved.length; k++) {
    const v = plan.moved[k] as number;
    const x = plan.origin[3 * k] as number;
    const y = plan.origin[3 * k + 1] as number;
    const z = plan.origin[3 * k + 2] as number;
    const mode = plan.mode[k] as number;
    const q = a34Point(mode === MODE_MIRROR ? Mm : Ml, x, y, z);
    const w = plan.weight[k] as number;
    let dx = (q[0] - x) * w;
    let dy = (q[1] - y) * w;
    let dz = (q[2] - z) * w;
    if (mode === MODE_SEAM && plan.space !== null) {
      inPlanePart(plan.space, dx, dy, dz, out);
      dx = out[0] as number;
      dy = out[1] as number;
      dz = out[2] as number;
    }
    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;
    if (mode === MODE_SEAM && preserve && plan.space !== null) {
      projectOntoPlane(plan.space, nx, ny, nz, out);
      nx = out[0] as number;
      ny = out[1] as number;
      nz = out[2] as number;
    }
    const p = m.position;
    if (
      Math.fround(nx) === (p[3 * v] as number) &&
      Math.fround(ny) === (p[3 * v + 1] as number) &&
      Math.fround(nz) === (p[3 * v + 2] as number)
    ) {
      continue;
    }
    m.setPosition(v, nx, ny, nz);
  }
}

function plan(
  m: EditMesh,
  sel: ComponentSelection,
  pivot: Vec3,
  ctx: OpContext,
): { readonly plan: Plan; readonly warnings: OpWarning[] } {
  const hidden = ctx.hidden;
  const picked = pickedVertices(m, sel, hidden);
  const warnings: OpWarning[] = [];
  const symmetry = ctx.symmetry;
  let moving = picked;
  let space: MirrorSpace | null = null;
  const partner = symmetry === null ? null : symmetry.map.vertex;
  if (symmetry !== null) {
    if (symmetry.map.vertex.length !== m.counts.points) {
      throw kernelError(
        'symmetry-stale',
        `the symmetry map has ${symmetry.map.vertex.length} vertices, the mesh ${m.counts.points}`,
      );
    }
    space = mirrorSpaceOf(symmetry.map);
    const components = visibleComponents(m, sel, hidden);
    const own: ComponentSelection = {
      ...sel,
      verts: sel.kind === 'vertex' ? components : sel.verts,
      edges: sel.kind === 'edge' ? components : sel.edges,
      faces: sel.kind === 'face' ? components : sel.faces,
    };
    const expanded = visibleComponents(m, expandSelection(own, symmetry.map), hidden);
    moving = pickedVertices(m, { ...sel, verts: expanded, edges: expanded, faces: expanded }, hidden);
    const warning = unmatchedPartnerWarning(unmatchedOf(components, symmetry.map, sel.kind));
    if (warning !== null) warnings.push(warning);
  }
  const n = m.counts.points;
  let weights: Float32Array | null = null;
  if (ctx.soft !== null && ctx.soft.radius > 0) {
    weights = softWeights(m, moving, { ...ctx.soft, placement: ctx.placement, hidden });
  }
  const p = m.position;
  // Source side: the side of the off-seam picks (their mean signed distance beyond the tolerance), else the pivot's
  // side, else positive (two-sided symmetric picks: float noise in the mean must not pick the side).
  let source = 1;
  if (space !== null && partner !== null && symmetry !== null) {
    const tolerance = symmetry.map.tolerance;
    let sum = 0;
    let count = 0;
    picked.forEach((v) => {
      if (partner[v] === v) return;
      sum += planeDistance(space, p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number);
      count++;
    });
    if (count > 0 && Math.abs(sum / count) > tolerance) source = Math.sign(sum);
    else {
      const local = a34Point(a34Invert(placementAffine(ctx.placement)), pivot[0], pivot[1], pivot[2]);
      const d = planeDistance(space, local[0], local[1], local[2]);
      if (Math.abs(d) > tolerance) source = Math.sign(d);
    }
  }
  const moved: number[] = [];
  const weight: number[] = [];
  const mode: number[] = [];
  for (let v = 0; v < n; v++) {
    const w = moving.has(v) ? 1 : weights === null ? 0 : (weights[v] as number);
    if (!(w > 0)) continue;
    let mv = MODE_SOURCE;
    if (space !== null && partner !== null) {
      const u = partner[v] as number;
      if (u === v) mv = MODE_SEAM;
      else if (u < 0 && moving.has(v)) mv = MODE_SOURCE;
      else {
        const d = planeDistance(space, p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number);
        mv = d === 0 || Math.sign(d) === source ? MODE_SOURCE : MODE_MIRROR;
      }
    }
    moved.push(v);
    weight.push(w);
    mode.push(mv);
  }
  const origin = new Float64Array(3 * moved.length);
  for (let k = 0; k < moved.length; k++) {
    const v = moved[k] as number;
    origin[3 * k] = p[3 * v] as number;
    origin[3 * k + 1] = p[3 * v + 1] as number;
    origin[3 * k + 2] = p[3 * v + 2] as number;
  }
  return {
    plan: {
      moved: Uint32Array.from(moved),
      weight: Float32Array.from(weight),
      origin,
      mode: Uint8Array.from(mode),
      placement: ctx.placement,
      symmetry,
      space,
    },
    warnings,
  };
}

function resolve(m: EditMesh, sel: ComponentSelection, raw: ParamValues, ctx: OpContext): Resolved {
  const { args } = coerceArgs(TRANSFORM_COMPONENTS.params, raw);
  const picked = pickedVertices(m, sel, ctx.hidden);
  const pivot = vec3Arg(args['pivot']) ?? pickedCentre(m, picked, placementAffine(ctx.placement));
  const orientation = quatArg(args['orientation']) ?? componentFrame(m, sel, picked, ctx.hidden, ctx.placement);
  return { args: Object.freeze({ ...args, pivot: [...pivot], orientation: [...orientation] }), pivot, orientation };
}

function frameOf(resolved: Resolved, placement: ReadonlyXf, M: A34): OpFrame {
  const toLocal = a34Invert(placementAffine(placement));
  const moved = a34Point(M, resolved.pivot[0], resolved.pivot[1], resolved.pivot[2]);
  const pivot = a34Point(toLocal, moved[0], moved[1], moved[2]);
  const space = resolved.args['space'];
  const O =
    space === 'object' ? rotation(placement.q) : space === 'component' ? m3FromQuat(resolved.orientation) : m3();
  const L = a34Linear(toLocal);
  const axis = (j: number): Vec3 => {
    const v = m3Vec(L, O[j] as number, O[3 + j] as number, O[6 + j] as number);
    const len = Math.hypot(v[0], v[1], v[2]);
    return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : v;
  };
  return { pivot, axes: [axis(0), axis(1), axis(2)] };
}

function poll(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  if (sel === null || (sel.kind !== 'vertex' && sel.kind !== 'edge' && sel.kind !== 'face')) {
    return refuse('transform.no-selection', NO_SELECTION);
  }
  return visibleComponents(m, sel, ctx.hidden).isEmpty() ? refuse('transform.no-selection', NO_SELECTION) : true;
}

function run(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
  const ok = poll(m, sel, ctx);
  if (ok !== true) return ok;
  const selection = sel as ComponentSelection;
  let resolved = resolve(m, selection, raw, ctx);
  const { plan: steps, warnings } = plan(m, selection, resolved.pivot, ctx);
  let M = worldTransform(resolved.args, resolved.pivot, resolved.orientation, ctx.placement);
  applyPlan(m, steps, M);
  const counts = m.counts;
  const result: OpResult = {
    selection: selection,
    warnings: Object.freeze(warnings),
    frame: frameOf(resolved, ctx.placement, M),
    resolvedArgs: resolved.args,
    adjust: (patch: ParamValues): boolean => {
      if (!m.inTransaction || m.counts.points !== counts.points) return false;
      const next = { ...resolved.args, ...patch };
      // A new pivot or orientation is a value like any other here: the plan (who moves, weights, sides) is kept.
      const { args } = coerceArgs(TRANSFORM_COMPONENTS.params, next);
      const pivot = vec3Arg(args['pivot']) ?? resolved.pivot;
      const orientation = quatArg(args['orientation']) ?? resolved.orientation;
      resolved = {
        args: Object.freeze({ ...args, pivot: [...pivot], orientation: [...orientation] }),
        pivot,
        orientation,
      };
      M = worldTransform(resolved.args, pivot, orientation, ctx.placement);
      applyPlan(m, steps, M);
      return true;
    },
  };
  return result;
}

export const transformComponents: MeshOp = Object.freeze({ ...TRANSFORM_COMPONENTS, poll, run });
