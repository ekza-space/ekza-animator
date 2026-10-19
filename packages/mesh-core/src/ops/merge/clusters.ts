// Merge groups for the merge family (M6A-SPEC §5.12, §5.14): distance clustering by union-find over an integer
// spatial hash (cell = the threshold; threshold 0 = coincident only), and the conversion of groups into a weld plan —
// each group becomes its first vertex (the caller orders members: pick order, then index) at the group's centroid
// (or the first vertex's position for a target weld); a group that is its own mirror has its centre snapped onto the
// mirror plane.
import type { EditMesh, OpWarning } from '../../types';
import type { Mirror } from '../extrude/shared/symmetry';
import { type V3, add, pos, scale } from '../extrude/shared/util';
import { type WeldPlan, type WeldResult, weld } from './weld';

/** Groups of `verts` (ascending) whose members are within `distance` of a neighbour (single linkage). */
export function clusterByDistance(m: EditMesh, verts: readonly number[], distance: number): number[][] {
  const parent = new Map<number, number>(verts.map((v) => [v, v]));
  const find = (v: number): number => {
    let r = v;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    let c = v;
    while (parent.get(c) !== r) {
      const next = parent.get(c) as number;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  const d = Math.max(0, distance);
  const cells = new Map<string, number[]>();
  const cellOf = (p: V3): [number, number, number] =>
    d > 0 ? [Math.floor(p[0] / d), Math.floor(p[1] / d), Math.floor(p[2] / d)] : [p[0], p[1], p[2]];
  for (const v of verts) {
    const p = pos(m, v);
    const [x, y, z] = cellOf(p);
    if (d > 0) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (const u of cells.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
              const q = pos(m, u);
              if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= d) union(u, v);
            }
          }
        }
      }
    } else {
      for (const u of cells.get(`${x},${y},${z}`) ?? []) union(u, v);
    }
    const key = `${x},${y},${z}`;
    const list = cells.get(key) ?? [];
    list.push(v);
    cells.set(key, list);
  }
  const groups = new Map<number, number[]>();
  for (const v of verts) {
    const r = find(v);
    const list = groups.get(r) ?? [];
    list.push(v);
    groups.set(r, list);
  }
  return [...groups.values()].sort((a, b) => (a[0] as number) - (b[0] as number));
}

/** Whether a group is its own mirror (every member's partner is a member). */
export function isSelfMirror(group: readonly number[], mirror: Mirror | null): boolean {
  if (mirror === null) return false;
  const set = new Set(group);
  return group.every((v) => {
    const p = mirror.partner('vertex', v);
    return p !== -1 && set.has(p);
  });
}

export interface MergeOutcome {
  readonly result: WeldResult;
  /** Final indices of the groups' representatives (ascending, removed ones dropped). */
  readonly reps: number[];
}

/**
 * Welds every group with ≥ 2 members into its first member: at the centroid (`'centroid'`, point layers averaged) or
 * at the first member's position (`'target'`, the target's layers); self-mirrored groups snap onto the plane.
 * `centerOf` overrides a group's position (Target Weld's midpoint mode).
 */
export function mergeGroups(
  m: EditMesh,
  groups: readonly (readonly number[])[],
  place: 'centroid' | 'target',
  mirror: Mirror | null,
  centerOf?: (group: readonly number[]) => V3 | null,
): MergeOutcome {
  const P = m.counts.points;
  const target = new Int32Array(P);
  for (let v = 0; v < P; v++) target[v] = v;
  const positions = new Map<number, V3>();
  const sources = new Map<number, readonly number[]>();
  const attributes = new Map<number, 'average' | 'target'>();
  const repsBefore: number[] = [];
  for (const group of groups) {
    const rep = group[0] as number;
    repsBefore.push(rep);
    if (group.length < 2) continue;
    for (const v of group) target[v] = rep;
    let p: V3 = pos(m, rep);
    const override = centerOf?.(group) ?? null;
    attributes.set(rep, place === 'target' && override === null ? 'target' : 'average');
    if (override !== null) p = override;
    else if (place === 'centroid') {
      let sum: V3 = [0, 0, 0];
      for (const v of group) sum = add(sum, pos(m, v));
      p = scale(sum, 1 / group.length);
    }
    if (isSelfMirror(group, mirror) && mirror !== null) p = mirror.project(p);
    positions.set(rep, p);
    sources.set(rep, group);
  }
  const plan: WeldPlan = { target, positions, sources, attributes };
  const result = weld(m, plan);
  const reps = [...new Set(repsBefore.map((v) => result.vertexMap[v] as number).filter((v) => v !== -1))].sort(
    (a, b) => a - b,
  );
  return { result, reps };
}

/** The `<op>.nothing`-style refusal sentence for groups that merge nothing. */
export function mergesAnything(groups: readonly (readonly number[])[]): boolean {
  return groups.some((g) => g.length > 1);
}

export function countWarning(code: string, removed: number): OpWarning[] {
  return [{ code, message: `${removed} vertex${removed === 1 ? '' : 'es'} merged`, count: removed }];
}
