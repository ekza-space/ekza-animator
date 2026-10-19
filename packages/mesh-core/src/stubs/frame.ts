// B0a stub of B3's region frame (M6A-SPEC §4.3, §5.8): throws until B3 lands it.
import { notImplemented } from '../kernel';
import type { EditMesh, OpFrame } from '../types';

/** §5.8 region frame of a face set (mesh-local), shared by extrude, inset and the extrude manipulator. */
export function regionFrame(_m: EditMesh, _faces: ArrayLike<number>): OpFrame {
  throw notImplemented('regionFrame');
}
