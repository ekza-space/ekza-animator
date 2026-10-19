// Contract file: the operator policy table of MCP-SPEC §5.14 as data. It classifies every operator id registered by
// `registerBuiltins` at v0.2.0, the ten M-AI operators and the operators other packages register at run time
// (`viewport`'s `view.*`, the shell's `workspace.*`, `prefs.set`, the curve editor's frames). Resolution order:
// `OperatorDef.agent` (only honoured for built-ins and trusted extensions, research 08 §8.3), then this table, else
// denied — so new operators (M6a's, M6b's, extensions') are denied until someone classifies them.
import type { ChannelId, ClipId, ControlId } from '@ekza-animator/doc';
import { isLocked, type EditorApp, type OperatorAgentPolicy, type OperatorDef } from '@ekza-animator/editor-core';

const DENIED_FILES = 'files go through project_open, project_import, project_save and project_export';
const DENIED_PLAYHEAD =
  "acts at the playhead or on the user's clipboard, pins or selection; use pose_set, keys_set, keys_delete, pose_transfer, pose_reset or pose_ik_target";
const DENIED_UNDO = "the user's undo navigation; use history_revert";
const DENIED_PANE_CAMERA = "needs the user's pane camera; ask the user to run View › Copy View to Shot";
const DENIED_USER_STATE = "the user's preferences, tools, buffers and UI";
/** The reason an operator without a classification answers `denied_operator` with. */
export const UNCLASSIFIED_REASON = 'this operator is not classified for agents';

const SCOPE_READY: OperatorAgentPolicy = { policy: 'allowed', access: 'edit', runScope: true };
const ALLOWED_EDIT: OperatorAgentPolicy = { policy: 'allowed', access: 'edit' };
const CONFIRM_EDIT: OperatorAgentPolicy = { policy: 'confirm', access: 'edit' };
const ALLOWED_VIEW: OperatorAgentPolicy = { policy: 'allowed', access: 'view' };

function denied(reason: string): OperatorAgentPolicy {
  return { policy: 'denied', reason };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `channel.toggleLock` unlocking (locked: false, or a toggle of locked channels) asks the user (§5.9). */
function unlockConfirm(app: EditorApp, args: unknown): string | null {
  if (!isRecord(args) || !Array.isArray(args['refs']) || args['locked'] === true) return null;
  let unlocking = 0;
  for (const ref of args['refs'] as readonly unknown[]) {
    if (!isRecord(ref) || typeof ref['control'] !== 'string' || typeof ref['channel'] !== 'string') continue;
    const control = app.store.get('controls', ref['control'] as ControlId);
    if (control !== undefined && isLocked(control, ref['channel'] as ChannelId)) unlocking++;
  }
  return unlocking === 0 ? null : `AI wants to unlock ${unlocking} channel${unlocking === 1 ? '' : 's'} you locked`;
}

/** Overrides (unkeyed edits) the user has on a character's controls. */
function overridesOn(app: EditorApp, character: string): number {
  let count = 0;
  for (const control of app.session.getState().overrides.keys()) {
    const record = app.store.get('controls', control);
    const rig = record === undefined ? undefined : app.store.get('rigs', record.rig);
    if (rig?.character === character) count++;
  }
  return count;
}

/** `clip.setSettings` asks when it changes fps, or range/scene start/loop while the user has overrides (§5.9). */
function clipSettingsConfirm(app: EditorApp, args: unknown): string | null {
  if (!isRecord(args) || typeof args['clip'] !== 'string') return null;
  const clip = app.store.get('clips', args['clip'] as ClipId);
  if (clip === undefined) return null;
  const fps = args['fps'];
  if (isRecord(fps) && (fps['num'] !== clip.fps.num || fps['den'] !== clip.fps.den)) {
    return `AI wants to change the frame rate of clip "${clip.name.slice(0, 40)}"`;
  }
  const moves = args['range'] !== undefined || args['sceneStart'] !== undefined || args['loop'] !== undefined;
  const overrides = moves ? overridesOn(app, clip.character) : 0;
  return overrides === 0 ? null : `This change drops your ${overrides} unkeyed edit${overrides === 1 ? '' : 's'}`;
}

/** `time.setFrame` (View) asks while the user has unkeyed overrides: moving the playhead drops them (§5.9). */
function setFrameConfirm(app: EditorApp): string | null {
  const overrides = app.session.getState().overrides.size;
  return overrides === 0
    ? null
    : `Moving the playhead drops your ${overrides} unkeyed edit${overrides === 1 ? '' : 's'}`;
}

/** The §5.14 table, by operator id. */
export const OPERATOR_POLICY: Readonly<Record<string, OperatorAgentPolicy>> = {
  // allowed, scope-ready (`operator_run {context}` works): edit
  'graph.tangent.set': SCOPE_READY,
  'graph.tangent.break': SCOPE_READY,
  'graph.tangent.unify': SCOPE_READY,
  'graph.tangent.lockWeight': SCOPE_READY,
  'graph.curve.setWeighted': SCOPE_READY,
  'graph.infinity.set': SCOPE_READY,
  'graph.keys.setFields': SCOPE_READY,
  'graph.curves.simplify': SCOPE_READY,
  'graph.eulerFilter': SCOPE_READY,
  'key.tween': SCOPE_READY,
  'key.convert': SCOPE_READY,
  'pose.mirrorAnimation': SCOPE_READY,
  // allowed, explicit arguments: edit
  'key.write': ALLOWED_EDIT,
  'key.delete': ALLOWED_EDIT,
  'key.adjust': ALLOWED_EDIT,
  'key.retime': ALLOWED_EDIT,
  // `mode: 'propose'` is View access (the wire schema of P3 resolves it per call); 'key' and 'static' are edits.
  'pose.setAt': ALLOWED_EDIT,
  'pose.goals': ALLOWED_EDIT,
  'pose.transfer': ALLOWED_EDIT,
  'clip.makeLoop': ALLOWED_EDIT,
  // The wire schemas default `activate` to false; `activate: true` needs View (P3).
  'clip.new': ALLOWED_EDIT,
  'clip.duplicate': ALLOWED_EDIT,
  'clip.rename': ALLOWED_EDIT,
  'graph.key.insert': ALLOWED_EDIT, // actor-safe after P1
  'rig.setControlSize': ALLOWED_EDIT,
  'rig.ikFk.matchRange': ALLOWED_EDIT, // actors must pass clip and range (P1)
  'channel.toggleLock': { policy: 'allowed', access: 'edit', confirmWhen: unlockConfirm },
  // confirm: edit
  'clip.delete': {
    policy: 'confirm',
    access: 'edit',
    reason: 'deleting a clip loses its animation (undo restores it)',
  }, // actor-safe after P1
  'clip.setSettings': { policy: 'allowed', access: 'edit', confirmWhen: clipSettingsConfirm },
  'rig.addLimbIk': { ...CONFIRM_EDIT, reason: 'changes the rig of the character' },
  'rig.setFootParams': { ...CONFIRM_EDIT, reason: 'changes the rig of the character' },
  'rig.setRotateOrder': { ...CONFIRM_EDIT, reason: 'changes how existing rotation keys are read' },
  // allowed: view (live only)
  'select.controls': ALLOWED_VIEW,
  'select.keys': ALLOWED_VIEW,
  'select.channels': ALLOWED_VIEW,
  'select.curveKeys': ALLOWED_VIEW,
  'select.none': ALLOWED_VIEW,
  'clip.setActive': ALLOWED_VIEW,
  'view.frame': ALLOWED_VIEW,
  'graph.frame': ALLOWED_VIEW,
  'dopeSheet.frame': ALLOWED_VIEW,
  'graph.view.setMode': ALLOWED_VIEW,
  'view.layout': ALLOWED_VIEW,
  'view.toggleMaximize': ALLOWED_VIEW,
  'view.display.toggle': ALLOWED_VIEW,
  'view.lookThrough': ALLOWED_VIEW,
  'view.toggleCameraLock': ALLOWED_VIEW,
  'view.camera.setSettings': ALLOWED_VIEW,
  'workspace.showPanel': ALLOWED_VIEW,
  'time.setPlaybackRange': ALLOWED_VIEW,
  'time.setLoop': ALLOWED_VIEW,
  'time.setSpeed': ALLOWED_VIEW,
  'time.play': ALLOWED_VIEW,
  'time.stop': ALLOWED_VIEW,
  // confirm: view (live only) — only while the user has unkeyed overrides
  'time.setFrame': { policy: 'allowed', access: 'view', confirmWhen: setFrameConfirm },
  // denied: files
  'file.new': denied(DENIED_FILES),
  'file.open': denied(DENIED_FILES),
  'file.openProject': denied(DENIED_FILES),
  'file.importModel': denied(DENIED_FILES),
  'file.importAnimation': denied(DENIED_FILES),
  'file.loadSample': denied(DENIED_FILES),
  'file.save': denied(DENIED_FILES),
  'file.saveAs': denied(DENIED_FILES),
  'file.saveJson': denied(DENIED_FILES),
  'file.export': denied(DENIED_FILES),
  'file.recover': denied(DENIED_FILES),
  'file.discardRecovery': denied(DENIED_FILES),
  'file.autosaveNow': denied(DENIED_FILES),
  // denied: the playhead, the user's clipboard, pins or selection
  'key.set': denied(DENIED_PLAYHEAD),
  'key.deleteAtFrame': denied(DENIED_PLAYHEAD),
  'channel.setValues': denied(DENIED_PLAYHEAD),
  'pose.resetToRest': denied(DENIED_PLAYHEAD),
  'pose.copy': denied(DENIED_PLAYHEAD),
  'pose.paste': denied(DENIED_PLAYHEAD),
  'pose.mirror': denied(DENIED_PLAYHEAD),
  'pose.pinFeet': denied(DENIED_PLAYHEAD),
  'pose.unpinFeet': denied(DENIED_PLAYHEAD),
  'pose.plantFeet': denied(DENIED_PLAYHEAD),
  'rig.ikFk.switch': denied(DENIED_PLAYHEAD),
  'rig.ikFk.match': denied(DENIED_PLAYHEAD),
  'edit.copy': denied(DENIED_PLAYHEAD),
  'edit.paste': denied(DENIED_PLAYHEAD),
  'edit.delete': denied(DENIED_PLAYHEAD),
  'graph.keys.move': denied(DENIED_PLAYHEAD),
  'graph.keys.scale': denied(DENIED_PLAYHEAD),
  'graph.keys.delete': denied(DENIED_PLAYHEAD),
  'graph.keys.keyCurves': denied(DENIED_PLAYHEAD),
  'graph.keys.copy': denied(DENIED_PLAYHEAD),
  'graph.keys.paste': denied(DENIED_PLAYHEAD),
  'graph.keys.copyTo': denied(DENIED_PLAYHEAD),
  'time.insertTime': denied(DENIED_PLAYHEAD),
  'time.deleteTime': denied(DENIED_PLAYHEAD),
  // denied: the user's undo navigation
  'edit.undo': denied(DENIED_UNDO),
  'edit.redo': denied(DENIED_UNDO),
  'edit.revertSteps': denied(DENIED_UNDO),
  'edit.restoreDocument': denied(DENIED_UNDO),
  'edit.escape': denied(DENIED_UNDO),
  // denied: needs the user's pane camera (registered by viewport; absent headless)
  'view.copyViewToShot': denied(DENIED_PANE_CAMERA),
  // denied: the user's preferences, tools, buffers and UI
  'prefs.set': denied(DENIED_USER_STATE),
  'key.toggleAutoKey': denied(DENIED_USER_STATE),
  'key.setTarget': denied(DENIED_USER_STATE),
  'key.toggleRipple': denied(DENIED_USER_STATE),
  'view.tool': denied(DENIED_USER_STATE),
  'view.manipulatorSize': denied(DENIED_USER_STATE),
  'view.setManipSpace': denied(DENIED_USER_STATE),
  'view.setNavProfile': denied(DENIED_USER_STATE),
  'view.selectionMask': denied(DENIED_USER_STATE),
  'view.cameraRadial': denied(DENIED_USER_STATE),
  'ui.open': denied(DENIED_USER_STATE),
  'ui.close': denied(DENIED_USER_STATE),
  'workspace.reset': denied(DENIED_USER_STATE),
  'rig.toggleSecondary': denied(DENIED_USER_STATE),
  'graph.buffer.snapshot': denied(DENIED_USER_STATE),
  'graph.buffer.swap': denied(DENIED_USER_STATE),
  'graph.buffer.clear': denied(DENIED_USER_STATE),
  'select.all': denied(DENIED_USER_STATE),
  'select.mirror': denied(DENIED_USER_STATE),
  'select.pickWalk': denied(DENIED_USER_STATE),
  'time.step': denied(DENIED_USER_STATE),
  'time.nextKey': denied(DENIED_USER_STATE),
  'time.prevKey': denied(DENIED_USER_STATE),
  'time.goToStart': denied(DENIED_USER_STATE),
  'time.goToEnd': denied(DENIED_USER_STATE),
  'time.togglePlay': denied(DENIED_USER_STATE),
  'time.selectBand': denied(DENIED_USER_STATE),
};

/**
 * The agent policy of an operator (§5.14): its own `agent` field when the definition is trusted (a built-in or a
 * trusted extension), else this table, else denied as unclassified.
 */
export function agentPolicyOf(
  id: string,
  def: Pick<OperatorDef<unknown, unknown, unknown>, 'agent'> | undefined,
  opts?: { readonly trusted?: boolean },
): OperatorAgentPolicy {
  if (def?.agent !== undefined && opts?.trusted === true) return def.agent;
  return OPERATOR_POLICY[id] ?? denied(UNCLASSIFIED_REASON);
}

/** True when an operator id has a classification in the table. */
export function isClassified(id: string): boolean {
  return Object.hasOwn(OPERATOR_POLICY, id);
}
