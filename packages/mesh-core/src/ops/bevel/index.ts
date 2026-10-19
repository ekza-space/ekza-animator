// Kernel op of `ops/bevel/` (M6A-SPEC §5.9, §6.1; owner B5): `mesh.bevel`. The algorithm is in ./bevel.ts.
import type { MeshOp } from '../../types';
import { pollBevel, runBevel } from './bevel';
import { BEVEL } from './descriptor';

export const bevel: MeshOp = Object.freeze({ ...BEVEL, poll: pollBevel, run: runBevel });
