// B13's op harness (M6A-SPEC §5.1, §5.29): runs one `MeshOp` the way the runtime does (poll, begin, run, end; abort on
// a refusal) and checks P1 (a refusal leaves the mesh bit-identical, a result validates), P5 (backward restores the
// stored arrays and links exactly, forward re-yields the result, also on runtimes rebuilt from either state) and P8
// (the incremental revision equals the full one). Also: hand-built symmetry maps by mirrored centroids (B2's
// `buildSymmetryMap` is not on this branch; the paint ops read only `face` partners).
import type { ParamValues } from '@ekza-animator/anim-core';
import {
  BitSet,
  type ComponentSelection,
  type EditMesh,
  editMeshFrom,
  type HiddenSet,
  isRefusal,
  type MeshData,
  type MeshDelta,
  type MeshOp,
  type OpContext,
  type OpResult,
  type Refusal,
  type SymmetryMap,
  validateMesh,
  writeRevision,
} from '../../../src';
import { diffStored, firstDifference, linkArray } from '../../../src/testing';

export function ctxOf(patch: Partial<OpContext> = {}): OpContext {
  return {
    symmetry: null,
    hidden: null,
    placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    faceted: true,
    soft: null,
    curves: { compile: () => ({}) as never, evaluate: () => 0 },
    epsilon: 1e-9,
    ...patch,
  };
}

export interface Ran {
  readonly result: OpResult | Refusal;
  readonly delta: MeshDelta | null;
  readonly before: MeshData;
}

function fail(label: string, what: string): never {
  throw new Error(`${label}: ${what}`);
}

export function runChecked(
  op: MeshOp,
  m: EditMesh,
  sel: ComponentSelection | null,
  args: ParamValues,
  ctx: OpContext = ctxOf(),
): Ran {
  const label = `${op.id} ${JSON.stringify(args)}`;
  const before = m.snapshot();
  const beforeLinks = linkArray(m);
  const previous = writeRevision(m);
  const verdict = op.poll(m, sel, ctx);
  if (verdict !== true) return { result: verdict, delta: null, before };
  m.begin(op.id);
  let result: OpResult | Refusal;
  try {
    result = op.run(m, sel, args, ctx);
  } catch (error) {
    m.abort();
    throw error;
  }
  if (isRefusal(result)) {
    m.abort();
    const diff = diffStored(m, before);
    if (diff !== null) fail(label, `a refusal changed the mesh: ${diff}`);
    if (firstDifference(linkArray(m), beforeLinks) !== -1) fail(label, 'a refusal changed the edit links');
    return { result, delta: null, before };
  }
  const delta = m.end();
  const problems = validateMesh(m);
  if (problems.length > 0) fail(label, problems.map((p) => p.message).join('; '));
  const after = m.snapshot();
  const afterLinks = linkArray(m);
  const full = writeRevision(m);
  const incremental = writeRevision(m, { previous: previous.manifest, dirty: delta.dirty });
  if (incremental.manifestId !== full.manifestId) fail(label, 'incremental revision ≠ full revision');
  const check = (mesh: EditMesh, state: MeshData, links: Int32Array, when: string): void => {
    const diff = diffStored(mesh, state);
    if (diff !== null) fail(label, `${when}: ${diff}`);
    if (firstDifference(linkArray(mesh), links) !== -1) fail(label, `${when}: links differ`);
  };
  m.apply(delta, 'backward');
  check(m, before, beforeLinks, 'undo');
  m.apply(delta, 'forward');
  check(m, after, afterLinks, 'redo');
  const rebuiltAfter = editMeshFrom(after);
  rebuiltAfter.apply(delta, 'backward');
  check(rebuiltAfter, before, beforeLinks, 'undo on a rebuilt runtime');
  const rebuiltBefore = editMeshFrom(before);
  rebuiltBefore.apply(delta, 'forward');
  check(rebuiltBefore, after, afterLinks, 'redo on a rebuilt runtime');
  return { result, delta, before };
}

export function ok(ran: Ran): OpResult {
  if (isRefusal(ran.result)) throw new Error(`refused: ${ran.result.code} ${ran.result.reason}`);
  return ran.result;
}

/** The paint layer's values (slot per face; 0 without the layer). */
export function slots(m: EditMesh | MeshData): number[] {
  const layer = 'layer' in m ? m.layer('paint') : m.layers.get('paint');
  const out: number[] = [];
  for (let f = 0; f < m.counts.faces; f++) {
    out.push(layer === undefined ? 0 : 'get' in layer ? layer.get(f, 0) : (layer.data[f] as number));
  }
  return out;
}

/** Centroid of a face. */
export function centroid(m: EditMesh, f: number): [number, number, number] {
  const c = [0, 0, 0] as [number, number, number];
  let n = 0;
  const first = m.faceCorner(f);
  let k = first;
  do {
    const v = m.cornerVert(k);
    for (let i = 0; i < 3; i++) c[i] = (c[i] as number) + (m.position[3 * v + i] as number);
    n += 1;
    k = m.cornerNext(k);
  } while (k !== first);
  return [c[0] / n, c[1] / n, c[2] / n];
}

/** An X-mirror map by vertex positions and face centroids (within `tol`); edges unmapped. */
export function mirrorMapX(m: EditMesh, tol = 1e-6, dropFaces: readonly number[] = []): SymmetryMap {
  const vertex = new Int32Array(m.counts.points).fill(-1);
  for (let a = 0; a < m.counts.points; a++) {
    for (let b = 0; b < m.counts.points; b++) {
      const p = m.position;
      if (
        Math.abs((p[3 * a] as number) + (p[3 * b] as number)) <= tol &&
        Math.abs((p[3 * a + 1] as number) - (p[3 * b + 1] as number)) <= tol &&
        Math.abs((p[3 * a + 2] as number) - (p[3 * b + 2] as number)) <= tol
      ) {
        vertex[a] = b;
        break;
      }
    }
  }
  const face = new Int32Array(m.counts.faces).fill(-1);
  const cs = Array.from({ length: m.counts.faces }, (_, f) => centroid(m, f));
  for (let a = 0; a < m.counts.faces; a++) {
    const ca = cs[a] as [number, number, number];
    for (let b = 0; b < m.counts.faces; b++) {
      const cb = cs[b] as [number, number, number];
      if (Math.abs(ca[0] + cb[0]) <= tol && Math.abs(ca[1] - cb[1]) <= tol && Math.abs(ca[2] - cb[2]) <= tol) {
        face[a] = b;
        break;
      }
    }
  }
  for (const f of dropFaces) {
    const partner = face[f] as number;
    face[f] = -1;
    if (partner >= 0) face[partner] = -1;
  }
  return {
    axis: 'x',
    space: 'object',
    plane: 0,
    tolerance: tol,
    vertex,
    edge: new Int32Array(m.counts.edges).fill(-1),
    edgeReversed: new Uint8Array(m.counts.edges),
    edgeSelf: new Uint8Array(m.counts.edges),
    face,
    unmatched: 0,
  };
}

/** A hidden set with the given faces hidden. */
export function hiddenFaces(m: EditMesh, faces: readonly number[]): HiddenSet {
  const set = new BitSet(m.counts.faces);
  for (const f of faces) set.add(f);
  return { verts: new BitSet(m.counts.points), edges: new BitSet(m.counts.edges), faces: set };
}
