// Pose operators (MVP-SPEC §4.9 `pose.*`; §4.11.2 value edits, §4.11.19 pin/plant feet, §4.11.20 mirror). Every
// pose change goes through `applyChannelEdits` with `key: 'auto'`, so it keys, sets static values or overrides by
// the same rules as a manipulator drag. Rotations from the rig solvers come back through `eulerNear` (rig).
// M-AI B5 (`check:size`): this file keeps the definitions and polls; the apply bodies are `poseBodies.ts`, loaded by
// each run's `prepare` (`lazyBodies`).
import { EkzaError } from '@ekza-studio/anim-core';
import type { ControlId, HumanBoneName } from '@ekza-studio/doc';
import { isHumanoidProgram, type MirrorMode, type PoseClipboard } from '@ekza-studio/rig';
import type { CharacterRuntime, EditorApp, OperatorContext } from '../../types';
import { GLOBAL_SCOPE } from '../../types';
import { type AnyOperator, all, defineOperator, fail, isRecord, OK, optionalArgs } from './define';
import { lazyBodies } from './lazyBodies';
import { activeRuntimeOf, pollClipEdit, pollRuntime } from './polls';

/** The apply bodies (`lazyBodies`). */
const poseBodies = lazyBodies(() => import('./poseBodies'));
type PoseBodies = Awaited<ReturnType<typeof poseBodies>>;

const MIRROR_MODES: readonly MirrorMode[] = ['flip', 'leftToRight', 'rightToLeft'];
const SIDES: readonly ('L' | 'R')[] = ['L', 'R'];

export function requireRuntime(app: EditorApp): CharacterRuntime {
  const runtime = activeRuntimeOf(app);
  if (runtime === undefined) throw new EkzaError('unsupported', 'The character is still loading');
  return runtime;
}

export function controlsArg(args: unknown): readonly ControlId[] | null | string {
  const options = optionalArgs(args);
  if (options === null) return 'expects { controls? }';
  const controls = options['controls'];
  if (controls === undefined) return null;
  if (!Array.isArray(controls) || !(controls as readonly unknown[]).every((c) => typeof c === 'string')) {
    return 'controls must be control ids';
  }
  return controls as readonly ControlId[];
}

const resetToRest = defineOperator<'pose.resetToRest', PoseBodies>({
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
  prepare: poseBodies,
  apply: (ctx, args, bodies) => bodies.resetToRest(ctx, args),
});

const poseCopy = defineOperator<'pose.copy', PoseBodies>({
  id: 'pose.copy',
  label: 'Copy Pose',
  description: 'Copy the pose of the selected controls (all controls when none is selected).',
  category: 'pose',
  scope: GLOBAL_SCOPE,
  poll: ({ app }) => pollRuntime(app),
  prepare: poseBodies,
  apply: (ctx, _args, bodies) => bodies.poseCopy(ctx),
});

const posePaste = defineOperator<'pose.paste', { readonly bodies: PoseBodies; readonly clipboard: PoseClipboard }>({
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
  // The bodies first, then the copied pose (the session's, else the system clipboard's).
  async prepare(ctx) {
    const bodies = await poseBodies();
    return { bodies, clipboard: await bodies.pasteClipboard(ctx) };
  },
  apply: (ctx, args, { bodies, clipboard }) => bodies.posePaste(ctx, args, clipboard),
});

const poseMirror = defineOperator<'pose.mirror', PoseBodies>({
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
  prepare: poseBodies,
  apply: (ctx, args, bodies) => bodies.poseMirror(ctx, args),
});

export function sidesArg(args: unknown): readonly ('L' | 'R')[] | string {
  const options = optionalArgs(args);
  if (options === null) return 'expects { sides? }';
  const sides = options['sides'];
  if (sides === undefined) return SIDES;
  if (!Array.isArray(sides) || !(sides as readonly unknown[]).every((s) => s === 'L' || s === 'R')) {
    return "sides must be 'L' and/or 'R'";
  }
  return [...new Set(sides as readonly ('L' | 'R')[])];
}

export const FOOT: Readonly<Record<'L' | 'R', HumanBoneName>> = { L: 'leftFoot', R: 'rightFoot' };

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

const pinFeet = defineOperator<'pose.pinFeet', PoseBodies>({
  id: 'pose.pinFeet',
  label: 'Pin Feet',
  description: 'Remember where the feet are now; Plant Feet puts them back there on other frames.',
  category: 'pose',
  scope: GLOBAL_SCOPE,
  poll: pollFeet,
  prepare: poseBodies,
  apply: (ctx, args, bodies) => bodies.pinFeet(ctx, args),
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

const plantFeet = defineOperator<'pose.plantFeet', PoseBodies>({
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
  prepare: poseBodies,
  apply: (ctx, args, bodies) => bodies.plantFeet(ctx, args),
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
