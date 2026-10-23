// The Rig & Skin workspace (M6B-SPEC §5.24, §0.4.5; C0 baseline, then C7): the enabled `WorkspaceDef` with its MVP
// menus and status groups, the `rig-side` layout, the mode key scopes (CR-4) and the tab glyph, and the loaders of the
// two lazy chunks whose operators the runner resolves on first use (§2.1): `rig-workspace` (every skel.*, skin.*, char.*,
// rig.shape.*, rig.constraint.* and Rig & Skin rig.* operator, `select.joints`, `mesh.importStatic`,
// `file.exportCharacter`, and the Auto-Rig compositions `autorig.*`, AUTORIG-SPEC §4.5) and `clip-library`
// (library.*). Eager and tiny: no rig code is imported here.
import type { EditorApp, WorkspaceDef, WorkspaceStatus } from '../types';
import { AGENT_OPERATOR_IDS, loadAgentOperators } from '../operators/builtin/agentChunk';

/** The MVP menus (§0.4.5; `constrain` and `control` arrive after the MVP, Q-MVP-15). */
export const RIG_MENUS: readonly string[] = [
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
];

/** The status-line groups (§5.24; the brush strip shows in Skin mode only). */
export const RIG_STATUS_GROUPS: readonly string[] = [
  'tools',
  'rigMode',
  'poseView',
  'rigSymmetry',
  'rigSnap',
  'jointDisplay',
  'brush',
  'moveSpace',
  'layout',
];

export const RIG_WORKSPACE: WorkspaceDef = {
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
  layout: 'rig-side',
  // CR-4 (§7): `rig.viewport.<mode>` in front of `rig.viewport` outside Object mode.
  keyModes: (app) => {
    const mode = app.session.getState().rig.mode;
    return mode === 'object' ? [] : [mode];
  },
  status: rigStatus,
};

const NO_GLYPH: WorkspaceStatus = { glyph: 'todo', reasons: ['No skeleton yet'] };

/** The tab glyph (§5.21): the Validation service's glyph of the active character once the rig chunk is loaded. */
export function rigStatus(app: EditorApp): WorkspaceStatus {
  const character = app.session.getState().rig.character;
  if (character === null || !app.rig.loaded) return NO_GLYPH;
  return app.rig.validation.status(character, null);
}

/**
 * Unregistered operator ids the `rig-workspace` chunk registers (§2.1): every skel.*, skin.*, char.* and Rig & Skin
 * rig.* operator (Animate's rig.* operators are eager, so they are always registered), `select.joints`,
 * `mesh.importStatic` and `file.exportCharacter`; AUTORIG-SPEC §4.5 (D0): every `autorig.*` composition.
 */
export function isRigWorkspaceOperator(id: string): boolean {
  return /^(?:(?:skel|skin|char|rig|autorig)\.|(?:select\.joints|mesh\.importStatic|file\.exportCharacter)$)/.test(id);
}

/**
 * The chunk an unregistered operator id belongs to, loading (null: none). The runner awaits it and runs the id when
 * the chunk has registered it (§2.1: menus, the palette and the test API run rig ids before the tab was entered).
 */
export function lazyOperatorChunk(app: EditorApp, id: string): Promise<void> | null {
  if (id.startsWith('library.')) return app.library.loaded ? null : app.library.load();
  if (isRigWorkspaceOperator(id)) return app.rig.loaded ? null : app.rig.load();
  // M-AI (MCP-SPEC §0.4): the explicit-target operators' chunk.
  if (AGENT_OPERATOR_IDS.has(id)) return loadAgentOperators(app);
  return null;
}
