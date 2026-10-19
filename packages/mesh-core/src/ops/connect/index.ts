// Kernel ops of `ops/connect/` (M6A-SPEC §6.1): B0a stubs whose `run` refuses `not-implemented` until B3 lands them
// (§3 rule 1). The owner replaces the stub objects in this file and keeps the export names (the registry imports them).
import { stubMeshOp } from '../../stubs/op';
import type { MeshOp } from '../../types';
import { CONNECT } from './descriptor';

export const connect: MeshOp = stubMeshOp(CONNECT);
