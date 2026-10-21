// `rig.autoRig.update` core (M6B-SPEC §4.3, §5.16; C1). C0 working baseline: regenerate the rig from the skeleton
// with the shipped `autoRig` (control ids are `<rigId>:<templateKey>`, so every surviving control keeps its id and its
// curves) and soft-delete the current controls whose template key the new skeleton no longer produces. C1 replaces it
// with the full §5.16 rules (edited shapes kept, jointKeys for non-humanoid keys, props and sockets, stale offsets).
import type { CharacterId, ControlId, RigId } from '@ekza-studio/doc';
import type { AutoRigUpdate, RigDefinition, SkeletonDesc } from '../types';
import { autoRig } from './autoRig';

export function updateAutoRig(
  current: RigDefinition | null,
  skeleton: SkeletonDesc,
  ids: { readonly character: CharacterId; readonly rig: RigId },
  opts: { readonly ik: { readonly legs: boolean; readonly arms: boolean } },
): AutoRigUpdate {
  const fresh = autoRig(skeleton, ids, { ik: opts.ik });
  if (current === null) return { rig: fresh, softDeleted: [], staleOffsets: [], warnings: [] };
  const kept = new Set<ControlId>(fresh.controls.map((control) => control.id));
  const softDeleted = current.controls
    .filter((control) => control.deleted === null && !kept.has(control.id))
    .map((control) => control.id);
  const warnings = softDeleted.map((id) => `${id}: its bone is gone; the control is removed and its curves are kept`);
  return { rig: fresh, softDeleted, staleOffsets: [], warnings };
}
