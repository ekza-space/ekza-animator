// The options B10 checks a mesh with (M6A-SPEC §5.25; the Mesh Check panel, its overlay, "select matching" and the test
// API read the same problems): the visible elements only (the mesh's hidden set), `closedExpected` for a mesh that its
// template flags closed, and `duplicateSlots` from the mesh's palette.
//
// - **Closed by its template** (M6A-B10-18): a mesh under a template group (`GroupRecord.template`: prop, handheld,
//   humanoid; §5.16 — AS-LP's sword, grip and body parts are closed solids) or the humanoid body generator's mesh
//   (§5.16 "closed and manifold"). Every other mesh is open by default ("Clean" ignores `open-border` on it).
// - **Duplicate slots**: the slots two live swatches of the mesh's palette share (a merge of two peers' palettes can
//   produce them; the slot rule never reuses one locally).
import type { GroupId, MeshId, MeshRecord, ReadView } from '@ekza-animator/doc';
import type { HiddenSet } from '@ekza-animator/mesh-core';
import type { EditorApp } from '../../types';

export interface MeshCheckOptions {
  readonly hidden?: HiddenSet | null;
  readonly closedExpected?: boolean;
  readonly duplicateSlots?: ReadonlySet<number>;
}

/** How many parents a lookup follows (a cycle in a corrupt document never loops forever). */
const MAX_DEPTH = 64;

/** Whether a mesh's template flags it closed: a template group above it, or the humanoid body generator. */
export function closedExpectedOf(view: Pick<ReadView, 'get'>, mesh: MeshRecord): boolean {
  if (mesh.generator?.kind === 'humanoidBody') return true;
  let parent: string | null = mesh.parent;
  for (let depth = 0; parent !== null && depth < MAX_DEPTH; depth++) {
    if (parent.startsWith('grp_')) {
      const group = view.get('groups', parent as GroupId);
      if (group === undefined || group.deleted !== null) return false;
      if (group.template !== null) return true;
      parent = group.parent;
    } else {
      const owner = view.get('meshes', parent as MeshId);
      if (owner === undefined || owner.deleted !== null) return false;
      parent = owner.parent;
    }
  }
  return false;
}

/** The slots that two or more live swatches of the mesh's palette share (empty without a palette). */
export function duplicateSlotsOf(app: Pick<EditorApp, 'store'>, mesh: MeshRecord): ReadonlySet<number> {
  const out = new Set<number>();
  if (mesh.palette === null) return out;
  const seen = new Set<number>();
  for (const swatch of app.store.query.swatchesOfPalette(mesh.palette)) {
    if (swatch.deleted !== null) continue;
    if (seen.has(swatch.slot)) out.add(swatch.slot);
    seen.add(swatch.slot);
  }
  return out;
}

/** The `checkMesh` options of a mesh in the editor (hidden components, closed template, duplicate slots). */
export function meshCheckOptions(app: Pick<EditorApp, 'store' | 'components'>, mesh: MeshId): MeshCheckOptions {
  const record = app.store.get('meshes', mesh);
  let hidden: HiddenSet | null = null;
  try {
    hidden = app.components.hidden(mesh);
  } catch {
    hidden = null;
  }
  if (record === undefined) return { hidden };
  const duplicateSlots = duplicateSlotsOf(app, record);
  return {
    hidden,
    closedExpected: closedExpectedOf(app.store, record),
    ...(duplicateSlots.size > 0 ? { duplicateSlots } : {}),
  };
}
