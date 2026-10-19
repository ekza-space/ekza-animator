// Kernel ops of `ops/normals/` (M6A-SPEC §6.1): B0a stubs whose `run` refuses `not-implemented` until B4 lands them
// (§3 rule 1). The owner replaces the stub objects in this file and keeps the export names (the registry imports them).
import { stubMeshOp } from '../../stubs/op';
import type { MeshOp } from '../../types';
import { HARDEN, SOFTEN, SET_NORMAL_ANGLE, REVERSE, CONFORM } from './descriptor';

export const harden: MeshOp = stubMeshOp(HARDEN);
export const soften: MeshOp = stubMeshOp(SOFTEN);
export const setNormalAngle: MeshOp = stubMeshOp(SET_NORMAL_ANGLE);
export const reverse: MeshOp = stubMeshOp(REVERSE);
export const conform: MeshOp = stubMeshOp(CONFORM);
