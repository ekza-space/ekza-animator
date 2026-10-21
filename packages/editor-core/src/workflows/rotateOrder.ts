// Pose-preserving rotate-order change (MVP-SPEC §4.11.5, M1-stretch; FR-RIG-08): in every clip and layer of the
// character, the control's rx/ry/rz curves are resampled at the union of their key times, converted to the new order
// (rig `convertRotateOrderKeysWith`: `eulerNear` against the previous sample, then the Euler filter) and written back
// on all three curves, synchronized. Static values and pose overrides are converted as a triple. The curves are
// sampled with the editor's engine (`deps.curves.engine`, cycle-aware on cyclic curves, M2A-SPEC §5.23), so the values
// converted between a curve's keys are the values the editor evaluates and draws.
import { type AnimCurve, eulerNear, eulerToQuat, type RotateOrder, type Vec3 } from '@ekza-studio/anim-core';
import type {
  ChannelValues,
  ClipRecord,
  ControlRecord,
  CurveId,
  CurveRecord,
  KeyRecord,
  LayerRecord,
  Tx,
} from '@ekza-studio/doc';
import { convertRotateOrderKeysWith } from '@ekza-studio/rig';
import { internalsOf, newRecordId } from '../app/internals';
import { animCurve, keyDataOf } from '../edit/context';
import { ensureCurve } from '../edit/keys';
import type { EditorApp } from '../types';
import { curveRecord, keyRecord } from './records';
import { constantCurve } from './util';

const ROTATIONS = ['rx', 'ry', 'rz'] as const;
const SAME_VALUE = 1e-12;

/** The same rotation in another order, nearest to the old triple. */
export function convertTriple(values: Vec3, from: RotateOrder, to: RotateOrder): Vec3 {
  return eulerNear(eulerToQuat(values, from), to, values);
}

/**
 * The control's channel curve in a layer, created (base or not) when missing. A created curve takes the pre and post
 * infinities of the control's first existing rotation curve in that layer (rx, ry, rz order), so the three converted
 * curves extrapolate alike and the converted pose holds outside the keyed range as it did before (a sibling with
 * `constant` infinities on a clip whose `loop` was turned on later stays `constant`). Only without such a curve does a
 * base-layer curve follow the loop-clip rule of `ensureCurve` (M2A-SPEC §5.23, M2A-A0-11). The converter always has a
 * sibling: it creates a curve only next to a keyed or static one.
 */
function curveIn(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  layer: LayerRecord,
  control: ControlRecord,
  axis: number,
): CurveId {
  const channel = ROTATIONS[axis] as (typeof ROTATIONS)[number];
  const existing = tx.query.curveFor(clip.id, layer.id, control.id, channel);
  if (existing !== undefined) return existing.id;
  const sibling = ROTATIONS.filter((other) => other !== channel)
    .map((other) => tx.query.curveFor(clip.id, layer.id, control.id, other))
    .find((curve) => curve !== undefined);
  if (sibling === undefined && tx.query.baseLayer(clip.id)?.id === layer.id) {
    return ensureCurve(app, tx, clip.id, control.id, channel);
  }
  const curve: CurveRecord = {
    ...curveRecord({ id: newRecordId(app, 'curve'), clip: clip.id, layer: layer.id, control: control.id, channel }),
    ...(sibling === undefined ? {} : { pre: sibling.pre, post: sibling.post }),
  };
  tx.put('curves', curve);
  return curve.id;
}

function convertLayer(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  layer: LayerRecord,
  control: ControlRecord,
  from: RotateOrder,
  to: RotateOrder,
): void {
  const curves: (CurveRecord | undefined)[] = ROTATIONS.map((channel) =>
    tx.query.curveFor(clip.id, layer.id, control.id, channel),
  );
  const keys: (readonly KeyRecord[])[] = curves.map((curve) =>
    curve === undefined ? [] : tx.query.keysOfCurve(curve.id),
  );
  const statics = curves.map((curve) => curve?.staticValue ?? 0) as Vec3;
  if (keys.every((list) => list.length === 0)) {
    if (curves.every((curve) => curve === undefined || curve.staticValue === null)) return;
    const next = convertTriple(statics, from, to);
    curves.forEach((curve, axis) => {
      const value = next[axis] as number;
      if (curve === undefined && Math.abs(value) <= SAME_VALUE) return;
      const id = curve?.id ?? curveIn(app, tx, clip, layer, control, axis);
      if (tx.get('curves', id)?.staticValue !== value) tx.patch('curves', id, { staticValue: value });
    });
    return;
  }
  let first = Number.POSITIVE_INFINITY;
  for (const list of keys) for (const key of list) first = Math.min(first, key.t);
  const input = curves.map((curve, axis) => {
    const list = keys[axis] as readonly KeyRecord[];
    return curve === undefined || list.length === 0
      ? constantCurve(first, statics[axis] as number)
      : animCurve(curve, list.map(keyDataOf));
  }) as [AnimCurve, AnimCurve, AnimCurve];
  const converted = convertRotateOrderKeysWith(internalsOf(app).deps.curves.engine, input, from, to);
  converted.forEach((data, axis) => {
    const id = curveIn(app, tx, clip, layer, control, axis);
    for (const key of tx.query.keysOfCurve(id)) tx.remove('keys', key.id);
    for (const key of data) tx.put('keys', keyRecord(newRecordId(app, 'key'), clip.id, id, key));
  });
}

/** Converts every clip, layer and override of `control` to `to`, then sets its rotate order. */
export function changeRotateOrder(app: EditorApp, tx: Tx, control: ControlRecord, to: RotateOrder): void {
  const from = control.rotateOrder;
  if (from === to) return;
  const character = tx.get('rigs', control.rig)?.character;
  if (character !== undefined) {
    for (const clip of tx.query.clipsOfCharacter(character)) {
      for (const layer of tx.query.layersOfClip(clip.id)) convertLayer(app, tx, clip, layer, control, from, to);
    }
  }
  const overrides = app.session.getState().overrides;
  const override = overrides.get(control.id);
  if (override !== undefined && ROTATIONS.some((channel) => override[channel] !== undefined)) {
    const values = app.evaluation.channelValues(control.id);
    const next = convertTriple([values.rx, values.ry, values.rz], from, to);
    const updated: ChannelValues = { ...override, rx: next[0], ry: next[1], rz: next[2] };
    app.session.setState({ overrides: new Map(overrides).set(control.id, updated) });
  }
  tx.patch('controls', control.id, { rotateOrder: to });
}
