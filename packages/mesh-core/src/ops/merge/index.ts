// Kernel ops of `ops/merge/` (M6A-SPEC §6.1): B0a stubs whose `run` refuses `not-implemented` until B3 lands them
// (§3 rule 1). The owner replaces the stub objects in this file and keeps the export names (the registry imports them).
import { stubMeshOp } from '../../stubs/op';
import type { MeshOp } from '../../types';
import { MERGE, MERGE_TO_CENTER, MERGE_BY_DISTANCE } from './descriptor';

export const merge: MeshOp = stubMeshOp(MERGE);
export const mergeToCenter: MeshOp = stubMeshOp(MERGE_TO_CENTER);
export const mergeByDistance: MeshOp = stubMeshOp(MERGE_BY_DISTANCE);
