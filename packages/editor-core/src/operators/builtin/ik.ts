// Limb IK operators (M2A-SPEC §4.9 `rig.*` IK rows, §5.6–§5.7; A2 on A1's rig functions): add limb IK to an M1
// rig, switch a limb between IK and FK with the key policies, match one side to the other at the current frame or
// over a range, and edit a leg's foot-roll pivots. Each undoable operator is one transaction and one history step.
import { EkzaError, eulerFilterCurves, type Frame } from '@ekza-animator/anim-core';
import type {
  ChannelId,
  ChannelValues,
  CharacterId,
  ClipId,
  ControlId,
  CurveId,
  SolverId,
  Tx,
} from '@ekza-animator/doc';
import {
  type FootRollParams,
  type Ik2Params,
  isHumanoidProgram,
  type LimbId,
  readRigDefinition,
} from '@ekza-animator/rig';
import { newKeyTangents } from '../../edit/channelMeta';
import { applyChannelEdits } from '../../edit/channels';
import { animCurve } from '../../edit/context';
import { ensureCurve, insertKeyOnCurve, writeKeyAt } from '../../edit/keys';
import { type ChannelEdit, type ChannelEditResult, type EditorApp, GLOBAL_SCOPE, type IkFkKeyMode } from '../../types';
import {
  channelsAt,
  LIMB_NAME,
  LIMB_ORDER,
  type LimbContext,
  limbContext,
  limbIkAvailable,
  limbKitOf,
  limbsWithSolvers,
  matchAt,
  matchEdits,
  matchRangeDeviation,
  matchRangeDeviationWarning,
  matchRangeFrames,
  matchWarnings,
  type MatchResult,
  resolveSwitchKey,
  switchAlreadyReason,
} from '../../workflows/ik';
import { editsFromValues } from '../../workflows/pose';
import type { CountResult } from '../args';
import { AGENT_SPAN_LIMIT, type AgentImpl, loadAgentImpl, loadedAgentImpl } from './agentLoad';
import {
  type AnyOperator,
  defineOperator,
  fail,
  isActorRun,
  isFiniteNumber,
  isRecord,
  OK,
  optionalArgs,
} from './define';
import { pollClipEdit, pollEditable } from './polls';
import { NOT_AVAILABLE_YET } from './stub';

const SIDES: readonly ('ik' | 'fk')[] = ['ik', 'fk'];
const KEY_MODES: readonly IkFkKeyMode[] = ['auto', 'none', 'key', 'seamless'];
const FOOT_FIELDS = ['heelBack', 'ballFront', 'toeFront', 'innerWidth', 'outerWidth', 'breakAngle'] as const;
const NO_EDITS: ChannelEditResult = { keyed: 0, statics: 0, overrides: new Map(), skipped: [] };
/** Two keys this close (frames) share a frame (§4.11.1). */
const SAME_FRAME = 1e-6;

const isLimb = (value: unknown): value is LimbId =>
  typeof value === 'string' && (LIMB_ORDER as readonly string[]).includes(value);

/**
 * Common poll of the limb operators: arguments, an editable document with an active clip, the limb's context, then
 * the operator's own check of that context (`inContext`).
 */
function pollLimb(
  app: EditorApp,
  args: unknown,
  extra?: (args: Readonly<Record<string, unknown>>) => string | null,
  inContext?: (ctx: LimbContext, args: Readonly<Record<string, unknown>>) => string | null,
  explicitClip?: boolean,
) {
  if (!isRecord(args) || !isLimb(args['limb'])) return fail(`expects { limb: ${LIMB_ORDER.join(' | ')}, … }`);
  const character = args['character'];
  if (character !== undefined && typeof character !== 'string') return fail('character must be a character id');
  const problem = extra?.(args) ?? null;
  if (problem !== null) return fail(problem);
  // MCP-SPEC §4.10: an operator given its clip (`rig.ikFk.matchRange {clip}`) needs no active clip.
  const clip = explicitClip === true ? args['clip'] : undefined;
  const base = clip === undefined ? pollClipEdit(app) : pollEditable(app);
  if (base !== true) return base;
  const ctx = limbContext(
    app,
    args['limb'],
    character as CharacterId | undefined,
    clip === undefined ? undefined : { clip: clip as ClipId },
  );
  if (typeof ctx === 'string') return fail(ctx);
  const refused = inContext?.(ctx, args) ?? null;
  return refused === null ? OK : fail(refused);
}

function requireContext(app: EditorApp, limb: LimbId, character: CharacterId | undefined, clip?: ClipId): LimbContext {
  const ctx = limbContext(app, limb, character, clip === undefined ? undefined : { clip });
  if (typeof ctx === 'string') throw new EkzaError('unsupported', ctx);
  return ctx;
}

/** Merges channel-edit results (counts add up, overrides merge, skipped concatenate). */
function mergeResults(results: readonly ChannelEditResult[]): ChannelEditResult {
  let keyed = 0;
  let statics = 0;
  const overrides = new Map<ControlId, ChannelValues>();
  const skipped: ChannelEditResult['skipped'][number][] = [];
  for (const result of results) {
    keyed += result.keyed;
    statics += result.statics;
    for (const [control, values] of result.overrides) overrides.set(control, { ...overrides.get(control), ...values });
    skipped.push(...result.skipped);
  }
  return { keyed, statics, overrides, skipped };
}

function warn(app: EditorApp, warnings: readonly string[]): void {
  if (warnings.length > 0) app.services.notify.toast({ kind: 'warning', text: warnings.join('; ') });
}

/** Ensures the `@ikFk` key at `frame` steps (§5.6 "step tangent") whether it was created or patched. */
function stepKeyAt(tx: Tx, curve: ReturnType<typeof ensureCurve>, frame: Frame): void {
  const key = tx.query.keysOfCurve(curve).find((candidate) => Math.abs(candidate.t - frame) < SAME_FRAME);
  if (key !== undefined && key.outType !== 'step') tx.patch('keys', key.id, { outType: 'step' });
}

/** The `@ikFk` value of the limb's curve at a frame (keys, else static, else the default), ignoring overrides. */
function ikFkCurveValue(app: EditorApp, ctx: LimbContext, frame: Frame): number {
  const ch = channelsAt(app, ctx, frame, false);
  const slot = ctx.program.attrIndex.get(`${ctx.limb.params.ikControl}/@ikFk`);
  return slot === undefined ? 0 : (ch.attrs[slot] as number);
}

/**
 * 'seamless' (§5.6 "the pose at f − 1 … unchanged"): before the switch keys the matched channels at f, each of them
 * gets a key at f − 1 holding its curve value there, unless a key exists at f − 1. The new key keeps the curve's
 * shape (`insertKeyOnCurve`, so no other frame moves) and steps out like the `@ikFk` key. Without it the key at f
 * would reach back to f − 1: `fk.toes` drives the toes under IK too (the ik2 toes rule), and an `@ikFk` between 0
 * and 1 at f − 1 reads the whole FK chain. Locked curves are left alone (the switch skips them too). Curves that had
 * no keys go to `firstKeys` (see `holdAfterSwitch`).
 */
function holdBeforeSwitch(
  app: EditorApp,
  tx: Tx,
  ctx: LimbContext,
  edits: readonly ChannelEdit[],
  firstKeys: CurveId[],
): void {
  const at = ctx.frame - 1;
  for (const edit of edits) {
    const curve = ensureCurve(app, tx, ctx.clip.id, edit.control, edit.channel);
    if (tx.get('curves', curve)?.locked === true) continue;
    const keys = tx.query.keysOfCurve(curve);
    if (keys.length === 0) firstKeys.push(curve);
    if (keys.some((key) => Math.abs(key.t - at) < SAME_FRAME)) continue;
    insertKeyOnCurve(app, tx, curve, at);
    stepKeyAt(tx, curve, at);
  }
}

/**
 * 'seamless' on curves that had no keys before the switch (`firstKeys`): their two keys at f − 1 and f are a step in
 * time, so they get `constant` infinities. On a loop clip a new curve cycles (§5.23), and a cycle over the one-frame
 * span f − 1…f would flip the limb back to the old mode on every integer frame after f (and repeat the hold value of
 * the matched channels there). Curves that had keys keep their infinities (the user's).
 */
function holdAfterSwitch(tx: Tx, firstKeys: readonly CurveId[]): void {
  for (const id of firstKeys) {
    const curve = tx.get('curves', id);
    if (curve === undefined || curve.locked || tx.query.keysOfCurve(id).length === 0) continue;
    if (curve.pre !== 'constant' || curve.post !== 'constant') {
      tx.patch('curves', id, { pre: 'constant', post: 'constant' });
    }
  }
}

/**
 * Writes a switch or match (§5.6) at the current frame: the matched channels and, for a switch, the new `@ikFk`
 * value, with the key policy: 'none' through `applyChannelEdits(key: 'auto')` (changed channels only); 'key' forces
 * keys at f on the matched channels and on `@ikFk` (step); 'seamless' also keys `@ikFk` at f − 1 with its value
 * before the switch and holds the matched channels at f − 1 (`holdBeforeSwitch`), unless keys exist there, and
 * gives the curves it put their first keys on `constant` infinities (`holdAfterSwitch`).
 */
function writeSwitch(
  app: EditorApp,
  tx: Tx,
  ctx: LimbContext,
  matched: ReadonlyMap<ControlId, ChannelValues> | null,
  ikFk: number | null,
  mode: 'none' | 'key' | 'seamless',
): ChannelEditResult {
  const results: ChannelEditResult[] = [];
  const ikControl = ctx.limb.params.ikControl;
  // The value before the switch at f − 1 is read before anything is written.
  const before = mode === 'seamless' && ikFk !== null ? ikFkCurveValue(app, ctx, ctx.frame - 1) : null;
  /** 'seamless': the curves this switch puts their first keys on (`holdAfterSwitch`). */
  const firstKeys: CurveId[] = [];
  if (matched !== null) {
    if (mode === 'none') {
      const { edits } = editsFromValues(app, matched);
      if (edits.length > 0) results.push(applyChannelEdits(app, tx, edits, { key: 'auto' }));
    } else {
      const edits = matchEdits(app, matched);
      if (mode === 'seamless') holdBeforeSwitch(app, tx, ctx, edits, firstKeys);
      if (edits.length > 0) results.push(applyChannelEdits(app, tx, edits, { key: 'force' }));
    }
  }
  if (ikFk !== null) {
    const edit = { control: ikControl, channel: '@ikFk' as ChannelId, value: ikFk };
    if (mode === 'none') {
      if (Math.abs(app.evaluation.channelValue(ikControl, '@ikFk') - ikFk) > 1e-12) {
        results.push(applyChannelEdits(app, tx, [edit], { key: 'auto' }));
      }
    } else {
      const curve = ensureCurve(app, tx, ctx.clip.id, ikControl, '@ikFk');
      if (before !== null && tx.query.keysOfCurve(curve).length === 0) firstKeys.push(curve);
      results.push(applyChannelEdits(app, tx, [edit], { key: 'force' }));
      stepKeyAt(tx, curve, ctx.frame);
      if (before !== null) {
        const at = ctx.frame - 1;
        if (!tx.query.keysOfCurve(curve).some((key) => Math.abs(key.t - at) < SAME_FRAME)) {
          const control = tx.get('controls', ikControl);
          const tangents = newKeyTangents(control, '@ikFk', app.prefs.getState().defaultTangents);
          writeKeyAt(app, tx, curve, at, before, tangents);
          stepKeyAt(tx, curve, at);
        }
      }
    }
  }
  if (mode === 'seamless') holdAfterSwitch(tx, firstKeys);
  return results.length === 0 ? NO_EDITS : mergeResults(results);
}

// ---------- rig.addLimbIk ----------

/** The limbs `rig.addLimbIk` would add: the requested ones (default all) that have no `ik2` solver yet. */
function missingLimbs(app: EditorApp, character: CharacterId, requested: readonly LimbId[] | undefined): LimbId[] {
  const present = limbsWithSolvers(app.store, character);
  return (requested ?? LIMB_ORDER).filter((limb) => !present.has(limb));
}

function addLimbArgs(args: unknown): { character?: CharacterId; limbs?: readonly LimbId[] } | string {
  const options = optionalArgs(args);
  if (options === null) return 'expects { character?, limbs? }';
  const limbs = options['limbs'];
  if (limbs !== undefined && (!Array.isArray(limbs) || !(limbs as readonly unknown[]).every(isLimb))) {
    return `limbs must be ${LIMB_ORDER.join(', ')}`;
  }
  const character = options['character'];
  if (character !== undefined && typeof character !== 'string') return 'character must be a character id';
  return {
    ...(character === undefined ? {} : { character: character as CharacterId }),
    ...(limbs === undefined ? {} : { limbs: [...new Set(limbs as readonly LimbId[])] }),
  };
}

const addLimbIk = defineOperator({
  id: 'rig.addLimbIk',
  label: 'Add Limb IK',
  description: 'Add IK controls and two-bone IK to the limbs of a humanoid rig (your animation stays unchanged).',
  category: 'rig',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, structural: true },
  undoLabel: () => 'Add Limb IK',
  poll({ app }, raw) {
    const args = addLimbArgs(raw);
    if (typeof args === 'string') return fail(args);
    const base = pollEditable(app);
    if (base !== true) return base;
    const character = args.character ?? app.session.getState().activeCharacter;
    if (character === null) return fail('No character is loaded');
    const runtime = app.characters.get(character);
    if (runtime === undefined) return fail('The character is still loading');
    if (!isHumanoidProgram(runtime.program)) return fail('Limb IK needs a humanoid rig');
    if (!limbIkAvailable(app, runtime)) return fail(NOT_AVAILABLE_YET);
    return missingLimbs(app, character, args.limbs).length > 0 ? OK : fail('Those limbs have IK already');
  },
  apply({ app, tx }, raw) {
    if (tx === null) throw new EkzaError('internal', 'rig.addLimbIk runs in a transaction');
    const args = addLimbArgs(raw);
    if (typeof args === 'string') throw new EkzaError('invalid-record', args);
    const character = args.character ?? app.session.getState().activeCharacter;
    const runtime = character === null ? undefined : app.characters.get(character);
    if (character === null || runtime === undefined) throw new EkzaError('unsupported', 'No character runtime');
    const def = readRigDefinition(tx, runtime.program.rigId);
    if (def === undefined) throw new EkzaError('invalid-record', 'The character has no rig');
    const limbs = missingLimbs(app, character, args.limbs);
    // §5.7: every added limb starts FK (ikFk 0), so the animation is unchanged bit for bit.
    const records = limbKitOf(app).limbIkRecords(def, runtime.skeleton, { limbs, ikFkDefault: 0 });
    for (const control of records.controls) tx.put('controls', control);
    for (const solver of records.solvers) tx.put('solvers', solver);
    const added = records.solvers
      .map((solver) => (solver.params as Partial<Ik2Params>).limb)
      .filter((limb): limb is LimbId => isLimb(limb));
    warn(app, records.warnings);
    return { added, warnings: records.warnings };
  },
});

// ---------- rig.ikFk.switch / match / matchRange ----------

const switchLimb = defineOperator({
  id: 'rig.ikFk.switch',
  label: 'Switch IK/FK',
  description: "Switch a limb between IK and FK, matching the other side's pose first.",
  category: 'rig',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) => `Switch ${LIMB_NAME[args.limb] ?? 'Limb'} to ${args.to === 'ik' ? 'IK' : 'FK'}`,
  poll({ app }, args) {
    return pollLimb(
      app,
      args,
      (options) => {
        if (options['to'] !== 'ik' && options['to'] !== 'fk') return "to must be 'ik' or 'fk'";
        if (options['match'] !== undefined && typeof options['match'] !== 'boolean') return 'match must be a boolean';
        if (options['key'] !== undefined && !KEY_MODES.includes(options['key'] as IkFkKeyMode)) {
          return `key must be ${KEY_MODES.join(', ')}`;
        }
        return null;
      },
      // A switch to the limb's current mode would re-match the visible side to the hidden one (§5.6: the pose at f
      // is unchanged), so it is refused: "L Leg is IK already" on the menu item, the Attributes segment does nothing.
      (ctx, options) => switchAlreadyReason(app, ctx, options['to'] as 'ik' | 'fk'),
    );
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'rig.ikFk.switch runs in a transaction');
    const ctx = requireContext(app, args.limb, args.character);
    const mode = resolveSwitchKey(app, ctx, args.key);
    let matched: MatchResult | null = null;
    if (args.match !== false) {
      // Switching to FK matches the FK chain to the IK pose; to IK matches the IK control and pole to FK.
      matched = matchAt(app, ctx, args.to === 'fk' ? 'fk' : 'ik', channelsAt(app, ctx, ctx.frame, true));
      warn(app, matchWarnings(args.limb, matched));
    }
    return writeSwitch(app, tx, ctx, matched?.values ?? null, args.to === 'ik' ? 1 : 0, mode);
  },
});

const matchLimb = defineOperator({
  id: 'rig.ikFk.match',
  label: 'Match IK/FK',
  description: 'Set the IK or FK controls of a limb from the pose of the other side.',
  category: 'rig',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) =>
    args.side === 'fk'
      ? `Match ${LIMB_NAME[args.limb] ?? 'Limb'} FK to IK`
      : `Match ${LIMB_NAME[args.limb] ?? 'Limb'} IK to FK`,
  poll({ app }, args) {
    return pollLimb(app, args, (options) => {
      if (!SIDES.includes(options['side'] as 'ik' | 'fk')) return "side must be 'ik' or 'fk'";
      if (options['key'] !== undefined && typeof options['key'] !== 'boolean') return 'key must be a boolean';
      return null;
    });
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'rig.ikFk.match runs in a transaction');
    const ctx = requireContext(app, args.limb, args.character);
    const matched = matchAt(app, ctx, args.side, channelsAt(app, ctx, ctx.frame, true));
    warn(app, matchWarnings(args.limb, matched));
    return writeSwitch(app, tx, ctx, matched.values, null, args.key === true ? 'key' : 'none');
  },
});

export function rangeArg(value: unknown): { start: Frame; end: Frame } | null | string {
  if (value === undefined) return null;
  if (!isRecord(value) || !isFiniteNumber(value['start']) || !isFiniteNumber(value['end'])) {
    return 'range must be { start, end }';
  }
  if (value['end'] < value['start']) return 'range ends before it starts';
  return { start: value['start'], end: value['end'] };
}

const matchRange = defineOperator<'rig.ikFk.matchRange', AgentImpl | undefined>({
  id: 'rig.ikFk.matchRange',
  label: 'Match Range',
  description: 'Match the IK or FK controls of a limb over a frame range and key them.',
  category: 'rig',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) => `Match Range ${LIMB_NAME[args.limb] ?? 'Limb'} to ${args.side === 'ik' ? 'IK' : 'FK'}`,
  poll(opCtx, args) {
    const { app } = opCtx;
    const actor = isActorRun(opCtx);
    return pollLimb(
      app,
      args,
      (options) => {
        if (!SIDES.includes(options['side'] as 'ik' | 'fk')) return "side must be 'ik' or 'fk'";
        const range = rangeArg(options['range']);
        if (typeof range === 'string') return range;
        if (options['step'] !== undefined && options['step'] !== 'keys' && options['step'] !== 'frames') {
          return "step must be 'keys' or 'frames'";
        }
        if (options['clip'] !== undefined && typeof options['clip'] !== 'string') return 'clip must be a clip id';
        // MCP-SPEC §4.10: an agent run names its clip and range and never reads the session.
        if (actor && (options['clip'] === undefined || range === null)) {
          return 'An agent Match Range needs its clip and range';
        }
        if (actor && range !== null && range.end - range.start > AGENT_SPAN_LIMIT) {
          return `The range spans more than ${AGENT_SPAN_LIMIT} frames`;
        }
        return null;
      },
      // §5.5: an agent's match writes at most 50,000 keys (frames × the side's keyable channels). The check loads
      // with the agent operators' implementation (this run's `prepare` loads it; the runner polls again after it).
      (ctx, options) => (actor ? (loadedAgentImpl()?.matchRangeWriteProblem(app, ctx, options) ?? null) : null),
      true,
    );
  },
  // Agent runs write their keys through the agent operators' merge writer (one pass per curve, MAI-P1-16).
  prepare: (ctx) => (isActorRun(ctx) ? loadAgentImpl() : undefined),
  apply({ app, tx }, args, impl) {
    if (tx === null) throw new EkzaError('internal', 'rig.ikFk.matchRange runs in a transaction');
    const ctx = requireContext(app, args.limb, args.character, args.clip);
    const range = rangeArg(args.range);
    const span = range === null || typeof range === 'string' ? ctx.clip.range : range;
    const step = args.step ?? (args.side === 'fk' ? 'frames' : 'keys');
    const frames = matchRangeFrames(app, ctx, span, step);
    // Every match reads the committed curves (writing one side never changes the other side's pose); each frame's
    // values are the eulerNear reference of the next, so the written rotations are continuous.
    const perFrame: { readonly frame: Frame; readonly values: ReadonlyMap<ControlId, ChannelValues> }[] = [];
    let reference: ReadonlyMap<ControlId, ChannelValues> | undefined;
    let worst = { endErrorM: 0, midErrorM: 0, hyperextensionRad: 0, toesErrorRad: 0, toesErrorM: 0 };
    for (const frame of frames) {
      const result = matchAt(app, ctx, args.side, channelsAt(app, ctx, frame, false), reference);
      perFrame.push({ frame, values: result.values });
      reference = result.values;
      worst = {
        endErrorM: Math.max(worst.endErrorM, result.endErrorM),
        midErrorM: Math.max(worst.midErrorM, result.midErrorM),
        hyperextensionRad: Math.max(worst.hyperextensionRad, result.hyperextensionRad),
        toesErrorRad: Math.max(worst.toesErrorRad, result.toesErrorRad),
        toesErrorM: Math.max(worst.toesErrorM, result.toesErrorM),
      };
    }
    let count = 0;
    const tangents = app.prefs.getState().defaultTangents;
    const written = new Set<ControlId>();
    const merged: { control: ControlId; channel: ChannelId; frame: Frame; value: number }[] = [];
    for (const { frame, values } of perFrame) {
      for (const edit of matchEdits(app, values)) {
        if (impl !== undefined) merged.push({ ...edit, frame });
        else {
          const curve = ensureCurve(app, tx, ctx.clip.id, edit.control, edit.channel);
          const control = tx.get('controls', edit.control);
          writeKeyAt(app, tx, curve, frame, edit.value, newKeyTangents(control, edit.channel, tangents));
        }
        written.add(edit.control);
        count++;
      }
    }
    if (impl !== undefined) impl.writeKeys(app, tx, ctx.clip, merged);
    eulerFilterWritten(tx, ctx, [...written]);
    const warnings = matchWarnings(args.limb, worst);
    if (step === 'keys' && perFrame.length > 0) {
      // Keys only at the key times leave the in-betweens to the curves' interpolation, which differs between IK
      // and FK: say by how much (fix round 1: Match Range to IK moved an in-between knee 3.5 cm silently).
      const channels = new Map<ControlId, ChannelId[]>();
      for (const { values } of perFrame) {
        for (const edit of matchEdits(app, values)) {
          const list = channels.get(edit.control) ?? [];
          if (!list.includes(edit.channel)) list.push(edit.channel);
          channels.set(edit.control, list);
        }
      }
      const deviation = matchRangeDeviation(app, tx, ctx, args.side, span, frames, channels);
      const warning = matchRangeDeviationWarning(args.limb, args.side, frames.length, deviation);
      if (warning !== null) warnings.push(warning);
    }
    warn(app, warnings);
    return { count } satisfies CountResult;
  },
});

/** §5.6: the Euler filter over the rotation curves of the written controls (key values patched in place). */
function eulerFilterWritten(tx: Tx, ctx: LimbContext, controls: readonly ControlId[]): void {
  const layer = tx.query.baseLayer(ctx.clip.id);
  if (layer === undefined) return;
  for (const id of controls) {
    const control = tx.get('controls', id);
    if (control === undefined) continue;
    const curves = (['rx', 'ry', 'rz'] as const).map((channel) =>
      tx.query.curveFor(ctx.clip.id, layer.id, id, channel),
    );
    if (curves.some((curve) => curve === undefined)) continue;
    const records = curves as NonNullable<(typeof curves)[number]>[];
    const keys = records.map((curve) => tx.query.keysOfCurve(curve.id));
    if (keys.every((list) => list.length < 2)) continue;
    const filtered = eulerFilterCurves(
      [animCurve(records[0]!, keys[0]!), animCurve(records[1]!, keys[1]!), animCurve(records[2]!, keys[2]!)],
      control.rotateOrder,
    );
    for (let axis = 0; axis < 3; axis++) {
      for (const key of keys[axis] ?? []) {
        const next = filtered[axis]?.find((candidate) => Math.abs(candidate.t - key.t) < SAME_FRAME);
        if (next !== undefined && Math.abs(next.v - key.v) > 1e-12) tx.patch('keys', key.id, { v: next.v });
      }
    }
  }
}

// ---------- rig.setFootParams ----------

function footPatch(value: unknown): Partial<Pick<FootRollParams, (typeof FOOT_FIELDS)[number]>> | string {
  if (!isRecord(value)) return 'params must be an object';
  const out: Partial<Record<(typeof FOOT_FIELDS)[number], number>> = {};
  for (const [name, field] of Object.entries(value)) {
    if (!(FOOT_FIELDS as readonly string[]).includes(name)) return `unknown foot parameter '${name}'`;
    if (!isFiniteNumber(field) || field < 0) return `${name} must be a number ≥ 0`;
    if (name === 'breakAngle' && field > Math.PI / 2) return 'breakAngle must be at most 90°';
    out[name as (typeof FOOT_FIELDS)[number]] = field;
  }
  return Object.keys(out).length === 0 ? 'params names no foot parameter' : out;
}

const setFootParams = defineOperator({
  id: 'rig.setFootParams',
  label: 'Edit Foot Pivots',
  description: "Set a leg's foot-roll pivot distances and break angle.",
  category: 'rig',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, structural: true },
  undoLabel: () => 'Edit Foot Pivots',
  poll({ app }, args) {
    if (!isRecord(args) || (args['limb'] !== 'leg.L' && args['limb'] !== 'leg.R')) {
      return fail("expects { limb: 'leg.L' | 'leg.R', params, character? }");
    }
    const patch = footPatch(args['params']);
    if (typeof patch === 'string') return fail(patch);
    const base = pollEditable(app);
    if (base !== true) return base;
    if (args['character'] !== undefined && typeof args['character'] !== 'string') {
      return fail('character must be a character id');
    }
    // Foot pivots are rig data: no active clip is needed.
    const foot = currentFoot(app, args['limb'], args['character']);
    if (typeof foot === 'string') return fail(foot);
    const merged = limbKitOf(app).validateFootParams(foot.params, patch);
    return 'error' in merged ? fail(merged.error) : OK;
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'rig.setFootParams runs in a transaction');
    const patch = footPatch(args.params);
    if (typeof patch === 'string') throw new EkzaError('invalid-record', patch);
    const foot = currentFoot(app, args.limb, args.character);
    if (typeof foot === 'string') throw new EkzaError('unsupported', foot);
    const kit = limbKitOf(app);
    const merged = kit.validateFootParams(foot.params, patch);
    if ('error' in merged) throw new EkzaError('invalid-record', merged.error);
    const solver = tx.get('solvers', foot.solver);
    if (solver === undefined) throw new EkzaError('invalid-record', 'The leg has no ik2 solver');
    tx.patch('solvers', solver.id, { params: { ...solver.params, foot: merged } });
    // The IK control's footprint shape follows its pivots (§5.2.3), in the same transaction.
    const control = tx.get('controls', foot.ikControl);
    if (control !== undefined) {
      tx.patch('controls', control.id, {
        shape: { ...control.shape, kind: 'custom', custom: kit.footprintShape(merged) },
      });
    }
  },
});

/** The leg's current foot parameters and records, or why there are none. */
function currentFoot(
  app: EditorApp,
  limb: 'leg.L' | 'leg.R',
  character: CharacterId | undefined,
): { readonly params: FootRollParams; readonly solver: SolverId; readonly ikControl: ControlId } | string {
  const id = character ?? app.session.getState().activeCharacter;
  if (id === null) return 'No character is loaded';
  const runtime = app.characters.get(id);
  if (runtime === undefined) return 'The character is still loading';
  const desc = runtime.program.limbs.find((candidate) => candidate.id === limb);
  if (desc === undefined) return `The character has no ${LIMB_NAME[limb]} IK (Rig › Add Limb IK)`;
  if (desc.params.foot === null) return `${LIMB_NAME[limb]} has no foot pivots`;
  return { params: desc.params.foot, solver: desc.solver, ikControl: desc.params.ikControl };
}

export const IK_OPERATORS: readonly AnyOperator[] = [addLimbIk, switchLimb, matchLimb, matchRange, setFootParams];
