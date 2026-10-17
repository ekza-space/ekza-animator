import {
  eulerNear,
  eulerToQuat,
  mirrorQuatYZ,
  type Quat,
  quatInvert,
  quatMultiply,
  quatRotateVec3,
  type ReadonlyQuat,
  type RotateOrder,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId, ControlRecord } from '@ekza-animator/doc';
import { internalsOf, type RigInternals } from '../kernel/internals';
import { SLOT_CHANNELS } from '../sampler/channels';
import type { MirrorMode, RigProgram } from '../types';

// Mirror pose (MVP-SPEC §4.11.20, research 07 §16). The mirror plane is the character's YZ plane. World-aligned
// controls mirror their channels directly: rx, −ry, −rz and −tx, ty, tz (rotate-order independent, an exact
// involution). Controls with other rest frames (generic and secondary controls) mirror their local transform in
// character axes: L' = R'⁻¹ · M · (R · L · R⁻¹) · M · R', R and R' being the two controls' rest rotations.

const ALIGNED_EPSILON = 1e-9;

function restRotation(internals: RigInternals, slot: number): Quat {
  const q = internals.controlRest.q;
  return [q[slot * 4] as number, q[slot * 4 + 1] as number, q[slot * 4 + 2] as number, q[slot * 4 + 3] as number];
}

function isWorldAligned(q: ReadonlyQuat): boolean {
  return Math.abs(q[0]) < ALIGNED_EPSILON && Math.abs(q[1]) < ALIGNED_EPSILON && Math.abs(q[2]) < ALIGNED_EPSILON;
}

function full(values: ChannelValues | undefined): Required<Record<(typeof SLOT_CHANNELS)[number], number>> {
  return {
    tx: values?.tx ?? 0,
    ty: values?.ty ?? 0,
    tz: values?.tz ?? 0,
    rx: values?.rx ?? 0,
    ry: values?.ry ?? 0,
    rz: values?.rz ?? 0,
    sx: values?.sx ?? 1,
    sy: values?.sy ?? 1,
    sz: values?.sz ?? 1,
  };
}

/**
 * Mirrored channel values of the control at `from`, written for the control at `to` (which may be the same one):
 * only `to`'s keyable channels are returned.
 */
export function mirrorChannels(
  internals: RigInternals,
  from: number,
  to: number,
  values: ChannelValues | undefined,
  reference: ChannelValues | undefined,
): ChannelValues {
  const v = full(values);
  const rFrom = restRotation(internals, from);
  const rTo = restRotation(internals, to);
  let t: Vec3;
  let r: Vec3;
  if (isWorldAligned(rFrom) && isWorldAligned(rTo)) {
    // `0 − x` keeps zero channels at +0 (−0 would leak into documents and comparisons).
    t = [0 - v.tx, v.ty, v.tz];
    r = [v.rx, 0 - v.ry, 0 - v.rz];
  } else {
    // Character-axis local transform A = R · L · R⁻¹, reflected, then expressed in the target's rest frame.
    const orderFrom: RotateOrder = internals.rotateOrders[from] ?? 'xyz';
    const orderTo: RotateOrder = internals.rotateOrders[to] ?? 'xyz';
    const qL = eulerToQuat([v.rx, v.ry, v.rz], orderFrom);
    const qA = quatMultiply(quatMultiply(rFrom, qL), quatInvert(rFrom));
    const qB = mirrorQuatYZ(qA);
    const qL2 = quatMultiply(quatMultiply(quatInvert(rTo), qB), rTo);
    const tA = quatRotateVec3(rFrom, [v.tx, v.ty, v.tz]);
    t = quatRotateVec3(quatInvert(rTo), [0 - tA[0], tA[1], tA[2]]);
    const ref = full(reference);
    r = eulerNear(qL2, orderTo, [ref.rx, ref.ry, ref.rz]);
  }
  const all = [t[0], t[1], t[2], r[0], r[1], r[2], v.sx, v.sy, v.sz];
  const out: ChannelValues = {};
  for (let k = 0; k < 9; k++) {
    if (internals.keyable[to * 9 + k] === 1) out[SLOT_CHANNELS[k] as (typeof SLOT_CHANNELS)[number]] = all[k] as number;
  }
  return out;
}

/**
 * Mirrors a pose (§4.11.20). `values` holds the current channels per control (missing channels count as defaults);
 * `scope` (null: the whole character) is expanded to mirror pairs. `flip` swaps every pair with mirrored values and
 * mirrors centre controls onto themselves; `leftToRight` / `rightToLeft` copy one side's mirrored values onto the
 * other. Sided controls without a counterpart stay unchanged (with a warning). All reads come from `values` (a
 * snapshot), so the result does not depend on processing order. Returns the new keyable channels per written control.
 */
export function mirrorPose(
  program: RigProgram,
  values: ReadonlyMap<ControlId, ChannelValues>,
  mode: MirrorMode,
  scope: ReadonlySet<ControlId> | null,
): { readonly values: Map<ControlId, ChannelValues>; readonly warnings: readonly string[] } {
  const internals = internalsOf(program);
  const inScope = new Set<number>();
  for (let slot = 0; slot < internals.controlCount; slot++) {
    const control = internals.controls[slot] as ControlRecord;
    if (scope !== null && !scope.has(control.id)) continue;
    inScope.add(slot);
    const other = internals.mirror[slot] as number;
    if (other !== -1) inScope.add(other);
  }
  const result = new Map<ControlId, ChannelValues>();
  const warnings: string[] = [];
  for (const slot of [...inScope].sort((a, b) => a - b)) {
    const control = internals.controls[slot] as ControlRecord;
    const other = internals.mirror[slot] as number;
    const current = values.get(control.id);
    if (control.side === 'C' || other === slot) {
      if (mode === 'flip') result.set(control.id, mirrorChannels(internals, slot, slot, current, current));
      continue;
    }
    if (other === -1) {
      warnings.push(`${control.name} has no mirror counterpart and was left unchanged`);
      continue;
    }
    const source = internals.controls[other] as ControlRecord;
    const writes =
      mode === 'flip' ||
      (mode === 'leftToRight' && control.side === 'R' && source.side === 'L') ||
      (mode === 'rightToLeft' && control.side === 'L' && source.side === 'R');
    if (!writes) continue;
    result.set(control.id, mirrorChannels(internals, other, slot, values.get(source.id), current));
  }
  return { values: result, warnings };
}
