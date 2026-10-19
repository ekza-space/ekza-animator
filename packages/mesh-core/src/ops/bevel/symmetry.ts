// The kernel side of §5.14 for B5's `expand` ops (bevel, the UV projections): the selection an op runs on, the
// unmatched-partner warning, and the symmetrization of a region that is its own mirror. The runtime already hands
// `expand` ops the expanded selection (B7); expanding again here is idempotent (a partner's partner is the component
// itself) and lets the op run the same way when it is called directly (tests, scripts). Unmatched components
// (partner −1) stay on their own side and are counted. The mirror follows B2's `MirrorSpace` (Object: the local axis
// plane at `map.plane`; World: the world axis plane through the origin mapped into local space by the placement), so
// INT can swap these helpers for B2's `expandSelection`, `selectionUnmatchedWarning` and `symmetrizeVertices`.
import type { ReadonlyXf } from '@ekza-animator/anim-core';
import type { BitSet } from '../../bitset';
import { kernelError } from '../../kernel';
import type { ComponentKind, ComponentSelection, EditMesh, HiddenSet, OpWarning, SymmetryMap } from '../../types';

function expandBits(bits: BitSet, partner: Int32Array): BitSet {
  const out = bits.clone();
  bits.forEach((i) => {
    const p = i < partner.length ? (partner[i] as number) : -1;
    if (p >= 0 && p < out.size) out.add(p);
  });
  return out;
}

/** `sel` plus every matched partner (§4.3 `expandSelection` semantics); components with partner −1 stay as they are. */
export function expandForOp(sel: ComponentSelection, map: SymmetryMap): ComponentSelection {
  if (!(map.vertex instanceof Int32Array)) throw kernelError('invalid-argument', 'symmetry map without partners');
  return {
    kind: sel.kind,
    verts: expandBits(sel.verts, map.vertex),
    edges: expandBits(sel.edges, map.edge),
    faces: expandBits(sel.faces, map.face),
    order: sel.order,
    active: sel.active,
  };
}

/** The `symmetry.unmatched-partner` warning for the components of `kind` in `sel` without a partner, or null. */
export function unmatchedWarning(sel: ComponentSelection, kind: ComponentKind, map: SymmetryMap): OpWarning | null {
  const bits = kind === 'vertex' ? sel.verts : kind === 'edge' ? sel.edges : sel.faces;
  const partner = kind === 'vertex' ? map.vertex : kind === 'edge' ? map.edge : map.face;
  const lonely: number[] = [];
  bits.forEach((i) => {
    if (i >= partner.length || (partner[i] as number) < 0) lonely.push(i);
  });
  if (lonely.length === 0) return null;
  return {
    code: 'symmetry.unmatched-partner',
    message: 'No mirror partner: applied to one side',
    count: lonely.length,
    elements: Uint32Array.from(lonely),
  };
}

/** True when component `i` of `kind` is hidden. */
export function isHidden(hidden: HiddenSet | null, kind: ComponentKind, i: number): boolean {
  if (hidden === null) return false;
  const bits = kind === 'vertex' ? hidden.verts : kind === 'edge' ? hidden.edges : hidden.faces;
  return bits.has(i);
}

/** A mirror in mesh-local coordinates: S(p) = p − 2·(n·p − c)·g with n·g = 1 (B2's `MirrorSpace`). */
export interface Mirror {
  readonly n: readonly [number, number, number];
  readonly c: number;
  readonly g: readonly [number, number, number];
}

/** The mirror of a symmetry map for a mesh with `placement` (world from local). */
export function mirrorOf(map: SymmetryMap, placement: ReadonlyXf): Mirror {
  const k = map.axis === 'x' ? 0 : map.axis === 'y' ? 1 : map.axis === 'z' ? 2 : -1;
  if (k === -1) throw kernelError('invalid-argument', `symmetry axis must be 'x', 'y' or 'z', got ${String(map.axis)}`);
  if (map.space !== 'world') {
    const n: [number, number, number] = [0, 0, 0];
    n[k] = 1;
    return { n, c: Number.isFinite(map.plane) ? map.plane : 0, g: [n[0], n[1], n[2]] };
  }
  // World: d(p) = w_k = Σ_j R_kj s_j p_j + t_k, S(p) = p − 2·d(p)·diag(1/s)·Rᵀ·e_k.
  let [x, y, z, w] = [placement.q[0] ?? 0, placement.q[1] ?? 0, placement.q[2] ?? 0, placement.q[3] ?? 1];
  const len = Math.hypot(x, y, z, w);
  if (!(len > 0) || !Number.isFinite(len)) [x, y, z, w] = [0, 0, 0, 1];
  else [x, y, z, w] = [x / len, y / len, z / len, w / len];
  const rows = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ][k] as number[];
  const n: [number, number, number] = [0, 0, 0];
  const g: [number, number, number] = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    const raw = placement.s[j] ?? 1;
    const sj = Math.abs(raw) < 1e-12 ? (raw < 0 ? -1e-12 : 1e-12) : raw;
    n[j] = (rows[j] as number) * sj;
    g[j] = (rows[j] as number) / sj;
  }
  return { n, c: -(placement.t[k] ?? 0), g };
}

/**
 * Symmetrizes the vertices of a region that is its own mirror (§5.14): each vertex v with partner u is set to the
 * mean of p(v) and S·p(u), and u to the mirror of that; a vertex that is its own partner is projected onto the plane;
 * a vertex without one (−1) keeps its position. Writes go through `setPosition` (the caller's transaction).
 */
export function symmetrizeVertices(
  m: EditMesh,
  verts: readonly number[],
  partner: (v: number) => number,
  mirror: Mirror,
): void {
  const done = new Set<number>();
  const p = m.position;
  const reflect = (x: number, y: number, z: number, scale: number): [number, number, number] => {
    const d = scale * (mirror.n[0] * x + mirror.n[1] * y + mirror.n[2] * z - mirror.c);
    return [x - d * mirror.g[0], y - d * mirror.g[1], z - d * mirror.g[2]];
  };
  for (const v of verts) {
    if (done.has(v)) continue;
    done.add(v);
    const u = partner(v);
    if (u < 0) continue;
    if (u === v) {
      const [x, y, z] = reflect(p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number, 1);
      m.setPosition(v, x, y, z);
      continue;
    }
    if (done.has(u)) continue;
    done.add(u);
    const s = reflect(p[3 * u] as number, p[3 * u + 1] as number, p[3 * u + 2] as number, 2);
    const x = 0.5 * ((p[3 * v] as number) + s[0]);
    const y = 0.5 * ((p[3 * v + 1] as number) + s[1]);
    const z = 0.5 * ((p[3 * v + 2] as number) + s[2]);
    m.setPosition(v, x, y, z);
    const back = reflect(x, y, z, 2);
    m.setPosition(u, back[0], back[1], back[2]);
  }
}
