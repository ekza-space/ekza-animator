// C2 (skeleton kernel; M6B-SPEC §5.2): the four VRM humanoid presets. C0 stub.
import { EkzaError } from '@ekza-studio/anim-core';
import type { SkeletonPreset, TemplateJoint } from '../types';

export function skeletonTemplate(
  _preset: SkeletonPreset,
  _opts: {
    readonly height: number;
    readonly proportions: 'standard' | 'bigHead';
    readonly flexion: number /* radians, default 2° */;
  },
): readonly TemplateJoint[] {
  throw new EkzaError('not-implemented', 'rig.skeletonTemplate');
}
