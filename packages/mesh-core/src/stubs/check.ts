// B0a stub of B5's Mesh Check (M6A-SPEC §4.3, §5.25): throws until B5 lands `src/check/**`.
import { notImplemented } from '../kernel';
import type { EditMesh, HiddenSet, MeshData, MeshProblem } from '../types';

export function checkMesh(
  _m: EditMesh | MeshData,
  _opts?: {
    readonly hidden?: HiddenSet | null;
    readonly closedExpected?: boolean;
    readonly duplicateSlots?: ReadonlySet<number>;
  },
): readonly MeshProblem[] {
  throw notImplemented('checkMesh');
}
