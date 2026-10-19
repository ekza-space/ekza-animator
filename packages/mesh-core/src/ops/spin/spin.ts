// The spin move shared by `mesh.spinEdge` and `mesh.flipTriangleEdge` (M6A-SPEC §5.12, research 10 §4.12): an edge
// a–b shared by faces A (running a → b) and B (running b → a) is detached and reattached one vertex further along the
// joined polygon's winding. The joined polygon is [a, y₁…yₘ, b, x₁…xₖ] (A = a, b, x₁…xₖ; B = b, a, y₁…yₘ); forward
// reattaches to y₁–x₁, back to yₘ–xₖ. Counts never change.
//
// Euler sequence: `joinFaceKillEdge` then `splitFaceMakeEdge`, after which the two faces' identities are restored: the
// piece holding all of A's own vertices takes A's material, flags (flip-diagonal cleared: the quad changed) and face
// layers, each of its corners A's values at that vertex (B's for the one vertex A did not have), likewise for B; the
// new edge takes the old edge's flags and layers (H5: the spun edge keeps its own flag).
//
// A plan names its edge and vertices, never its faces: an earlier spin of the same run removes a face slot and moves
// the last face into the hole, so face indices taken at plan time go stale. Edges spun in descending order and
// vertices (never removed) stay valid, so `spin` finds A and B again from the edge at spin time.
import { FACE_FLIP_DIAGONAL } from '../../constants';
import { kernelError } from '../../kernel';
import { refuse } from '../../refusal';
import { edgeCorners, faceCorners, faceVerts } from '../../subset/support';
import type { AttrLayer, EditMesh, Refusal } from '../../types';

export type SpinDirection = 'forward' | 'back';

interface FaceRecord {
  readonly material: number;
  readonly flags: number;
  readonly layers: readonly (readonly number[])[]; // per face layer
  /** Per corner layer: vertex → values. */
  readonly corners: readonly Map<number, readonly number[]>[];
}

function readValues(layer: AttrLayer, index: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < layer.def.comps; k++) out.push(layer.get(index, k));
  return out;
}

function writeValues(layer: AttrLayer, index: number, values: readonly number[]): void {
  for (let k = 0; k < values.length; k++)
    if (!Object.is(layer.get(index, k), values[k])) layer.set(index, k, values[k] as number);
}

function recordFace(
  m: EditMesh,
  f: number,
  faceLayers: readonly AttrLayer[],
  cornerLayers: readonly AttrLayer[],
): FaceRecord {
  const corners = faceCorners(m, f);
  return {
    material: m.faceMaterial(f),
    flags: m.faceFlags(f),
    layers: faceLayers.map((layer) => readValues(layer, f)),
    corners: cornerLayers.map((layer) => new Map(corners.map((c) => [m.cornerVert(c), readValues(layer, c)] as const))),
  };
}

function restoreFace(
  m: EditMesh,
  f: number,
  own: FaceRecord,
  other: FaceRecord,
  faceLayers: readonly AttrLayer[],
  cornerLayers: readonly AttrLayer[],
): void {
  if (m.faceMaterial(f) !== own.material) m.setFaceMaterial(f, own.material);
  const flags = own.flags & ~FACE_FLIP_DIAGONAL;
  if (m.faceFlags(f) !== flags) m.setFaceFlags(f, flags);
  faceLayers.forEach((layer, i) => writeValues(layer, f, own.layers[i] as readonly number[]));
  for (const c of faceCorners(m, f)) {
    const v = m.cornerVert(c);
    cornerLayers.forEach((layer, i) => {
      const values =
        (own.corners[i] as Map<number, readonly number[]>).get(v) ??
        (other.corners[i] as Map<number, readonly number[]>).get(v);
      if (values !== undefined) writeValues(layer, c, values);
    });
  }
}

export interface SpinPlan {
  /** The edge to spin; valid as long as only higher-index edges were removed since planning. */
  readonly edge: number;
  /** A runs a → b along the edge, B runs b → a. */
  readonly a: number;
  readonly b: number;
  /** The new edge's endpoints. */
  readonly u: number;
  readonly w: number;
  readonly direction: SpinDirection;
}

/** Checks a spin of edge `e` without writing; the plan or the refusal. */
export function planSpin(m: EditMesh, e: number, direction: SpinDirection): SpinPlan | Refusal {
  const radial = edgeCorners(m, e);
  if (radial.length < 2)
    return refuse('spin.border-edge', 'Spin needs an edge between two faces (this is a border edge)');
  if (radial.length > 2) return refuse('spin.non-manifold', 'Spin needs an edge between exactly two faces');
  const [cA, cB] = radial as [number, number];
  const faceA = m.cornerFace(cA);
  const faceB = m.cornerFace(cB);
  if (faceA === faceB) return refuse('spin.same-face', 'Both sides of the edge belong to one face');
  if (m.cornerVert(cA) === m.cornerVert(cB)) {
    return refuse('spin.winding', 'The two faces are wound inconsistently (Conform first)');
  }
  const vertsA = faceVerts(m, faceA);
  const vertsB = faceVerts(m, faceB);
  const a = m.cornerVert(cA);
  const b = m.cornerVert(m.cornerNext(cA));
  // A from a: a, b, x₁…xₖ; B from b: b, a, y₁…yₘ.
  const ia = vertsA.indexOf(a);
  const xs = [...vertsA.slice(ia), ...vertsA.slice(0, ia)].slice(2);
  const ib = vertsB.indexOf(b);
  const ys = [...vertsB.slice(ib), ...vertsB.slice(0, ib)].slice(2);
  const all = [a, b, ...xs, ...ys];
  if (new Set(all).size !== all.length) {
    return refuse('spin.shared-vertices', 'The two faces share more than the edge; spinning it would fold them');
  }
  const u = direction === 'forward' ? (ys[0] as number) : (ys[ys.length - 1] as number);
  const w = direction === 'forward' ? (xs[0] as number) : (xs[xs.length - 1] as number);
  if (m.findEdge(u, w) !== -1) return refuse('spin.existing-edge', 'The spun edge would duplicate an existing edge');
  return { edge: e, a, b, u, w, direction };
}

/** Faces A (running a → b) and B (running b → a) of the plan's edge, looked up now (face indices move on removals). */
function planFaces(m: EditMesh, plan: SpinPlan): [number, number] {
  const radial = edgeCorners(m, plan.edge);
  if (radial.length === 2) {
    const [c0, c1] = radial as [number, number];
    const v0 = m.cornerVert(c0);
    const v1 = m.cornerVert(c1);
    if (v0 === plan.a && v1 === plan.b) return [m.cornerFace(c0), m.cornerFace(c1)];
    if (v1 === plan.a && v0 === plan.b) return [m.cornerFace(c1), m.cornerFace(c0)];
  }
  throw kernelError('mesh-euler', 'spin: the planned edge no longer joins its two faces');
}

/** Performs a planned spin; returns the new edge's index (valid until the next removal). */
export function spin(m: EditMesh, plan: SpinPlan): number {
  const faceLayers = m.layers().filter((layer) => layer.def.domain === 'face');
  const cornerLayers = m.layers().filter((layer) => layer.def.domain === 'corner');
  const edgeLayers = m.layers().filter((layer) => layer.def.domain === 'edge');
  const [faceA, faceB] = planFaces(m, plan);
  const recA = recordFace(m, faceA, faceLayers, cornerLayers);
  const recB = recordFace(m, faceB, faceLayers, cornerLayers);
  const edgeFlags = m.edgeFlags(plan.edge);
  const edgeValues = edgeLayers.map((layer) => readValues(layer, plan.edge));
  // Another spin of the same run may have created the edge meanwhile: reusing it would make it non-manifold.
  if (m.findEdge(plan.u, plan.w) !== -1) throw kernelError('mesh-euler', 'spin: the spun edge already exists');
  const s = m.joinFaceKillEdge(plan.edge);
  let cu = -1;
  let cw = -1;
  for (const c of faceCorners(m, s)) {
    if (m.cornerVert(c) === plan.u) cu = c;
    if (m.cornerVert(c) === plan.w) cw = c;
  }
  const e = m.splitFaceMakeEdge(s, cu, cw);
  const g = m.counts.faces - 1;
  // Forward: s = y₁…yₘ, b, x₁ and g = x₁…xₖ, a, y₁ (g holds A's own vertices); back: s = yₘ, b, x₁…xₖ (A's) and
  // g = xₖ, a, y₁…yₘ.
  const sIsA = plan.direction === 'back';
  const pieceA = sIsA ? s : g;
  const pieceB = sIsA ? g : s;
  restoreFace(m, pieceA, recA, recB, faceLayers, cornerLayers);
  restoreFace(m, pieceB, recB, recA, faceLayers, cornerLayers);
  if (m.edgeFlags(e) !== edgeFlags) m.setEdgeFlags(e, edgeFlags);
  edgeLayers.forEach((layer, i) => writeValues(layer, e, edgeValues[i] as readonly number[]));
  return e;
}
