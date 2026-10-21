// Rest moves and rotations (M6B-SPEC §5.7; C2): `W` (subtree), `D`+`W` (joint only), `E` (rotate the subtree's rest
// about a pivot) and `D`+`E` (re-orient the joint only), with X symmetry: a partner of a moved joint moves by the
// mirrored delta `(−x, y, z)` (rotations `(x, −y, −z, w)`) about the mirrored pivot, centre joints keep x = 0, and a
// centre joint's subtree moves by the delta's mirror-invariant part (no x, twist about X only) so it stays symmetric.
// A subtree rotation keeps identity rest rotations identity (World-oriented humanoid joints, the §5.7 Apply Pose as
// Rest rule); every other rotation takes the delta, and a joint-only rotation re-orients whatever the rest. No edit moves a joint it does not move (P-J1).
import { quatMultiply, quatNormalize, quatRotateVec3 } from '@ekza-studio/anim-core';
import type { JointId, JointRecord } from '@ekza-studio/doc';
import type { JointEdit } from '../types';
import { canonicalQuat, isIdentityQuat, JointIndex, mirrorV3, type Q4, sameQuat, sameV3, type V3, v3 } from './util';

interface Delta {
  readonly t: V3;
  readonly q: Q4 | null;
  readonly pivot: V3;
}

const mirrorDelta = (d: Delta): Delta => ({
  t: [d.t[0] === 0 ? 0 : -d.t[0], d.t[1], d.t[2]],
  q: d.q === null ? null : [d.q[0], -d.q[1], -d.q[2], d.q[3]],
  pivot: mirrorV3(d.pivot),
});

/** The mirror-invariant part of a delta: x translation 0, pivot on x = 0, the rotation's twist about X (normalized;
 *  null when nothing is left). */
function symmetricDelta(d: Delta): Delta {
  let q: Q4 | null = null;
  if (d.q !== null) {
    const l = Math.hypot(d.q[0], d.q[3]);
    q = l > 1e-12 && !(d.q[0] === 0 && d.q[3] === 1) ? [d.q[0] / l, 0, 0, d.q[3] / l] : null;
  }
  return { t: [0, d.t[1], d.t[2]], q, pivot: [0, d.pivot[1], d.pivot[2]] };
}

function applyPoint(p: readonly number[], d: Delta): [number, number, number] {
  let x = (p[0] as number) - d.pivot[0];
  let y = (p[1] as number) - d.pivot[1];
  let z = (p[2] as number) - d.pivot[2];
  if (d.q !== null) [x, y, z] = quatRotateVec3(d.q, [x, y, z]);
  return [x + d.pivot[0] + d.t[0], y + d.pivot[1] + d.t[1], z + d.pivot[2] + d.t[2]];
}

/**
 * §5.7 rest edit of `ids` by `delta` (`t` translation, `q` rotation about `pivot`, character space). `subtree` moves
 * the joints with their descendants (tails included); `joint` moves only the joints (a rotation then re-orients the
 * joint: its rest rotation turns, its position and children stay). With `symmetry` the partners not in `ids` take the
 * mirrored delta; a centre joint that sits on x = 0 stays there.
 */
export function moveJoints(
  joints: readonly JointRecord[],
  ids: readonly JointId[],
  delta: { readonly t?: readonly number[]; readonly q?: readonly number[]; readonly pivot: readonly number[] },
  mode: 'subtree' | 'joint',
  symmetry: boolean,
): JointEdit {
  const index = new JointIndex(joints);
  const base: Delta = {
    t: delta.t === undefined ? [0, 0, 0] : v3(delta.t),
    q: delta.q === undefined ? null : quatNormalize(delta.q as Q4),
    pivot: v3(delta.pivot),
  };
  const selected = ids.filter((id) => index.get(id) !== undefined);
  // Which delta each moved joint takes: the selection's own, else (symmetry) the mirrored one of a partner.
  const assignment = new Map<JointId, Delta>();
  const assign = (root: JointId, d: Delta, overwrite: boolean): void => {
    const set = mode === 'subtree' ? index.subtree(root) : [index.get(root) as JointRecord];
    for (const joint of set) if (overwrite || !assignment.has(joint.id)) assignment.set(joint.id, d);
  };
  if (symmetry) {
    const mirrored = mirrorDelta(base);
    for (const id of selected) {
      const joint = index.get(id) as JointRecord;
      if (joint.side === 'C') continue;
      const partner = index.partnerOf(joint);
      if (partner !== undefined && !selected.includes(partner.id)) assign(partner.id, mirrored, false);
    }
  }
  // A centre joint on x = 0 moved (W, E) with symmetry moves its subtree symmetrically: no x translation, the pivot on x = 0
  // and only the rotation's mirror-invariant part (the twist about X), so both sides of the subtree stay mirrors.
  const centre: Delta = symmetricDelta(base);
  for (const id of selected) {
    const joint = index.get(id) as JointRecord;
    assign(
      id,
      symmetry && mode === 'subtree' && joint.side === 'C' && joint.restPosition[0] === 0 ? centre : base,
      true,
    );
  }

  const upserts: JointRecord[] = [];
  for (const joint of index.order) {
    const d = assignment.get(joint.id);
    if (d === undefined) continue;
    const reorientOnly = mode === 'joint' && d.q !== null;
    let restPosition: [number, number, number] = reorientOnly
      ? v3(joint.restPosition)
      : applyPoint(joint.restPosition, d);
    if (symmetry && joint.side === 'C' && joint.restPosition[0] === 0)
      restPosition = [0, restPosition[1], restPosition[2]];
    const moveTail = mode === 'subtree' && joint.tail !== null;
    let tail: [number, number, number] | null =
      joint.tail === null ? null : moveTail ? applyPoint(joint.tail, d) : v3(joint.tail);
    if (tail !== null && symmetry && joint.side === 'C' && joint.tail?.[0] === 0) tail = [0, tail[1], tail[2]];
    // E (subtree) keeps World-oriented identity rests; D + E (joint only) re-orients whatever the rest.
    const keepIdentity = mode === 'subtree' && isIdentityQuat(joint.restRotation);
    const restRotation =
      d.q === null || keepIdentity ? joint.restRotation : canonicalQuat(quatMultiply(d.q, joint.restRotation));
    const changed =
      !sameV3(restPosition, joint.restPosition) ||
      !sameQuat(restRotation, joint.restRotation) ||
      (tail === null ? joint.tail !== null : joint.tail === null || !sameV3(tail, joint.tail));
    if (changed) upserts.push({ ...joint, restPosition, restRotation, tail });
  }
  return { upserts, deletes: [], folds: new Map(), rotationDeltas: new Map(), warnings: [] };
}

/** `skel.joint.setRest`: one joint's rest position and/or rotation (canonical), unchanged fields kept. */
export function setJointRest(
  joints: readonly JointRecord[],
  id: JointId,
  rest: { readonly position?: readonly number[] | null; readonly rotation?: readonly number[] | null },
): JointEdit {
  const joint = new JointIndex(joints).get(id);
  if (joint === undefined)
    return { upserts: [], deletes: [], folds: new Map(), rotationDeltas: new Map(), warnings: [] };
  const restPosition = rest.position === undefined || rest.position === null ? joint.restPosition : v3(rest.position);
  const restRotation =
    rest.rotation === undefined || rest.rotation === null ? joint.restRotation : canonicalQuat(rest.rotation as Q4);
  const rotationDeltas = new Map<JointId, readonly [number, number, number, number]>();
  if (!sameQuat(restRotation, joint.restRotation)) {
    const inv: Q4 = [-joint.restRotation[0], -joint.restRotation[1], -joint.restRotation[2], joint.restRotation[3]];
    rotationDeltas.set(id, canonicalQuat(quatMultiply(inv, restRotation)));
  }
  const changed = !sameV3(restPosition, joint.restPosition) || !sameQuat(restRotation, joint.restRotation);
  return {
    upserts: changed ? [{ ...joint, restPosition: v3(restPosition), restRotation }] : [],
    deletes: [],
    folds: new Map(),
    rotationDeltas,
    warnings: [],
  };
}
