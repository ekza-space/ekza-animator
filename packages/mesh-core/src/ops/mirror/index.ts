// Kernel ops of `ops/mirror/` (M6A-SPEC §6.1): B0a stubs whose `run` refuses `not-implemented` until B4 lands them
// (§3 rule 1). The owner replaces the stub objects in this file and keeps the export names (the registry imports them).
import { stubMeshOp } from '../../stubs/op';
import type { MeshOp } from '../../types';
import { MIRROR } from './descriptor';

export const mirror: MeshOp = stubMeshOp(MIRROR);
