// ③ *Adjust joints* → *Done*: the hands follow their forearms (AUTORIG-SPEC §5.4, AS-AR-1 step 12; AR-D7-16; moved
// from Auto-Rig ③ by T5b). The fit aims each hand (its tail and its fingers) along the forearm it was fitted with
// (M6B §0.4.2: hand tail = wrist + 0.55·(wrist − elbow)). When *Adjust joints* moves an elbow or a wrist, the forearm turns but
// C3's joint-only move (`D` + `W`) leaves every other joint — the hand's tail and fingers — where it was (M6b's P-J1),
// so `skel.tpose` keeps the hand's row. On *Done* Auto-Rig turns each hand's subtree (tail and fingers, about the
// wrist) by the same rotation its forearm made since *Adjust joints* opened, so the hand keeps its angle to the
// forearm: an elbow moved back onto the arm line clears the row. Only shipped operators run (§4.5): the bound meshes
// are unbound (`skin.unbind {confirm}`; Done rebinds right after, which recomputes the weights anyway), each turned
// hand is one `skel.joint.rotateRest {mode: 'subtree', pivot: wrist}` (bound joints refuse a subtree rest rotation),
// then Done's rebind. Painted weights are kept instead: with `rig.paintedSinceBind` the hands do not follow (an unbind
// would drop the painting; the rebind question decides about the weights).
import { quatToEuler } from '@ekza-studio/anim-core';
import type { CharacterId, JointId, JointRecord } from '@ekza-studio/doc';
import { autoRigBindMeshes } from '../operators/builtin/rig/wizard/targets';
import type { EditorApp } from '../types';
import type { AutoRigFlowHost } from './host';

type V3 = readonly [number, number, number];
type Q4 = readonly [number, number, number, number];

/** A turn below this (radians) is no turn: the forearm did not change. */
export const FOLLOW_EPSILON = 1e-7;

const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];

/** Each side's forearm (lower arm → hand) and the hand, as read when *Adjust joints* opened. */
export type ArmSnapshot = Readonly<Partial<Record<Side, { readonly hand: JointId; readonly forearm: V3 }>>>;

const sub = (a: readonly number[], b: readonly number[]): V3 => [
  (a[0] ?? 0) - (b[0] ?? 0),
  (a[1] ?? 0) - (b[1] ?? 0),
  (a[2] ?? 0) - (b[2] ?? 0),
];
const norm = (v: V3): number => Math.hypot(v[0], v[1], v[2]);

/** The forearms of a skeleton's joints (humanoid bones `<side>LowerArm` → `<side>Hand`). */
export function armSnapshot(joints: readonly JointRecord[]): ArmSnapshot {
  const out: Partial<Record<Side, { hand: JointId; forearm: V3 }>> = {};
  for (const side of SIDES) {
    const lower = joints.find((joint) => joint.humanBone === `${side}LowerArm` && joint.deleted === null);
    const hand = joints.find((joint) => joint.humanBone === `${side}Hand` && joint.deleted === null);
    if (lower === undefined || hand === undefined) continue;
    const forearm = sub(hand.restPosition, lower.restPosition);
    if (norm(forearm) > 0) out[side] = { hand: hand.id, forearm };
  }
  return out;
}

/** The shortest-arc rotation turning direction `a` onto direction `b` (unit quaternion, [x, y, z, w]). */
export function turnBetween(a: V3, b: V3): Q4 {
  const la = norm(a);
  const lb = norm(b);
  const u: V3 = [a[0] / la, a[1] / la, a[2] / la];
  const v: V3 = [b[0] / lb, b[1] / lb, b[2] / lb];
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const c: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  // half-angle form: q = (u × v, 1 + u·v) normalized (a forearm never turns by 180° in a rest edit)
  const q: Q4 = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** One hand to turn: the `skel.joint.rotateRest` arguments (Euler XYZ, radians, about the wrist). */
export interface HandTurn {
  readonly side: Side;
  readonly args: {
    readonly joints: readonly [JointId];
    readonly mode: 'subtree';
    readonly pivot: V3;
    readonly rotateX: number;
    readonly rotateY: number;
    readonly rotateZ: number;
    readonly symmetry: false;
  };
}

/** The hands whose forearm turned since `before` and the turn each takes (pure; the current joints). */
export function handTurns(before: ArmSnapshot, joints: readonly JointRecord[]): HandTurn[] {
  const now = armSnapshot(joints);
  const out: HandTurn[] = [];
  for (const side of SIDES) {
    const was = before[side];
    const is = now[side];
    if (was === undefined || is === undefined || was.hand !== is.hand) continue;
    const cos =
      (was.forearm[0] * is.forearm[0] + was.forearm[1] * is.forearm[1] + was.forearm[2] * is.forearm[2]) /
      (norm(was.forearm) * norm(is.forearm));
    if (Math.acos(Math.min(1, Math.max(-1, cos))) <= FOLLOW_EPSILON) continue;
    const hand = joints.find((joint) => joint.id === is.hand) as JointRecord;
    const [rotateX, rotateY, rotateZ] = quatToEuler(turnBetween(was.forearm, is.forearm), 'xyz');
    out.push({
      side,
      args: {
        joints: [is.hand],
        mode: 'subtree',
        pivot: [hand.restPosition[0], hand.restPosition[1], hand.restPosition[2]],
        rotateX,
        rotateY,
        rotateZ,
        symmetry: false,
      },
    });
  }
  return out;
}

/** The live joints of a model character's skeleton (empty without one). */
export function characterJoints(app: EditorApp, character: CharacterId): readonly JointRecord[] {
  const record = app.store.get('characters', character);
  if (record === undefined || record.source.kind !== 'model') return [];
  const skeleton = app.store.get('skeletons', record.source.skeleton) ?? app.store.query.skeletonOfCharacter(character);
  if (skeleton === undefined) return [];
  return app.store.query.jointsOfSkeleton(skeleton.id).filter((joint) => joint.deleted === null);
}

/**
 * Turns the hands whose forearm turned since `before` (see the header): unbind, one rotate per hand. Returns whether
 * anything ran (Done's rebind follows either way). A refused step stops it; the steps made stay (each undoable).
 */
export async function handsFollowForearms(
  host: Pick<AutoRigFlowHost, 'app' | 'quiet'>,
  character: CharacterId,
  before: ArmSnapshot,
): Promise<boolean> {
  const { app } = host;
  const turns = handTurns(before, characterJoints(app, character));
  // a rest edit needs the bind pose (C3's rule); in a test pose nothing turns
  if (turns.length === 0 || app.session.getState().rig.poseView !== 'bind') return false;
  const meshes = autoRigBindMeshes(app, character).filter((mesh) => {
    const skin = app.store.get('meshes', mesh)?.skin ?? null;
    return skin !== null && 'skeleton' in skin;
  });
  if (meshes.length > 0) {
    const unbound = await host.quiet('skin.unbind', { meshes, confirm: true });
    if (unbound.status !== 'finished') return false;
  }
  for (const turn of turns) {
    const result = await host.quiet('skel.joint.rotateRest', turn.args);
    if (result.status !== 'finished') return true;
  }
  return true;
}
