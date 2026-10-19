// M6A-SPEC §5.29 properties of B3's ops on primitives with random divisions, random selections and random args, and
// on synthetic soups: P1 (a valid mesh or a refusal, never a throw; on manifold primitives never the `.topology`
// safety refusal), P2 (χ for the ops that keep it; Fill Hole +1 per hole), P3 (closed manifold stays closed manifold
// for the manifold-preserving ops), P4 (consistent winding; outward volume kept by outward-only steps), P5 and P8
// (inside `runChecked`: exact undo/redo on the same and rebuilt meshes, incremental revisions), P6 (the same step on
// a copy gives the same manifest), P7-hard (an all-hard mesh stays all-hard) — single steps and model-based sequences.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { editMeshFrom, isRefusal, primitive, topologyStats, writeRevision } from '../../src';
import { isAllHard } from '../../src/normals/hard';
import { arbPrimitive, arbSoup, signedVolume } from '../../src/testing';
import { arbOpStep, type OpStep, resolveStep } from './steps';
import { ctxOf, op, runChecked, windingProblems } from './support';

/** Heavier local runs: B3_PROPERTY_SCALE=10 multiplies every run count (report-only; CI runs scale 1). */
const SCALE = Math.max(1, Number(process.env['B3_PROPERTY_SCALE'] ?? '1') || 1);

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
function checkStep(m: ReturnType<typeof editMeshFrom>, step: OpStep, manifoldInput: boolean): boolean {
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
  // P4: consistent winding stays consistent.
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

describe('B3 properties on primitives (P1–P7)', () => {
  it('single steps', () => {
    let ran = 0;
    fc.assert(
      fc.property(arbPrimitive(), arbOpStep(), (prim, step) => {
        const m = editMeshFrom(primitive(prim.kind, prim.params));
        if (checkStep(m, step, true)) ran++;
      }),
      { numRuns: 600 * SCALE },
    );
    expect(ran).toBeGreaterThan(200);
  });

  it('model-based sequences of 10–60 steps', () => {
    let ran = 0;
    fc.assert(
      fc.property(arbPrimitive(), fc.array(arbOpStep(), { minLength: 10, maxLength: 60 }), (prim, steps) => {
        const m = editMeshFrom(primitive(prim.kind, prim.params));
        for (const step of steps) {
          // Later steps run on whatever the earlier ones made (merges may leave non-manifold edges).
          const manifold = topologyStats(m).nonManifoldEdges === 0 && topologyStats(m).nonManifoldVerts === 0;
          if (checkStep(m, step, manifold && step.id !== 'mesh.bridge')) ran++;
          if (m.counts.faces > 600) break;
        }
      }),
      { numRuns: 40 * SCALE },
    );
    expect(ran).toBeGreaterThan(100);
  });
});

describe('B3 refusal policy on synthetic soups (P1)', () => {
  it('a valid mesh or a refusal, never a throw', () => {
    fc.assert(
      fc.property(arbSoup({ maxVerts: 8, maxFaces: 8 }), arbOpStep(), (data, step) => {
        const m = editMeshFrom(data);
        checkStep(m, step, false);
      }),
      { numRuns: 400 * SCALE },
    );
  });
});
