// The apply bodies of the pose operators (`pose.ts`; MVP-SPEC §4.9 `pose.*`): a lazy chunk of its own (M-AI B5,
// `check:size`), loaded by each run's `prepare`. The bodies are the shipped ones, moved unchanged.
import { EkzaError, type Mat4 } from '@ekza-studio/anim-core';
import type { ChannelValues, ControlId } from '@ekza-studio/doc';
import {
  applyPoseClipboard,
  type FootPin,
  makePoseClipboard,
  mirrorPose,
  type PoseBuffers,
  type PoseClipboard,
  plantFeetChannels,
} from '@ekza-studio/rig';
import { applyChannelEdits } from '../../edit/channels';
import type {
  ApplyContext,
  ChannelEditResult,
  CharacterRuntime,
  EditorApp,
  OperatorArgs,
  OperatorContext,
} from '../../types';
import { channelsAt, limbContext, plantIkLeg } from '../../workflows/ik';
import { summarizeMirrorWarnings } from '../../workflows/mirrorWarnings';
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
import { errorText, isRecord, optionalArgs } from './define';
import { controlsArg, FOOT, requireRuntime, sidesArg } from './pose';

const NO_EDITS: ChannelEditResult = { keyed: 0, statics: 0, overrides: new Map(), skipped: [] };

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

/** `pose.resetToRest` */
export function resetToRest(ctx: ApplyContext, args: OperatorArgs<'pose.resetToRest'>) {
  const { app, tx } = ctx;
  if (tx === null) throw new EkzaError('internal', 'pose.resetToRest runs in a transaction');
  const given = controlsArg(args);
  const ids = Array.isArray(given) ? given : selectedControls(app, tx).map((control) => control.id);
  return writePose(app, tx, restValues(app, ids as readonly ControlId[]));
}

/** `pose.copy` */
export function poseCopy(ctx: ApplyContext) {
  const { app } = ctx;
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
}

/** `pose.paste` */
export function posePaste(ctx: ApplyContext, args: OperatorArgs<'pose.paste'>, clipboard: PoseClipboard) {
  const { app, tx } = ctx;
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
}

/** `pose.mirror` */
export function poseMirror(ctx: ApplyContext, args: OperatorArgs<'pose.mirror'>) {
  const { app, tx } = ctx;
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
}

/** `pose.pinFeet` */
export function pinFeet(ctx: ApplyContext, args: OperatorArgs<'pose.pinFeet'>) {
  const { app } = ctx;
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
}

/** `pose.plantFeet` */
export function plantFeet(ctx: ApplyContext, args: OperatorArgs<'pose.plantFeet'>) {
  const { app, tx } = ctx;
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
}

/** `pose.paste`'s copied pose: the session's, else the system clipboard's (parsed). */
export async function pasteClipboard({ app }: OperatorContext): Promise<PoseClipboard> {
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
}
