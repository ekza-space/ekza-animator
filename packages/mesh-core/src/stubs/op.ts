// B0a stub op objects (M6A-SPEC §3 rule 1): the final descriptor with `poll` true and `run` refusing
// `not-implemented`, so menus, cards and option boxes are generated before the kernel lands.
import { refuse } from '../refusal';
import type { MeshOp, MeshOpDescriptor, MeshSetOp, MeshSetOpDescriptor } from '../types';

export function stubMeshOp(desc: MeshOpDescriptor): MeshOp {
  return Object.freeze({
    ...desc,
    poll: () => true as const,
    run: () => refuse('not-implemented', `${desc.label} is not available yet (${desc.id})`),
  });
}

export function stubMeshSetOp(desc: MeshSetOpDescriptor): MeshSetOp {
  return Object.freeze({
    ...desc,
    poll: () => true as const,
    run: () => refuse('not-implemented', `${desc.label} is not available yet (${desc.id})`),
  });
}
