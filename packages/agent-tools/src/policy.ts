// Contract file: the operator policy table of MCP-SPEC §5.14 as data. It classifies every operator id registered by
// `registerBuiltins` at v0.2.0, the ten M-AI operators and the operators other packages register at run time
// (`viewport`'s `view.*`, the shell's `workspace.*`, `prefs.set`, the curve editor's frames). Resolution order:
// `OperatorDef.agent` (only honoured for built-ins and trusted extensions, research 08 §8.3), then this table, else
// denied — so new operators (M6a's, M6b's, extensions') are denied until someone classifies them.
import type { ChannelId, ClipId, ControlId } from '@ekza-studio/doc';
import { isLocked, type EditorApp, type OperatorAgentPolicy, type OperatorDef } from '@ekza-studio/editor-core';

const DENIED_FILES = 'files go through project_open, project_import, project_save and project_export';
const DENIED_PLAYHEAD =
  "acts at the playhead or on the user's clipboard, pins or selection; use pose_set, keys_set, keys_delete, pose_transfer, pose_reset or pose_ik_target";
const DENIED_UNDO = "the user's undo navigation; use history_revert";
const DENIED_PANE_CAMERA = "needs the user's pane camera; ask the user to run View › Copy View to Shot";
const DENIED_USER_STATE = "the user's preferences, tools, buffers and UI";
const DENIED_MODELING = 'modeling and scene editing are not available to agents yet';
// MCP-SPEC §0.4.4 (B4): the character setup operators
const DENIED_QUICK_RIG = 'Quick Rig runs through rig_create';
const DENIED_WEIGHTS = 'weight edits are not available to agents yet';
const DENIED_EXPORT_SETUP = 'files go through project_export';
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

/**
 * The §5.14 table, by operator id. A null-prototype object: an id such as `constructor` or `__proto__` never finds an
 * inherited member (lookups go through `tablePolicyOf`, which also checks `Object.hasOwn`).
 */
export const OPERATOR_POLICY: Readonly<Record<string, OperatorAgentPolicy>> = nullPrototype({
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
  // The wire schemas default `activate` to false; live, `activate: true` needs Edit and View (operator_run's
  // extraGrants, Q-AI-38) and runs with access 'view' (P3).
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
  // M6a modeling, scene, palette and image-plane operators (registered eagerly since M6a): not exposed to agents in
  // the M-AI MVP (MCP-SPEC §0.4). The M6b rig/skin and Auto-Rig operators load lazily and stay unclassified (denied)
  // until phase B classifies its subset (§0.4.4).
  'edit.adjustLast': denied(DENIED_USER_STATE),
  'edit.repeatLast': denied(DENIED_USER_STATE),
  'mesh.transformComponents': denied(DENIED_MODELING),
  'mesh.extrude': denied(DENIED_MODELING),
  'mesh.inset': denied(DENIED_MODELING),
  'mesh.bevel': denied(DENIED_MODELING),
  'mesh.insertLoop': denied(DENIED_MODELING),
  'mesh.offsetLoop': denied(DENIED_MODELING),
  'mesh.connect': denied(DENIED_MODELING),
  'mesh.cut': denied(DENIED_MODELING),
  'mesh.slide': denied(DENIED_MODELING),
  'mesh.averageVertices': denied(DENIED_MODELING),
  'mesh.bridge': denied(DENIED_MODELING),
  'mesh.fillHole': denied(DENIED_MODELING),
  'mesh.merge': denied(DENIED_MODELING),
  'mesh.mergeToCenter': denied(DENIED_MODELING),
  'mesh.mergeByDistance': denied(DENIED_MODELING),
  'mesh.targetWeld': denied(DENIED_MODELING),
  'mesh.collapse': denied(DENIED_MODELING),
  'mesh.delete': denied(DENIED_MODELING),
  'mesh.deleteEdgeVertex': denied(DENIED_MODELING),
  'mesh.spinEdge': denied(DENIED_MODELING),
  'mesh.flipTriangleEdge': denied(DENIED_MODELING),
  'mesh.triangulate': denied(DENIED_MODELING),
  'mesh.quadrangulate': denied(DENIED_MODELING),
  'mesh.harden': denied(DENIED_MODELING),
  'mesh.soften': denied(DENIED_MODELING),
  'mesh.setNormalAngle': denied(DENIED_MODELING),
  'mesh.reverse': denied(DENIED_MODELING),
  'mesh.conform': denied(DENIED_MODELING),
  'mesh.mirror': denied(DENIED_MODELING),
  'mesh.symmetrize': denied(DENIED_MODELING),
  'mesh.applyTransform': denied(DENIED_MODELING),
  'mesh.uv.planar': denied(DENIED_MODELING),
  'mesh.uv.box': denied(DENIED_MODELING),
  'mesh.uv.cylindrical': denied(DENIED_MODELING),
  'mesh.cleanup': denied(DENIED_MODELING),
  'mesh.paint': denied(DENIED_MODELING),
  'mesh.paint.fillShell': denied(DENIED_MODELING),
  'mesh.paint.remap': denied(DENIED_MODELING),
  'mesh.combine': denied(DENIED_MODELING),
  'mesh.separate': denied(DENIED_MODELING),
  'mesh.extract': denied(DENIED_MODELING),
  'mesh.duplicateFaces': denied(DENIED_MODELING),
  'workspace.set': denied(DENIED_USER_STATE),
  'view.shading': denied(DENIED_USER_STATE),
  'view.display.set': denied(DENIED_USER_STATE),
  'ui.commandPalette': denied(DENIED_USER_STATE),
  'ui.markingMenu': denied(DENIED_USER_STATE),
  'select.mode': denied(DENIED_USER_STATE),
  'model.hilite': denied(DENIED_USER_STATE),
  'select.components': denied(DENIED_USER_STATE),
  'select.mesh.loop': denied(DENIED_USER_STATE),
  'select.mesh.ring': denied(DENIED_USER_STATE),
  'select.mesh.grow': denied(DENIED_USER_STATE),
  'select.mesh.shrink': denied(DENIED_USER_STATE),
  'select.mesh.border': denied(DENIED_USER_STATE),
  'select.mesh.shell': denied(DENIED_USER_STATE),
  'select.mesh.all': denied(DENIED_USER_STATE),
  'select.mesh.invert': denied(DENIED_USER_STATE),
  'select.mesh.none': denied(DENIED_USER_STATE),
  'select.mesh.convert': denied(DENIED_USER_STATE),
  'select.mesh.matching': denied(DENIED_USER_STATE),
  'select.objects': denied(DENIED_USER_STATE),
  'select.mesh.pickWalk': denied(DENIED_USER_STATE),
  'view.hide': denied(DENIED_USER_STATE),
  'view.showAll': denied(DENIED_USER_STATE),
  'view.isolate': denied(DENIED_USER_STATE),
  'model.symmetry.set': denied(DENIED_USER_STATE),
  'model.softSelect.set': denied(DENIED_USER_STATE),
  'model.softSelect.toggle': denied(DENIED_USER_STATE),
  'model.selectionStyle.set': denied(DENIED_USER_STATE),
  'model.cameraBased.set': denied(DENIED_USER_STATE),
  'model.backfaces.toggle': denied(DENIED_USER_STATE),
  'model.constraint.set': denied(DENIED_USER_STATE),
  'model.snap.toggle': denied(DENIED_USER_STATE),
  'model.pivot.editToggle': denied(DENIED_USER_STATE),
  'mesh.pivot.set': denied(DENIED_MODELING),
  'mesh.pivot.center': denied(DENIED_MODELING),
  'mesh.pivot.bottomCenter': denied(DENIED_MODELING),
  'mesh.pivot.reset': denied(DENIED_MODELING),
  'mesh.pivot.bake': denied(DENIED_MODELING),
  'mesh.resetTransforms': denied(DENIED_MODELING),
  'mesh.freezeTransforms': denied(DENIED_MODELING),
  'scene.object.transform': denied(DENIED_MODELING),
  'tool.last': denied(DENIED_USER_STATE),
  'view.lastOpCard': denied(DENIED_USER_STATE),
  'model.animateOnly': denied(DENIED_USER_STATE),
  'mesh.create.cube': denied(DENIED_MODELING),
  'mesh.create.sphere': denied(DENIED_MODELING),
  'mesh.create.cylinder': denied(DENIED_MODELING),
  'mesh.create.cone': denied(DENIED_MODELING),
  'mesh.create.plane': denied(DENIED_MODELING),
  'mesh.create.torus': denied(DENIED_MODELING),
  'mesh.create.template': denied(DENIED_MODELING),
  'mesh.primitive.set': denied(DENIED_MODELING),
  'palette.ensureDefault': denied(DENIED_MODELING),
  'palette.create': denied(DENIED_MODELING),
  'palette.duplicate': denied(DENIED_MODELING),
  'palette.rename': denied(DENIED_MODELING),
  'palette.addSwatch': denied(DENIED_MODELING),
  'palette.setSwatch': denied(DENIED_MODELING),
  'palette.removeSwatch': denied(DENIED_MODELING),
  'palette.assign': denied(DENIED_MODELING),
  'palette.replaceSwatch': denied(DENIED_MODELING),
  'palette.setActive': denied(DENIED_USER_STATE),
  'select.mesh.bySwatch': denied(DENIED_USER_STATE),
  'palette.assignMaterial': denied(DENIED_MODELING),
  'imagePlane.import': denied(DENIED_MODELING),
  'imagePlane.set': denied(DENIED_MODELING),
  'imagePlane.delete': denied(DENIED_MODELING),
  'scene.group': denied(DENIED_MODELING),
  'scene.parent': denied(DENIED_MODELING),
  'scene.unparent': denied(DENIED_MODELING),
  'scene.duplicate': denied(DENIED_MODELING),
  'scene.delete': denied(DENIED_MODELING),
  'scene.rename': denied(DENIED_MODELING),
  'mesh.setAttributes': denied(DENIED_MODELING),
  'mesh.makeEditable': denied(DENIED_MODELING),
  'file.exportModel': denied(DENIED_FILES),
  // MCP-SPEC §0.4.4 (B4): Auto-Rig compositions, Quick Rig, skin and the clip library (lazy chunks; rig_create,
  // model_*, library_* and the setup kinds of project_import/project_export run them, these rows guard operator_run)
  'autorig.inspect': ALLOWED_VIEW,
  'autorig.fix': ALLOWED_EDIT,
  'autorig.clip.add': ALLOWED_EDIT,
  'autorig.rig': {
    policy: 'confirm',
    access: 'view',
    reason: 'creates a skeleton and binds the skin (2–3 undo steps)',
  },
  'autorig.sample': { policy: 'confirm', access: 'view', reason: 'adds a model to the scene and selects it' },
  'autorig.intake': { policy: 'confirm', access: 'view', reason: 'adds a model to the scene and selects it' },
  'autorig.export': denied(DENIED_EXPORT_SETUP),
  'autorig.cancel': denied(DENIED_USER_STATE),
  'autorig.navigate': denied(DENIED_USER_STATE),
  'autorig.controls': denied(DENIED_USER_STATE),
  'autorig.parts': denied(DENIED_USER_STATE),
  'skel.quickRig.start': denied(DENIED_QUICK_RIG),
  'skel.quickRig.setMarker': denied(DENIED_QUICK_RIG),
  'skel.quickRig.guess': denied(DENIED_QUICK_RIG),
  'skel.quickRig.clear': denied(DENIED_QUICK_RIG),
  'skel.quickRig.setPreset': denied(DENIED_QUICK_RIG),
  'skel.quickRig.cancel': denied(DENIED_QUICK_RIG),
  'skel.quickRig.pick': denied(DENIED_QUICK_RIG),
  'skel.quickRig.center': denied(DENIED_QUICK_RIG),
  'skel.quickRig.faceForward': denied(DENIED_QUICK_RIG),
  'skel.quickRig.commit': denied(DENIED_QUICK_RIG),
  'skin.bind': denied(DENIED_QUICK_RIG),
  'skin.unbind': denied(DENIED_WEIGHTS),
  'skin.weights.autoForJoints': denied(DENIED_WEIGHTS),
  'skin.weights.paint': denied(DENIED_WEIGHTS),
  'skin.weights.flood': denied(DENIED_WEIGHTS),
  'skin.weights.set': denied(DENIED_WEIGHTS),
  'skin.weights.assign': denied(DENIED_WEIGHTS),
  'skin.weights.rigidIslands': denied(DENIED_WEIGHTS),
  'skin.weights.mirror': denied(DENIED_WEIGHTS),
  'skin.weights.transfer': denied(DENIED_WEIGHTS),
  'skin.weights.smooth': denied(DENIED_WEIGHTS),
  'skin.weights.hammer': denied(DENIED_WEIGHTS),
  'skin.weights.copyVertex': denied(DENIED_WEIGHTS),
  'skin.weights.pasteVertex': denied(DENIED_WEIGHTS),
  'skin.weights.prune': denied(DENIED_WEIGHTS),
  'skin.weights.normalize': denied(DENIED_WEIGHTS),
  'skin.weights.move': denied(DENIED_WEIGHTS),
  'skin.weights.fillMissing': denied(DENIED_WEIGHTS),
  'skin.palette.compact': denied(DENIED_WEIGHTS),
  'skin.review.mark': denied(DENIED_WEIGHTS),
  'skin.influence.setActive': denied(DENIED_USER_STATE),
  'skin.influence.hold': denied(DENIED_USER_STATE),
  'skin.influence.holdAll': denied(DENIED_USER_STATE),
  'skin.influence.releaseAll': denied(DENIED_USER_STATE),
  'skin.influence.walk': denied(DENIED_USER_STATE),
  'skin.influence.pickDominant': denied(DENIED_USER_STATE),
  'skin.paint.mode': denied(DENIED_USER_STATE),
  'skin.paint.set': denied(DENIED_USER_STATE),
  'skin.paint.mirrorToggle': denied(DENIED_USER_STATE),
  'skin.paint.sample': denied(DENIED_USER_STATE),
  'skin.testRotate.toggle': denied(DENIED_USER_STATE),
  'skin.test.rom': denied(DENIED_USER_STATE),
  'library.useClip': ALLOWED_EDIT,
  'library.preview': denied(DENIED_USER_STATE),
  'library.stop': denied(DENIED_USER_STATE),
  'library.open': denied(DENIED_USER_STATE),
});

function nullPrototype<T>(entries: Readonly<Record<string, T>>): Readonly<Record<string, T>> {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, T>, entries));
}

/** The table's own entry for an operator id (never an inherited member), else undefined. */
export function tablePolicyOf(id: string): OperatorAgentPolicy | undefined {
  return Object.hasOwn(OPERATOR_POLICY, id) ? OPERATOR_POLICY[id] : undefined;
}

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
  return tablePolicyOf(id) ?? denied(UNCLASSIFIED_REASON);
}

/** True when an operator id has a classification in the table. */
export function isClassified(id: string): boolean {
  return Object.hasOwn(OPERATOR_POLICY, id);
}
