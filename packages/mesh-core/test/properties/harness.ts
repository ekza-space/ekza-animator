// The kernel's property harness (M6A-SPEC §5.29), shared by the Node run (`*.test.ts`) and the Chromium run
// (`*.browser.test.ts`): no Node APIs here.
//
// `checkStep` runs one Euler step in its own transaction; `checkTransaction` runs 2…n steps (layer events included)
// in one transaction, the way real ops compose the Euler operators. Both check, after the transaction:
// - P1: a refusal (`EkzaError('mesh-euler')`) leaves the mesh bit-identical; otherwise `end()` passes the debug
//   validation (setup turns it on) and `validateMesh` finds nothing;
// - the count oracle of every step (the model);
// - canonical edit links: the edited mesh traverses exactly like `editMeshFrom(snapshot())`;
// - dead slots: every slot past a count holds its dead value (0, −1, the layer default), the kernel invariant that
//   makes deltas replay on any mesh in the same state;
// - the remap: survivors map one-to-one onto [0, createdFrom), positions and face materials travel with them;
// - the dirty set: every element whose stored values or layers changed (below both counts) is listed;
// - P8: the incremental revision (`previous` + `dirty`) has the full write's manifest id, and reads back exactly —
//   after the transaction and again after its undo;
// - P5: `apply(delta, 'backward')` restores the stored arrays and every edit link bit-identically, `forward`
//   re-yields the after-state — on the same mesh, on a runtime rebuilt from the after-state (undo after leaving and
//   re-entering component mode, §5.5) and on one rebuilt from the before-state (redo);
// - `checkTransaction` also aborts the transaction first (exact) and re-runs it (the same result: an op's outcome
//   never depends on the mesh's history).
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
import { KernelMesh } from '../../src/core/mesh';
import { storedValue } from '../../src/layers/arrays';
import {
  T_CE,
  T_CF,
  T_CN,
  T_CP,
  T_CR,
  T_CV,
  T_DN,
  T_EC,
  T_EF,
  T_EV,
  T_FC,
  T_FF,
  T_FM,
  T_POS,
  T_VE,
  TARGET_DEAD,
} from '../../src/log/log';
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

function checkRemap(before: MeshData, after: MeshData, delta: MeshDelta, label: string, moved: boolean): void {
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
  if (!moved) {
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

/**
 * The first dead slot (past its count, up to the capacity) of a kernel mesh that does not hold its dead value, or
 * null. Dead slots are canonical so that the arrays are a pure function of the live state (../../src/core/mesh.ts).
 */
export function deadSlotProblem(m: EditMesh): string | null {
  if (!(m instanceof KernelMesh)) return null;
  const builtins: readonly (readonly [string, ArrayLike<number>, number, number, number])[] = [
    ['position', m.pos, T_POS, 0, 3],
    ['edgeVerts', m.ev, T_EV, 1, 2],
    ['edgeFlags', m.ef, T_EF, 1, 1],
    ['cornerVert', m.cv, T_CV, 3, 1],
    ['cornerNext', m.cn, T_CN, 3, 1],
    ['faceCorner', m.fc, T_FC, 2, 1],
    ['faceMaterial', m.fm, T_FM, 2, 1],
    ['faceFlags', m.ff, T_FF, 2, 1],
    ['vertEdge', m.ve, T_VE, 0, 1],
    ['edgeDisk', m.dn, T_DN, 1, 2],
    ['edgeCorner', m.ec, T_EC, 1, 1],
    ['cornerPrev', m.cp, T_CP, 3, 1],
    ['cornerEdge', m.ce, T_CE, 3, 1],
    ['cornerFace', m.cf, T_CF, 3, 1],
    ['cornerRadial', m.cr, T_CR, 3, 1],
  ];
  for (const [name, array, tid, domain, stride] of builtins) {
    const dead = TARGET_DEAD[tid] as number;
    for (let i = m.count(domain) * stride; i < array.length; i++) {
      if (!Object.is(array[i], dead)) return `${name}[${i}] = ${array[i]} past the count (dead value ${dead})`;
    }
  }
  for (const store of m.layerList) {
    const { comps, type } = store.def;
    const data = store.data;
    for (let i = m.count(store.domain) * comps; i < data.length; i++) {
      const dead = storedValue(type, store.def.default[i % comps] ?? 0);
      if (!Object.is(data[i], dead)) {
        return `layer ${store.def.name}[${i}] = ${data[i]} past the count (default ${dead})`;
      }
    }
  }
  return null;
}

function checkDead(m: EditMesh, label: string, when: string): void {
  const problem = deadSlotProblem(m);
  if (problem !== null) fail(label, `${when}: ${problem}`);
}

/** Stored arrays and edit links of `m` equal `state` and `links`; dead slots are canonical. */
function checkState(m: EditMesh, state: MeshData, links: Int32Array, label: string, when: string): void {
  const diff = diffStored(m, state);
  if (diff !== null) fail(label, `${when}: ${diff}`);
  const at = firstDifference(linkArray(m), links);
  if (at !== -1) fail(label, `${when}: links differ at ${at}`);
  checkDead(m, label, when);
}

/**
 * P5 after `end()`: undo and redo on the same mesh, undo on a runtime rebuilt from the after-state, redo on one rebuilt
 * from the before-state; P8 after the undo (the incremental write from the after revision gives the before id).
 */
function checkApply(
  m: EditMesh,
  delta: MeshDelta,
  states: { before: MeshData; beforeLinks: Int32Array; after: MeshData; afterLinks: Int32Array },
  revisions: { before: Revision; after: Revision },
  label: string,
): void {
  const { before, beforeLinks, after, afterLinks } = states;
  m.apply(delta, 'backward');
  checkState(m, before, beforeLinks, label, 'undo');
  const back = writeRevision(m, { previous: revisions.after.manifest, dirty: delta.dirty });
  if (back.manifestId !== revisions.before.manifestId) fail(label, 'undo: incremental revision ≠ the before revision');
  m.apply(delta, 'forward');
  checkState(m, after, afterLinks, label, 'redo');
  const rebuiltAfter = editMeshFrom(after);
  rebuiltAfter.apply(delta, 'backward');
  checkState(rebuiltAfter, before, beforeLinks, label, 'undo on a rebuilt runtime');
  rebuiltAfter.apply(delta, 'forward');
  checkState(rebuiltAfter, after, afterLinks, label, 'redo on a rebuilt runtime');
  const rebuiltBefore = editMeshFrom(before);
  rebuiltBefore.apply(delta, 'forward');
  checkState(rebuiltBefore, after, afterLinks, label, 'redo on a runtime rebuilt from the before-state');
}

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
    checkState(m, before, beforeLinks, label, 'a refusal');
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
  checkDead(m, label, 'after');
  checkRemap(before, after, delta, label, label.startsWith('setPosition'));
  checkDirty(before, after, delta, label);
  const revision = checkRevision(m, previous, delta, label);
  checkApply(m, delta, { before, beforeLinks, after, afterLinks }, { before: previous, after: revision }, label);
  return revision;
}

/**
 * Runs `steps` inside one transaction on `m` (refused steps are skipped, as an op would handle them): first aborted
 * (exact), then re-run (the same result) and committed, with every check above. `previous` is the full revision of
 * `m`; returns the full revision after the transaction.
 */
export function checkTransaction(
  m: EditMesh,
  steps: readonly EulerStep[],
  tally: StepTally,
  previous: Revision,
): Revision {
  const label = `transaction of ${steps.length} steps`;
  const before = m.snapshot();
  const beforeLinks = linkArray(m);
  let moved = false;
  const labels: string[] = [];
  const run = (count: boolean): void => {
    labels.length = 0;
    for (const step of steps) {
      const resolved = resolveEulerStep(m, step);
      if (resolved === null) {
        if (count) tally.skipped++;
        continue;
      }
      const counts = { ...m.counts };
      try {
        resolved.run();
      } catch (error) {
        if (errorCode(error) !== 'mesh-euler') throw error;
        if (count) tally.refused++;
        expect({ ...m.counts }, `${label}, ${resolved.label} (refused): counts`).toEqual(counts);
        continue;
      }
      labels.push(resolved.label);
      if (count) tally.applied++;
      if (step.op === 'setPosition') moved = true;
      expect({ ...m.counts }, `${label}, ${resolved.label}: counts`).toEqual(resolved.expect);
    }
  };
  const where = (): string => `${label} [${labels.join('; ')}]`;
  m.begin(label);
  try {
    run(false);
  } catch (error) {
    m.abort();
    throw error;
  }
  const aborted = m.snapshot();
  const abortedLinks = linkArray(m);
  m.abort();
  checkState(m, before, beforeLinks, where(), 'abort');
  if (validateMesh(m).length > 0) fail(where(), 'abort left an invalid mesh');
  m.begin(label);
  try {
    run(true);
  } catch (error) {
    m.abort();
    throw error;
  }
  const delta = m.end();
  const at = where();
  checkState(m, aborted, abortedLinks, at, 're-run after the abort');
  const problems = validateMesh(m);
  if (problems.length > 0) fail(at, problems.map((p) => p.message).join('; '));
  const after = m.snapshot();
  const afterLinks = linkArray(m);
  const canonical = firstDifference(afterLinks, linkArray(editMeshFrom(after)));
  if (canonical !== -1) fail(at, `links differ from editMeshFrom(snapshot()) at ${canonical}`);
  checkRemap(before, after, delta, at, moved);
  checkDirty(before, after, delta, at);
  const revision = checkRevision(m, previous, delta, at);
  checkApply(m, delta, { before, beforeLinks, after, afterLinks }, { before: previous, after: revision }, at);
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

/** Runs a sequence of multi-step transactions from `start`; returns the final mesh and the tally. */
export function checkTransactions(
  start: MeshData,
  transactions: readonly (readonly EulerStep[])[],
): { mesh: EditMesh; tally: StepTally } {
  const m = editMeshFrom(start);
  const tally = newTally();
  let revision = writeRevision(m);
  for (const steps of transactions) revision = checkTransaction(m, steps, tally, revision);
  return { mesh: m, tally };
}
