// How much *Straighten to T-Pose* tore the model (AUTORIG-SPEC §5.4; AR-R4-3, the owner's call on round 4's arms-down
// Wang; moved from Auto-Rig ③ by T5b). Straightening bakes the bound meshes into the T-pose by linear blend skinning:
// from an A-pose the shoulders turn 35–50° and the sleeves follow; from arms held down (an I-pose with the arm markers
// placed by hand) they turn 90° and the jacket between arm and body tears, while every Validation row passes. So the
// flow measures the bake: the length the straightened edges grew beyond twice their length before
// (Σ max(0, l₁ − 2·l₀)), over the character's height. Above `STRETCH_LIMIT` the shells warn ("Arms were straightened
// from arms-down…") instead of *All good*, for as long as the meshes keep the straightened points (a rebind keeps them;
// an undo of the straighten brings the old points back and the warning goes). U state (`straightened`); nothing here
// writes the document.
import type { CharacterId, MeshId } from '@ekza-studio/doc';
import { autoRigBindMeshes } from '../operators/builtin/rig/wizard/targets';
import type { EditorApp } from '../types';
import type { AutoRigStraightened } from './host';

/** The straighten's undo label (A0's `STRAIGHTEN_LABEL`). */
const STRAIGHTEN = 'Straighten to T-Pose';

/**
 * The torn length, in heights, above which ③ warns. Calibrated on round 4's models (AR-R4-3, measured on the bake):
 * Polybot's A-pose 0 (no edge doubles), Wang's 50° A-pose 0.016 H (two cap edges of an arm), Wang's arms-down I-pose
 * with hand-placed arm markers 7.2 H (138 edges, the jacket a quarter of its edges).
 */
export const STRETCH_LIMIT = 0.25;

/** What the stretch measure reads of a mesh revision. */
export interface StretchData {
  readonly position: Float32Array;
  readonly edgeVerts: Uint32Array;
}

const edgeLength = (p: Float32Array, a: number, b: number): number =>
  Math.hypot(
    (p[a] as number) - (p[b] as number),
    (p[a + 1] as number) - (p[b + 1] as number),
    (p[a + 2] as number) - (p[b + 2] as number),
  );

/** The length the edges of `after` grew beyond twice their length in `before` (same topology; 0 for another one). */
export function tornLength(before: StretchData, after: StretchData): number {
  if (before.edgeVerts.length !== after.edgeVerts.length || before.position.length !== after.position.length) return 0;
  const e = after.edgeVerts;
  let torn = 0;
  for (let i = 0; i < e.length; i += 2) {
    const a = 3 * (e[i] as number);
    const b = 3 * (e[i + 1] as number);
    torn += Math.max(0, edgeLength(after.position, a, b) - 2 * edgeLength(before.position, a, b));
  }
  return torn;
}

/** The height of a set of meshes (their points' y extent). */
function heightOf(meshes: Iterable<StretchData>): number {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const data of meshes) {
    for (let i = 1; i < data.position.length; i += 3) {
      const y = data.position[i] as number;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return hi > lo ? hi - lo : 0;
}

/** The bound meshes of a character and their resident revisions. */
function boundData(app: EditorApp, character: CharacterId | null): Map<MeshId, StretchData> {
  const out = new Map<MeshId, StretchData>();
  if (character === null) return out;
  for (const mesh of autoRigBindMeshes(app, character)) {
    const data = app.meshes.get(mesh)?.data() ?? null;
    if (data !== null) out.set(mesh, data);
  }
  return out;
}

/** A fingerprint of the character's points (FNV-1a over the position bits of its meshes, in id order). */
export function pointsKey(app: EditorApp, character: CharacterId | null): string | null {
  const data = boundData(app, character);
  if (data.size === 0) return null;
  let hash = 0x811c9dc5;
  for (const id of [...data.keys()].sort()) {
    const position = (data.get(id) as StretchData).position;
    const bits = new Uint32Array(position.buffer, position.byteOffset, position.length);
    for (let i = 0; i < bits.length; i++) hash = Math.imul(hash ^ (bits[i] as number), 0x01000193) >>> 0;
  }
  return `${data.size}:${hash.toString(36)}`;
}

/** The torn length over the meshes present before and after, in heights of the character. */
export function tornShare(before: ReadonlyMap<MeshId, StretchData>, after: ReadonlyMap<MeshId, StretchData>): number {
  let torn = 0;
  for (const [id, data] of after) {
    const old = before.get(id);
    if (old !== undefined && old !== data) torn += tornLength(old, data);
  }
  const height = heightOf(after.values());
  return height > 0 ? torn / height : 0;
}

/** Resolves once the mesh runtimes hold the revisions the last transaction wrote (they take them a tick later). */
async function meshesSettled(app: EditorApp): Promise<void> {
  const meshes = app.meshes as { readonly settled?: () => Promise<void> };
  if (typeof meshes.settled === 'function') await meshes.settled();
}

/**
 * Watches the history while a run may straighten (the rig composition, *Bind again*, the `skel.tpose` row's Fix, or
 * while ③ is open): the points before each step are kept, and when *Straighten to T-Pose* lands on top the stretch it
 * made is reported to `record` once the meshes hold the baked points (the straightened points' key and the torn
 * length in heights). `character()` names the subject character now. Resolves `done()` when the last measure was
 * recorded; `stop()` ends the watch.
 */
export function watchStraighten(
  app: EditorApp,
  character: () => CharacterId | null,
  record: (straightened: AutoRigStraightened) => void,
): { readonly stop: () => void; readonly done: () => Promise<void> } {
  let before = boundData(app, character());
  let top = app.history.peekUndo()?.id ?? null;
  let pending: Promise<void> = Promise.resolve();
  const stop = app.history.subscribe(() => {
    const step = app.history.peekUndo();
    const now = boundData(app, character());
    if (step !== null && step.id !== top && step.label === STRAIGHTEN) {
      const snapshot = before;
      pending = meshesSettled(app).then(() => {
        const ratio = tornShare(snapshot, boundData(app, character()));
        record({ key: pointsKey(app, character()) ?? '', ratio });
      });
    }
    top = step?.id ?? null;
    // a mesh whose runtime has not caught up keeps its last known points
    before = new Map([...before, ...now]);
  });
  return { stop, done: () => pending };
}

/** Whether the shells warn (AR-R4-3): the last straighten tore beyond the limit and the points are still those. */
export function tornNow(
  app: EditorApp,
  character: CharacterId | null,
  straightened: AutoRigStraightened | null,
): boolean {
  return straightened !== null && straightened.ratio > STRETCH_LIMIT && pointsKey(app, character) === straightened.key;
}
