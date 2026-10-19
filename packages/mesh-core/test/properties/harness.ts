// The kernel's property harness (M6A-SPEC §5.29), shared by the Node run (`*.test.ts`) and the Chromium run
// (`*.browser.test.ts`): no Node APIs here.
//
// `checkStep` runs one Euler step in its own transaction and checks, after it:
// - P1: a refusal (`EkzaError('mesh-euler')`) leaves the mesh bit-identical; otherwise `end()` passes the debug
//   validation (setup turns it on) and `validateMesh` finds nothing;
// - the count oracle of the step (the model);
// - canonical edit links: the edited mesh traverses exactly like `editMeshFrom(snapshot())`;
// - the remap: survivors map one-to-one onto [0, createdFrom), positions and face materials travel with them;
// - the dirty set: every element whose stored values or layers changed (below both counts) is listed;
// - P8: the incremental revision (`previous` + `dirty`) has the full write's manifest id, and reads back exactly;
// - P5: `apply(delta, 'backward')` restores the stored arrays and every edit link bit-identically, `forward`
//   re-yields the after-state.
// Comparisons run on typed arrays (`diffStored`, `linkArray`), so 500-step sequences stay fast.
import { expect } from 'vitest';
import {
  type DirtySet,
  type EditMesh,
  editMeshFrom,
  type MeshData,
  type MeshDelta,
  readRevision,
  validateMesh,
  writeRevision,
} from '../../src';
import { diffStored, type EulerStep, firstDifference, linkArray, resolveEulerStep } from '../../src/testing';

export interface StepTally {
  applied: number;
  refused: number;
  skipped: number;
}

export function newTally(): StepTally {
  return { applied: 0, refused: 0, skipped: 0 };
}

function errorCode(error: unknown): string | undefined {
  return (error as { readonly code?: string } | null)?.code;
}

type Domain = 'point' | 'edge' | 'face' | 'corner';
const DOMAINS: readonly Domain[] = ['point', 'edge', 'face', 'corner'];
const countOf = (counts: MeshData['counts'], d: Domain): number =>
  d === 'point' ? counts.points : d === 'edge' ? counts.edges : d === 'face' ? counts.faces : counts.corners;

type Values = ArrayLike<number>;

/** The stored arrays and layers of a domain with their values per element. */
function domainArrays(data: MeshData, d: Domain): (readonly [Values, number])[] {
  const out: (readonly [Values, number])[] = [];
  if (d === 'point') out.push([data.position, 3]);
  if (d === 'edge') out.push([data.edgeVerts, 2], [data.edgeFlags, 1]);
  if (d === 'face') out.push([data.faceCorner, 1], [data.faceMaterial, 1], [data.faceFlags, 1]);
  if (d === 'corner') out.push([data.cornerVert, 1], [data.cornerNext, 1]);
  for (const layer of data.layers.values()) if (layer.def.domain === d) out.push([layer.data, layer.def.comps]);
  return out;
}

function dirtyList(dirty: DirtySet, d: Domain): Uint32Array | 'all' {
  return d === 'point' ? dirty.points : d === 'edge' ? dirty.edges : d === 'face' ? dirty.faces : dirty.corners;
}

function fail(label: string, what: string): never {
  throw new Error(`${label}: ${what}`);
}

function checkRemap(before: MeshData, after: MeshData, delta: MeshDelta, label: string): void {
  for (const d of DOMAINS) {
    const remap = delta.remap[d];
    const nb = countOf(before.counts, d);
    const na = countOf(after.counts, d);
    if (remap.createdFrom > na) fail(label, `${d} createdFrom ${remap.createdFrom} > ${na}`);
    if (remap.forward === null) {
      if (remap.createdFrom !== nb) fail(label, `${d} createdFrom ${remap.createdFrom} without removals (${nb})`);
      continue;
    }
    if (remap.forward.length !== nb) fail(label, `${d} forward has ${remap.forward.length} entries, not ${nb}`);
    const hit = new Uint8Array(remap.createdFrom);
    let removed = 0;
    for (let i = 0; i < nb; i++) {
      const j = remap.forward[i] as number;
      if (j === -1) {
        removed++;
        continue;
      }
      if (j >= remap.createdFrom || hit[j] === 1) fail(label, `${d} ${i} → ${j}`);
      hit[j] = 1;
    }
    if (nb - removed !== remap.createdFrom) fail(label, `${d} survivors ${nb - removed} ≠ ${remap.createdFrom}`);
  }
  // Positions travel with their vertices; materials with their faces (no Euler operator changes either).
  if (!label.startsWith('setPosition')) {
    const f = delta.remap.point.forward;
    for (let i = 0; i < before.counts.points; i++) {
      const j = f === null ? i : (f[i] as number);
      if (j === -1) continue;
      for (let k = 0; k < 3; k++) {
        if (!Object.is(after.position[3 * j + k], before.position[3 * i + k])) fail(label, `position ${i}→${j}`);
      }
    }
  }
  const ff = delta.remap.face.forward;
  for (let i = 0; i < before.counts.faces; i++) {
    const j = ff === null ? i : (ff[i] as number);
    if (j !== -1 && after.faceMaterial[j] !== before.faceMaterial[i]) fail(label, `material ${i}→${j}`);
  }
}

function checkDirty(before: MeshData, after: MeshData, delta: MeshDelta, label: string): void {
  const sameLayers = [...before.layers.keys()].join('|') === [...after.layers.keys()].join('|');
  for (const d of DOMAINS) {
    const list = dirtyList(delta.dirty, d);
    if (list === 'all' || !sameLayers) continue;
    const set = new Set(list);
    const n = Math.min(countOf(before.counts, d), countOf(after.counts, d));
    const a = domainArrays(before, d);
    const b = domainArrays(after, d);
    for (let i = 0; i < n; i++) {
      let changed = false;
      for (let k = 0; k < a.length && !changed; k++) {
        const [x, stride] = a[k] as readonly [Values, number];
        const [y] = b[k] as readonly [Values, number];
        for (let s = 0; s < stride; s++) if (!Object.is(x[i * stride + s], y[i * stride + s])) changed = true;
      }
      if (changed && !set.has(i)) fail(label, `${d} ${i} changed but is not dirty`);
    }
  }
  const c1 = before.counts;
  const c2 = after.counts;
  const changedCounts =
    c1.points !== c2.points || c1.edges !== c2.edges || c1.faces !== c2.faces || c1.corners !== c2.corners;
  if (changedCounts && !delta.dirty.topology) fail(label, 'counts changed without dirty.topology');
}

type Revision = ReturnType<typeof writeRevision>;

/** P8: the incremental write equals the full write; the full write reads back exactly. Returns the full write. */
function checkRevision(m: EditMesh, previous: Revision, delta: MeshDelta, label: string): Revision {
  const full = writeRevision(m);
  const incremental = writeRevision(m, { previous: previous.manifest, dirty: delta.dirty });
  if (incremental.manifestId !== full.manifestId) fail(label, 'incremental revision ≠ full revision');
  const blobs = new Map([...previous.newChunks, ...full.newChunks, ...incremental.newChunks]);
  const back = readRevision(full.manifest, (id) => {
    const bytes = blobs.get(id);
    if (bytes === undefined) throw new Error(`missing chunk ${id}`);
    return bytes;
  });
  const diff = diffStored(back, m);
  if (diff !== null) fail(label, `read back: ${diff}`);
  return full;
}

/**
 * Runs one step on `m` with every check above; `previous` is the revision of `m` before the step (it must hold every
 * chunk of that revision: the first call passes a full write). Returns the revision after the step.
 */
export function checkStep(m: EditMesh, step: EulerStep, tally: StepTally, previous: Revision): Revision {
  const resolved = resolveEulerStep(m, step);
  if (resolved === null) {
    tally.skipped++;
    return previous;
  }
  const label = resolved.label;
  const before = m.snapshot();
  const beforeLinks = linkArray(m);
  m.begin(label);
  try {
    resolved.run();
  } catch (error) {
    if (errorCode(error) !== 'mesh-euler') {
      m.abort();
      throw error;
    }
    m.end();
    tally.refused++;
    const diff = diffStored(m, before);
    if (diff !== null) fail(label, `a refusal changed the mesh: ${diff}`);
    if (firstDifference(linkArray(m), beforeLinks) !== -1) fail(label, 'a refusal changed the links');
    return previous;
  }
  const delta = m.end();
  tally.applied++;
  const problems = validateMesh(m);
  if (problems.length > 0) fail(label, problems.map((p) => p.message).join('; '));
  expect({ ...m.counts }, `${label}: counts`).toEqual(resolved.expect);
  const after = m.snapshot();
  const afterLinks = linkArray(m);
  const canonical = firstDifference(afterLinks, linkArray(editMeshFrom(after)));
  if (canonical !== -1) fail(label, `links differ from editMeshFrom(snapshot()) at ${canonical}`);
  checkRemap(before, after, delta, label);
  checkDirty(before, after, delta, label);
  const revision = checkRevision(m, previous, delta, label);
  m.apply(delta, 'backward');
  const undo = diffStored(m, before);
  if (undo !== null) fail(label, `undo: ${undo}`);
  if (firstDifference(linkArray(m), beforeLinks) !== -1) fail(label, 'undo links');
  m.apply(delta, 'forward');
  const redo = diffStored(m, after);
  if (redo !== null) fail(label, `redo: ${redo}`);
  if (firstDifference(linkArray(m), afterLinks) !== -1) fail(label, 'redo links');
  return revision;
}

/** Runs a whole step sequence from `start`; returns the final mesh and the tally. */
export function checkSequence(start: MeshData, steps: readonly EulerStep[]): { mesh: EditMesh; tally: StepTally } {
  const m = editMeshFrom(start);
  const tally = newTally();
  let revision = writeRevision(m);
  for (const step of steps) revision = checkStep(m, step, tally, revision);
  return { mesh: m, tally };
}
