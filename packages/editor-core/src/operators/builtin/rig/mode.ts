// C7 (rig shell; M6B-SPEC §5.24, §6.3, §0.6): the Rig & Skin modes and the Validation profile.
//
// - `rig.mode {mode}`: 'skeleton' (`1`) and 'skin' (`2`) enter that mode; pressing the active mode's digit again
//   returns to Object (menus, the status line and scripts are idempotent); 'toggle' (`F8`) switches between Object
//   and the last mode; 'object' returns. Skin needs a bound mesh of the active character ("Bind a mesh first (Skin ›
//   Bind Skin)"); Shapes arrives after the MVP. A mode switch is U state (no undo step): it sets the pick mask and the
//   default tool of the mode (Select; Skin: Paint Skin Weights once C6 registers it), cancels channel gestures and
//   closes the Last-op card. Selection is remembered per mode (§5.24): the joints of Skeleton mode and the controls of
//   Object mode come back when the mode is entered again (points stay per mesh in the component selection service).
//   The shell follows `session.rig.mode` with the dock tabs (`tabMemory`).
// - `rig.validation.profile {profile}`: the profile the Validation panel shows (U state).
// `rig.outliner.delete` stays a deferred stub (the Rig Outliner needs CR-5).
import { EkzaError } from '@ekza-studio/anim-core';
import { cancelChannelEditGestures } from '../../../edit/channels';
import { rigValidation } from '../../../rig/validation';
import type { EditorApp, OperatorContext, PollResult, RigMode, Selection, SelectionMask } from '../../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from '../define';
import { ARRIVES_AFTER_MVP, rigStub } from './stub';

const MODES: readonly (RigMode | 'toggle')[] = ['object', 'skeleton', 'skin', 'shape', 'toggle'];
/** `2` without a bound mesh (§5.24). */
export const BIND_A_MESH_FIRST = 'Bind a mesh first (Skin › Bind Skin)';
/** Rig & Skin operators outside the workspace. */
export const RIG_ONLY_REASON = 'Rig & Skin modes are in the Rig & Skin workspace';

/** Pick masks per mode (§5.24 table): Object picks meshes, joints and controls; Skeleton joints only; Skin the points
 *  of the bound meshes and the joint glyphs (the mesh layer stays pickable for the brush). */
export const MODE_MASKS: Readonly<Record<RigMode, SelectionMask>> = {
  object: { controls: true, joints: true, meshes: true, groups: false },
  skeleton: { controls: false, joints: true, meshes: false, groups: false },
  skin: { controls: false, joints: true, meshes: true, groups: false },
  shape: { controls: true, joints: false, meshes: false, groups: false },
};
/** The default tool per mode (§5.24): Select, except Paint Skin Weights in Skin mode. */
export const MODE_TOOLS: Readonly<Record<RigMode, string>> = {
  object: 'select',
  skeleton: 'select',
  skin: 'paintSkinWeights',
  shape: 'select',
};

/** Whether the active character (else any character) has a bound mesh. */
export function hasBoundMesh(app: Pick<EditorApp, 'store' | 'session'>): boolean {
  const character = app.session.getState().rig.character;
  return app.store
    .list('meshes')
    .some(
      (mesh) =>
        mesh.skin !== null && 'character' in mesh.owner && (character === null || mesh.owner.character === character),
    );
}

/** The mode a `rig.mode` run switches to (the active digit again → Object for keyboard runs). */
export function targetRigMode(ctx: Pick<OperatorContext, 'app' | 'source'>, mode: RigMode | 'toggle'): RigMode {
  const rig = ctx.app.session.getState().rig;
  if (mode === 'toggle') return rig.mode === 'object' ? rig.lastMode : 'object';
  if (mode !== 'object' && mode === rig.mode && ctx.source === 'keyboard') return 'object';
  return mode;
}

function pollMode(ctx: OperatorContext, args: unknown): PollResult {
  if (!isRecord(args) || !MODES.includes(args['mode'] as RigMode)) return fail('expects { mode }');
  if (ctx.app.session.getState().workspace !== 'rig') return fail(RIG_ONLY_REASON);
  const target = targetRigMode(ctx, args['mode'] as RigMode | 'toggle');
  if (target === 'shape') return fail(ARRIVES_AFTER_MVP);
  if (target === 'skin' && !hasBoundMesh(ctx.app)) return fail(BIND_A_MESH_FIRST);
  return OK;
}

/** The selection each mode had when it was left (per app session; §5.24). */
const remembered = new WeakMap<object, Map<RigMode, readonly string[]>>();
/** The selection list a mode remembers: joints (Skeleton), controls (Object). */
const MODE_SELECTION: Partial<Record<RigMode, 'joints' | 'controls'>> = { skeleton: 'joints', object: 'controls' };

/** The selection with the entered mode's remembered list back (live records only), after saving the left mode's. */
function modeSelection(app: EditorApp, from: RigMode, to: RigMode): Selection {
  const selection = app.session.getState().selection;
  let memory = remembered.get(app.session);
  if (memory === undefined) {
    memory = new Map();
    remembered.set(app.session, memory);
  }
  const left = MODE_SELECTION[from];
  if (left !== undefined) memory.set(from, selection[left]);
  const entered = MODE_SELECTION[to];
  const list = memory.get(to);
  if (entered === undefined || list === undefined) return selection;
  const table = entered === 'joints' ? 'joints' : 'controls';
  const live = list.filter((id) => {
    const record = app.store.get(table, id as never) as { readonly deleted?: unknown } | undefined;
    return record !== undefined && (record.deleted ?? null) === null;
  });
  return { ...selection, [entered]: live };
}

/** Switches the mode (U state; the caller polled). */
export function setRigMode(app: EditorApp, mode: RigMode): void {
  const state = app.session.getState();
  if (state.rig.mode === mode) return;
  cancelChannelEditGestures(app);
  const selection = modeSelection(app, state.rig.mode, mode);
  const tool = app.tools.get('viewport', MODE_TOOLS[mode]) === undefined ? 'select' : MODE_TOOLS[mode];
  const lastRun =
    state.lastRun !== null && state.lastRun.closed === null
      ? { ...state.lastRun, closed: 'Changed the Rig & Skin mode' }
      : state.lastRun;
  app.session.setState({
    rig: { ...state.rig, mode, lastMode: mode === 'object' ? state.rig.lastMode : mode },
    tools: { ...state.tools, viewport: tool, selectionMask: MODE_MASKS[mode] },
    lastRun,
    ...(selection === state.selection ? {} : { selection }),
  });
}

const rigMode = defineOperator({
  id: 'rig.mode',
  label: 'Rig Mode',
  description: 'Switches between Object, Skeleton (1) and Skin (2) modes of Rig & Skin; F8 toggles the last mode.',
  category: 'rig',
  scope: 'rig',
  workspaces: ['rig'],
  extraArgs: ['mode'],
  poll: pollMode,
  apply(ctx, args) {
    setRigMode(ctx.app, targetRigMode(ctx, args.mode));
  },
});

const validationProfile = defineOperator({
  id: 'rig.validation.profile',
  label: 'Validation Profile',
  description: 'Chooses the export profile the Validation rows are checked against.',
  category: 'rig',
  scope: 'rig',
  flags: { internal: true },
  workspaces: ['rig'],
  extraArgs: ['profile'],
  poll(_ctx, args) {
    if (!isRecord(args)) return fail('expects { profile }');
    const profile = args['profile'];
    return profile === null || (typeof profile === 'string' && profile !== '') ? OK : fail('expects { profile }');
  },
  apply({ app }, args) {
    if (!app.rig.loaded) throw new EkzaError('unavailable', 'The Rig & Skin services are not loaded');
    rigValidation(app).setProfile(args.profile);
  },
});

export const MODE_OPERATORS: readonly AnyOperator[] = [
  rigMode,
  validationProfile,
  rigStub('rig.outliner.delete', 'Delete', { undo: true, deferred: true }),
];
