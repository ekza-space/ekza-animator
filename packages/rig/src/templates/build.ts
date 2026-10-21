// Assembling a template skeleton (M6B-SPEC §5.2, §0.4.2; C2), shared by `skeletonTemplate` and the Quick Rig fit:
// the body joints of the centre and the RIGHT side go in, the §5.2 finger table fills the right hand, the minimum-bend
// rest flexion bends the right elbow and knee, and every left joint is the exact `(−x, y, z)` mirror of its right
// partner. Pure and deterministic (float64, fixed operation order), so the preview and the commit of Quick Rig, which
// call it with the same inputs, give the same joints bit for bit.
import type { HumanBoneName } from '@ekza-studio/doc';
import { mirrorHumanBone } from '../humanoid/map';
import type { SkeletonPreset, TemplateJoint } from '../types';
import {
  add,
  cross,
  distance,
  dot,
  mirrorX,
  normalize,
  PRESET_BONES,
  scale,
  sub,
  type TemplateKey,
  templateParent,
  type Vec3,
} from './presets';

/** Rest flexion default (2°, research 17 J8), radians. */
export const DEFAULT_FLEXION = (2 * Math.PI) / 180;
/** Hinge directions (§0.4.2): the elbow bends back (−Z), the knee forward (+Z). */
export const ELBOW_HINGE: Vec3 = [0, 0, -1];
export const KNEE_HINGE: Vec3 = [0, 0, 1];

/**
 * §0.4.2 minimum bend. With `a = |B − A|`, `b = |C − B|`, `P` the closest point to `B` on the line `A–C`, the current
 * bend `δ = (B − P)·d` and the required bend `δmin = θ·a·b/(a + b)`: `B` is returned unchanged (the same tuple) when
 * `δ ≥ δmin` (with a relative 1e-3 slack, so re-applying the rule to its own result is a no-op), else
 * `B + (δmin − δ)·d` (only z changes for the hinge directions ±Z).
 */
export function minimumBend(A: Vec3, B: Vec3, C: Vec3, d: Vec3, theta: number): Vec3 {
  const ac = sub(C, A);
  const l2 = dot(ac, ac);
  const t = l2 > 0 ? dot(sub(B, A), ac) / l2 : 0;
  const P = add(A, scale(ac, t));
  const delta = dot(sub(B, P), d);
  const a = distance(B, A);
  const b = distance(C, B);
  const required = a + b > 0 ? (theta * a * b) / (a + b) : 0;
  // A relative 1e-3 slack keeps a limb this rule bent bit-equal: its bent lengths give a δmin larger by O(δ²/a²).
  if (delta >= required * (1 - 1e-3)) return B;
  const k = required - delta;
  return [B[0] + k * d[0], B[1] + k * d[1], B[2] + k * d[2]];
}

/** The current bend of a limb toward its hinge side, `(B − P)·d` (§0.4.2); for `skel.hinge-bend` and the tests. */
export function hingeBend(A: Vec3, B: Vec3, C: Vec3, d: Vec3): number {
  const ac = sub(C, A);
  const l2 = dot(ac, ac);
  const t = l2 > 0 ? dot(sub(B, A), ac) / l2 : 0;
  return dot(sub(B, add(A, scale(ac, t))), d);
}

const THUMB = Math.SQRT1_2;
/** §5.2: the thumb metacarpal sits 0.20 h forward of the hand. */
const THUMB_FORWARD = 0.2;
const FINGERS: readonly (readonly [string, number, number])[] = [
  // [finger, z offset × h, segment length factor] (§5.2: Middle on the axis; Index/Ring/Little in Full)
  ['Middle', 0, 1],
  ['Index', 0.15, 1],
  ['Ring', -0.12, 0.95],
  ['Little', -0.24, 0.8],
];

/**
 * The right hand's fingers by the §5.2 table: `axis` = the unit direction of the hand (wrist − elbow), `h` = the hand
 * length; the frame is `axis`, forward `f` (+Z made orthogonal to the axis) and up `u = axis × f` (+Y in the T-pose).
 * Only the bones in `present` are written; distal joints get their tails.
 */
export function rightFingers(
  present: ReadonlySet<HumanBoneName>,
  hand: Vec3,
  axis: Vec3,
  h: number,
  out: Map<TemplateKey, Vec3>,
  tails: Map<TemplateKey, Vec3>,
  thumbForward = THUMB_FORWARD,
): void {
  const f = normalize(sub([0, 0, 1], scale(axis, axis[2])), [0, 0, 1]);
  const u = normalize(cross(axis, f), [0, 1, 0]);
  for (const [finger, zoff, factor] of FINGERS) {
    const proximal = `right${finger}Proximal` as HumanBoneName;
    if (!present.has(proximal)) continue;
    const p = add(add(hand, scale(axis, 0.55 * h)), scale(f, zoff * h));
    const i = add(p, scale(axis, 0.17 * h * factor));
    const d = add(i, scale(axis, 0.13 * h * factor));
    out.set(proximal, p);
    out.set(`right${finger}Intermediate` as HumanBoneName, i);
    out.set(`right${finger}Distal` as HumanBoneName, d);
    tails.set(`right${finger}Distal` as HumanBoneName, add(d, scale(axis, 0.1 * h * factor)));
  }
  if (present.has('rightThumbMetacarpal')) {
    const m = add(add(add(hand, scale(axis, 0.15 * h)), scale(u, -0.05 * h)), scale(f, thumbForward * h));
    const dir = add(scale(axis, THUMB), scale(f, THUMB));
    const p = add(m, scale(dir, 0.25 * h));
    const d = add(p, scale(dir, 0.2 * h));
    out.set('rightThumbMetacarpal', m);
    out.set('rightThumbProximal', p);
    out.set('rightThumbDistal', d);
    tails.set('rightThumbDistal', add(d, scale(dir, 0.15 * h)));
  }
}

export interface TemplateInput {
  /** Positions of `root`, the centre bones and the right-side bones of the preset (fingers are filled when absent). */
  readonly positions: ReadonlyMap<TemplateKey, Vec3>;
  /** Tails of the right side and the head (`head`, `rightHand`, `rightFoot`, `rightToes`, finger distals). */
  readonly tails: ReadonlyMap<TemplateKey, Vec3>;
}

/**
 * The template joints of a preset from the right-side input: right fingers by the table along `rightHand − rightLowerArm`
 * (h = |hand tail − hand|) when missing, the minimum bend on the right elbow and knee, then every left joint mirrored.
 * Order: `root`, then the preset's bones in the VRM table order (parents first). Tails: head, hands, toes (or the feet
 * without toes) and the finger tips.
 */
export function assembleTemplate(
  preset: SkeletonPreset,
  input: TemplateInput,
  flexion: number,
  opts: { readonly thumbForward?: number } = {},
): TemplateJoint[] {
  const bones = PRESET_BONES[preset];
  const present = new Set(bones);
  const pos = new Map<TemplateKey, Vec3>(input.positions);
  const tails = new Map<TemplateKey, Vec3>(input.tails);
  const need = (key: TemplateKey): Vec3 => {
    const p = pos.get(key);
    if (p === undefined) throw new Error(`template: ${key} has no position`);
    return p;
  };
  // Fingers (when the input has none): along the forearm direction.
  if (bones.some((bone) => bone.startsWith('right') && bone.includes('Proximal') && !pos.has(bone))) {
    const hand = need('rightHand');
    const axis = normalize(sub(hand, need('rightLowerArm')), [-1, 0, 0]);
    const tail = tails.get('rightHand');
    const h = tail === undefined ? 0 : distance(tail, hand);
    const fingers = new Map<TemplateKey, Vec3>();
    rightFingers(present, hand, axis, h, fingers, tails, opts.thumbForward ?? THUMB_FORWARD);
    for (const [key, p] of fingers) if (!pos.has(key)) pos.set(key, p);
  }
  // Rest flexion: the minimum bend of the right arm and leg (§0.4.2).
  pos.set(
    'rightLowerArm',
    minimumBend(need('rightUpperArm'), need('rightLowerArm'), need('rightHand'), ELBOW_HINGE, flexion),
  );
  pos.set(
    'rightLowerLeg',
    minimumBend(need('rightUpperLeg'), need('rightLowerLeg'), need('rightFoot'), KNEE_HINGE, flexion),
  );
  const out: TemplateJoint[] = [{ key: 'root', parent: null, position: need('root'), tail: null }];
  for (const bone of bones) {
    const partner = bone.startsWith('left') ? mirrorHumanBone(bone) : null;
    const position = partner === null ? need(bone) : mirrorX(need(partner));
    const sourceTail = tails.get(partner ?? bone);
    const tail = sourceTail === undefined ? null : partner === null ? sourceTail : mirrorX(sourceTail);
    out.push({
      key: bone,
      parent: templateParent(bone, present),
      position,
      tail: isTailBone(bone, present) ? tail : null,
    });
  }
  return out;
}

function isTailBone(bone: HumanBoneName, present: ReadonlySet<HumanBoneName>): boolean {
  if (bone === 'head' || bone.endsWith('Hand') || bone.endsWith('Toes') || bone.endsWith('Distal')) return true;
  if (bone.endsWith('Foot')) return !present.has(bone.startsWith('left') ? 'leftToes' : 'rightToes');
  return false;
}
