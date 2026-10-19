import type { CharacterId, ClipId, ControlId, CurveId, DocSnapshot, KeyId, LayerId, RigId } from '@ekza-animator/doc';
import { readSyntheticFixture, withSchemaV3 } from '@ekza-animator/doc/testing';
import type { SkeletonDesc } from '@ekza-animator/rig';

export interface RestPoseFixture {
  readonly bones: readonly {
    readonly node: number;
    readonly name: string;
    readonly humanoid: string | null;
    readonly t: readonly [number, number, number];
    readonly q: readonly [number, number, number, number];
    readonly world: readonly number[];
  }[];
}

/**
 * The wave document as the app holds it: the M1 fixture in its schema 3 form (M6A-SPEC §3 rule 9 literal update; the
 * app always loads documents through `migrateSnapshot`, which adds `source`, `provenance: null` and the M6a tables).
 */
export const waveDoc = (): DocSnapshot => withSchemaV3(readSyntheticFixture('wave-doc.json') as DocSnapshot);
export const humanoidSkeleton = (): SkeletonDesc => readSyntheticFixture('humanoid-skeleton.json') as SkeletonDesc;
export const restPose = (): RestPoseFixture => readSyntheticFixture('rest-pose.json') as RestPoseFixture;

export const WAVE = {
  character: 'chr_SyntheticWave001' as CharacterId,
  rig: 'rig_SyntheticWave001' as RigId,
  clip: 'clp_SyntheticWave001' as ClipId,
  layer: 'lay_SyntheticWave001' as LayerId,
  curve: 'crv_SyntheticWave001' as CurveId,
  keys: ['k_SynthWave001', 'k_SynthWave002', 'k_SynthWave003'] as unknown as readonly [KeyId, KeyId, KeyId],
  lowerArmL: 'rig_SyntheticWave001:fk.lowerArm.L' as ControlId,
  upperArmL: 'rig_SyntheticWave001:fk.upperArm.L' as ControlId,
  handL: 'rig_SyntheticWave001:fk.hand.L' as ControlId,
  hips: 'rig_SyntheticWave001:fk.hips' as ControlId,
  cog: 'rig_SyntheticWave001:cog' as ControlId,
} as const;

export const DEG = Math.PI / 180;
