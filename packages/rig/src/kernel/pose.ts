// WP-3 stub: final signature (MVP-SPEC §7 WP-3); throws until the kernel lands.
import { EkzaError, type Mat4 } from '@ekza-animator/anim-core';
import type { ControlId } from '@ekza-animator/doc';
import type { PoseBuffers, RigProgram } from '../types';

export function controlWorld(_program: RigProgram, _pose: PoseBuffers, _control: ControlId, _out?: Mat4): Mat4 {
  throw new EkzaError('not-implemented', 'rig.controlWorld');
}
