// Kernel ops of `ops/paint/` (M6A-SPEC §6.1): B0a stubs whose `run` refuses `not-implemented` until B13 lands them
// (§3 rule 1). The owner replaces the stub objects in this file and keeps the export names (the registry imports them).
import { stubMeshOp } from '../../stubs/op';
import type { MeshOp } from '../../types';
import { PAINT, PAINT_FILL_SHELL, PAINT_REMAP } from './descriptor';

export const paint: MeshOp = stubMeshOp(PAINT);
export const paintFillShell: MeshOp = stubMeshOp(PAINT_FILL_SHELL);
export const paintRemap: MeshOp = stubMeshOp(PAINT_REMAP);
