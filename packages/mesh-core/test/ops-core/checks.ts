// The per-step property checks of B3's ops (M6A-SPEC §5.29): P1 (no `.topology` safety refusal on manifold input),
// P2, P3, P4, P6 and P7-hard around `runChecked` (P1 validity, P5, P8). Shared by the Node property run and the
// Chromium run; no Node APIs.
import { expect } from 'vitest';
import {
  BUILTIN_LAYERS,
  type EditMesh,
  editMeshFrom,
  groupLayer,
  isRefusal,
  morphLayer,
  topologyStats,
  writeRevision,
} from '../../src';
import { isAllHard } from '../../src/normals/hard';
import { signedVolume } from '../../src/testing';
import { type OpStep, resolveStep } from './steps';
import { ctxOf, op, runChecked, windingProblems } from './support';

const KEEPS_EULER = new Set(['mesh.extrude', 'mesh.inset', 'mesh.insertLoop', 'mesh.offsetLoop', 'mesh.connect']);
const MANIFOLD = new Set(['mesh.extrude', 'mesh.inset', 'mesh.insertLoop']);
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
  // P3, and P4's outward volume (a closed outward mesh stays positive under outward-only steps).
  if (closedBefore && MANIFOLD.has(step.id)) expect(closedManifold(m), `${step.id}: closed manifold`).toBe(true);
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
