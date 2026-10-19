// Kernel ops of `ops/uv/` (M6A-SPEC §6.1): B0a stubs whose `run` refuses `not-implemented` until B5 lands them
// (§3 rule 1). The owner replaces the stub objects in this file and keeps the export names (the registry imports them).
import { stubMeshOp } from '../../stubs/op';
import type { MeshOp } from '../../types';
import { UV_PLANAR, UV_BOX, UV_CYLINDRICAL } from './descriptor';

export const uvPlanar: MeshOp = stubMeshOp(UV_PLANAR);
export const uvBox: MeshOp = stubMeshOp(UV_BOX);
export const uvCylindrical: MeshOp = stubMeshOp(UV_CYLINDRICAL);
