// Workspaces (M6A-SPEC §4.6, §5.17): the registry's built-in Animate definition (B0a). B9 registers Model and the
// disabled Rig & Skin and Review tabs, and owns `workspace.set`.
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp, WorkspaceDef, WorkspaceStatus } from '../types';

export const WORKSPACE = { model: 'model', rig: 'rig', animate: 'animate', review: 'review' } as const;

/** The shipped menu-bar menus, in order (Animate is today's editor). */
export const ANIMATE_MENUS: readonly string[] = [
  'file',
  'edit',
  'select',
  'key',
  'pose',
  'clip',
  'graph',
  'time',
  'playback',
  'rig',
  'view',
  'display',
  'windows',
  'help',
];

/** The shipped status-line groups, in order. */
export const ANIMATE_STATUS_GROUPS: readonly string[] = [
  'tools',
  'moveSpace',
  'rotateSpace',
  'selectionMask',
  'keyTarget',
  'keying',
  'layout',
];

/** ● when a clip has keys, ○ otherwise (§5.17). */
export function animateStatus(app: Pick<EditorApp, 'store'>): WorkspaceStatus {
  return app.store.list('keys').length > 0
    ? { glyph: 'done', reasons: [] }
    : { glyph: 'todo', reasons: ['No keys yet'] };
}

export const ANIMATE_WORKSPACE: WorkspaceDef = Object.freeze({
  id: WORKSPACE.animate,
  label: 'Animate',
  shortLabel: 'Anim',
  order: 2,
  enabled: true,
  keyScope: null,
  menus: ANIMATE_MENUS,
  statusGroups: ANIMATE_STATUS_GROUPS,
  defaultTool: 'select',
  pickMask: { controls: true, joints: false, meshes: false, groups: false },
  timeline: true,
  layout: 'animate',
  status: animateStatus,
});

/** The workspaces B0a registers (Model is B9's). */
export const BUILTIN_WORKSPACES: readonly WorkspaceDef[] = [ANIMATE_WORKSPACE];

/** Registers the built-in workspaces that are not registered yet. */
export function registerBuiltinWorkspaces(app: EditorApp): Disposer {
  const disposers: Disposer[] = [];
  for (const def of BUILTIN_WORKSPACES) {
    if (app.workspaces.get(def.id) === undefined) disposers.push(app.contribute({ kind: 'workspace', def }));
  }
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
