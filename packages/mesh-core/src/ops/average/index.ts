// Kernel ops of `ops/average/` (M6A-SPEC §6.1): B0a stubs whose `run` refuses `not-implemented` until B4 lands them
// (§3 rule 1). The owner replaces the stub objects in this file and keeps the export names (the registry imports them).
import { stubMeshOp } from '../../stubs/op';
import type { MeshOp } from '../../types';
import { AVERAGE_VERTICES } from './descriptor';

export const averageVertices: MeshOp = stubMeshOp(AVERAGE_VERTICES);
