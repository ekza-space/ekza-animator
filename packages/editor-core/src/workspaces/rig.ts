// The Rig & Skin workspace (M6B-SPEC §5.24, §0.4.5; C0 baseline, then C7): the enabled `WorkspaceDef` with its MVP
// menus and status groups (its layout a placeholder until C7 lands `rig-side`), and the loaders of the two lazy
// chunks whose operators the runner resolves on first use (§2.1): `rig-workspace` (every skel.*, skin.*, char.*,
// rig.shape.*, rig.constraint.* and Rig & Skin rig.* operator, `select.joints`, `mesh.importStatic`,
// `file.exportCharacter`) and `clip-library` (library.*). Eager and tiny: no rig code is imported here.
import type { EditorApp, WorkspaceDef } from '../types';

/** The MVP menus (§0.4.5; `constrain` and `control` arrive after the MVP, Q-MVP-15). */
export const RIG_MENUS: readonly string[] = Object.freeze([
  'file',
  'edit',
  'create',
  'select',
  'modify',
  'display',
  'skeleton',
  'skin',
  'windows',
  'help',
]);

/** The status-line groups (§5.24; the brush strip shows in Skin mode only). */
export const RIG_STATUS_GROUPS: readonly string[] = Object.freeze([
  'tools',
  'rigMode',
  'poseView',
  'rigSymmetry',
  'rigSnap',
  'jointDisplay',
  'brush',
  'moveSpace',
  'layout',
]);

export const RIG_WORKSPACE: WorkspaceDef = Object.freeze({
  id: 'rig',
  label: 'Rig & Skin',
  shortLabel: 'Rig',
  order: 1,
  enabled: true,
  keyScope: 'rig',
  menus: RIG_MENUS,
  statusGroups: RIG_STATUS_GROUPS,
  defaultTool: 'select',
  pickMask: { controls: true, joints: true, meshes: true, groups: false },
  timeline: true,
  // Placeholder until C7 registers the `rig-side` preset (editor/src/shell/rig/layouts.ts).
  layout: 'animate',
});

/** Operator ids that live in the `rig-workspace` chunk (§2.1). */
export function isRigWorkspaceOperator(id: string): boolean {
  return (
    id.startsWith('skel.') ||
    id.startsWith('skin.') ||
    id.startsWith('char.') ||
    id.startsWith('rig.shape.') ||
    id.startsWith('rig.constraint.') ||
    id.startsWith('rig.space.') ||
    id.startsWith('rig.pose.') ||
    id.startsWith('rig.validation.') ||
    id.startsWith('rig.outliner.') ||
    id.startsWith('rig.autoRig.') ||
    id === 'rig.mode' ||
    id === 'rig.animateOnly' ||
    id === 'select.joints' ||
    id === 'mesh.importStatic' ||
    id === 'file.exportCharacter'
  );
}

/**
 * The chunk an unregistered operator id belongs to, loading (null: none). The runner awaits it and runs the id when
 * the chunk has registered it (§2.1: menus, the palette and the test API run rig ids before the tab was entered).
 */
export function lazyOperatorChunk(app: EditorApp, id: string): Promise<void> | null {
  if (id.startsWith('library.')) return app.library.loaded ? null : app.library.load();
  if (isRigWorkspaceOperator(id)) return app.rig.loaded ? null : app.rig.load();
  return null;
}
