// C2 (skeleton kernel; M6B-SPEC §5.2): the four VRM humanoid presets — Lite 17, Core 21, Standard 33 (default) and
// Full 52 — plus the non-humanoid helper `root`, in the VRM T-pose (+Y up, facing +Z, left = +X), `height` metres tall,
// standing on y = 0 and centred on x = z = 0. Positions are the §5.2 table (research 14 §4.1) as fractions of the
// height, fingers by the §5.2 finger table, the elbows and knees bent by the rest flexion (on these straight limbs the
// §0.4.2 minimum bend equals §5.2's absolute rule). `placeTemplate` moves a template onto a model's bounds.
import type { SkeletonPreset, TemplateJoint } from '../types';
import { assembleTemplate } from './build';
import type { TemplateKey, Vec3 } from './presets';

export { assembleTemplate, DEFAULT_FLEXION, hingeBend, minimumBend, rightFingers } from './build';
export {
  isSkeletonPreset,
  PRESET_BONES,
  presetOfBones,
  SKELETON_PRESETS,
  type TemplateKey,
  templateParent,
} from './presets';
export { refitTemplateJoints, templateJointId, templateJointRecords } from './records';

type Proportions = 'standard' | 'bigHead';

/** §5.2 table, right side mirrored from the left column (x negated); fractions of H. */
const TABLE: Readonly<
  Record<
    Proportions,
    {
      readonly joints: readonly (readonly [TemplateKey, Vec3])[];
      readonly tails: readonly (readonly [TemplateKey, Vec3])[];
    }
  >
> = {
  standard: {
    joints: [
      ['root', [0, 0, 0]],
      ['hips', [0, 0.5, 0]],
      ['spine', [0, 0.59, 0]],
      ['chest', [0, 0.67, 0]],
      ['upperChest', [0, 0.74, 0]],
      ['neck', [0, 0.815, 0]],
      ['head', [0, 0.845, 0]],
      ['rightShoulder', [-0.03, 0.8, 0]],
      ['rightUpperArm', [-0.09, 0.78, 0]],
      ['rightLowerArm', [-0.25, 0.78, 0]],
      ['rightHand', [-0.39, 0.78, 0]],
      ['rightUpperLeg', [-0.056, 0.49, 0]],
      ['rightLowerLeg', [-0.056, 0.29, 0]],
      ['rightFoot', [-0.056, 0.048, 0]],
      ['rightToes', [-0.056, 0.01, 0.09]],
    ],
    tails: [
      ['head', [0, 1, 0]],
      ['rightHand', [-0.47, 0.78, 0]],
      ['rightFoot', [-0.056, 0.01, 0.09]],
      ['rightToes', [-0.056, 0.01, 0.13]],
    ],
  },
  bigHead: {
    joints: [
      ['root', [0, 0, 0]],
      ['hips', [0, 0.38, 0]],
      ['spine', [0, 0.45, 0]],
      ['chest', [0, 0.51, 0]],
      ['upperChest', [0, 0.55, 0]],
      ['neck', [0, 0.6, 0]],
      ['head', [0, 0.64, 0]],
      ['rightShoulder', [-0.065, 0.59, 0]],
      ['rightUpperArm', [-0.13, 0.585, 0]],
      ['rightLowerArm', [-0.25, 0.585, 0]],
      ['rightHand', [-0.36, 0.585, 0]],
      ['rightUpperLeg', [-0.05, 0.36, 0]],
      ['rightLowerLeg', [-0.05, 0.22, 0]],
      ['rightFoot', [-0.05, 0.05, 0]],
      ['rightToes', [-0.05, 0.01, 0.06]],
    ],
    tails: [
      ['head', [0, 1, 0]],
      ['rightHand', [-0.42, 0.585, 0]],
      ['rightFoot', [-0.05, 0.01, 0.06]],
      ['rightToes', [-0.05, 0.01, 0.1]],
    ],
  },
};

const scaled = (v: Vec3, h: number): Vec3 => [v[0] === 0 ? 0 : v[0] * h, v[1] * h, v[2] * h];

/** §5.2: the template of a preset at `height`, with the rest flexion (radians; default 2°). */
export function skeletonTemplate(
  preset: SkeletonPreset,
  opts: {
    readonly height: number;
    readonly proportions: 'standard' | 'bigHead';
    readonly flexion: number /* radians, default 2° */;
  },
): readonly TemplateJoint[] {
  const table = TABLE[opts.proportions === 'bigHead' ? 'bigHead' : 'standard'];
  const h = opts.height;
  return assembleTemplate(
    preset,
    {
      positions: new Map(table.joints.map(([key, v]) => [key, scaled(v, h)])),
      tails: new Map(table.tails.map(([key, v]) => [key, scaled(v, h)])),
    },
    opts.flexion,
  );
}

/** A template translated by `offset` (positions and tails); x = 0 stays +0. */
export function placeTemplate(template: readonly TemplateJoint[], offset: Vec3): readonly TemplateJoint[] {
  const move = (v: readonly [number, number, number]): [number, number, number] => {
    const x = v[0] + offset[0];
    return [x === 0 ? 0 : x, v[1] + offset[1], v[2] + offset[2]];
  };
  return template.map((joint) => ({
    ...joint,
    position: move(joint.position),
    tail: joint.tail === null ? null : move(joint.tail),
  }));
}
