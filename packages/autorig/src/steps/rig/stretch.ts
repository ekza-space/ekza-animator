// How much *Straighten to T-Pose* stretched the model (AUTORIG-SPEC §5.4; AR-R4-3, the owner's call on round 4's
// arms-down Wang). Straightening bakes the bound meshes into the T-pose by linear blend skinning: from an A-pose the
// shoulders turn 35° and the sleeves follow; from arms held down (an I-pose with the arm markers placed by hand) they
// turn 90° and the jacket between arm and body tears, while every Validation row passes. So ③ measures the bake: the
// longest edge of the straightened meshes against its length before, and when an edge grew more than `STRETCH_LIMIT`
// times, ③ shows "Arms were straightened from arms-down…" instead of *All good*, for as long as the meshes keep the
// straightened points (a rebind keeps them; an undo of the straighten brings the old points back and the row goes).
// The I-pose itself is not fixed (Studio's weight painting is the way). U state in the `rig` slice; nothing here writes
// the document.
import type { CharacterId, MeshId } from '@ekza-studio/doc';
import { autoRigBindMeshes, type EditorApp } from '@ekza-studio/editor-core';
import { resolveSubject } from '../../progress';
import type { WizardContext } from '../../shell/context';

/** The straighten's undo label (A0's `STRAIGHTEN_LABEL`). */
const STRAIGHTEN = 'Straighten to T-Pose';

/**
 * An edge longer than this many times its length before the straighten tears the surface. Calibrated on round 4's
 * models (AR-R4-3): Polybot and Wang straightened from their A-poses stretch at most ~1.6×; Wang's arms-down I-pose
 * with hand-placed arm markers stretches the jacket under the arms ~4×.
 */
export const STRETCH_LIMIT = 2;

/** What the stretch measure reads of a mesh revision. */
export interface StretchData {
  readonly position: Float32Array;
  readonly edgeVerts: Uint32Array;
}

/** The longest edge of `after` over its length in `before` (same topology), or 1 for another topology. */
export function edgeStretch(before: StretchData, after: StretchData): number {
  if (before.edgeVerts.length !== after.edgeVerts.length || before.position.length !== after.position.length) return 1;
  const p0 = before.position;
  const p1 = after.position;
  const e = after.edgeVerts;
  let worst = 1;
  // edges shorter than this before the bake are seams and slivers: their ratio says nothing about the surface
  let longest = 0;
  for (let i = 0; i < e.length; i += 2) {
    const a = 3 * (e[i] as number);
    const b = 3 * (e[i + 1] as number);
    longest = Math.max(
      longest,
      Math.hypot(
        (p0[a] as number) - (p0[b] as number),
        (p0[a + 1] as number) - (p0[b + 1] as number),
        (p0[a + 2] as number) - (p0[b + 2] as number),
      ),
    );
  }
  const floor = 1e-3 * longest;
  for (let i = 0; i < e.length; i += 2) {
    const a = 3 * (e[i] as number);
    const b = 3 * (e[i + 1] as number);
    const l0 = Math.hypot(
      (p0[a] as number) - (p0[b] as number),
      (p0[a + 1] as number) - (p0[b + 1] as number),
      (p0[a + 2] as number) - (p0[b + 2] as number),
    );
    if (l0 <= floor) continue;
    const l1 = Math.hypot(
      (p1[a] as number) - (p1[b] as number),
      (p1[a + 1] as number) - (p1[b + 1] as number),
      (p1[a + 2] as number) - (p1[b + 2] as number),
    );
    if (l1 / l0 > worst) worst = l1 / l0;
  }
  return worst;
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

/** The largest stretch over the meshes present before and after. */
function stretchOf(before: ReadonlyMap<MeshId, StretchData>, after: ReadonlyMap<MeshId, StretchData>): number {
  let worst = 1;
  for (const [id, data] of after) {
    const old = before.get(id);
    if (old !== undefined && old !== data) worst = Math.max(worst, edgeStretch(old, data));
  }
  return worst;
}

/** Resolves once the mesh runtimes hold the revisions the last transaction wrote (they take them a tick later). */
async function meshesSettled(app: EditorApp): Promise<void> {
  const meshes = app.meshes as { readonly settled?: () => Promise<void> };
  if (typeof meshes.settled === 'function') await meshes.settled();
}

/**
 * Watches the history while a run may straighten (the Auto-rig composition, *Bind again*, the `skel.tpose` row's Fix,
 * or while ③ is open): the points before each step are kept, and when *Straighten to T-Pose* lands on top the stretch
 * it made is recorded in the `rig` slice once the meshes hold the baked points (`torn` with the straightened points'
 * key, or null when it stayed within `STRETCH_LIMIT`). Resolves `done()` when the last measure was recorded. The
 * disposer stops it.
 */
export function watchStraighten(ctx: Pick<WizardContext, 'app' | 'session'>): {
  readonly stop: () => void;
  readonly done: () => Promise<void>;
} {
  const { app, session } = ctx;
  const character = (): CharacterId | null =>
    resolveSubject(app.store, session.getState().subject).character?.id ?? null;
  let before = boundData(app, character());
  let top = app.history.peekUndo()?.id ?? null;
  let pending: Promise<void> = Promise.resolve();
  const stop = app.history.subscribe(() => {
    const step = app.history.peekUndo();
    const now = boundData(app, character());
    if (step !== null && step.id !== top && step.label === STRAIGHTEN) {
      const snapshot = before;
      pending = meshesSettled(app).then(() => {
        const ratio = stretchOf(snapshot, boundData(app, character()));
        session.patch('rig', {
          torn: ratio > STRETCH_LIMIT ? { key: pointsKey(app, character()) ?? '', ratio } : null,
        });
      });
    }
    top = step?.id ?? null;
    // a mesh whose runtime has not caught up keeps its last known points
    before = new Map([...before, ...now]);
  });
  return { stop, done: () => pending };
}
