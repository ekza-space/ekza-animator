// The Quaternius UAL bone map (M6B-SPEC §0.4.7; landed by C0 as the spec lists it, C12 owns it): Rigify `DEF-*`
// deformers → VRM 1.0 humanoid bones, ported from OMOBA's `scripts/retarget_animations.py` `BONE_MAP` (with the VRM 1.0
// thumb names) and checked against the fixture's node names.
import type { HumanBoneName } from '@ekza-studio/doc';

function sidePairs(source: string, target: string): Record<string, HumanBoneName> {
  return {
    [`DEF-${source}.L`]: `left${target}` as HumanBoneName,
    [`DEF-${source}.R`]: `right${target}` as HumanBoneName,
  };
}

function fingers(
  source: string,
  target: string,
  segments: readonly [string, string, string],
): Record<string, HumanBoneName> {
  return Object.assign(
    {},
    ...segments.map((segment, i) => sidePairs(`${source}.0${i + 1}`, `${target}${segment}`)),
  ) as Record<string, HumanBoneName>;
}

/** Quaternius UAL `DEF-*` deformers → VRM 1.0 humanoid bones (§0.4.7; ported from OMOBA's `BONE_MAP`). */
export const UAL_BONE_MAP: Readonly<Record<string, HumanBoneName>> = Object.freeze({
  'DEF-hips': 'hips',
  'DEF-spine.001': 'spine',
  'DEF-spine.002': 'chest',
  'DEF-spine.003': 'upperChest',
  'DEF-neck': 'neck',
  'DEF-head': 'head',
  ...sidePairs('shoulder', 'Shoulder'),
  ...sidePairs('upper_arm', 'UpperArm'),
  ...sidePairs('forearm', 'LowerArm'),
  ...sidePairs('hand', 'Hand'),
  ...sidePairs('thigh', 'UpperLeg'),
  ...sidePairs('shin', 'LowerLeg'),
  ...sidePairs('foot', 'Foot'),
  ...sidePairs('toe', 'Toes'),
  ...fingers('f_index', 'Index', ['Proximal', 'Intermediate', 'Distal']),
  ...fingers('f_middle', 'Middle', ['Proximal', 'Intermediate', 'Distal']),
  ...fingers('f_ring', 'Ring', ['Proximal', 'Intermediate', 'Distal']),
  ...fingers('f_pinky', 'Little', ['Proximal', 'Intermediate', 'Distal']),
  ...fingers('thumb', 'Thumb', ['Metacarpal', 'Proximal', 'Distal']),
});
