// The clip library (M6B-SPEC §0.4.7, §0.5; C12): the UAL bone map, the starter-pack manifest parser, the world-delta
// retarget and the VRMA writer of normalized humanoid clips. C0: `UAL_BONE_MAP` as the spec lists it (C12 checks it
// against the fixture) and stubs for the functions.
import { EkzaError } from '@ekza-studio/anim-core';
import type { HumanBoneName } from '@ekza-studio/doc';
import type { HumanoidClipData } from '@ekza-studio/rig';
import type { GlbContainer, StarterPackManifest } from '../types';

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

/** Throws EkzaError('invalid-input') naming the field. */
export function parseStarterPackManifest(_json: unknown): StarterPackManifest {
  throw new EkzaError('not-implemented', 'io.parseStarterPackManifest');
}

/** §0.4.7 world-delta retarget of one UAL clip onto the VRM normalized T-pose. */
export function retargetUalClip(_ual: GlbContainer, _clip: string): HumanoidClipData {
  throw new EkzaError('not-implemented', 'io.retargetUalClip');
}

/** Deterministic VRMA 1.0 bytes of a normalized humanoid clip (the shipped VRMA writer's layout and provenance). */
export function writeHumanoidVrma(
  _data: HumanoidClipData,
  _meta: { readonly generator: string; readonly license: string; readonly credit: string; readonly source: string },
): Promise<Uint8Array> {
  return Promise.reject(new EkzaError('not-implemented', 'io.writeHumanoidVrma'));
}
