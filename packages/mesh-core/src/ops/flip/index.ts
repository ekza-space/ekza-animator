// Kernel op `mesh.flipTriangleEdge` (M6A-SPEC §5.12, research 10 §4.12; owner B4): on an edge between two triangles it
// is one spin (the other diagonal of their quad); on a selected quad it toggles `FACE_FLIP_DIAGONAL`, the per-face
// override of the shared triangulation. Edges that are not between two triangles and faces that are not quads are
// skipped with the warning `flip.skipped`; nothing to flip refuses. Under symmetry the partner of a source quad (centroid
// on the positive side) gets the mirrored diagonal, and partner edges spin the mirrored way.
import type { ParamValues } from '@ekza-studio/anim-core';
import { FACE_FLIP_DIAGONAL } from '../../constants';
import { refuse } from '../../refusal';
import {
  argsOf,
  edgeCorners,
  faceCentroid,
  faceVerts,
  guarded,
  keptSelection,
  resultSelection,
  scopeEdges,
  scopeFaces,
} from '../../subset/support';
import { contextMirror, expandWarnings, partnerOf, planeDistance } from '../../subset/symmetry';
import { triangulate as triangulation } from '../../triangulate/triangulate';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, OpWarning, Refusal } from '../../types';
import { mirroredDirection, sameFace, spinAll } from '../spin';
import { planSpin, type SpinPlan } from '../spin/spin';
import { FLIP_TRIANGLE_EDGE } from './descriptor';

function triangleEdges(m: EditMesh, edges: readonly number[]): number[] {
  const radial: number[] = [];
  return edges.filter((e) => {
    edgeCorners(m, e, radial);
    return radial.length === 2 && radial.every((c) => m.faceLen(m.cornerFace(c)) === 3);
  });
}

function flipPoll(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  if (sel !== null && sel.kind === 'face') {
    return scopeFaces(m, sel, ctx.hidden).some((f) => m.faceLen(f) === 4)
      ? true
      : refuse('flip.no-quads', 'Flip Triangle Edge on faces needs quads');
  }
  const edges = triangleEdges(m, scopeEdges(m, sel, ctx.hidden));
  if (edges.length === 0) return refuse('flip.not-triangles', 'Flip Triangle Edge needs an edge between two triangles');
  return sameFace(m, edges)
    ? refuse('flip.same-face', 'Flip one edge per triangle: two selected edges share a face')
    : true;
}

/** The vertex pair of the diagonal the shared triangulation shows for quad `f`. */
function shownDiagonal(m: EditMesh, tris: ReturnType<typeof triangulation>, f: number): [number, number] {
  const verts = faceVerts(m, f);
  const t = tris.faceTriStart[f] as number;
  const first = new Set([0, 1, 2].map((i) => m.cornerVert(tris.tris[3 * t + i] as number)));
  return first.has(verts[0] as number) && first.has(verts[2] as number)
    ? [verts[0] as number, verts[2] as number]
    : [verts[1] as number, verts[3] as number];
}

const C = new Float64Array(3);

export const flipTriangleEdge: MeshOp = Object.freeze({
  ...FLIP_TRIANGLE_EDGE,
  poll: flipPoll,
  run(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
    const verdict = flipPoll(m, sel, ctx);
    if (verdict !== true) return verdict;
    const args = argsOf(FLIP_TRIANGLE_EDGE.params, raw);
    const warnings: OpWarning[] = [...expandWarnings(sel, ctx)];
    if (sel !== null && sel.kind === 'face') {
      const faces = scopeFaces(m, sel, ctx.hidden);
      const quads = faces.filter((f) => m.faceLen(f) === 4);
      if (quads.length < faces.length) {
        warnings.push({ code: 'flip.skipped', message: 'Only quads were flipped', count: faces.length - quads.length });
      }
      for (const f of quads) m.setFaceFlags(f, m.faceFlags(f) ^ FACE_FLIP_DIAGONAL);
      const mirror = contextMirror(ctx);
      if (mirror !== null) {
        const map = mirror.map;
        const tris = triangulation(m);
        const inSet = new Set(quads);
        for (const f of quads) {
          const pf = partnerOf(map, 'face', f);
          if (pf < 0 || pf === f || !inSet.has(pf)) continue;
          faceCentroid(m, f, C);
          if (planeDistance(mirror, C[0] as number, C[1] as number, C[2] as number) <= 0) continue;
          const [x, y] = shownDiagonal(m, tris, f);
          const px = partnerOf(map, 'vertex', x);
          const py = partnerOf(map, 'vertex', y);
          const [u, w] = shownDiagonal(m, tris, pf);
          if (px < 0 || py < 0 || (u === px && w === py) || (u === py && w === px)) continue;
          m.setFaceFlags(pf, m.faceFlags(pf) ^ FACE_FLIP_DIAGONAL);
        }
      }
      return { selection: keptSelection(m, sel, 'face'), warnings, resolvedArgs: args };
    }
    const all = scopeEdges(m, sel, ctx.hidden);
    const edges = triangleEdges(m, all);
    if (edges.length < all.length) {
      warnings.push({
        code: 'flip.skipped',
        message: 'Only edges between two triangles were flipped',
        count: all.length - edges.length,
      });
    }
    const inSet = new Set(edges);
    const plans: SpinPlan[] = [];
    for (const e of edges) {
      const plan = planSpin(m, e, mirroredDirection(m, e, 'forward', inSet, ctx));
      if ('refused' in plan) return plan;
      plans.push(plan);
    }
    return guarded('flip.failed', 'The edge could not be flipped', () => ({
      selection: resultSelection(m, 'edge', spinAll(m, plans)),
      warnings,
      resolvedArgs: args,
    }));
  },
});
