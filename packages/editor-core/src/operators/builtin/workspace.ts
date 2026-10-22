// Workspace and shell operators (M6A-SPEC §6.2, §5.17, §5.18; B9): switching workspaces, a pane's shading and
// display flags, the command palette and marking menus. The pane and overlay operators reach the viewport and the
// shell through their ports (../../workspaces/ports.ts), so they resolve in every app and poll-fail where the UI is
// missing (headless scripts).
import { EkzaError } from '@ekza-studio/anim-core';
import type { DisplayFlags, OperatorContext, Shading } from '../../types';
import { paneDisplayPort, shellOverlayPort } from '../../workspaces/ports';
import { switchWorkspace, workspaceProblem } from '../../workspaces/switch';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from './define';

export const SHADINGS: readonly Shading[] = ['wire', 'shaded', 'colours', 'lit'];
const NORMALS: readonly DisplayFlags['normals'][] = ['off', 'face', 'vertex', 'both'];

/** Every `DisplayFlags` field and the values it takes (enums listed; the rest are booleans). */
const ENUM_FLAGS: Readonly<Partial<Record<keyof DisplayFlags, readonly string[]>>> = {
  shading: SHADINGS,
  normals: NORMALS,
  // M6b (§4.6; C7's Display menu): the joint and weight display.
  jointAxes: ['none', 'selected', 'all'],
  jointLabels: ['none', 'hover', 'all'],
  weights: ['off', 'greyscale', 'ramp', 'influences'],
};
export const BOOLEAN_DISPLAY_FLAGS: readonly (keyof DisplayFlags)[] = [
  'mesh',
  'skeleton',
  'controls',
  'grid',
  'xray',
  'hud',
  'springBones',
  'wireOnShaded',
  'flat',
  'cull',
  'components',
  'faceOrientation',
  'triangulation',
  'hardEdges',
  'polyCount',
  'meshCheck',
  'symmetryPlane',
  'dimUnhilited',
  'imagePlanes',
  // M6b (§4.6)
  'joints',
  'xrayJoints',
  'weightNumbers',
  'lockRelative',
  'constraintLines',
];

/** Why a `DisplayFlags` patch is invalid, or null. */
export function displayPatchProblem(patch: unknown): string | null {
  if (!isRecord(patch)) return 'expects { patch }';
  for (const [key, value] of Object.entries(patch)) {
    const options = ENUM_FLAGS[key as keyof DisplayFlags];
    if (options !== undefined) {
      if (typeof value !== 'string' || !options.includes(value)) return `${key} is one of ${options.join(', ')}`;
    } else if (BOOLEAN_DISPLAY_FLAGS.includes(key as keyof DisplayFlags)) {
      if (typeof value !== 'boolean') return `${key} is true or false`;
    } else {
      return `Unknown display flag '${key}'`;
    }
  }
  return null;
}

/** The pane a display operator acts on: explicit, the run's, the hovered one, else the viewport's active pane. */
function paneOf(ctx: OperatorContext, explicit: unknown): string | null {
  const port = paneDisplayPort(ctx.app);
  if (port === null) return null;
  const panes = port.panes();
  const candidates = [
    typeof explicit === 'string' ? explicit : undefined,
    ctx.paneId,
    ctx.app.session.getState().hoveredPanel?.paneId,
    port.activePane(),
  ];
  // An explicit pane that does not exist is an error, not a fallback.
  if (typeof explicit === 'string') return panes.includes(explicit) ? explicit : null;
  for (const id of candidates) if (typeof id === 'string' && panes.includes(id)) return id;
  return null;
}

function pollPane(ctx: OperatorContext, explicit: unknown): true | { readonly ok: false; readonly reason: string } {
  if (paneDisplayPort(ctx.app) === null) return fail('No viewport pane');
  if (paneOf(ctx, explicit) === null) {
    return fail(typeof explicit === 'string' ? `No viewport pane '${explicit}'` : 'No viewport pane');
  }
  return OK;
}

function patchPane(ctx: OperatorContext, explicit: unknown, patch: Partial<DisplayFlags>): void {
  const port = paneDisplayPort(ctx.app);
  const pane = paneOf(ctx, explicit);
  const display = pane === null ? null : (port?.display(pane) ?? null);
  if (port === null || pane === null || display === null) throw new EkzaError('unsupported', 'No viewport pane');
  const next = { ...display, ...patch };
  const changed = (Object.keys(patch) as (keyof DisplayFlags)[]).some((key) => next[key] !== display[key]);
  if (changed) port.setDisplay(pane, next);
}

const setWorkspace = defineOperator({
  id: 'workspace.set',
  label: 'Switch Workspace',
  description: 'Switches the workspace (Model, Rig & Skin, Animate, Review); the document, selection and time stay.',
  category: 'workspace',
  scope: 'global',
  extraArgs: ['workspace'],
  poll({ app }, args) {
    const problem = workspaceProblem(app, isRecord(args) ? args['workspace'] : undefined);
    return problem === null ? OK : fail(problem);
  },
  // M6b (§2.1): entering Rig & Skin awaits the rig-workspace chunk (its operators are registered on entry).
  prepare: ({ app }, args) => (args.workspace === 'rig' && !app.rig.loaded ? app.rig.load() : undefined),
  apply({ app }, args) {
    switchWorkspace(app, args.workspace);
  },
});

const shading = defineOperator({
  id: 'view.shading',
  label: 'Shading',
  description: "Sets a viewport pane's shading: wireframe (4), shaded (5), colours (6) or lit (7).",
  category: 'view',
  scope: 'global',
  extraArgs: ['mode', 'paneId'],
  poll(ctx, args) {
    if (
      !isRecord(args) ||
      typeof args['mode'] !== 'string' ||
      !(SHADINGS as readonly string[]).includes(args['mode'])
    ) {
      return fail(`expects { mode: ${SHADINGS.join(' | ')} }`);
    }
    return pollPane(ctx, args['paneId']);
  },
  apply(ctx, args) {
    patchPane(ctx, args.paneId, { shading: args.mode });
  },
});

const displaySet = defineOperator({
  id: 'view.display.set',
  label: 'Set Display',
  description: "Sets any of a viewport pane's display flags.",
  category: 'view',
  scope: 'global',
  extraArgs: ['patch', 'paneId'],
  poll(ctx, args) {
    const problem = displayPatchProblem(isRecord(args) ? args['patch'] : undefined);
    return problem === null ? pollPane(ctx, isRecord(args) ? args['paneId'] : undefined) : fail(problem);
  },
  apply(ctx, args) {
    patchPane(ctx, args.paneId, args.patch);
  },
});

const commandPalette = defineOperator({
  id: 'ui.commandPalette',
  label: 'Command Palette',
  description: 'Searches every operator of the current workspace and runs one.',
  category: 'ui',
  scope: 'global',
  aliases: ['Search', 'F3 Search', 'Menu Search', 'Find Command'],
  poll: ({ app }) => (shellOverlayPort(app) === null ? fail('The command palette needs the editor window') : OK),
  apply({ app }) {
    shellOverlayPort(app)?.openCommandPalette();
  },
});

const markingMenu = defineOperator({
  id: 'ui.markingMenu',
  label: 'Marking Menu',
  description: 'Opens a marking menu at the pointer.',
  category: 'ui',
  scope: 'global',
  extraArgs: ['menu'],
  flags: { internal: true },
  poll({ app }, args) {
    const id = isRecord(args) ? args['menu'] : undefined;
    if (typeof id !== 'string' || id === '') return fail('expects { menu }');
    const def = app.markingMenus.get(id);
    if (def === undefined) return fail(`Unknown marking menu '${id}'`);
    const workspace = app.session.getState().workspace;
    if (!def.workspaces.includes(workspace)) {
      const where = def.workspaces.map((w) => app.workspaces.get(w)?.label ?? w).join(', ');
      return fail(`This menu is available in ${where}`);
    }
    const modes = def.when.modes;
    if (modes !== undefined && !modes.includes(app.session.getState().model.componentMode)) {
      return fail(`This menu works in ${modes.join(', ')} mode`);
    }
    return shellOverlayPort(app) === null ? fail('Marking menus need the editor window') : OK;
  },
  apply(ctx, args) {
    const def = ctx.app.markingMenus.get(args.menu);
    if (def === undefined) throw new EkzaError('unsupported', `Unknown marking menu '${args.menu}'`);
    shellOverlayPort(ctx.app)?.openMarkingMenu(def, {
      ...(ctx.panel === null ? {} : { panel: ctx.panel }),
      ...(ctx.paneId === null ? {} : { paneId: ctx.paneId }),
      ...(ctx.source === undefined ? {} : { source: ctx.source }),
    });
  },
});

export const WORKSPACE_OPERATORS: readonly AnyOperator[] = [
  setWorkspace,
  shading,
  displaySet,
  commandPalette,
  markingMenu,
];
