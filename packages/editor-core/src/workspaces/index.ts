// Workspaces (M6A-SPEC §4.6, §5.17; B0a Animate, B9 the rest): the tabs `Model › Rig & Skin › Animate › Review`.
// Model and Animate are built; Rig & Skin and Review are disabled tabs with the release they arrive in. Each
// definition carries its menus, status-line groups, key scope, default tool and pick mask, timeline visibility and
// layout preset; `workspace.set` (./switch.ts) applies them.
import type { Disposer } from '@ekza-studio/anim-core';
import type { MeshId, MeshRecord } from '@ekza-studio/doc';
import { meshKernel } from '../mesh';
import { MODEL_MENUS } from '../operators/builtin/menus';
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

/** Model's status line (§8.2): `[Q][W][E][R] │ Mode │ Sym │ Soft │ Snap │ Piv │ Space │ Layout`. */
export const MODEL_STATUS_GROUPS: readonly string[] = [
  'tools',
  'mode',
  'symmetry',
  'soft',
  'snap',
  'pivot',
  'moveSpace',
  'layout',
];

/** ● when a clip has keys, ○ otherwise (§5.17). */
export function animateStatus(app: Pick<EditorApp, 'store'>): WorkspaceStatus {
  return app.store.list('keys').length > 0
    ? { glyph: 'done', reasons: [] }
    : { glyph: 'todo', reasons: ['No keys yet'] };
}

/** Triangle budgets of the presets (§5.24; advisory): the target a mesh must stay within for Model's ●. */
export const BUDGET_TRIS: Readonly<Record<string, number>> = {
  hero: 3000,
  npc: 1000,
  boss: 6000,
  handheld: 600,
  'small-prop': 300,
  'medium-prop': 1500,
  building: 5000,
};

const BUDGET_LABEL: Readonly<Record<string, string>> = {
  hero: 'Hero',
  npc: 'NPC',
  boss: 'Boss',
  handheld: 'Handheld',
  'small-prop': 'Small prop',
  'medium-prop': 'Medium prop',
  building: 'Building',
};

/** A mesh's triangle budget: its own, else the nearest parent's (§5.24); null without one. */
export function meshBudget(
  app: Pick<EditorApp, 'store'>,
  mesh: MeshRecord,
): { readonly tris: number; readonly label: string } | null {
  let budget = mesh.budget;
  let parent = mesh.parent;
  const seen = new Set<string>([mesh.id]);
  while (budget === null && parent !== null && !seen.has(parent)) {
    seen.add(parent);
    const record = app.store.get('groups', parent as never) ?? app.store.get('meshes', parent as MeshId);
    if (record === undefined || record.deleted !== null) break;
    budget = record.budget;
    parent = record.parent;
  }
  if (budget === null) return null;
  if ('tris' in budget) return { tris: budget.tris, label: `${budget.tris.toLocaleString('en')} tris` };
  const tris = BUDGET_TRIS[budget.preset];
  return tris === undefined ? null : { tris, label: BUDGET_LABEL[budget.preset] ?? budget.preset };
}

/** Mesh Check results per runtime version (the kernel's `checkMesh`, B5); recomputed only when a mesh changes. */
const checks = new WeakMap<object, Map<MeshId, { readonly version: number; readonly count: number | null }>>();

function problemCount(app: Pick<EditorApp, 'meshes'>, id: MeshId): number | null {
  const runtime = app.meshes.get(id);
  if (runtime === undefined || runtime.state !== 'ready') return null;
  let cache = checks.get(app.meshes);
  if (cache === undefined) {
    cache = new Map();
    checks.set(app.meshes, cache);
  }
  const hit = cache.get(id);
  if (hit !== undefined && hit.version === runtime.version) return hit.count;
  let count: number | null = null;
  const kernel = meshKernel();
  const data = runtime.data();
  if (kernel !== null && data !== null) {
    try {
      // "Clean" = no code except `open-border` on open meshes (§5.25).
      count = kernel.checkMesh(data).filter((problem) => problem.code !== 'open-border').length;
    } catch {
      count = null; // Mesh Check has not landed (B5) or cannot read this mesh: nothing to report.
    }
  }
  cache.set(id, { version: runtime.version, count });
  return count;
}

/**
 * Model's tab glyph (§5.17): ● when every editable mesh passes Mesh Check and is within its budget, ◐ with the
 * failing reasons, ○ without an editable mesh. Derived and cheap (cached per mesh version); read at human speed.
 */
export function modelStatus(app: Pick<EditorApp, 'store' | 'meshes'>): WorkspaceStatus {
  const meshes = app.store.list('meshes').filter((mesh) => mesh.deleted === null && mesh.data !== null);
  if (meshes.length === 0) return { glyph: 'todo', reasons: ['No editable mesh yet'] };
  const reasons: string[] = [];
  for (const mesh of meshes) {
    const problems = problemCount(app, mesh.id);
    if (problems !== null && problems > 0) {
      reasons.push(`${mesh.name}: Mesh Check found ${problems} problem${problems === 1 ? '' : 's'}`);
    }
    const budget = meshBudget(app, mesh);
    const runtime = app.meshes.get(mesh.id);
    if (budget !== null && runtime !== undefined && runtime.state === 'ready') {
      const tris = runtime.triangulation().triFace.length;
      if (tris > budget.tris) {
        reasons.push(
          `${mesh.name}: ${tris.toLocaleString('en')} tris, over the ${budget.label} budget (${budget.tris.toLocaleString('en')})`,
        );
      }
    }
  }
  return reasons.length === 0 ? { glyph: 'done', reasons: [] } : { glyph: 'attention', reasons };
}

export const MODEL_WORKSPACE: WorkspaceDef = Object.freeze({
  id: WORKSPACE.model,
  label: 'Model',
  shortLabel: 'Mdl',
  order: 0,
  enabled: true,
  keyScope: 'model',
  menus: MODEL_MENUS,
  statusGroups: MODEL_STATUS_GROUPS,
  defaultTool: 'select',
  pickMask: { controls: false, joints: false, meshes: true, groups: true },
  timeline: false,
  layout: 'model-quad',
  status: modelStatus,
});

export const RIG_WORKSPACE: WorkspaceDef = Object.freeze({
  id: WORKSPACE.rig,
  label: 'Rig & Skin',
  shortLabel: 'Rig',
  order: 1,
  enabled: false,
  disabledReason: 'Arrives with characters from your own models (v0.4)',
  keyScope: null,
  menus: ANIMATE_MENUS,
  statusGroups: ANIMATE_STATUS_GROUPS,
  defaultTool: 'select',
  pickMask: { controls: true, joints: true, meshes: false, groups: false },
  timeline: true,
  layout: 'animate',
});

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

export const REVIEW_WORKSPACE: WorkspaceDef = Object.freeze({
  id: WORKSPACE.review,
  label: 'Review',
  shortLabel: 'Rev',
  order: 3,
  enabled: false,
  disabledReason: 'Arrives in V1',
  keyScope: null,
  menus: ANIMATE_MENUS,
  statusGroups: ANIMATE_STATUS_GROUPS,
  defaultTool: 'select',
  pickMask: { controls: true, joints: false, meshes: false, groups: false },
  timeline: true,
  layout: 'animate',
});

/** The built-in workspaces, in tab order (§5.17). */
export const BUILTIN_WORKSPACES: readonly WorkspaceDef[] = [
  MODEL_WORKSPACE,
  RIG_WORKSPACE,
  ANIMATE_WORKSPACE,
  REVIEW_WORKSPACE,
];

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

/** The registered workspaces in tab order. */
export function workspaceTabs(app: Pick<EditorApp, 'workspaces'>): readonly WorkspaceDef[] {
  return [...app.workspaces.list()].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export {
  type PaneDisplayPort,
  paneDisplayPort,
  providePaneDisplay,
  provideShellOverlays,
  type ShellOverlayPort,
  shellOverlayPort,
} from './ports';
export {
  DEFAULT_WORKSPACE_VIEWS,
  isTransformTool,
  LEFT_MODEL_REASON,
  switchWorkspace,
  workspaceProblem,
} from './switch';
