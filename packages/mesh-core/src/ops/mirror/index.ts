// Kernel op `mesh.mirror` (M6A-SPEC §5.13, research 10 §4.14, 13 §5.10; Maya `polyMirror`; owner B4). Whole mesh:
// 1. The plane: `position: 'object'` — local axis = 0 through the object origin; `'world'` — the world axis plane
//    through the world origin, mapped into mesh-local space through the placement (the reflection is then the local
//    affine map P⁻¹·S·P). Vertices within `mergeThreshold` (at least ctx.epsilon) of the plane snap onto it.
// 2. `cutMesh` (default): edges crossing the plane are split exactly on it, faces crossing it are clipped to their
//    kept-side part (`makeFace` with the face as example; the clip edge follows H1), and everything on the far side of
//    the plane (`keep` names the source half: positive = +axis) is deleted with its unused edges and vertices.
// 3. The source half is copied with positions reflected and **corner order reversed** (outward winding); layers by
//    their mirror rules (§5.2: morph axis negated and `_L`/`_R` swapped, joints through the palette's mirror pairs,
//    U flipped when `flipUVs`, custom normals negated on the axis); copied edges keep their source's flags.
// 4. `mergeMode: 'merge'` shares the on-plane vertices between the halves (seam edges are the same edge: H3 trivially);
//    `'none'` duplicates them (the halves stay apart). Faces lying in the plane are not copied in merge mode (they would
//    be laminas).
// 5. Each copied quad shows the mirror image of its source's diagonal (`FACE_FLIP_DIAGONAL` set where the shared
//    triangulation's tie-break would pick the other one), so the halves look identical.
// `selection′` = every face (face memory). Half cube (centre loop, −X faces deleted) 8/12/5 → 12/20/10.
import { mat4Invert, mat4Multiply, type ParamValues } from '@ekza-animator/anim-core';
import { EDGE_HARD, FACE_FLIP_DIAGONAL } from '../../constants';
import { mirrorCornerAttributes, mirrorPointAttributes } from '../../layers/propagate';
import { allEdgesHard } from '../../normals/hard';
import { resolveSmoothingAngle } from '../../normals/normals';
import { refuse } from '../../refusal';
import { matrixOf, transformPoint } from '../../subset/matrix';
import {
  argsOf,
  bool,
  edgeCorners,
  faceCorners,
  faceVerts,
  guarded,
  num,
  positiveZeros,
  resultSelection,
  str,
  vertEdges,
} from '../../subset/support';
import { triangulate as triangulation } from '../../triangulate/triangulate';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, OpWarning, Refusal } from '../../types';
import { MIRROR } from './descriptor';

type Axis = 'x' | 'y' | 'z';

/** The mirror plane in mesh-local space: signed distance (> 0 = positive side), reflection and projection. */
interface Plane {
  distance(x: number, y: number, z: number): number;
  reflect(x: number, y: number, z: number, out: Float64Array): void;
  project(x: number, y: number, z: number, out: Float64Array): void;
}

function objectPlane(k: number): Plane {
  return {
    distance: (x, y, z) => (k === 0 ? x : k === 1 ? y : z),
    reflect(x, y, z, out) {
      out[0] = x;
      out[1] = y;
      out[2] = z;
      out[k] = 0 - (out[k] as number);
    },
    project(x, y, z, out) {
      out[0] = x;
      out[1] = y;
      out[2] = z;
      out[k] = 0;
    },
  };
}

function worldPlane(k: number, ctx: OpContext): Plane | null {
  const P = matrixOf(ctx.placement);
  const inverse = mat4Invert(P);
  if (inverse === null) return null;
  const S = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  S[5 * k] = -1;
  const M = mat4Multiply(inverse, mat4Multiply(S, P));
  // Local displacement per unit of world distance along the axis: P⁻¹'s linear part applied to e_k.
  const g = [inverse[4 * k] as number, inverse[4 * k + 1] as number, inverse[4 * k + 2] as number];
  const r = [P[k] as number, P[4 + k] as number, P[8 + k] as number, P[12 + k] as number];
  const distance = (x: number, y: number, z: number): number =>
    (r[0] as number) * x + (r[1] as number) * y + (r[2] as number) * z + (r[3] as number);
  return {
    distance,
    reflect: (x, y, z, out) => transformPoint(M, x, y, z, out),
    project(x, y, z, out) {
      const d = distance(x, y, z);
      out[0] = x - d * (g[0] as number);
      out[1] = y - d * (g[1] as number);
      out[2] = z - d * (g[2] as number);
    },
  };
}

const OUT = new Float64Array(3);

function mirrorPoll(m: EditMesh): true | Refusal {
  return m.counts.faces > 0 ? true : refuse('mirror.no-faces', 'Mirror needs a mesh with faces');
}

export const mirror: MeshOp = Object.freeze({
  ...MIRROR,
  poll: (m: EditMesh) => mirrorPoll(m),
  run(m: EditMesh, _sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
    const verdict = mirrorPoll(m);
    if (verdict !== true) return verdict;
    const parsed = argsOf(MIRROR.params, raw);
    const smoothingAngle = resolveSmoothingAngle(
      typeof parsed['smoothingAngle'] === 'number' ? parsed['smoothingAngle'] : null,
      ctx.faceted,
    );
    const args = { ...parsed, smoothingAngle };
    const axis = str<Axis>(args, 'axis', 'x');
    const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const keep = str<string>(args, 'keep', 'positive') === 'negative' ? -1 : 1;
    const plane = str<string>(args, 'position', 'object') === 'world' ? worldPlane(k, ctx) : objectPlane(k);
    if (plane === null) return refuse('mirror.placement', 'The mesh placement cannot be inverted (zero scale)');
    const cutMesh = bool(args, 'cutMesh', true);
    const merge = str<string>(args, 'mergeMode', 'merge') === 'merge';
    const threshold = Math.max(0, num(args, 'mergeThreshold', 0.001));
    const flipUVs = bool(args, 'flipUVs', false);

    return guarded('mirror.failed', 'The mesh could not be mirrored', () => {
      const p = m.position;
      // 1. Snap onto the plane; sides (+1 kept, −1 removed, 0 on the plane).
      let side = new Int8Array(m.counts.points);
      for (let v = 0; v < m.counts.points; v++) {
        const x = p[3 * v] as number;
        const y = p[3 * v + 1] as number;
        const z = p[3 * v + 2] as number;
        const d = plane.distance(x, y, z);
        if (Math.abs(d) <= Math.max(threshold, ctx.epsilon)) {
          if (d !== 0) {
            plane.project(x, y, z, OUT);
            m.setPosition(v, (OUT[0] as number) + 0, (OUT[1] as number) + 0, (OUT[2] as number) + 0);
          }
          side[v] = 0;
        } else side[v] = d * keep > 0 ? 1 : -1;
      }
      if (cutMesh) {
        if (!side.some((s) => s === 1) && !side.some((s) => s === 0)) {
          return refuse('mirror.empty', 'Nothing lies on the kept side of the mirror plane');
        }
        // 2a. Split crossing edges exactly on the plane.
        const crossing: number[] = [];
        for (let e = 0; e < m.counts.edges; e++) {
          if ((side[m.edgeVert(e, 0)] as number) * (side[m.edgeVert(e, 1)] as number) < 0) crossing.push(e);
        }
        const grown = new Int8Array(m.counts.points + crossing.length);
        grown.set(side);
        side = grown;
        for (const e of crossing) {
          const a = m.edgeVert(e, 0);
          const b = m.edgeVert(e, 1);
          const da = plane.distance(p[3 * a] as number, p[3 * a + 1] as number, p[3 * a + 2] as number);
          const db = plane.distance(p[3 * b] as number, p[3 * b + 1] as number, p[3 * b + 2] as number);
          const t = da / (da - db);
          const v = m.splitEdgeMakeVert(e, t);
          const q = m.position;
          plane.project(q[3 * v] as number, q[3 * v + 1] as number, q[3 * v + 2] as number, OUT);
          m.setPosition(v, (OUT[0] as number) + 0, (OUT[1] as number) + 0, (OUT[2] as number) + 0);
          side[v] = 0;
        }
        // 2b. Clip faces that cross the plane to their kept runs.
        const F0 = m.counts.faces;
        for (let f = 0; f < F0; f++) {
          const corners = faceCorners(m, f);
          const sides = corners.map((c) => side[m.cornerVert(c)] as number);
          if (!sides.includes(1) || !sides.includes(-1)) continue;
          const hard = allEdgesHard(m, f);
          const n = corners.length;
          const startAt = sides.findIndex((s, i) => s === -1 && sides[(i + 1) % n] !== -1);
          let run: number[] = [];
          const runs: number[][] = [];
          for (let i = 1; i <= n; i++) {
            const c = corners[(startAt + i) % n] as number;
            if (side[m.cornerVert(c)] === -1) {
              if (run.length > 0) runs.push(run);
              run = [];
            } else run.push(m.cornerVert(c));
          }
          if (run.length > 0) runs.push(run);
          for (const verts of runs) {
            if (verts.length < 3 || !verts.some((v) => side[v] === 1)) continue;
            const first = verts[0] as number;
            const last = verts[verts.length - 1] as number;
            const existed = m.findEdge(first, last) !== -1;
            m.makeFace(verts, { example: f });
            if (!existed) {
              const chord = m.findEdge(first, last);
              m.setEdgeFlags(chord, hard ? EDGE_HARD : 0);
            }
          }
        }
        // 2c. Delete the far half: faces, then edges, then vertices (each pass in descending order).
        const deadFaces: number[] = [];
        for (let f = 0; f < m.counts.faces; f++) {
          if (faceVerts(m, f).some((v) => side[v] === -1)) deadFaces.push(f);
        }
        const touched = new Set<number>();
        for (const f of deadFaces) for (const c of faceCorners(m, f)) touched.add(m.cornerEdge(c));
        for (const f of deadFaces.reverse()) m.killFace(f);
        const deadEdges: number[] = [];
        for (let e = 0; e < m.counts.edges; e++) {
          const far = side[m.edgeVert(e, 0)] === -1 || side[m.edgeVert(e, 1)] === -1;
          if (far || (touched.has(e) && m.edgeFaceCount(e) === 0)) deadEdges.push(e);
        }
        const ends = new Set<number>();
        for (const e of deadEdges) {
          ends.add(m.edgeVert(e, 0));
          ends.add(m.edgeVert(e, 1));
        }
        for (const e of deadEdges.reverse()) m.killEdge(e);
        const deadVerts: number[] = [];
        for (let v = 0; v < m.counts.points; v++) {
          if (side[v] === -1 || (ends.has(v) && m.vertEdge(v) === -1)) deadVerts.push(v);
        }
        for (const v of deadVerts.reverse()) m.killVert(v);
        if (m.counts.faces === 0) return refuse('mirror.empty', 'Nothing lies on the kept side of the mirror plane');
        // Removals moved vertices: classify the survivors again (on the plane = snapped or split onto it).
        const tolerance = Math.max(threshold, ctx.epsilon);
        const q = m.position;
        side = new Int8Array(m.counts.points);
        for (let v = 0; v < m.counts.points; v++) {
          const d = plane.distance(q[3 * v] as number, q[3 * v + 1] as number, q[3 * v + 2] as number);
          side[v] = Math.abs(d) <= tolerance ? 0 : 1;
        }
      }

      // 3. The copy: vertices (on-plane ones shared when merging), faces reversed, layers by their mirror rules.
      const sourceFaces: number[] = [];
      for (let f = 0; f < m.counts.faces; f++) {
        if (merge && faceVerts(m, f).every((v) => side[v] === 0)) continue;
        sourceFaces.push(f);
      }
      const copyOf = new Int32Array(m.counts.points).fill(-1);
      const pos = m.position;
      for (const f of sourceFaces) {
        for (const v of faceVerts(m, f)) {
          if (copyOf[v] !== -1) continue;
          if (merge && side[v] === 0) {
            copyOf[v] = v;
            continue;
          }
          plane.reflect(pos[3 * v] as number, pos[3 * v + 1] as number, pos[3 * v + 2] as number, OUT);
          const w = m.makeVert((OUT[0] as number) + 0, (OUT[1] as number) + 0, (OUT[2] as number) + 0);
          mirrorPointAttributes(m, v, w, axis);
          positiveZeros(m, 'point', w);
          copyOf[v] = w;
        }
      }
      const pairs: [number, number][] = [];
      const sourceEdges = new Set<number>();
      for (const f of sourceFaces) {
        const corners = faceCorners(m, f).reverse();
        const verts = corners.map((c) => copyOf[m.cornerVert(c)] as number);
        const g = m.makeFace(verts, { example: f });
        pairs.push([f, g]);
        if (m.faceFlags(f) !== 0) m.setFaceFlags(g, m.faceFlags(f));
        let c = m.faceCorner(g);
        for (const source of corners) {
          mirrorCornerAttributes(m, source, c, axis, { flipUVs });
          positiveZeros(m, 'corner', c);
          c = m.cornerNext(c);
        }
        for (const source of faceCorners(m, f)) sourceEdges.add(m.cornerEdge(source));
      }
      for (const e of sourceEdges) {
        const a = copyOf[m.edgeVert(e, 0)] as number;
        const b = copyOf[m.edgeVert(e, 1)] as number;
        const copy = m.findEdge(a, b);
        if (copy === -1 || copy === e) continue;
        if (m.edgeFlags(copy) !== m.edgeFlags(e)) m.setEdgeFlags(copy, m.edgeFlags(e));
        for (const layer of m.layers()) {
          if (layer.def.domain !== 'edge') continue;
          for (let i = 0; i < layer.def.comps; i++) layer.set(copy, i, layer.get(e, i));
        }
      }

      // 5. Copied quads show their source's diagonal mirrored.
      const tris = triangulation(m);
      const shown = (f: number): string => {
        const t = tris.faceTriStart[f] as number;
        const tri = new Set([0, 1, 2].map((i) => m.cornerVert(tris.tris[3 * t + i] as number)));
        const verts = faceVerts(m, f);
        const pair =
          tri.has(verts[0] as number) && tri.has(verts[2] as number) ? [verts[0], verts[2]] : [verts[1], verts[3]];
        return (pair as number[]).sort((x, y) => x - y).join(',');
      };
      for (const [f, g] of pairs) {
        if (m.faceLen(f) !== 4) continue;
        const [a, b] = shown(f).split(',').map(Number) as [number, number];
        const wanted = [copyOf[a] as number, copyOf[b] as number].sort((x, y) => x - y).join(',');
        if (shown(g) !== wanted) m.setFaceFlags(g, m.faceFlags(g) ^ FACE_FLIP_DIAGONAL);
      }

      const warnings: OpWarning[] = [];
      let nonManifold = 0;
      const radial: number[] = [];
      for (let v = 0; v < side.length; v++) {
        if (side[v] !== 0) continue;
        for (const e of vertEdges(m, v)) if (edgeCorners(m, e, radial).length > 2) nonManifold++;
      }
      if (nonManifold > 0) {
        warnings.push({
          code: 'mirror.non-manifold',
          message: 'The mirrored halves meet in non-manifold edges at the plane',
          count: nonManifold,
        });
      }
      return {
        selection: resultSelection(m, 'face', [...Array(m.counts.faces).keys()]),
        warnings,
        resolvedArgs: args,
      };
    });
  },
});
