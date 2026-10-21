// C2 (skeleton kernel; M6B-SPEC §5.21): the skel.* and xform.* problems. C0 stub.
import { EkzaError } from '@ekza-studio/anim-core';
import type { DocSkeletonInput, RigProblem } from '../types';

/** skel.* and xform.* (§5.21; xform.* on the meshes' world placements). pose.bind-mismatch is not produced here: it
 *  needs the asset's inverse bind matrices and comes from C11's `checkImportedBind` (§5.23). */
export function checkSkeleton(_input: DocSkeletonInput): readonly RigProblem[] {
  throw new EkzaError('not-implemented', 'rig.checkSkeleton');
}
