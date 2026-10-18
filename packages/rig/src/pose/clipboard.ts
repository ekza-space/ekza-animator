import { eulerNear, eulerToQuat, type RotateOrder } from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId, ControlRecord, RigRecord, TrsChannel } from '@ekza-animator/doc';
import { internalsOf } from '../kernel/internals';
import { mirrorChannels } from '../mirror/mirrorPose';
import { SLOT_CHANNELS } from '../sampler/channels';
import type { PoseClipboard, RigProgram } from '../types';

const ROTATE_ORDERS: ReadonlySet<string> = new Set(['xyz', 'yzx', 'zxy', 'xzy', 'yxz', 'zyx']);

/** Finite TRS channel values only. */
function trsValues(values: ChannelValues): ChannelValues {
  const out: ChannelValues = {};
  for (const channel of SLOT_CHANNELS) {
    const value = values[channel];
    if (value !== undefined && Number.isFinite(value)) out[channel] = value;
  }
  return out;
}

/**
 * Finite values of the control's keyable custom attributes ('@name', M2A-SPEC §5.8), except `keyAll: false` ones
 * (modes and settings such as `ikFk` and `soft` travel only when named explicitly, §5.1 rule 4).
 */
function attrValues(control: ControlRecord, values: ChannelValues): ChannelValues {
  const out: ChannelValues = {};
  const attrs = control.attrs;
  if (typeof attrs !== 'object' || attrs === null) return out;
  for (const [name, def] of Object.entries(attrs)) {
    if (typeof def !== 'object' || def === null || def.keyable === false || def.keyAll === false) continue;
    const value = values[`@${name}`];
    if (value !== undefined && Number.isFinite(value)) out[`@${name}`] = value;
  }
  return out;
}

/**
 * Pose clipboard payload (research 07 §17): channel values and rotate order per control template key, so a pose
 * pastes onto any rig with the same template (e.g. another humanoid). Controls follow the program's slot order.
 */
export function makePoseClipboard(
  program: RigProgram,
  rig: RigRecord,
  values: ReadonlyMap<ControlId, ChannelValues>,
): PoseClipboard {
  const controls: Record<string, { readonly values: ChannelValues; readonly order: RotateOrder }> = {};
  program.controls.forEach((control) => {
    const pose = values.get(control.id);
    if (pose === undefined) return;
    controls[control.key] = {
      values: { ...trsValues(pose), ...attrValues(control, pose) },
      order: control.rotateOrder,
    };
  });
  return {
    kind: 'ekza.pose',
    version: 1,
    rig: { id: rig.id, fingerprint: rig.skeleton.fingerprint, generator: rig.generator.name },
    controls,
  };
}

/**
 * Channel values to paste from a pose clipboard (keyable channels and attributes of the target controls only). Controls match by
 * template key; a rotate order that differs from the clipboard's is converted (same rotation, nearest triple).
 * `mirrored` pastes each control's mirror image onto its counterpart (centre controls mirror in place, unpaired
 * sided controls are skipped). Malformed payloads give an empty map.
 */
export function applyPoseClipboard(
  clip: PoseClipboard,
  program: RigProgram,
  mode: 'local' | 'mirrored',
): Map<ControlId, ChannelValues> {
  const result = new Map<ControlId, ChannelValues>();
  if (clip === null || typeof clip !== 'object' || clip.kind !== 'ekza.pose' || typeof clip.controls !== 'object') {
    return result;
  }
  const internals = internalsOf(program);
  const slotByKey = new Map<string, number>();
  internals.controls.forEach((control, slot) => slotByKey.set(control.key, slot));

  for (const [key, entry] of Object.entries(clip.controls)) {
    const slot = slotByKey.get(key);
    if (slot === undefined || entry === null || typeof entry !== 'object' || typeof entry.values !== 'object') continue;
    const target0 = internals.controls[slot] as ControlRecord;
    const values = { ...trsValues(entry.values), ...attrValues(target0, entry.values) };
    const order = internals.rotateOrders[slot] ?? 'xyz';
    if (ROTATE_ORDERS.has(entry.order) && entry.order !== order) {
      const e = eulerNear(eulerToQuat([values.rx ?? 0, values.ry ?? 0, values.rz ?? 0], entry.order), order, [
        values.rx ?? 0,
        values.ry ?? 0,
        values.rz ?? 0,
      ]);
      values.rx = e[0];
      values.ry = e[1];
      values.rz = e[2];
    }
    if (mode === 'local') {
      result.set(target0.id, { ...keyableOnly(internals.keyable, slot, values), ...attrValues(target0, values) });
      continue;
    }
    const target = target0.side === 'C' ? slot : (internals.mirror[slot] as number);
    if (target === -1) continue;
    const mirrored = mirrorChannels(internals, slot, target, values, undefined);
    // Attributes the clipboard did not carry (keyAll: false ones) are not pasted.
    const targetControl = internals.controls[target] as ControlRecord;
    for (const key of Object.keys(mirrored)) {
      if (key.startsWith('@') && values[key as `@${string}`] === undefined) delete mirrored[key as `@${string}`];
    }
    result.set(targetControl.id, mirrored);
  }
  return result;
}

function keyableOnly(keyable: Uint8Array, slot: number, values: ChannelValues): ChannelValues {
  const out: ChannelValues = {};
  SLOT_CHANNELS.forEach((channel: TrsChannel, k) => {
    const value = values[channel];
    if (keyable[slot * 9 + k] === 1 && value !== undefined) out[channel] = value;
  });
  return out;
}
