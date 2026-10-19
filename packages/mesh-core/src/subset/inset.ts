// The boundary inset of Extract and Duplicate Faces (M6A-SPEC §5.13 "`offset` insets the extracted faces' boundary
// (as extrude `offset`)", §5.8 step 5a): every boundary vertex of a face set moves inside the region surface along the
// in-plane bisector of its two boundary edges by `offset / sin(θ/2)` (θ = the region's interior angle there), clamped at
// half the shortest adjacent inner edge (or, with none, half the shortest boundary edge) with a warning. Vertices with
// more than one boundary fan (bow-ties) stay. A negative offset grows the region outward.
import type { EditMesh, OpWarning } from '../types';
import { edgeCorners, faceCorners, newellNormal, vertEdges } from './support';

const N = new Float64Array(3);

export function insetBoundary(m: EditMesh, faces: readonly number[], offset: number, code: string): OpWarning[] {
  if (offset === 0 || faces.length === 0) return [];
  const inSet = new Set(faces);
  const p = m.position;
  // Boundary edges as traversed by the set's faces: from → to.
  const outgoing = new Map<number, number[]>();
  const incoming = new Map<number, number[]>();
  const boundaryEdges = new Set<number>();
  const normal = new Map<number, [number, number, number]>();
  const radial: number[] = [];
  for (const f of faces) {
    newellNormal(m, f, N);
    for (const c of faceCorners(m, f)) {
      const v = m.cornerVert(c);
      const acc = normal.get(v) ?? [0, 0, 0];
      acc[0] += N[0] as number;
      acc[1] += N[1] as number;
      acc[2] += N[2] as number;
      normal.set(v, acc);
      const e = m.cornerEdge(c);
      const inside = edgeCorners(m, e, radial).filter((d) => inSet.has(m.cornerFace(d))).length;
      if (inside !== 1) continue;
      boundaryEdges.add(e);
      const to = m.cornerVert(m.cornerNext(c));
      outgoing.set(v, [...(outgoing.get(v) ?? []), to]);
      incoming.set(to, [...(incoming.get(to) ?? []), v]);
    }
  }
  const moves: [number, number, number, number][] = [];
  let clamped = 0;
  for (const [v, outs] of outgoing) {
    const ins = incoming.get(v) ?? [];
    if (outs.length !== 1 || ins.length !== 1) continue;
    const u = ins[0] as number;
    const w = outs[0] as number;
    const n = normal.get(v) as [number, number, number];
    const ln = Math.hypot(n[0], n[1], n[2]);
    if (!(ln > 0)) continue;
    const nx = n[0] / ln;
    const ny = n[1] / ln;
    const nz = n[2] / ln;
    const vx = p[3 * v] as number;
    const vy = p[3 * v + 1] as number;
    const vz = p[3 * v + 2] as number;
    const unit = (x: number, y: number, z: number): [number, number, number] => {
      const l = Math.hypot(x, y, z);
      return l > 0 ? [x / l, y / l, z / l] : [0, 0, 0];
    };
    const d1 = unit(vx - (p[3 * u] as number), vy - (p[3 * u + 1] as number), vz - (p[3 * u + 2] as number));
    const d2 = unit((p[3 * w] as number) - vx, (p[3 * w + 1] as number) - vy, (p[3 * w + 2] as number) - vz);
    // Left of an edge running d inside a counterclockwise face: n × d.
    const left = (d: [number, number, number]): [number, number, number] => [
      ny * d[2] - nz * d[1],
      nz * d[0] - nx * d[2],
      nx * d[1] - ny * d[0],
    ];
    const l1 = left(d1);
    const l2 = left(d2);
    const b = unit(l1[0] + l2[0], l1[1] + l2[1], l1[2] + l2[2]);
    if (b[0] === 0 && b[1] === 0 && b[2] === 0) continue;
    // Interior angle θ between (u − v) and (w − v); sin(θ/2) from the half-angle identity.
    const cos = Math.max(-1, Math.min(1, -(d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2])));
    const sinHalf = Math.sqrt((1 - cos) / 2);
    if (!(sinHalf > 1e-9)) continue;
    let distance = offset / sinHalf;
    let limit = Number.POSITIVE_INFINITY;
    let border = Number.POSITIVE_INFINITY;
    for (const e of vertEdges(m, v)) {
      const o = m.edgeOther(e, v);
      const length = Math.hypot(
        (p[3 * o] as number) - vx,
        (p[3 * o + 1] as number) - vy,
        (p[3 * o + 2] as number) - vz,
      );
      const ofSet = edgeCorners(m, e, radial).some((d) => inSet.has(m.cornerFace(d)));
      if (!ofSet) continue;
      if (boundaryEdges.has(e)) border = Math.min(border, length);
      else limit = Math.min(limit, length);
    }
    const cap = 0.5 * (Number.isFinite(limit) ? limit : border);
    if (Math.abs(distance) > cap) {
      distance = Math.sign(distance) * cap;
      clamped++;
    }
    moves.push([v, vx + b[0] * distance, vy + b[1] * distance, vz + b[2] * distance]);
  }
  for (const [v, x, y, z] of moves) m.setPosition(v, x + 0, y + 0, z + 0);
  return clamped === 0
    ? []
    : [{ code, message: 'The offset was clamped at half the shortest adjacent edge', count: clamped }];
}
