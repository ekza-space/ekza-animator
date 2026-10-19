// The per-step property checks of B3's ops (M6A-SPEC §5.29): P1 (no `.topology` safety refusal on manifold input),
// P2, P3, P4, P6 and P7-hard around `runChecked` (P1 validity, P5, P8). Shared by the Node property run and the
// Chromium run; no Node APIs.
import { expect } from 'vitest';
import { type EditMesh, editMeshFrom, isRefusal, topologyStats, writeRevision } from '../../src';
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
