// `mesh.extrude` on border edges (M6A-SPEC §5.8 step 7, §5.14): connected selected border edges share their new
// vertices; each edge gets `divisions` quads from its border to the new outer edge; a chain's frame has X along the
// chain, Z = the average of the adjacent face normals and Y in-plane pointing away from the faces; the local args
// apply in it (offset and thickness are face-region args). An interior edge refuses: it would make a fin.
// `selection′` = the new outer edges. Winding (M6A-B3-1): for a border edge its face runs a → b, the quads run
// (B_k, A_k, A_k+1, B_k+1), against the face on the border edge (§5.8 step 7 writes (a, b, b′, a′)).
import type { ParamValue, ParamValues } from '@ekza-animator/anim-core';
import { copyCornerAttributes, copyPointAttributes } from '../../layers/propagate';
import { applySmoothingAngle } from '../../normals/hard';
import { resolveSmoothingAngle } from '../../normals/normals';
import { refuse } from '../../refusal';
import type { EditMesh, OpContext, OpResult, OpWarning, Refusal } from '../../types';
import { EXTRUDE } from './descriptor';
import { axesFromNormal, type CapData, PLACEMENT_ARGS } from './geometry';
import { type PlaceGroup, pairGroups, placeGroups } from './place';
import type { Mirror } from './shared/symmetry';
import {
  type V3,
  add,
  cornerAt,
  cross,
  dot,
  edgeCorners,
  faceCentroid,
  faceCorners,
  length,
  lerp3,
  newell,
  normalize,
  num,
  opResult,
  pos,
  resolveArgs,
  scale,
  selectionResult,
  sub,
  uniqueSorted,
} from './shared/util';

interface BorderEdge {
  readonly e: number;
  readonly face: number;
  /** The face runs a → b. */
  readonly a: number;
  readonly b: number;
}

/** Connected components of the edges through shared vertices (ascending edge lists). */
function chainsOf(m: EditMesh, edges: readonly number[]): number[][] {
  const parent = new Map<number, number>(edges.map((e) => [e, e]));
  const find = (e: number): number => {
    let r = e;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    return r;
  };
  const byVert = new Map<number, number>();
  for (const e of edges) {
    for (const end of [0, 1] as const) {
      const v = m.edgeVert(e, end);
      const other = byVert.get(v);
      if (other === undefined) byVert.set(v, e);
      else {
        const a = find(other);
        const b = find(e);
        if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (const e of edges) {
    const root = find(e);
    const list = groups.get(root) ?? [];
    list.push(e);
    groups.set(root, list);
  }
  return [...groups.values()].map((g) => g.sort((a, b) => a - b)).sort((a, b) => (a[0] as number) - (b[0] as number));
}

/** §5.8 step 7 frame of a chain. */
function chainFrame(m: EditMesh, chain: readonly BorderEdge[]): { pivot: V3; x: V3; y: V3; z: V3 } {
  let weighted: V3 = [0, 0, 0];
  let plain: V3 = [0, 0, 0];
  let total = 0;
  let along: V3 = [0, 0, 0];
  let normal: V3 = [0, 0, 0];
  let away: V3 = [0, 0, 0];
  for (const edge of chain) {
    const a = pos(m, edge.a);
    const b = pos(m, edge.b);
    const mid = lerp3(a, b, 0.5);
    const l = length(sub(b, a));
    weighted = add(weighted, scale(mid, l));
    plain = add(plain, mid);
    total += l;
    along = add(along, normalize(sub(b, a), [0, 0, 0]));
    normal = add(normal, normalize(newell(m, edge.face), [0, 0, 0]));
    away = add(away, sub(mid, faceCentroid(m, edge.face)));
  }
  const pivot = total > 0 ? scale(weighted, 1 / total) : scale(plain, 1 / Math.max(1, chain.length));
  const z = normalize(normal, [0, 1, 0]);
  const projected = sub(along, scale(z, dot(along, z)));
  let { x, y } = length(projected) > 1e-9 ? { x: normalize(projected), y: [0, 0, 0] as V3 } : axesFromNormal(z);
  y = cross(z, x);
  if (dot(y, away) < 0) {
    x = scale(x, -1);
    y = scale(y, -1);
  }
  return { pivot, x, y, z };
}

export function extrudeEdges(
  m: EditMesh,
  edges: readonly number[],
  args: Record<string, ParamValue>,
  ctx: OpContext,
  mirror: Mirror | null,
  warnings: readonly OpWarning[],
): OpResult | Refusal {
  for (const e of edges) {
    if (m.edgeFaceCount(e) !== 1) {
      return refuse('extrude.interior-edge', 'Extruding an interior edge makes a fin; it arrives later');
    }
  }
  const n = Math.max(1, Math.round(num(args, 'divisions', 1)));
  const chains = chainsOf(m, edges);
  const records = chains.map((chain) =>
    chain.map((e): BorderEdge => {
      const c = edgeCorners(m, e)[0] as number;
      return { e, face: m.cornerFace(c), a: m.cornerVert(c), b: m.cornerVert(m.cornerNext(c)) };
    }),
  );
  const frames = records.map((chain) => chainFrame(m, chain));
  const roles = pairGroups(chains, 'edge', mirror, (i) =>
    mirror === null ? 0 : mirror.distance((frames[i] as (typeof frames)[number]).pivot),
  );
  // Topology: one new vertex (plus rings) per chain vertex, quads per edge.
  const groups: PlaceGroup[] = [];
  const outer: [number, number][] = [];
  const hardPairs: [number, number][] = [];
  for (let i = 0; i < records.length; i++) {
    const chain = records[i] as BorderEdge[];
    const verts = uniqueSorted(chain.flatMap((edge) => [edge.a, edge.b]));
    const out = new Map<number, { out: number; ring: number[] }>();
    for (const v of verts) {
      const p = pos(m, v);
      const ring: number[] = [];
      for (let k = 1; k < n; k++) {
        const r = m.makeVert(p[0], p[1], p[2]);
        copyPointAttributes(m, v, r);
        ring.push(r);
      }
      const o = m.makeVert(p[0], p[1], p[2]);
      copyPointAttributes(m, v, o);
      out.set(v, { out: o, ring });
    }
    for (const edge of chain) {
      const A = [edge.a, ...(out.get(edge.a)?.ring ?? []), out.get(edge.a)?.out as number];
      const B = [edge.b, ...(out.get(edge.b)?.ring ?? []), out.get(edge.b)?.out as number];
      const ca = cornerAt(m, edge.face, edge.a);
      const cb = m.cornerNext(ca);
      for (let k = 0; k < n; k++) {
        const quad = [B[k], A[k], A[k + 1], B[k + 1]] as number[];
        const q = m.makeFace(quad, { example: edge.face });
        for (const corner of faceCorners(m, q)) {
          const vert = m.cornerVert(corner);
          copyCornerAttributes(m, vert === quad[1] || vert === quad[2] ? ca : cb, corner);
        }
        if (m.faceFlags(q) !== 0) m.setFaceFlags(q, 0);
      }
      outer.push([A[n] as number, B[n] as number]);
      for (let k = 0; k <= n; k++) hardPairs.push([A[k] as number, B[k] as number]);
      for (let k = 0; k < n; k++)
        hardPairs.push([A[k] as number, A[k + 1] as number], [B[k] as number, B[k + 1] as number]);
    }
    const role = roles[i] ?? { kind: 'own' };
    let frame = frames[i] as (typeof frames)[number];
    if (role.kind === 'partner' && mirror !== null) {
      const src = frames[role.source] as (typeof frames)[number];
      frame = {
        pivot: mirror.reflect(src.pivot),
        x: mirror.reflectDir(src.x),
        y: mirror.reflectDir(src.y),
        z: mirror.reflectDir(src.z),
      };
    }
    groups.push({
      role,
      frame,
      edges: true,
      verts: verts.map((v) => {
        const data: CapData = { p: pos(m, v), n: frame.z, thick: 1, bisector: null, invSin: 1, limit: 0 };
        const pv = mirror?.partner('vertex', v) ?? -1;
        return {
          src: v,
          out: out.get(v)?.out as number,
          ring: out.get(v)?.ring ?? [],
          data,
          key: `${v}`,
          partnerKey: pv === -1 ? null : `${pv}`,
        };
      }),
    });
  }
  const hard = uniqueSorted(hardPairs.map(([a, b]) => m.findEdge(a, b)).filter((e) => e !== -1));
  let current: Record<string, ParamValue> = args;
  const place = (values: Record<string, ParamValue>) => {
    const placed = placeGroups(m, groups, values, ctx.placement, mirror, 'extrude.offset-clamped');
    applySmoothingAngle(m, hard, num(values, 'smoothingAngle'));
    return placed;
  };
  const placed = place(current);
  const selection = uniqueSorted(outer.map(([a, b]) => m.findEdge(a, b)).filter((e) => e !== -1));
  const adjust = (patch: ParamValues): boolean => {
    for (const key of Object.keys(patch)) if (!PLACEMENT_ARGS.has(key) && key !== 'smoothingAngle') return false;
    const merged = resolveArgs(EXTRUDE, { ...current, ...patch });
    merged['smoothingAngle'] = resolveSmoothingAngle(merged['smoothingAngle'] as number | null, ctx.faceted);
    place(merged);
    current = merged;
    return true;
  };
  return opResult(selectionResult(m, 'edge', selection), [...warnings, ...placed.warnings], args, {
    ...(placed.frame === null ? {} : { frame: placed.frame }),
    adjust,
  });
}
