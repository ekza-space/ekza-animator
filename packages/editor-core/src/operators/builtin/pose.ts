// Pose operators (MVP-SPEC §4.9 `pose.*`; §4.11.2 value edits, §4.11.19 pin/plant feet, §4.11.20 mirror). Every
// pose change goes through `applyChannelEdits` with `key: 'auto'`, so it keys, sets static values or overrides by
// the same rules as a manipulator drag. Rotations from the rig solvers come back through `eulerNear` (rig).
import { EkzaError, type Mat4 } from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId, HumanBoneName } from '@ekza-animator/doc';
import {
  applyPoseClipboard,
  type FootPin,
  isHumanoidProgram,
  type MirrorMode,
  makePoseClipboard,
  mirrorPose,
  type PoseBuffers,
  type PoseClipboard,
  plantFeetChannels,
} from '@ekza-animator/rig';
import { applyChannelEdits } from '../../edit/channels';
import { channelsAt, limbContext, plantIkLeg } from '../../workflows/ik';
import { summarizeMirrorWarnings } from '../../workflows/mirrorWarnings';
import type { ChannelEditResult, CharacterRuntime, EditorApp, OperatorContext } from '../../types';
import { GLOBAL_SCOPE } from '../../types';
import {
  clipboardAttrValues,
  currentAttrValues,
  currentValues,
  editsFromValues,
  mergeChannelValues,
  mirrorAttrValues,
  restValues,
  selectedChannelsOf,
  withClipboardAttrs,
} from '../../workflows/pose';
import { activeClipRecord, controlsOfCharacter, selectedControls } from '../../workflows/targets';
import { type AnyOperator, all, defineOperator, errorText, fail, isRecord, OK, optionalArgs } from './define';
import { activeRuntimeOf, pollClipEdit, pollRuntime } from './polls';

const NO_EDITS: ChannelEditResult = { keyed: 0, statics: 0, overrides: new Map(), skipped: [] };
const MIRROR_MODES: readonly MirrorMode[] = ['flip', 'leftToRight', 'rightToLeft'];
const SIDES: readonly ('L' | 'R')[] = ['L', 'R'];

function requireRuntime(app: EditorApp): CharacterRuntime {
  const runtime = activeRuntimeOf(app);
  if (runtime === undefined) throw new EkzaError('unsupported', 'The character is still loading');
  return runtime;
}

/** Writes pose values through the edit kernel, reporting locked channels that were left alone. */
function writePose(
  app: EditorApp,
  tx: Parameters<typeof applyChannelEdits>[1],
  values: ReadonlyMap<ControlId, ChannelValues>,
): ChannelEditResult {
  const { edits, locked } = editsFromValues(app, values);
  const result = edits.length === 0 ? NO_EDITS : applyChannelEdits(app, tx, edits, { key: 'auto' });
  if (locked > 0) {
    app.services.notify.toast({ kind: 'warning', text: `${locked} locked channel(s) were not changed` });
  }
  return result;
}

function controlsArg(args: unknown): readonly ControlId[] | null | string {
  const options = optionalArgs(args);
  if (options === null) return 'expects { controls? }';
  const controls = options['controls'];
  if (controls === undefined) return null;
  if (!Array.isArray(controls) || !(controls as readonly unknown[]).every((c) => typeof c === 'string')) {
    return 'controls must be control ids';
  }
  return controls as readonly ControlId[];
}

const resetToRest = defineOperator({
  id: 'pose.resetToRest',
  label: 'Reset to Rest',
  description: "Reset the selected controls' keyable channels to the rest pose.",
  category: 'pose',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: () => 'Reset Pose',
  poll({ app }, args) {
    const controls = controlsArg(args);
    if (typeof controls === 'string') return fail(controls);
    const base = pollClipEdit(app);
    if (base !== true) return base;
    if (controls === null) return app.session.getState().selection.controls.length > 0 ? OK : fail('nothing selected');
    return controls.every((id) => app.store.get('controls', id) !== undefined) ? OK : fail('Unknown control');
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'pose.resetToRest runs in a transaction');
    const given = controlsArg(args);
    const ids = Array.isArray(given) ? given : selectedControls(app, tx).map((control) => control.id);
    return writePose(app, tx, restValues(app, ids as readonly ControlId[]));
  },
});

/** Pose clipboard text format (JSON of the `ekza.pose` payload). */
export function parsePoseClipboard(text: string | null): PoseClipboard | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || value['kind'] !== 'ekza.pose' || value['version'] !== 1 || !isRecord(value['controls'])) {
      return null;
    }
    return value as unknown as PoseClipboard;
  } catch {
    return null;
  }
}

const poseCopy = defineOperator({
  id: 'pose.copy',
  label: 'Copy Pose',
  description: 'Copy the pose of the selected controls (all controls when none is selected).',
  category: 'pose',
  scope: GLOBAL_SCOPE,
  poll: ({ app }) => pollRuntime(app),
  apply({ app }) {
    const runtime = requireRuntime(app);
    const rig = app.store.get('rigs', runtime.program.rigId);
    if (rig === undefined) throw new EkzaError('unsupported', 'The character has no rig');
    // The selected controls, or the whole character (secondary controls included) when nothing is selected.
    const selected = selectedControls(app);
    const controls = (selected.length > 0 ? selected : controlsOfCharacter(app.store, runtime.id)).map((c) => c.id);
    // M2a §5.8: attribute values ride along, except keyAll: false ones (ikFk, soft) unless selected channels.
    const clipboard = withClipboardAttrs(
      makePoseClipboard(runtime.program, rig, currentValues(app, controls)),
      app.store,
      currentAttrValues(app, controls),
    );
    const state = app.session.getState();
    app.session.setState({ clipboard: { ...state.clipboard, pose: clipboard } });
    app.services.clipboard.writeText(JSON.stringify(clipboard)).catch((error: unknown) => {
      app.services.notify.toast({ kind: 'warning', text: `The system clipboard is unavailable: ${errorText(error)}` });
    });
  },
});

const posePaste = defineOperator<'pose.paste', PoseClipboard>({
  id: 'pose.paste',
  label: 'Paste Pose',
  description: 'Paste a copied pose onto the matching controls (by template key, also across humanoids).',
  category: 'pose',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) => (optionalArgs(args)?.['mirrored'] === true ? 'Paste Pose Mirrored' : 'Paste Pose'),
  poll({ app }, args) {
    const options = optionalArgs(args);
    if (options === null || (options['mirrored'] !== undefined && typeof options['mirrored'] !== 'boolean')) {
      return fail('expects { mirrored? }');
    }
    return all(pollClipEdit(app), pollRuntime(app));
  },
  async prepare({ app }) {
    const session = app.session.getState().clipboard.pose;
    if (session !== null) return session;
    let text: string | null = null;
    try {
      text = await app.services.clipboard.readText();
    } catch {
      text = null;
    }
    const parsed = parsePoseClipboard(text);
    if (parsed === null) throw new EkzaError('unsupported', 'There is no copied pose');
    return parsed;
  },
  apply({ app, tx }, args, clipboard) {
    if (tx === null) throw new EkzaError('internal', 'pose.paste runs in a transaction');
    const runtime = requireRuntime(app);
    const mirrored = optionalArgs(args)?.['mirrored'] === true;
    const values = mergeChannelValues(
      applyPoseClipboard(clipboard, runtime.program, mirrored ? 'mirrored' : 'local'),
      clipboardAttrValues(tx, clipboard, controlsOfCharacter(tx, runtime.id), mirrored, (id) =>
        selectedChannelsOf(app, id),
      ),
    );
    // With a selection that shares controls with the pasted pose, paste onto the selected controls only.
    const selected = new Set(selectedControls(app, tx).map((control) => control.id));
    let overlaps = false;
    for (const id of values.keys()) overlaps ||= selected.has(id);
    if (overlaps) for (const id of values.keys()) if (!selected.has(id)) values.delete(id);
    return writePose(app, tx, values);
  },
});

/** Selected controls with their mirror counterparts; null (whole character) when nothing is selected. */
function mirrorScope(app: EditorApp): ReadonlySet<ControlId> | null {
  const selected = selectedControls(app);
  if (selected.length === 0) return null;
  const scope = new Set<ControlId>();
  for (const control of selected) {
    scope.add(control.id);
    if (control.mirror !== null) scope.add(control.mirror);
  }
  return scope;
}

const poseMirror = defineOperator({
  id: 'pose.mirror',
  label: 'Mirror Pose',
  description: 'Flip the pose, or copy one side onto the other (humanoid rigs).',
  category: 'pose',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) =>
    args.mode === 'leftToRight' ? 'Mirror Pose L→R' : args.mode === 'rightToLeft' ? 'Mirror Pose R→L' : 'Flip Pose',
  poll({ app }, raw) {
    const args: unknown = raw;
    if (!isRecord(args) || !MIRROR_MODES.includes(args['mode'] as MirrorMode)) {
      return fail(`expects { mode: ${MIRROR_MODES.join(' | ')} }`);
    }
    const base = all(pollClipEdit(app), pollRuntime(app));
    if (base !== true) return base;
    return isHumanoidProgram(requireRuntime(app).program) ? OK : fail('Mirror needs a humanoid rig');
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'pose.mirror runs in a transaction');
    const runtime = requireRuntime(app);
    const character = app.session.getState().activeCharacter;
    if (character === null) return NO_EDITS;
    // Snapshot every control first: the result never depends on the order of writes.
    const controls = controlsOfCharacter(tx, character);
    const ids = controls.map((control) => control.id);
    // M2a §5.8: the snapshot carries the keyable attributes too, so a rig that mirrors attributes (A1's
    // mirrorPose) reads their current values instead of their defaults.
    const attrSnapshot = currentAttrValues(app, ids, 'keyable');
    const snapshot = mergeChannelValues(currentValues(app, ids), attrSnapshot);
    const scope = mirrorScope(app);
    const { values, warnings: raw } = mirrorPose(runtime.program, snapshot, args.mode, scope);
    const warnings = summarizeMirrorWarnings(raw);
    if (warnings.length > 0) app.services.notify.toast({ kind: 'warning', text: warnings.join('; ') });
    // M2a §5.8: attributes map by AttrDef.mirror (ikFk copies, so the mirrored pose carries the limb mode); the
    // same mapping as the rig's, for a rig whose mirror leaves attributes out.
    const attrs = mirrorAttrValues(tx, controls, attrSnapshot, args.mode, scope);
    return writePose(app, tx, mergeChannelValues(values, attrs));
  },
});

function sidesArg(args: unknown): readonly ('L' | 'R')[] | string {
  const options = optionalArgs(args);
  if (options === null) return 'expects { sides? }';
  const sides = options['sides'];
  if (sides === undefined) return SIDES;
  if (!Array.isArray(sides) || !(sides as readonly unknown[]).every((s) => s === 'L' || s === 'R')) {
    return "sides must be 'L' and/or 'R'";
  }
  return [...new Set(sides as readonly ('L' | 'R')[])];
}

const FOOT: Readonly<Record<'L' | 'R', HumanBoneName>> = { L: 'leftFoot', R: 'rightFoot' };

/** The active character's pose at the current frame including overrides (what the viewport shows). */
function currentPose(app: EditorApp, runtime: CharacterRuntime): PoseBuffers {
  const clip = activeClipRecord(app);
  const frame = app.evaluation.clipFrame(runtime.id);
  const pose = runtime.program.allocPose();
  if (clip === undefined || frame === null) {
    const channels = runtime.program.allocChannels();
    runtime.program.evaluate(channels, pose);
  } else {
    app.evaluation.evaluateAt(runtime.id, clip.id, frame, pose, { withOverrides: true });
  }
  return pose;
}

function pollFeet(ctx: OperatorContext, args: unknown) {
  const sides = sidesArg(args);
  if (typeof sides === 'string') return fail(sides);
  const runtime = pollRuntime(ctx.app);
  if (runtime !== true) return runtime;
  const program = requireRuntime(ctx.app).program;
  if (!isHumanoidProgram(program)) return fail('Pin Feet needs a humanoid rig');
  const humanoid = program.skeleton.humanoid ?? {};
  return sides.some((side) => humanoid[FOOT[side]] !== undefined) ? OK : fail('The character has no feet to pin');
}

const pinFeet = defineOperator({
  id: 'pose.pinFeet',
  label: 'Pin Feet',
  description: 'Remember where the feet are now; Plant Feet puts them back there on other frames.',
  category: 'pose',
  scope: GLOBAL_SCOPE,
  poll: pollFeet,
  apply({ app }, args) {
    const runtime = requireRuntime(app);
    const sides = sidesArg(args);
    if (typeof sides === 'string') return;
    const pose = currentPose(app, runtime);
    const humanoid = runtime.program.skeleton.humanoid ?? {};
    const pins: FootPin[] = [];
    for (const side of sides) {
      const node = humanoid[FOOT[side]];
      if (node === undefined) continue;
      const footWorld: Mat4 = pose.boneWorld.slice(node * 16, node * 16 + 16);
      pins.push({ side, footWorld });
    }
    app.session.setState({ feetPins: { character: runtime.id, pins } });
  },
});

const unpinFeet = defineOperator({
  id: 'pose.unpinFeet',
  label: 'Unpin Feet',
  description: 'Forget the pinned feet.',
  category: 'pose',
  scope: GLOBAL_SCOPE,
  poll: ({ app }) => (app.session.getState().feetPins === null ? fail('No feet are pinned') : OK),
  apply({ app }) {
    app.session.setState({ feetPins: null });
  },
});

const plantFeet = defineOperator({
  id: 'pose.plantFeet',
  label: 'Plant Feet',
  description:
    'Put the feet back on their pins at this frame: IK legs move their IK foot, FK legs re-solve (keys per auto-key).',
  category: 'pose',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: () => 'Plant Feet',
  poll({ app }, args) {
    const sides = sidesArg(args);
    if (typeof sides === 'string') return fail(sides);
    const base = all(pollClipEdit(app), pollRuntime(app));
    if (base !== true) return base;
    const pins = app.session.getState().feetPins;
    if (pins === null || pins.character !== app.session.getState().activeCharacter) {
      return fail('Pin the feet first (Pose → Pin Feet)');
    }
    return pins.pins.some((pin) => sides.includes(pin.side)) ? OK : fail('Those feet are not pinned');
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'pose.plantFeet runs in a transaction');
    const runtime = requireRuntime(app);
    const sides = sidesArg(args);
    const pins = (app.session.getState().feetPins?.pins ?? []).filter(
      (pin) => typeof sides !== 'string' && sides.includes(pin.side),
    );
    const reference = currentValues(app, runtime.program.controlIds);
    const pose = currentPose(app, runtime);
    // M2a §5.8: a leg with ikFk ≥ 0.5 at this frame gets IK control channels (foot bone on the pin with the current
    // foot-roll attributes); an FK leg the M1 solve. One step.
    const fkPins: FootPin[] = [];
    const values = new Map<ControlId, ChannelValues>();
    for (const pin of pins) {
      const limb = pin.side === 'L' ? 'leg.L' : 'leg.R';
      const ctx = limbContext(app, limb, runtime.id);
      const w = app.evaluation.ikFk(runtime.id, limb);
      if (typeof ctx === 'string' || w === null || w < 0.5) {
        fkPins.push(pin);
        continue;
      }
      const ch = channelsAt(app, ctx, ctx.frame, true);
      values.set(ctx.limb.params.ikControl, plantIkLeg(app, ctx, pose, ch, pin.footWorld));
    }
    if (fkPins.length > 0) {
      const solved = plantFeetChannels(runtime.program, pose, fkPins, reference);
      if (solved.warnings.length > 0) app.services.notify.toast({ kind: 'warning', text: solved.warnings.join('; ') });
      for (const [control, channels] of solved.values) values.set(control, channels);
    }
    return writePose(app, tx, values);
  },
});

export const POSE_OPERATORS: readonly AnyOperator[] = [
  resetToRest,
  poseCopy,
  posePaste,
  poseMirror,
  pinFeet,
  unpinFeet,
  plantFeet,
];
