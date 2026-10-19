// Kernel ops of `ops/combine/` (M6A-SPEC §6.1): B0a stubs whose `run` refuses `not-implemented` until B4 lands them
// (§3 rule 1). The owner replaces the stub objects in this file and keeps the export names (the registry imports them).
import { stubMeshSetOp } from '../../stubs/op';
import type { MeshSetOp } from '../../types';
import { COMBINE } from './descriptor';

export const combine: MeshSetOp = stubMeshSetOp(COMBINE);
