// Shared plumbing of the edit kernel: clip frames, base layers, curve views over a transaction.
import { type AnimCurve, type CompiledAnimCurve, EkzaError, type Frame, type KeyData } from '@ekza-animator/anim-core';
import type {
  ClipId,
  ClipRecord,
  CurveId,
  CurveRecord,
  KeyRecord,
  LayerRecord,
  ReadView,
  Tx,
} from '@ekza-animator/doc';
import { internalsOf, newRecordId } from '../app/internals';
import { clipFrameAt, sceneFpsOf } from '../evaluation/time';
import type { EditorApp } from '../types';

/** Two keys closer than this share a frame (§4.11.1, §4.11.3). */
export const SAME_FRAME_EPS = 1e-6;

export function requireClip(view: ReadView, clip: ClipId): ClipRecord {
  const record = view.get('clips', clip);
  if (record === undefined) throw new EkzaError('invalid-record', `Clip ${clip} does not exist`);
  return record;
}

export function requireCurve(view: ReadView, curve: CurveId): CurveRecord {
  const record = view.get('curves', curve);
  if (record === undefined) throw new EkzaError('invalid-record', `Curve ${curve} does not exist`);
  return record;
}

/** The clip frame `clip` shows at the session's current scene frame (wrapped or clamped like evaluation). */
export function currentClipFrame(app: EditorApp, view: ReadView, clip: ClipRecord): Frame {
  return clipFrameAt(internalsOf(app).deps, sceneFpsOf(view), clip, app.session.getState().time.sceneFrame);
}

/** The clip's base layer; a clip without one gets one (repair, never an error). */
export function ensureBaseLayer(app: EditorApp, tx: Tx, clip: ClipId): LayerRecord {
  const existing = tx.query.baseLayer(clip);
  if (existing !== undefined) return existing;
  const layer: LayerRecord = {
    id: newRecordId(app, 'layer'),
    clip,
    name: 'Base',
    mode: 'override',
    weight: 1,
    mute: false,
    solo: false,
    owner: null,
    order: 'a0',
    deleted: null,
  };
  tx.put('layers', layer);
  return layer;
}

export function animCurve(curve: CurveRecord, keys: readonly KeyData[]): AnimCurve {
  return { keys, weighted: curve.weighted, pre: curve.pre, post: curve.post };
}

/** The curve's keys as seen by the transaction, compiled with the app's curve engine. */
export function compileInTx(
  app: EditorApp,
  tx: ReadView,
  curve: CurveRecord,
): { readonly keys: readonly KeyRecord[]; readonly compiled: CompiledAnimCurve } {
  const keys = tx.query.keysOfCurve(curve.id);
  return { keys, compiled: internalsOf(app).deps.curves.engine.compile(animCurve(curve, keys)) };
}

/** The KeyData fields of a key (what anim-core reads and returns). */
export function keyDataOf(key: KeyData): KeyData {
  const data: KeyData = {
    t: key.t,
    v: key.v,
    inType: key.inType,
    outType: key.outType,
    inHandle: key.inHandle,
    outHandle: key.outHandle,
    broken: key.broken,
    weightLocked: key.weightLocked,
  };
  return key.breakdown === undefined ? data : { ...data, breakdown: key.breakdown };
}

export function sameKeyData(a: KeyData, b: KeyData): boolean {
  return (
    a.t === b.t &&
    a.v === b.v &&
    a.inType === b.inType &&
    a.outType === b.outType &&
    a.inHandle.dt === b.inHandle.dt &&
    a.inHandle.dv === b.inHandle.dv &&
    a.outHandle.dt === b.outHandle.dt &&
    a.outHandle.dv === b.outHandle.dv &&
    a.broken === b.broken &&
    a.weightLocked === b.weightLocked &&
    a.breakdown === b.breakdown
  );
}
