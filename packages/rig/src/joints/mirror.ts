// Mirror Joint (M6B-SPEC §5.6.1; research 17 §5; C2): the subtree of `root` mirrored through the YZ plane of the
// character origin. Positions and tails `(−x, y, z)` (exact, so mirroring twice restores them bit for bit); rotations
// Orientation `q′ = q` or Behavior `q′ = q_X(π)·q`, `mode: 'auto'` = Orientation iff every subtree joint has an identity
// rest; names by `search`/`replace`, else the `sideFromName` swap, else `_R`/`_L` suffixes; human bones mirrored.
// With `update` a counterpart (by `mirror` link, then mirrored human bone, then mirrored name) is moved and re-oriented
// in place (ids, keys and curves survive); new joints get template ids when they carry a human bone, `newId(n)`
// otherwise. `mirror` and `side` are set both ways. A centre root mirrors its sided descendants of the source side.
import type { HumanBoneName, JointId, JointRecord, Side } from '@ekza-studio/doc';
import { jointKeyStem } from '@ekza-studio/doc';
import { orderKey, sideFromName } from '../autorig/naming';
import { humanBoneSide, mirrorHumanBone } from '../humanoid/map';
import type { JointEdit, MirrorJointArgs } from '../types';
import { behaviorQuat, isIdentityQuat, JointIndex, mirrorV3, type Q4 } from './util';

const flipSide = (side: Side): Side => (side === 'L' ? 'R' : side === 'R' ? 'L' : 'C');

function mirroredName(name: string, args: MirrorJointArgs, side: Side): string {
  if (args.search.length > 0 && name.includes(args.search)) return name.split(args.search).join(args.replace);
  const swapped = sideFromName(name)?.mirrored;
  if (swapped !== undefined) return swapped;
  return `${name}_${side === 'L' ? 'R' : 'L'}`;
}

export function mirrorJoints(
  joints: readonly JointRecord[],
  args: MirrorJointArgs,
  newId: (n: number) => JointId,
): JointEdit {
  const index = new JointIndex(joints);
  const root = index.get(args.root);
  if (root === undefined)
    return { upserts: [], deletes: [], folds: new Map(), rotationDeltas: new Map(), warnings: [] };
  const skeleton = root.skeleton;
  // Source side: the root's side (x > 0 is left), or the direction's.
  const direction =
    args.direction !== 'auto'
      ? args.direction
      : root.restPosition[0] < 0 || root.side === 'R'
        ? 'right-to-left'
        : 'left-to-right';
  const sourceSide: Side = direction === 'left-to-right' ? 'L' : 'R';
  let source = index.subtree(root.id);
  if (root.side === 'C' && Math.abs(root.restPosition[0]) <= 1e-12) {
    // A centre root: its sided descendants on the source side (the centre joints map onto themselves).
    source = source.filter((joint) => joint.side === sourceSide);
  }
  const mode =
    args.mode !== 'auto'
      ? args.mode
      : source.every((joint) => isIdentityQuat(joint.restRotation))
        ? 'orientation'
        : 'behavior';
  const rotate = (q: Q4): Q4 => (mode === 'orientation' ? q : behaviorQuat(q));
  const sourceIds = new Set(source.map((joint) => joint.id));

  // Counterparts (update in place) and new ids.
  const counterpart = new Map<JointId, JointRecord | null>();
  const names = new Set(index.order.map((joint) => joint.name));
  const keys = new Set(index.order.map((joint) => joint.key));
  let fresh = 0;
  const target = new Map<JointId, JointId>();
  for (const joint of source) {
    let found: JointRecord | undefined;
    if (args.update) {
      found = index.partnerOf(joint);
      if (found !== undefined && sourceIds.has(found.id)) found = undefined;
      if (found === undefined) {
        const name = mirroredName(joint.name, args, joint.side);
        found = index.order.find((other) => other.name === name && !sourceIds.has(other.id));
      }
    }
    counterpart.set(joint.id, found ?? null);
    if (found !== undefined) target.set(joint.id, found.id);
    else {
      const bone = joint.humanBone === null ? null : mirrorHumanBone(joint.humanBone);
      target.set(joint.id, bone !== null ? (`${skeleton}:${bone}` as JointId) : newId(fresh++));
    }
  }

  const upserts: JointRecord[] = [];
  let created = 0;
  for (const joint of source) {
    const id = target.get(joint.id) as JointId;
    const existing = counterpart.get(joint.id) ?? null;
    const bone: HumanBoneName | null =
      joint.humanBone === null ? null : (mirrorHumanBone(joint.humanBone) ?? joint.humanBone);
    const side: Side = bone !== null ? humanBoneSide(bone) : flipSide(joint.side);
    let parent: JointId | null;
    if (joint.id === root.id || joint.parent === null || !sourceIds.has(joint.parent)) {
      // The mirrored root's parent: a centre parent itself, else its partner, else the same parent.
      const original = joint.parent === null ? undefined : index.get(joint.parent);
      if (original === undefined) parent = joint.parent;
      else if (original.side === 'C') parent = original.id;
      else parent = index.partnerOf(original)?.id ?? original.id;
    } else {
      parent = target.get(joint.parent) ?? joint.parent;
    }
    const base: JointRecord =
      existing ??
      ({
        id,
        skeleton,
        parent,
        order: orderKey(index.order.length + created++),
        name: '',
        humanBone: bone,
        restPosition: [0, 0, 0],
        restRotation: [0, 0, 0, 1],
        tail: null,
        side,
        mirror: joint.id,
        deleted: null,
        role: joint.role,
        key: '',
      } satisfies JointRecord);
    let name = existing?.name ?? mirroredName(joint.name, args, joint.side);
    if (existing === null) {
      let n = 2;
      const stem = name;
      while (names.has(name)) name = `${stem}_${n++}`;
      names.add(name);
    }
    let key = existing?.key ?? bone ?? jointKeyStem(name);
    if (existing === null) {
      let n = 2;
      const stem = key;
      while (keys.has(key)) key = `${stem}#${n++}`;
      keys.add(key);
    }
    const record: JointRecord = {
      ...base,
      parent: existing === null ? parent : base.parent,
      name,
      key,
      humanBone: existing === null ? bone : base.humanBone,
      restPosition: mirrorV3(joint.restPosition),
      restRotation: rotate(joint.restRotation),
      tail: joint.tail === null ? null : mirrorV3(joint.tail),
      side: existing === null ? side : base.humanBone !== null ? humanBoneSide(base.humanBone) : flipSide(joint.side),
      mirror: joint.id,
      deleted: null,
    };
    upserts.push(record);
    // The source joint links back.
    if (joint.mirror !== record.id) upserts.push({ ...joint, mirror: record.id });
  }
  return { upserts, deletes: [], folds: new Map(), rotationDeltas: new Map(), warnings: [] };
}
