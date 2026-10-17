import type { Mat4 } from '@ekza-animator/anim-core';
import type { ControlId } from '@ekza-animator/doc';
import { controlSlotOf } from '../sampler/channels';
import type { PoseBuffers, RigProgram } from '../types';

/** The evaluated world matrix of `control` (canonical character space), copied into `out`. */
export function controlWorld(program: RigProgram, pose: PoseBuffers, control: ControlId, out?: Mat4): Mat4 {
  const slot = controlSlotOf(program, control);
  const target = out ?? new Float64Array(16);
  for (let i = 0; i < 16; i++) target[i] = pose.controlWorld[slot * 16 + i] as number;
  return target;
}
