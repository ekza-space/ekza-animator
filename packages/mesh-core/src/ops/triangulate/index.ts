// Kernel op `mesh.triangulate` (M6A-SPEC §5.13, §5.4; owner B4): writes the shared triangulation (`triangulate`, the
// one the viewport and export use) of the selected (object mode: every visible) faces as faces — cube → 8/18/12. Each
// face is cut along its triangulation's diagonals with `splitFaceMakeEdge` (no removals, so the original face keeps its
// index and the triangles after it are appended); new edges follow H1 (hard iff every edge of the face was), corner
// values are copied from the face's corners, the flip-diagonal bit (meaningless on triangles) is cleared. Under
// symmetry the partner face of a source face (centroid on the positive side) is cut along the mirrored diagonals, so
// a symmetric mesh stays symmetric (quad ties would otherwise go to the smaller vertex index on both sides).
import type { ParamValues } from '@ekza-animator/anim-core';
import { FACE_FLIP_DIAGONAL } from '../../constants';
import { refuse } from '../../refusal';
import {
  argsOf,
  cornerAt,
  faceCentroid,
  faceCorners,
  guarded,
  hasRepeatedVertex,
  resultSelection,
  scopeFaces,
} from '../../subset/support';
import { axisIndex, expandWarnings, partnerOf } from '../../subset/symmetry';
import { triangulate as triangulation } from '../../triangulate/triangulate';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, Refusal } from '../../types';
import { TRIANGULATE } from './descriptor';

/**
 * Cuts face `f` along `diagonals` (pairs of the face's corner indices as they are before the call; the diagonals must
 * not cross). Returns the faces created (appended). Throws the Euler refusal when a diagonal is not inside one piece.
 */
export function splitAlong(m: EditMesh, f: number, diagonals: readonly (readonly [number, number])[]): number[] {
  interface Piece {
    readonly face: number;
    readonly ids: number[];
    readonly at: Map<number, number>;
  }
  const ids = faceCorners(m, f);
  const pieces: Piece[] = [{ face: f, ids, at: new Map(ids.map((c) => [c, c])) }];
  const created: number[] = [];
  for (const [i, j] of diagonals) {
    let found = -1;
    let pi = -1;
    let pj = -1;
    for (let k = 0; k < pieces.length && found === -1; k++) {
      const list = (pieces[k] as Piece).ids;
      const a = list.indexOf(i);
      const b = list.indexOf(j);
      if (a === -1 || b === -1) continue;
      const n = list.length;
      if ((a + 1) % n === b || (b + 1) % n === a) continue;
      found = k;
      pi = a;
      pj = b;
    }
    if (found === -1) {
      // An adjacent pair is already an edge of a piece: nothing to cut.
      continue;
    }
    const piece = pieces[found] as Piece;
    const cA = piece.at.get(i) as number;
    const cB = piece.at.get(j) as number;
    m.splitFaceMakeEdge(piece.face, cA, cB);
    const g = m.counts.faces - 1;
    created.push(g);
    const nB = m.cornerPrev(cA); // piece.face: cA → … → pB → nB(vB)
    const nA = m.cornerPrev(cB); // g: cB → … → pA → nA(vA)
    const n = piece.ids.length;
    const first: number[] = [];
    for (let k = pi; ; k = (k + 1) % n) {
      first.push(piece.ids[k] as number);
      if (k === pj) break;
    }
    const second: number[] = [];
    for (let k = pj; ; k = (k + 1) % n) {
      second.push(piece.ids[k] as number);
      if (k === pi) break;
    }
    const atFirst = new Map<number, number>();
    for (const id of first) atFirst.set(id, piece.at.get(id) as number);
    atFirst.set(j, nB);
    const atSecond = new Map<number, number>();
    for (const id of second) atSecond.set(id, piece.at.get(id) as number);
    atSecond.set(j, cB);
    atSecond.set(i, nA);
    pieces[found] = { face: piece.face, ids: first, at: atFirst };
    pieces.push({ face: g, ids: second, at: atSecond });
  }
  return created;
}

/** The diagonals (corner pairs) of face `f` in a triangulation of the mesh. */
function diagonalsOf(m: EditMesh, tris: ReturnType<typeof triangulation>, f: number): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<string>();
  const from = tris.faceTriStart[f] as number;
  const to = tris.faceTriStart[f + 1] as number;
  for (let t = from; t < to; t++) {
    for (let k = 0; k < 3; k++) {
      const a = tris.tris[3 * t + k] as number;
      const b = tris.tris[3 * t + ((k + 1) % 3)] as number;
      if (m.cornerNext(a) === b || m.cornerNext(b) === a) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a < b ? [a, b] : [b, a]);
    }
  }
  return out;
}

const C = new Float64Array(3);

function triangulatePoll(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  return scopeFaces(m, sel, ctx.hidden).length > 0
    ? true
    : refuse('triangulate.no-faces', 'Triangulate needs faces: select faces');
}

export const triangulate: MeshOp = Object.freeze({
  ...TRIANGULATE,
  poll: triangulatePoll,
  run(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
    const verdict = triangulatePoll(m, sel, ctx);
    if (verdict !== true) return verdict;
    const args = argsOf(TRIANGULATE.params, raw);
    return guarded('triangulate.degenerate', 'A face could not be triangulated', () => {
      const faces = scopeFaces(m, sel, ctx.hidden);
      const inScope = new Set(faces);
      const tris = triangulation(m);
      const map = ctx.symmetry?.map ?? null;
      const plan = new Map<number, [number, number][]>();
      for (const f of faces) if (m.faceLen(f) > 3) plan.set(f, diagonalsOf(m, tris, f));
      if (map !== null) {
        const k = axisIndex(map.axis);
        for (const f of faces) {
          const pf = partnerOf(map, 'face', f);
          if (pf < 0 || pf === f || !inScope.has(pf) || !plan.has(f) || !plan.has(pf)) continue;
          if (hasRepeatedVertex(m, f) || hasRepeatedVertex(m, pf)) continue;
          if ((faceCentroid(m, f, C)[k] as number) - map.plane <= 0) continue; // f is the source when positive
          const mirrored: [number, number][] = [];
          for (const [a, b] of plan.get(f) as [number, number][]) {
            const pa = partnerOf(map, 'vertex', m.cornerVert(a));
            const pb = partnerOf(map, 'vertex', m.cornerVert(b));
            const ca = pa < 0 ? -1 : cornerAt(m, pf, pa);
            const cb = pb < 0 ? -1 : cornerAt(m, pf, pb);
            if (ca === -1 || cb === -1) break;
            mirrored.push([ca, cb]);
          }
          if (mirrored.length === (plan.get(f) as [number, number][]).length) plan.set(pf, mirrored);
        }
      }
      const result = [...faces];
      for (const f of faces) {
        const diagonals = plan.get(f);
        if (diagonals === undefined) continue;
        result.push(...splitAlong(m, f, diagonals));
      }
      for (const f of result) {
        const flags = m.faceFlags(f);
        if ((flags & FACE_FLIP_DIAGONAL) !== 0) m.setFaceFlags(f, flags & ~FACE_FLIP_DIAGONAL);
      }
      return {
        selection: resultSelection(m, 'face', result),
        warnings: expandWarnings(sel, ctx),
        resolvedArgs: args,
      };
    });
  },
});
