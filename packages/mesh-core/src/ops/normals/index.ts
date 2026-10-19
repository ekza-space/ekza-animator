// Kernel ops of `ops/normals/` (M6A-SPEC §6.1, §5.3 H5, research 10 §4.15, 13 §5.11; owner B4):
// - `mesh.harden` / `mesh.soften` set or clear EDGE_HARD on the selected (object mode: every visible) edges;
// - `mesh.setNormalAngle {angle}`: an edge is hard iff angle = 0 or its dihedral angle exceeds `angle` (the H2 rule, so
//   an angle of 0 keeps an all-hard mesh all-hard, §5.3 P7-hard);
// - `mesh.reverse` reverses the winding of the selected (every visible) face; each corner keeps its vertex and values,
//   and custom normals are negated so they keep facing the same side as the face;
// - `mesh.conform` makes winding consistent: a BFS over manifold edges per connected patch (the lowest face index
//   leads), then a closed patch with negative signed volume is flipped, an open one when most of its faces point
//   towards its centroid (ties keep).
// Face mode converts edge/vertex selections by containment (./subset/support scopeFaces/scopeEdges).
import type { ParamValues } from '@ekza-animator/anim-core';
import { EDGE_HARD } from '../../constants';
import { NORMAL_CUSTOM } from '../../layers/builtin';
import { isHardByAngle } from '../../normals/hard';
import { refuse } from '../../refusal';
import {
  argsOf,
  edgeCorners,
  faceCentroid,
  faceCorners,
  keptSelection,
  newellNormal,
  num,
  scopeEdges,
  scopeFaces,
} from '../../subset/support';
import { expandWarnings } from '../../subset/symmetry';
import type { ComponentSelection, EditMesh, MeshOp, MeshOpDescriptor, OpContext, OpResult, Refusal } from '../../types';
import { CONFORM, HARDEN, REVERSE, SET_NORMAL_ANGLE, SOFTEN } from './descriptor';

function edgeOp(
  desc: MeshOpDescriptor,
  apply: (m: EditMesh, e: number, flags: number, args: ParamValues) => number,
): MeshOp {
  const pollOf = (m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal =>
    scopeEdges(m, sel, ctx.hidden).length > 0
      ? true
      : refuse(`${desc.id.slice(5)}.no-edges`, `${desc.label} needs edges: select edges or faces`);
  return Object.freeze({
    ...desc,
    poll: pollOf,
    run(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
      const verdict = pollOf(m, sel, ctx);
      if (verdict !== true) return verdict;
      const args = argsOf(desc.params, raw);
      for (const e of scopeEdges(m, sel, ctx.hidden)) {
        const flags = m.edgeFlags(e);
        const next = apply(m, e, flags, args) & 0xff;
        if (next !== flags) m.setEdgeFlags(e, next);
      }
      return {
        selection: keptSelection(m, sel, 'edge'),
        warnings: expandWarnings(sel, ctx),
        resolvedArgs: args,
      };
    },
  });
}

export const harden: MeshOp = edgeOp(HARDEN, (_m, _e, flags) => flags | EDGE_HARD);
export const soften: MeshOp = edgeOp(SOFTEN, (_m, _e, flags) => flags & ~EDGE_HARD);
export const setNormalAngle: MeshOp = edgeOp(SET_NORMAL_ANGLE, (m, e, flags, args) => {
  const angle = num(args, 'angle', Math.PI / 6);
  return isHardByAngle(m, e, angle) ? flags | EDGE_HARD : flags & ~EDGE_HARD;
});

/** Reverses face `f` and negates its custom normals (a reversed face's normals point the other way). */
export function reverseWithNormals(m: EditMesh, f: number): void {
  m.reverseFace(f);
  const layer = m.layer(NORMAL_CUSTOM);
  if (layer === undefined) return;
  for (const c of faceCorners(m, f)) {
    for (let k = 0; k < layer.def.comps; k++) {
      const value = layer.get(c, k);
      if (value !== 0) layer.set(c, k, 0 - value);
    }
  }
}

function faceOpPoll(id: string, label: string) {
  return (m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal =>
    scopeFaces(m, sel, ctx.hidden).length > 0 ? true : refuse(`${id}.no-faces`, `${label} needs faces: select faces`);
}

const reversePoll = faceOpPoll('reverse', REVERSE.label);
export const reverse: MeshOp = Object.freeze({
  ...REVERSE,
  poll: reversePoll,
  run(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
    const verdict = reversePoll(m, sel, ctx);
    if (verdict !== true) return verdict;
    for (const f of scopeFaces(m, sel, ctx.hidden)) reverseWithNormals(m, f);
    return {
      selection: keptSelection(m, sel, 'face'),
      warnings: expandWarnings(sel, ctx),
      resolvedArgs: argsOf(REVERSE.params, raw),
    };
  },
});

const N = new Float64Array(3);
const Q = new Float64Array(3);

/**
 * The faces of `faces` to reverse so that winding is consistent and outward (`mesh.conform`), ascending. Exported for
 * the property tests.
 */
export function conformFlips(m: EditMesh, faces: readonly number[]): number[] {
  const F = m.counts.faces;
  const inScope = new Uint8Array(F);
  for (const f of faces) inScope[f] = 1;
  const flip = new Int8Array(F).fill(-1); // −1 unvisited, 0 keep, 1 flip
  const out: number[] = [];
  const corners: number[] = [];
  const radial: number[] = [];
  for (const seed of faces) {
    if (flip[seed] !== -1) continue;
    // BFS over manifold edges inside the scope; the seed (lowest index of its patch) keeps its winding.
    const patch: number[] = [seed];
    flip[seed] = 0;
    for (let head = 0; head < patch.length; head++) {
      const f = patch[head] as number;
      const flipped = flip[f] === 1;
      for (const c of faceCorners(m, f, corners)) {
        const e = m.cornerEdge(c);
        if (m.edgeFaceCount(e) !== 2) continue;
        edgeCorners(m, e, radial);
        const d = radial[0] === c ? (radial[1] as number) : (radial[0] as number);
        const g = m.cornerFace(d);
        if (g === f || inScope[g] !== 1 || flip[g] !== -1) continue;
        // Consistent neighbours run the edge in opposite directions: c starts at the vertex where d does not.
        const same = m.cornerVert(c) === m.cornerVert(d);
        flip[g] = (same ? 1 : 0) ^ (flipped ? 1 : 0);
        patch.push(g);
      }
    }
    // Outward: closed patches by signed volume, open ones by a vote of face normals against the centroid.
    let closed = true;
    for (const f of patch) {
      for (const c of faceCorners(m, f, corners)) {
        const e = m.cornerEdge(c);
        if (m.edgeFaceCount(e) !== 2) {
          closed = false;
          break;
        }
        edgeCorners(m, e, radial);
        for (const d of radial) if (inScope[m.cornerFace(d)] !== 1) closed = false;
      }
      if (!closed) break;
    }
    let invert = false;
    if (closed) {
      let volume = 0;
      for (const f of patch) volume += (flip[f] === 1 ? -1 : 1) * faceVolume(m, f);
      invert = volume < 0;
    } else {
      // Centroid of the patch (area-weighted face centroids).
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let total = 0;
      for (const f of patch) {
        newellNormal(m, f, N);
        const area = Math.hypot(N[0] as number, N[1] as number, N[2] as number);
        faceCentroid(m, f, Q);
        cx += (Q[0] as number) * area;
        cy += (Q[1] as number) * area;
        cz += (Q[2] as number) * area;
        total += area;
      }
      if (total > 0) {
        cx /= total;
        cy /= total;
        cz /= total;
        let outward = 0;
        let inward = 0;
        for (const f of patch) {
          newellNormal(m, f, N);
          faceCentroid(m, f, Q);
          const sign = flip[f] === 1 ? -1 : 1;
          const dot =
            sign *
            ((N[0] as number) * ((Q[0] as number) - cx) +
              (N[1] as number) * ((Q[1] as number) - cy) +
              (N[2] as number) * ((Q[2] as number) - cz));
          if (dot > 0) outward++;
          else if (dot < 0) inward++;
        }
        invert = inward > outward;
      }
    }
    for (const f of patch) if ((flip[f] === 1) !== invert) out.push(f);
  }
  return out.sort((a, b) => a - b);
}

/** Six times the signed volume contribution of face `f` (fan from its first corner; divergence theorem). */
function faceVolume(m: EditMesh, f: number): number {
  const p = m.position;
  const start = m.faceCorner(f);
  const a = m.cornerVert(start);
  let c = m.cornerNext(start);
  let volume = 0;
  let guard = 0;
  while (m.cornerNext(c) !== start && ++guard <= m.counts.corners) {
    const b = m.cornerVert(c);
    const d = m.cornerVert(m.cornerNext(c));
    const ax = p[3 * a] as number;
    const ay = p[3 * a + 1] as number;
    const az = p[3 * a + 2] as number;
    const bx = p[3 * b] as number;
    const by = p[3 * b + 1] as number;
    const bz = p[3 * b + 2] as number;
    const dx = p[3 * d] as number;
    const dy = p[3 * d + 1] as number;
    const dz = p[3 * d + 2] as number;
    volume += ax * (by * dz - bz * dy) - ay * (bx * dz - bz * dx) + az * (bx * dy - by * dx);
    c = m.cornerNext(c);
  }
  return volume;
}

const conformPoll = faceOpPoll('conform', CONFORM.label);
export const conform: MeshOp = Object.freeze({
  ...CONFORM,
  poll: conformPoll,
  run(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
    const verdict = conformPoll(m, sel, ctx);
    if (verdict !== true) return verdict;
    for (const f of conformFlips(m, scopeFaces(m, sel, ctx.hidden))) reverseWithNormals(m, f);
    return {
      selection: keptSelection(m, sel, 'face'),
      warnings: [],
      resolvedArgs: argsOf(CONFORM.params, raw),
    };
  },
});
