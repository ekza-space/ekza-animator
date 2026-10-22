// What `autorig.rig` binds (AUTORIG-SPEC §4.5, §5.4; D4): shared by the operator (`./rig.ts`, rig-workspace chunk) and
// the Auto-Rig shell's runner and ③ view (lazy chunks of `@ekza-studio/autorig`), so the progress sheet's plan and the
// operator's steps never disagree. Two reads, no writes.
import type { CharacterId, MeshId, SkeletonId } from '@ekza-studio/doc';
import type { EditorApp } from '../../../../types';

/** The meshes Bind Skin binds for a character: its live meshes with data. */
export function autoRigBindMeshes(app: EditorApp, character: CharacterId): MeshId[] {
  return app.store.query
    .meshesOfOwner(character)
    .filter((mesh) => mesh.deleted === null && mesh.data !== null)
    .map((mesh) => mesh.id);
}

/** The M6b re-run case: the Quick Rig session refits `refit`, which has live bound meshes (the commit rebinds them
 *  itself, so `autorig.rig` runs no Bind Skin of its own). */
export function autoRigRefitBound(app: EditorApp, refit: SkeletonId | null): boolean {
  return refit !== null && app.store.query.meshesBoundTo(refit).some((mesh) => mesh.deleted === null);
}
