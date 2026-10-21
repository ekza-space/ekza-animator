// Kernel op `mesh.quadrangulate {angle, keepHardEdges, keepSeams, keepMaterials}` (M6A-SPEC §5.13; Maya `polyQuad`;
// owner B4). Pairs triangles of the selected (object mode: every visible) faces greedily and removes the shared edge:
// - candidates: an edge with exactly two faces, both triangles in scope, wound consistently, sharing only that edge,
//   whose dihedral angle is below `angle`, that is not hard (`keepHardEdges`), not a UV seam (`EDGE_SEAM` or unequal
//   corner values, `keepSeams`) and not a material or paint border (`keepMaterials`), and whose quad is strictly convex;
// - score: rectangularity (the sum of |corner angle − 90°| of the quad, quantized to 1e-9 rad), ties to the smaller face
//   index, then the smaller edge index; deterministic;
// - under symmetry a pair is taken together with its mirrored pair (or alone when it is its own mirror), so a
//   symmetric mesh stays symmetric;
// - each quad keeps the diagonal that was the removed edge (`FACE_FLIP_DIAGONAL` set where the shared triangulation
//   would pick the other one), so the shape you see does not change.
// Nothing to join refuses `quadrangulate.no-pairs` with the reason. `selection′` = the faces in scope after the joins.
import type { ParamValues } from '@ekza-studio/anim-core';
import { EDGE_HARD, EDGE_SEAM, FACE_FLIP_DIAGONAL } from '../../constants';
import { dihedralAngle } from '../../normals/hard';
import { orient2d } from '../../predicates';
import { refuse } from '../../refusal';
import {
  argsOf,
  bool,
  collectMarkedFaces,
  edgeCorners,
  faceVerts,
  guarded,
  markFace,
  num,
  resultSelection,
  scopeFaces,
} from '../../subset/support';
import { expandWarnings, partnerOf } from '../../subset/symmetry';
import { triangulate as triangulation } from '../../triangulate/triangulate';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, Refusal } from '../../types';
import { QUADRANGULATE } from './descriptor';

interface Candidate {
  readonly edge: number;
  readonly faces: readonly [number, number];
  /** The quad's vertices in winding order: a, d, b, c for triangles (a, b, c) and (b, a, d) across a–b. */
  readonly quad: readonly [number, number, number, number];
  readonly score: number;
}

/** Corner layers continuous across edge `e` (uv, colours…; 'clear' layers such as custom normals are ignored). */
function cornerValuesEqual(m: EditMesh, e: number): boolean {
  const radial = edgeCorners(m, e);
  if (radial.length !== 2) return false;
  const [c, d] = radial as [number, number];
  // c runs a → b, d runs b → a: c's start meets d's end and c's end meets d's start.
  const pairs: [number, number][] = [
    [c, m.cornerNext(d)],
    [m.cornerNext(c), d],
  ];
  for (const layer of m.layers()) {
    if (layer.def.domain !== 'corner' || layer.def.interp === 'clear') continue;
    for (const [x, y] of pairs) {
      for (let k = 0; k < layer.def.comps; k++) if (!Object.is(layer.get(x, k), layer.get(y, k))) return false;
    }
  }
  return true;
}

function faceLayersEqual(m: EditMesh, f: number, g: number): boolean {
  if (m.faceMaterial(f) !== m.faceMaterial(g)) return false;
  for (const layer of m.layers()) {
    if (layer.def.domain !== 'face') continue;
    for (let k = 0; k < layer.def.comps; k++) if (layer.get(f, k) !== layer.get(g, k)) return false;
  }
  return true;
}

/** Sum of |angle − 90°| over the quad's corners, or null when the quad is not strictly convex in its plane. */
function rectangularity(m: EditMesh, quad: readonly number[]): number | null {
  const p = m.position;
  // Newell normal of the quad.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < 4; i++) {
    const a = 3 * (quad[i] as number);
    const b = 3 * (quad[(i + 1) % 4] as number);
    nx += ((p[a + 1] as number) - (p[b + 1] as number)) * ((p[a + 2] as number) + (p[b + 2] as number));
    ny += ((p[a + 2] as number) - (p[b + 2] as number)) * ((p[a] as number) + (p[b] as number));
    nz += ((p[a] as number) - (p[b] as number)) * ((p[a + 1] as number) + (p[b + 1] as number));
  }
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  // Project dropping the largest component; keep the winding (flip one axis when that component is negative).
  const drop = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  const sign = (drop === 0 ? nx : drop === 1 ? ny : nz) < 0 ? -1 : 1;
  // Right-handed pairs: (y, z) for x, (z, x) for y, (x, y) for z.
  const u = drop === 0 ? 1 : drop === 1 ? 2 : 0;
  const w = drop === 0 ? 2 : drop === 1 ? 0 : 1;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const v of quad) {
    xs.push(p[3 * v + u] as number);
    ys.push(sign * (p[3 * v + w] as number));
  }
  for (let i = 0; i < 4; i++) {
    const o = orient2d(
      xs[i] as number,
      ys[i] as number,
      xs[(i + 1) % 4] as number,
      ys[(i + 1) % 4] as number,
      xs[(i + 2) % 4] as number,
      ys[(i + 2) % 4] as number,
    );
    if (!(o > 0)) return null;
  }
  let score = 0;
  for (let i = 0; i < 4; i++) {
    const a = 3 * (quad[(i + 3) % 4] as number);
    const b = 3 * (quad[i] as number);
    const c = 3 * (quad[(i + 1) % 4] as number);
    const ux = (p[a] as number) - (p[b] as number);
    const uy = (p[a + 1] as number) - (p[b + 1] as number);
    const uz = (p[a + 2] as number) - (p[b + 2] as number);
    const vx = (p[c] as number) - (p[b] as number);
    const vy = (p[c + 1] as number) - (p[b + 1] as number);
    const vz = (p[c + 2] as number) - (p[b + 2] as number);
    const lu = Math.sqrt(ux * ux + uy * uy + uz * uz);
    const lv = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (!(lu > 0 && lv > 0)) return null;
    const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (lu * lv)));
    score += Math.abs(Math.acos(cos) - Math.PI / 2);
  }
  return Math.round(score * 1e9) / 1e9;
}

function candidates(
  m: EditMesh,
  inScope: Uint8Array,
  angle: number,
  keepHard: boolean,
  keepSeams: boolean,
  keepMaterials: boolean,
): { readonly list: Candidate[]; readonly blockedByHard: number } {
  const list: Candidate[] = [];
  let blockedByHard = 0;
  const radial: number[] = [];
  for (let e = 0; e < m.counts.edges; e++) {
    edgeCorners(m, e, radial);
    if (radial.length !== 2) continue;
    const [c, d] = radial as [number, number];
    const f = m.cornerFace(c);
    const g = m.cornerFace(d);
    if (f === g || inScope[f] !== 1 || inScope[g] !== 1) continue;
    if (m.faceLen(f) !== 3 || m.faceLen(g) !== 3) continue;
    if (m.cornerVert(c) === m.cornerVert(d)) continue; // inconsistent winding
    const a = m.cornerVert(c);
    const b = m.cornerVert(m.cornerNext(c));
    const cv = m.cornerVert(m.cornerNext(m.cornerNext(c)));
    const dv = m.cornerVert(m.cornerNext(m.cornerNext(d)));
    if (cv === dv || cv === a || cv === b || dv === a || dv === b) continue;
    const flags = m.edgeFlags(e);
    if (keepSeams && ((flags & EDGE_SEAM) !== 0 || !cornerValuesEqual(m, e))) continue;
    if (keepMaterials && !faceLayersEqual(m, f, g)) continue;
    if (!(dihedralAngle(m, e) < angle)) continue;
    const quad = [a, dv, b, cv] as const;
    const score = rectangularity(m, quad);
    if (score === null) continue;
    if (keepHard && (flags & EDGE_HARD) !== 0) {
      blockedByHard++;
      continue;
    }
    list.push({ edge: e, faces: f < g ? [f, g] : [g, f], quad, score });
  }
  return { list, blockedByHard };
}

function quadrangulatePoll(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  return scopeFaces(m, sel, ctx.hidden).length > 0
    ? true
    : refuse('quadrangulate.no-faces', 'Quadrangulate needs faces: select faces');
}

export const quadrangulate: MeshOp = Object.freeze({
  ...QUADRANGULATE,
  poll: quadrangulatePoll,
  run(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
    const verdict = quadrangulatePoll(m, sel, ctx);
    if (verdict !== true) return verdict;
    const args = argsOf(QUADRANGULATE.params, raw);
    const angle = num(args, 'angle', Math.PI / 6);
    const faces = scopeFaces(m, sel, ctx.hidden);
    const inScope = new Uint8Array(m.counts.faces);
    for (const f of faces) inScope[f] = 1;
    const { list, blockedByHard } = candidates(
      m,
      inScope,
      angle,
      bool(args, 'keepHardEdges', true),
      bool(args, 'keepSeams', true),
      bool(args, 'keepMaterials', true),
    );
    const map = ctx.symmetry?.map ?? null;
    const byEdge = new Map(list.map((c) => [c.edge, c]));
    const key = (c: Candidate): number => {
      if (map === null) return c.edge;
      const p = partnerOf(map, 'edge', c.edge);
      return p >= 0 ? Math.min(c.edge, p) : c.edge;
    };
    const order = [...list].sort(
      (x, y) => x.score - y.score || x.faces[0] - y.faces[0] || key(x) - key(y) || x.edge - y.edge,
    );
    const used = new Uint8Array(m.counts.faces);
    const chosen: Candidate[] = [];
    for (const c of order) {
      if (used[c.faces[0]] === 1 || used[c.faces[1]] === 1) continue;
      if (map !== null) {
        const p = partnerOf(map, 'edge', c.edge);
        const mirror = p >= 0 && p !== c.edge ? byEdge.get(p) : undefined;
        if (p >= 0 && p !== c.edge) {
          // Take the pair with its mirror image, or not at all.
          if (mirror === undefined) continue;
          const faces4 = new Set([...c.faces, ...mirror.faces]);
          if (faces4.size !== 4 || [...faces4].some((f) => used[f] === 1)) continue;
          for (const f of faces4) used[f] = 1;
          chosen.push(c, mirror);
          continue;
        }
      }
      used[c.faces[0]] = 1;
      used[c.faces[1]] = 1;
      chosen.push(c);
    }
    if (chosen.length === 0) {
      return refuse(
        'quadrangulate.no-pairs',
        blockedByHard > 0
          ? 'No triangle pairs to join: their shared edges are hard (turn off Keep Hard Edges)'
          : 'No triangle pairs to join within the angle threshold',
      );
    }
    return guarded('quadrangulate.join', 'Two triangles could not be joined', () => {
      for (const f of faces) markFace(m, f);
      const diagonals = new Set<string>();
      for (const c of chosen) {
        const [a, , b] = c.quad;
        diagonals.add(a < b ? `${a},${b}` : `${b},${a}`);
      }
      // Descending edge order: a removal moves elements from higher indices only.
      for (const c of [...chosen].sort((x, y) => y.edge - x.edge)) m.joinFaceKillEdge(c.edge);
      const result = collectMarkedFaces(m);
      // Keep the removed edge as each quad's visible diagonal.
      const tris = triangulation(m);
      const verts: number[] = [];
      for (const f of result) {
        if (m.faceLen(f) !== 4) continue;
        faceVerts(m, f, verts);
        const k0 = (verts[0] as number) < (verts[2] as number) ? `${verts[0]},${verts[2]}` : `${verts[2]},${verts[0]}`;
        const k1 = (verts[1] as number) < (verts[3] as number) ? `${verts[1]},${verts[3]}` : `${verts[3]},${verts[1]}`;
        const wanted = diagonals.has(k0) ? k0 : diagonals.has(k1) ? k1 : null;
        if (wanted === null) continue;
        const t = tris.faceTriStart[f] as number;
        const shown = new Set([0, 1, 2].map((i) => m.cornerVert(tris.tris[3 * t + i] as number)));
        const [x, y] = wanted.split(',').map(Number) as [number, number];
        if (!(shown.has(x) && shown.has(y))) m.setFaceFlags(f, m.faceFlags(f) ^ FACE_FLIP_DIAGONAL);
      }
      return {
        selection: resultSelection(m, 'face', result),
        warnings: expandWarnings(sel, ctx),
        resolvedArgs: args,
      };
    });
  },
});
