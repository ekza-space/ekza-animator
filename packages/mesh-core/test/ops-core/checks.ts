// The per-step property checks of B3's ops (M6A-SPEC §5.29): P1 (no `.topology` safety refusal on manifold input),
// P2 (χ for every op that states it, the delete family included), P3, P4, P6 and P7-hard around `runChecked` (P1
// validity, P5, P8). Shared by the Node property run and the Chromium run; no Node APIs.
import { expect } from 'vitest';
import {
  BUILTIN_LAYERS,
  type ComponentSelection,
  type EditMesh,
  editMeshFrom,
  groupLayer,
  isRefusal,
  type MeshData,
  morphLayer,
  topologyStats,
  writeRevision,
} from '../../src';
import { isAllHard } from '../../src/normals/hard';
import { signedVolume } from '../../src/testing';
import { type OpStep, resolveStep } from './steps';
import { ctxOf, op, runChecked, windingProblems } from './support';

const KEEPS_EULER = new Set(['mesh.extrude', 'mesh.inset', 'mesh.insertLoop', 'mesh.offsetLoop', 'mesh.connect']);
/** P3: the `manifoldPreserving` ops of B3 (Bridge separately: two holes only). */
const MANIFOLD = new Set(['mesh.extrude', 'mesh.inset', 'mesh.insertLoop', 'mesh.offsetLoop', 'mesh.connect']);
const DELETES = new Set(['mesh.delete', 'mesh.deleteEdgeVertex']);
/** Merges may fold faces onto each other (allowed and reported, §5.1); P4 winding is checked on manifold input. */
const MERGES = new Set([
  'mesh.merge',
  'mesh.mergeToCenter',
  'mesh.mergeByDistance',
  'mesh.targetWeld',
  'mesh.collapse',
]);

function closedManifold(m: Parameters<typeof topologyStats>[0]): boolean {
  const s = topologyStats(m);
  return s.boundaryLoops === 0 && s.nonManifoldEdges === 0 && s.nonManifoldVerts === 0;
}

/** The faces at vertex `v` (distinct). */
function vertFaceSet(m: EditMesh, v: number): Set<number> {
  const faces = new Set<number>();
  const first = m.vertEdge(v);
  if (first === -1) return faces;
  let e = first;
  let guard = 0;
  do {
    const start = m.edgeCorner(e);
    if (start !== -1) {
      let c = start;
      do {
        faces.add(m.cornerFace(c));
        c = m.cornerRadialNext(c);
      } while (c !== start);
    }
    e = m.edgeDiskNext(e, v);
  } while (e !== first && e !== -1 && ++guard <= m.counts.edges);
  return faces;
}

function edgeFaceList(m: EditMesh, e: number): number[] {
  const faces: number[] = [];
  const start = m.edgeCorner(e);
  if (start === -1) return faces;
  let c = start;
  do {
    faces.push(m.cornerFace(c));
    c = m.cornerRadialNext(c);
  } while (c !== start);
  return faces;
}

/** The χ that deleting the faces `gone` (and every edge and vertex only they use) takes away: |F| − |E| + |V|. */
function eulerOfDeletion(m: EditMesh, gone: ReadonlySet<number>): number {
  if (gone.size === 0) return 0;
  let edges = 0;
  for (let e = 0; e < m.counts.edges; e++) {
    const faces = edgeFaceList(m, e);
    if (faces.length > 0 && faces.every((f) => gone.has(f))) edges++;
  }
  let verts = 0;
  for (let v = 0; v < m.counts.points; v++) {
    const faces = vertFaceSet(m, v);
    if (faces.size > 0 && [...faces].every((f) => gone.has(f))) verts++;
  }
  return gone.size - edges + verts;
}

/**
 * P2 for the delete family (§5.29: "dissolve of a manifold edge or valence-2 vertex" keeps χ; "delete face χ − 1 plus
 * removed loose elements"), on manifold input without loose elements (else null): the χ a successful run must leave.
 * - Face mode: χ − (faces − the edges and vertices only they used).
 * - Edge mode: interior edges dissolve (χ kept, as do Delete Edge/Vertex's valence-2 dissolves); plain Delete removes
 *   a border edge's face with every face joined to it across selected interior edges — a face deletion of that set.
 * - Vertex mode: plain Delete dissolves winged vertices (χ kept); Delete Edge/Vertex merges each vertex's faces into
 *   one polygon over a disc (χ kept), and a shell whose every vertex is selected goes (its own χ is taken away).
 */
export function expectedDeleteEuler(data: MeshData, id: string, selection: ComponentSelection): number | null {
  const m = editMeshFrom(data);
  const stats = topologyStats(m);
  if (stats.nonManifoldEdges > 0 || stats.nonManifoldVerts > 0) return null;
  for (let e = 0; e < m.counts.edges; e++) if (m.edgeFaceCount(e) === 0) return null;
  for (let v = 0; v < m.counts.points; v++) if (m.vertEdge(v) === -1) return null;
  // A face that visits a vertex twice (a soup) is not a manifold surface either.
  for (let f = 0; f < m.counts.faces; f++) {
    const start = m.faceCorner(f);
    const seen = new Set<number>();
    let c = start;
    do {
      if (seen.has(m.cornerVert(c))) return null;
      seen.add(m.cornerVert(c));
      c = m.cornerNext(c);
    } while (c !== start);
  }
  const kind = selection.kind;
  const picked = Array.from(
    (kind === 'vertex' ? selection.verts : kind === 'edge' ? selection.edges : selection.faces).toArray(),
  );
  if (kind === 'face') return stats.euler - eulerOfDeletion(m, new Set(picked));
  if (kind === 'edge') {
    const chosen = new Set(picked);
    const gone = new Set<number>();
    const queue: number[] = [];
    const reach = (f: number): void => {
      if (gone.has(f)) return;
      gone.add(f);
      queue.push(f);
    };
    for (const e of picked) if (m.edgeFaceCount(e) === 1) edgeFaceList(m, e).forEach(reach);
    while (queue.length > 0) {
      const f = queue.pop() as number;
      const start = m.faceCorner(f);
      let c = start;
      do {
        const e = m.cornerEdge(c);
        if (chosen.has(e) && m.edgeFaceCount(e) === 2) edgeFaceList(m, e).forEach(reach);
        c = m.cornerNext(c);
      } while (c !== start);
    }
    return stats.euler - eulerOfDeletion(m, gone);
  }
  if (id === 'mesh.delete') return stats.euler;
  // Shells (vertices joined by edges) whose every vertex is selected.
  const parent = Int32Array.from({ length: m.counts.points }, (_, i) => i);
  const find = (v: number): number => {
    let r = v;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  for (let e = 0; e < m.counts.edges; e++) {
    const a = find(m.edgeVert(e, 0));
    const b = find(m.edgeVert(e, 1));
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  }
  const chosen = new Set(picked);
  const whole = new Set<number>();
  for (let v = 0; v < m.counts.points; v++) whole.add(find(v));
  for (let v = 0; v < m.counts.points; v++) if (!chosen.has(v)) whole.delete(find(v));
  const gone = new Set<number>();
  for (let f = 0; f < m.counts.faces; f++) if (whole.has(find(m.cornerVert(m.faceCorner(f))))) gone.add(f);
  return stats.euler - eulerOfDeletion(m, gone);
}

/** Whether `loops` (Bridge's resolved arg) are two closed chains of border edges of `data`. */
export function closedLoops(data: MeshData, loops: unknown): boolean {
  if (!Array.isArray(loops) || loops.length !== 2) return false;
  const m = editMeshFrom(data);
  return loops.every((list) => {
    if (!Array.isArray(list) || list.length < 3) return false;
    const degree = new Map<number, number>();
    for (const e of list as number[]) {
      if (m.edgeFaceCount(e) !== 1) return false;
      for (const k of [0, 1] as const) degree.set(m.edgeVert(e, k), (degree.get(m.edgeVert(e, k)) ?? 0) + 1);
    }
    return [...degree.values()].every((d) => d === 2) && degree.size === list.length;
  });
}

/** Runs one step with every per-step property; returns whether it ran. */
export function checkStep(m: EditMesh, step: OpStep, manifoldInput: boolean): boolean {
  const resolved = resolveStep(m, step);
  if (resolved === null) return false;
  const before = m.snapshot();
  const statsBefore = topologyStats(m);
  const closedBefore = closedManifold(m);
  const hardBefore = isAllHard(m);
  const volumeBefore = closedBefore ? signedVolume(m) : 0;
  const windingBefore = windingProblems(m).length;
  const { result } = runChecked(m, op(step.id), resolved.selection, resolved.args, ctxOf());
  if (isRefusal(result)) {
    if (manifoldInput) expect(result.code.endsWith('.topology'), `${step.id}: ${result.reason}`).toBe(false);
    return false;
  }
  // P6: the same step on a copy of the input gives the same mesh.
  const copy = editMeshFrom(before);
  const again = resolveStep(copy, step);
  copy.begin(step.id);
  const second = op(step.id).run(copy, again?.selection ?? null, again?.args ?? {}, ctxOf());
  if (isRefusal(second)) copy.abort();
  else copy.end();
  expect(writeRevision(copy).manifestId, `${step.id}: determinism`).toBe(writeRevision(m).manifestId);
  // P7-hard.
  if (hardBefore) expect(isAllHard(m), `${step.id}: all-hard`).toBe(true);
  // P4: consistent winding on manifold input stays consistent; a merge that folds faces says so (§5.1).
  if (windingBefore === 0 && statsBefore.nonManifoldEdges === 0) {
    const problems = windingProblems(m);
    if (MERGES.has(step.id)) {
      expect(problems.length === 0 || result.warnings.some((w) => w.code === 'merge.non-manifold')).toBe(true);
    } else expect(problems, `${step.id}: winding`).toEqual([]);
  }
  // P2.
  const statsAfter = topologyStats(m);
  if (KEEPS_EULER.has(step.id)) expect(statsAfter.euler, `${step.id}: χ`).toBe(statsBefore.euler);
  if (step.id === 'mesh.fillHole') {
    expect(statsAfter.euler - statsBefore.euler, `${step.id}: χ`).toBe(result.selection.faces.count());
  }
  // P2 for Bridge: two closed border loops bridged by an annulus keep χ and lower the boundary-loop count by 2 (a strip
  // over existing edges says so with `bridge.non-manifold`).
  const manifoldStrip = !result.warnings.some((w) => w.code === 'bridge.non-manifold');
  if (
    step.id === 'mesh.bridge' &&
    step.kind === 'edge' &&
    manifoldStrip &&
    closedLoops(before, result.resolvedArgs['loops'])
  ) {
    expect(statsAfter.euler, `${step.id}: χ`).toBe(statsBefore.euler);
    expect(statsAfter.boundaryLoops, `${step.id}: boundary loops`).toBe(statsBefore.boundaryLoops - 2);
  }
  // P2 for the delete family (expand symmetry is off here: the selection is the expanded one).
  if (DELETES.has(step.id) && resolved.selection !== null) {
    const expected = expectedDeleteEuler(before, step.id, resolved.selection);
    if (expected !== null) expect(statsAfter.euler, `${step.id} (${step.kind}): χ`).toBe(expected);
  }
  // P3, and P4's outward volume (a closed outward mesh stays positive under outward-only steps). Dissolves (every
  // delete but a face deletion) keep a closed manifold closed too: each merged polygon spans a disc.
  if (closedBefore && MANIFOLD.has(step.id)) expect(closedManifold(m), `${step.id}: closed manifold`).toBe(true);
  if (closedBefore && DELETES.has(step.id) && step.kind !== 'face') {
    expect(closedManifold(m), `${step.id} (${step.kind}): closed manifold`).toBe(true);
  }
  if (volumeBefore > 1e-6 && step.outward && closedManifold(m)) {
    expect(signedVolume(m), `${step.id}: volume`).toBeGreaterThan(0);
  }
  return true;
}

// ---------- P7 propagation on layered meshes ----------

/** The value ranges a layered mesh starts with (§5.2: every rule copies, interpolates or averages, never invents). */
export interface LayerEnvelope {
  readonly morph: readonly [number, number];
  readonly bits: number;
  readonly joints: ReadonlySet<number>;
  readonly paint: ReadonlySet<number>;
  readonly uv: readonly (readonly [number, number])[];
}

/** Adds a morph, a point bit group and a skin to `m` and spreads paint slots over its faces (one transaction). */
export function addTestLayers(m: EditMesh, salt: number): void {
  m.begin('layers');
  const morph = m.addLayer(morphLayer('M'));
  const bits = m.addLayer(groupLayer('B', 'point', 'bit'));
  const joints = m.addLayer(BUILTIN_LAYERS.skinJoints);
  const weights = m.addLayer(BUILTIN_LAYERS.skinWeights);
  const paint = m.addLayer(BUILTIN_LAYERS.paint);
  for (let v = 0; v < m.counts.points; v++) {
    const h = (v * 7919 + salt) % 97;
    morph.set(v, 0, h / 10);
    bits.set(v, 0, 1 << (h % 8));
    for (let k = 0; k < 4; k++) joints.set(v, k, (h + 3 * k) % 9);
    const raw = [(h % 5) + 1, (h % 3) + 1, h % 2, 1];
    const sum = raw.reduce((s, x) => s + x, 0);
    for (let k = 1; k < 4; k++) weights.set(v, k, (raw[k] as number) / sum);
    weights.set(v, 0, 1 - ((raw[1] as number) + (raw[2] as number) + (raw[3] as number)) / sum);
  }
  for (let f = 0; f < m.counts.faces; f++) paint.set(f, 0, (f * 31 + salt) % 7);
  m.end();
}

export function layerEnvelope(m: EditMesh): LayerEnvelope {
  const morph = m.layer('morph:M');
  const bits = m.layer('group:B');
  const joints = m.layer(BUILTIN_LAYERS.skinJoints.name);
  const paint = m.layer(BUILTIN_LAYERS.paint.name);
  const uv = m.layer(BUILTIN_LAYERS.uv0.name);
  let lo = Infinity;
  let hi = -Infinity;
  let union = 0;
  const jointSet = new Set<number>();
  for (let v = 0; v < m.counts.points; v++) {
    const x = morph?.get(v, 0) ?? 0;
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
    union |= bits?.get(v, 0) ?? 0;
    for (let k = 0; k < 4; k++) jointSet.add(joints?.get(v, k) ?? 0);
  }
  const slots = new Set<number>();
  for (let f = 0; f < m.counts.faces; f++) slots.add(paint?.get(f, 0) ?? 0);
  const ranges: [number, number][] = [];
  if (uv !== undefined) {
    for (let k = 0; k < uv.def.comps; k++) {
      let a = Infinity;
      let b = -Infinity;
      for (let c = 0; c < m.counts.corners; c++) {
        a = Math.min(a, uv.get(c, k));
        b = Math.max(b, uv.get(c, k));
      }
      ranges.push([a, b]);
    }
  }
  return { morph: [lo, hi], bits: union, joints: jointSet, paint: slots, uv: ranges };
}

/** P7: every value stays inside the starting envelope; skin weights are ≥ 0, sum to 1 and name known joints. */
export function layerProblems(m: EditMesh, env: LayerEnvelope): string[] {
  const problems: string[] = [];
  const morph = m.layer('morph:M');
  const bits = m.layer('group:B');
  const joints = m.layer(BUILTIN_LAYERS.skinJoints.name);
  const weights = m.layer(BUILTIN_LAYERS.skinWeights.name);
  const paint = m.layer(BUILTIN_LAYERS.paint.name);
  const uv = m.layer(BUILTIN_LAYERS.uv0.name);
  const tol = 1e-5;
  for (let v = 0; v < m.counts.points; v++) {
    const x = morph?.get(v, 0) ?? 0;
    if (x < env.morph[0] - tol || x > env.morph[1] + tol) problems.push(`morph of vertex ${v}: ${x}`);
    const b = bits?.get(v, 0) ?? 0;
    if ((b | env.bits) !== env.bits) problems.push(`bits of vertex ${v}: ${b}`);
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights?.get(v, k) ?? 0;
      sum += w;
      if (w < -1e-7) problems.push(`negative weight at vertex ${v}`);
      if (w > 0 && !env.joints.has(joints?.get(v, k) ?? -1)) problems.push(`unknown joint at vertex ${v}`);
    }
    if (weights !== undefined && Math.abs(sum - 1) > 1e-5) problems.push(`weights of vertex ${v} sum to ${sum}`);
  }
  for (let f = 0; f < m.counts.faces; f++) {
    const slot = paint?.get(f, 0) ?? 0;
    if (!env.paint.has(slot)) problems.push(`paint slot ${slot} on face ${f}`);
  }
  if (uv !== undefined) {
    for (let c = 0; c < m.counts.corners; c++) {
      for (let k = 0; k < uv.def.comps; k++) {
        const x = uv.get(c, k);
        const range = env.uv[k] as readonly [number, number];
        if (x < range[0] - tol || x > range[1] + tol) problems.push(`uv of corner ${c}: ${x}`);
      }
    }
  }
  return problems;
}
