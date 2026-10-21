// Shared bake inputs for io tests: default options and the synthetic humanoid skeleton.
import { quatFromAxisAngle, type ReadonlyXf } from '@ekza-studio/anim-core';
import { readSyntheticFixture } from '@ekza-studio/doc/testing';
import type { SkeletonDesc } from '@ekza-studio/rig';
import type { BakeOptions, EkzaClipMetaV1 } from '../../src/types';

export const syntheticSkeleton = (): SkeletonDesc => readSyntheticFixture('humanoid-skeleton.json') as SkeletonDesc;

export function clipMeta(name: string, fields: Partial<EkzaClipMetaV1> = {}): EkzaClipMetaV1 {
  return {
    index: 0,
    name,
    slot: null,
    loop: false,
    fps: 30,
    durationSeconds: 1,
    rootMotion: 'hips',
    contactSeconds: null,
    tags: [],
    derivedFrom: [],
    redistributable: 'yes',
    ...fields,
  };
}

export function bakeOptions(fields: Partial<BakeOptions> = {}): BakeOptions {
  const name = fields.name ?? 'wave';
  return {
    name,
    fps: { num: 30, den: 1 },
    range: { start: 0, end: 30 },
    target: 'raw',
    closeLoop: false,
    loop: false,
    rootMotion: 'hips',
    inPlaceNode: null,
    stepSchedule: new Map(),
    requiredTracks: new Set(),
    meta: clipMeta(name),
    ...fields,
  };
}

/** Rest local of `node` rotated by `angle` about `axis` (applied in the node's local frame). */
export function rotated(rest: ReadonlyXf, axis: readonly [number, number, number], angle: number): ReadonlyXf {
  const r = quatFromAxisAngle(axis, angle);
  const q = rest.q;
  // q · r (local rotation applied after the rest rotation).
  return {
    t: rest.t,
    q: [
      q[3] * r[0] + q[0] * r[3] + q[1] * r[2] - q[2] * r[1],
      q[3] * r[1] - q[0] * r[2] + q[1] * r[3] + q[2] * r[0],
      q[3] * r[2] + q[0] * r[1] - q[1] * r[0] + q[2] * r[3],
      q[3] * r[3] - q[0] * r[0] - q[1] * r[1] - q[2] * r[2],
    ],
    s: rest.s,
  };
}
