// `regionFrame` (M6A-SPEC §4.3, §5.8 step 4; B3): the frame of a face set, shared by extrude, inset and the extrude
// manipulator — pivot = area-weighted centroid, Z = normalized area-weighted normal, X = normalized U − (U·Z)Z with
// U = +Y (+Z when |Z·Y| > 0.9), Y = Z × X. Mesh-local.
import { kernelError } from '../../kernel';
import type { EditMesh, OpFrame } from '../../types';
import { frameOf } from './geometry';

/** §5.8 region frame of a face set (mesh-local), shared by extrude, inset and the extrude manipulator. */
export function regionFrame(m: EditMesh, faces: ArrayLike<number>): OpFrame {
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i] as number;
    if (!Number.isInteger(f) || f < 0 || f >= m.counts.faces) {
      throw kernelError('out-of-range', `regionFrame: face ${f} is outside 0…${m.counts.faces - 1}`);
    }
  }
  const frame = frameOf(m, faces);
  return { pivot: frame.pivot, axes: [frame.x, frame.y, frame.z] };
}
