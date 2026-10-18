// Limb IK in the editor (M2A-SPEC §5.5–§5.8, A2): which limb a control belongs to, the limbs of a character's
// compiled rig, and the IK/FK workflows the `rig.*` IK operators run (match, switch keys, match range, foot
// parameters, Plant Feet on IK legs, the "FK limbs only" notice). The rig math (records, the ik2 op, matching) is
// A1's (`@ekza-animator/rig`); this file reads compiled `RigProgram.limbs`, calls the rig's limb functions through
// one seam (`limbKitOf`) and writes channels through the edit kernel.
import { type Disposer, EkzaError, type Frame, type Mat4 } from '@ekza-animator/anim-core';
import type { ChannelId, ChannelValues, CharacterId, ClipRecord, ControlId, ReadView } from '@ekza-animator/doc';
import {
  applyOverrides,
  type ChannelBuffer,
  computeInfluenceKeyTimes,
  evaluateWithLimbMode,
  footprintShape,
  ikControlForEndWorld,
  isHumanoidProgram,
  type LimbDesc,
  type LimbId,
  limbIkRecords,
  matchFkToIk,
  matchIkToFk,
  type PoseBuffers,
  type RigProgram,
  readControlChannels,
  readRigDefinition,
  validateFootParams,
  writeControlChannels,
} from '@ekza-animator/rig';
import { attrChannelsOf, isKeyable, isLocked } from '../edit/channelMeta';
import { activeClipOf, clipFrameAt, sceneFpsOf } from '../evaluation/time';
import { internalsOf } from '../app/internals';
import type { ChannelEdit, CharacterRuntime, EditorApp, IkFkKeyMode } from '../types';
import { limbVisibilityState } from './visibility';

/** Display names of the limbs ('L Leg'), used in labels, warnings and menus. */
export const LIMB_NAME: Readonly<Record<LimbId, string>> = {
  'leg.L': 'L Leg',
  'leg.R': 'R Leg',
  'arm.L': 'L Arm',
  'arm.R': 'R Arm',
};
export const LIMB_ORDER: readonly LimbId[] = ['leg.L', 'leg.R', 'arm.L', 'arm.R'];

const isLeg = (limb: LimbId): boolean => limb === 'leg.L' || limb === 'leg.R';
/** 'knee' / 'elbow', 'foot' / 'hand'. */
const midName = (limb: LimbId): string => (isLeg(limb) ? 'knee' : 'elbow');
const endName = (limb: LimbId): string => (isLeg(limb) ? 'foot' : 'hand');

// ---------- the rig seam ----------

/** The rig functions the IK workflows call (A1's public API, M2A-SPEC §8 A1). */
export interface LimbKit {
  readonly limbIkRecords: typeof limbIkRecords;
  readonly validateFootParams: typeof validateFootParams;
  readonly footprintShape: typeof footprintShape;
  readonly evaluateWithLimbMode: typeof evaluateWithLimbMode;
  readonly matchFkToIk: typeof matchFkToIk;
  readonly matchIkToFk: typeof matchIkToFk;
  readonly ikControlForEndWorld: typeof ikControlForEndWorld;
  readonly computeInfluenceKeyTimes: typeof computeInfluenceKeyTimes;
}

const RIG_LIMB_KIT: LimbKit = {
  limbIkRecords,
  validateFootParams,
  footprintShape,
  evaluateWithLimbMode,
  matchFkToIk,
  matchIkToFk,
  ikControlForEndWorld,
  computeInfluenceKeyTimes,
};

const kits = new WeakMap<EditorApp, LimbKit>();

/** The limb functions an app uses: the rig's, unless a test replaced some (`setLimbKit`). */
export function limbKitOf(app: EditorApp): LimbKit {
  return kits.get(app) ?? RIG_LIMB_KIT;
}

/**
 * Test seam (not part of the package API): replaces some limb functions for one app, e.g. a scripted match result
 * to test the key policies independently of the rig's math. `null` restores the rig's functions.
 */
export function setLimbKit(app: EditorApp, kit: Partial<LimbKit> | null): void {
  if (kit === null) kits.delete(app);
  else kits.set(app, { ...RIG_LIMB_KIT, ...kit });
}

/** True when the call throws the rig's `not-implemented` stub error (the limb API is not merged yet). */
function notImplemented(error: unknown): boolean {
  return error instanceof EkzaError && error.code === 'not-implemented';
}

const availability = new WeakMap<object, boolean>();

/**
 * Whether limb IK can be added to this character: the rig package implements `limbIkRecords` (probed once per
 * program and kit with no limbs). False when the limb kit is the `not-implemented` stub (tests script one through
 * `setLimbKit`), so the IK commands poll-fail "not available yet"; true with the rig package's kit.
 */
export function limbIkAvailable(app: EditorApp, runtime: CharacterRuntime): boolean {
  const kit = limbKitOf(app);
  const key = kit === RIG_LIMB_KIT ? runtime.program : kit;
  const known = availability.get(key);
  if (known !== undefined) return known;
  const def = readRigDefinition(app.store, runtime.program.rigId);
  let ok = def !== undefined;
  if (def !== undefined) {
    try {
      kit.limbIkRecords(def, runtime.skeleton, { limbs: [], ikFkDefault: 0 });
    } catch (error) {
      ok = !notImplemented(error);
    }
  }
  availability.set(key, ok);
  return ok;
}

// ---------- limbs ----------

/** The compiled limbs of a character's rig (none without a runtime or without `ik2` solvers). */
export function limbsOf(app: EditorApp, character: CharacterId | null): readonly LimbDesc[] {
  if (character === null) return [];
  return app.characters.get(character)?.program.limbs ?? [];
}

/**
 * The limb a control belongs to for the IK/FK UI (§5.6 "any selected control of a limb"): its FK chain
 * (`fk.upper`, `fk.mid`, `fk.end`, and `fk.toes` of legs), its IK control or its pole; null otherwise.
 */
export function limbOfControlIn(program: RigProgram, control: ControlId): LimbDesc | null {
  for (const limb of program.limbs) {
    const { fk, ikControl, pole } = limb.params;
    if (
      control === ikControl ||
      control === pole ||
      control === fk.upper ||
      control === fk.mid ||
      control === fk.end ||
      (fk.toes !== null && control === fk.toes)
    ) {
      return limb;
    }
  }
  return null;
}

/** `limbOfControlIn` over the control's character runtime (null without a runtime). */
export function limbOfControlApp(app: EditorApp, control: ControlId): LimbDesc | null {
  const record = app.store.get('controls', control);
  if (record === undefined) return null;
  const character = app.store.get('rigs', record.rig)?.character;
  const program = character === undefined ? undefined : app.characters.get(character)?.program;
  return program === undefined ? null : limbOfControlIn(program, control);
}

/** Limbs whose rig has an `ik2` solver record (enabled or not), from the document. */
export function limbsWithSolvers(view: ReadView, character: CharacterId): ReadonlySet<LimbId> {
  const rig = view.query.rigOfCharacter(character);
  const out = new Set<LimbId>();
  if (rig === undefined) return out;
  for (const solver of view.list('solvers')) {
    if (solver.rig !== rig.id || solver.type !== 'ik2' || solver.deleted !== null) continue;
    const limb = (solver.params as { readonly limb?: unknown }).limb;
    if (typeof limb === 'string' && (LIMB_ORDER as readonly string[]).includes(limb)) out.add(limb as LimbId);
  }
  return out;
}

/** Everything an IK operator needs about one limb of a character at the current frame. */
export interface LimbContext {
  readonly character: CharacterId;
  readonly runtime: CharacterRuntime;
  readonly program: RigProgram;
  readonly limb: LimbDesc;
  readonly clip: ClipRecord;
  /** The active clip frame (the frame the switch keys). */
  readonly frame: Frame;
}

/** The limb context of `limb` on `character` (default: the active one), or the reason it cannot be used. */
export function limbContext(app: EditorApp, limb: LimbId, character?: CharacterId): LimbContext | string {
  const id = character ?? app.session.getState().activeCharacter;
  if (id === null || id === undefined) return 'No character is loaded';
  const runtime = app.characters.get(id);
  if (runtime === undefined) return 'The character is still loading';
  const desc = runtime.program.limbs.find((candidate) => candidate.id === limb);
  if (desc === undefined) return `The character has no ${LIMB_NAME[limb] ?? limb} IK (Rig › Add Limb IK)`;
  const clip = activeClipOf(app.store, app.session.getState(), id);
  if (clip === undefined) return 'The character has no active clip';
  const frame = clipFrameAt(internalsOf(app).deps, sceneFpsOf(app.store), clip, app.session.getState().time.sceneFrame);
  return { character: id, runtime, program: runtime.program, limb: desc, clip, frame };
}

/**
 * Why a switch of the limb to `to` does not apply: the limb is in that mode already at the current frame (§5.5
 * rule 2's thresholds, the ones the Attributes segments and the viewport use: IK at `ikFk ≥ 0.999`, FK at
 * `≤ 0.001`). Such a switch would match the visible side to the hidden one and move the pose at f, which §5.6 keeps
 * unchanged. Null when the switch applies (the other mode, or a blend between).
 */
export function switchAlreadyReason(app: EditorApp, ctx: LimbContext, to: 'ik' | 'fk'): string | null {
  const state = limbVisibilityState(app.evaluation.ikFk(ctx.character, ctx.limb.id) ?? 0);
  if (state !== (to === 'ik' ? 2 : 0)) return null;
  return `${LIMB_NAME[ctx.limb.id] ?? ctx.limb.id} is ${to === 'ik' ? 'IK' : 'FK'} already`;
}

// ---------- matching ----------

/** Channels of a character at a clip frame (curves, with the session overrides when asked). */
export function channelsAt(app: EditorApp, ctx: LimbContext, frame: Frame, withOverrides: boolean): ChannelBuffer {
  const ch = ctx.program.allocChannels();
  ctx.runtime.sampler(ctx.clip.id).sample(frame, ch);
  const overrides = app.session.getState().overrides;
  if (withOverrides && overrides.size > 0) applyOverrides(ctx.program, ch, overrides);
  return ch;
}

/** The controls one side of a limb sets (§5.6): FK chain (+ toes) for 'fk', the IK control and pole for 'ik'. */
export function sideControls(limb: LimbDesc, side: 'ik' | 'fk'): readonly ControlId[] {
  const { fk } = limb.params;
  if (side === 'ik') return [limb.params.ikControl, limb.params.pole];
  return fk.toes === null ? [fk.upper, fk.mid, fk.end] : [fk.upper, fk.mid, fk.end, fk.toes];
}

/** Channel values of controls in a channel buffer, TRS and attributes (the eulerNear reference of a match). */
function bufferValues(
  app: EditorApp,
  program: RigProgram,
  ch: ChannelBuffer,
  controls: readonly ControlId[],
): Map<ControlId, ChannelValues> {
  const out = new Map<ControlId, ChannelValues>();
  for (const id of controls) {
    if (!program.controlIndex.has(id)) continue;
    const values: Record<string, number> = { ...readControlChannels(program, ch, id) };
    const record = app.store.get('controls', id);
    for (const channel of attrChannelsOf(record)) {
      const slot = program.attrIndex.get(`${id}/${channel}`);
      if (slot !== undefined) values[channel] = ch.attrs[slot] as number;
    }
    out.set(id, values);
  }
  return out;
}

export interface MatchResult {
  readonly values: Map<ControlId, ChannelValues>;
  readonly endErrorM: number;
  readonly midErrorM: number;
  /** Bend angle of a hyperextended FK mid joint (radians), 0 when the FK pose bends the normal way. */
  readonly hyperextensionRad: number;
  /**
   * IK match of a leg with toes: how far the matched IK pose turns the toes relative to the foot (radians). The
   * ik2 toes rule counter-rotates the ball roll, so a `@roll` inside the ball range bends the toes by that amount
   * while the foot itself matches; 0 for FK matches and limbs without toes.
   */
  readonly toesErrorRad: number;
  /**
   * FK match of a leg with toes: how far the toes joint of the matched FK pose is from the IK pose's (metres). Under
   * a ball roll the ik2 toes rule keeps the toes planted by turning them about the ball pivot, which can lie off the
   * toes joint; FK keeps that joint on the foot, so only the rotation can match. 0 for IK matches.
   */
  readonly toesErrorM: number;
}

/**
 * §5.6 match at one frame from a channel buffer: `side: 'fk'` sets the FK chain from the pose with ikFk 1;
 * `side: 'ik'` sets the IK control and pole from the pose with ikFk 0 (the match pole rule is the rig's).
 * `reference` defaults to the side controls' channels in `ch` (eulerNear continuity).
 */
export function matchAt(
  app: EditorApp,
  ctx: LimbContext,
  side: 'ik' | 'fk',
  ch: ChannelBuffer,
  reference?: ReadonlyMap<ControlId, ChannelValues>,
): MatchResult {
  const kit = limbKitOf(app);
  const { program, limb } = ctx;
  const scratch = program.allocChannels();
  const pose = program.allocPose();
  const ref = reference ?? bufferValues(app, program, ch, sideControls(limb, side));
  const { upper, mid, end, toes } = limb.nodes;
  /** The pose of `ch` with `values` written, evaluated with the limb at `ikFk`. */
  const matchedPose = (values: ReadonlyMap<ControlId, ChannelValues>, ikFk: number): PoseBuffers => {
    const matched: ChannelBuffer = { values: ch.values.slice(), attrs: ch.attrs.slice() };
    for (const [control, channels] of values) writeControlChannels(program, matched, control, channels);
    const out = program.allocPose();
    kit.evaluateWithLimbMode(program, matched, limb.id, ikFk, scratch, out);
    return out;
  };
  if (side === 'fk') {
    kit.evaluateWithLimbMode(program, ch, limb.id, 1, scratch, pose);
    const values = kit.matchFkToIk(program, pose, limb.id, ref);
    const toesErrorM =
      toes >= 0 ? len3(sub3(position(matchedPose(values, 0).boneWorld, toes), position(pose.boneWorld, toes))) : 0;
    return { values, endErrorM: 0, midErrorM: 0, hyperextensionRad: 0, toesErrorRad: 0, toesErrorM };
  }
  kit.evaluateWithLimbMode(program, ch, limb.id, 0, scratch, pose);
  const result = kit.matchIkToFk(program, pose, ch, limb.id, ref);
  const chain = upper >= 0 && mid >= 0 && end >= 0;
  const midMoves = result.midErrorM > MID_ERROR_WARN_M;
  let hyperextensionRad = 0;
  let toesErrorRad = 0;
  if (chain && (midMoves || toes >= 0)) {
    const ikPose = matchedPose(result.values, 1);
    if (midMoves) hyperextensionRad = hyperextension(limb, pose, ikPose);
    if (toes >= 0) toesErrorRad = relativeTurn(pose.boneWorld, ikPose.boneWorld, end, toes);
  }
  return {
    values: result.values,
    endErrorM: result.endErrorM,
    midErrorM: result.midErrorM,
    hyperextensionRad,
    toesErrorRad,
    toesErrorM: 0,
  };
}

/** Warning thresholds of a match (§5.6): the end misses by more than 0.1 mm, the mid joint by more than 1 mm. */
export const END_ERROR_WARN_M = 1e-4;
export const MID_ERROR_WARN_M = 1e-3;
/** An IK match that turns the toes (relative to the foot) by more than this warns (radians). */
export const TOES_ERROR_WARN_RAD = 1e-3;

const position = (world: Float64Array, node: number): [number, number, number] => [
  world[node * 16 + 12] ?? 0,
  world[node * 16 + 13] ?? 0,
  world[node * 16 + 14] ?? 0,
];
const sub3 = (a: readonly number[], b: readonly number[]): [number, number, number] => [
  (a[0] ?? 0) - (b[0] ?? 0),
  (a[1] ?? 0) - (b[1] ?? 0),
  (a[2] ?? 0) - (b[2] ?? 0),
];
const dot3 = (a: readonly number[], b: readonly number[]): number =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
const len3 = (a: readonly number[]): number => Math.sqrt(dot3(a, a));

/** Offset of the mid joint from the upper→end line (the bend direction of a two-bone chain). */
function bendOffset(world: Float64Array, limb: LimbDesc): [number, number, number] {
  const a = position(world, limb.nodes.upper);
  const b = position(world, limb.nodes.mid);
  const c = position(world, limb.nodes.end);
  const axis = sub3(c, a);
  const length = len3(axis);
  const ab = sub3(b, a);
  if (length < 1e-12) return ab;
  const along = dot3(ab, axis) / (length * length);
  return [ab[0] - axis[0] * along, ab[1] - axis[1] * along, ab[2] - axis[2] * along];
}

/** Column `c` (0–2) of a world matrix's rotation part, normalized (worlds may carry scale). */
function axisOf(world: Float64Array, node: number, c: number): [number, number, number] {
  const o = node * 16 + c * 4;
  const v: [number, number, number] = [world[o] ?? 0, world[o + 1] ?? 0, world[o + 2] ?? 0];
  const length = len3(v);
  return length < 1e-12 ? v : [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * The angle between the rotations of `child` relative to `parent` in two poses (radians): with R = Rp⁻¹·Rc in each
 * pose, the angle of Ra⁻¹·Rb from its trace. Used for the toes relative to the foot.
 */
function relativeTurn(a: Float64Array, b: Float64Array, parent: number, child: number): number {
  // (Rp⁻¹·Rc)[i][j] = p_i · c_j for orthonormal columns p_i, c_j; trace(Ra⁻¹·Rb) = Σ_ij Ra[i][j]·Rb[i][j].
  const relative = (world: Float64Array): number[] => {
    const p = [axisOf(world, parent, 0), axisOf(world, parent, 1), axisOf(world, parent, 2)];
    const c = [axisOf(world, child, 0), axisOf(world, child, 1), axisOf(world, child, 2)];
    const out: number[] = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out.push(dot3(p[i] ?? [], c[j] ?? []));
    return out;
  };
  const ra = relative(a);
  const rb = relative(b);
  let trace = 0;
  for (let k = 0; k < 9; k++) trace += (ra[k] ?? 0) * (rb[k] ?? 0);
  return Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2)));
}

/**
 * The FK bend angle when the FK pose bends the mid joint the other way than the matched IK pose does (a
 * hyperextended knee or elbow, §5.6), else 0.
 */
function hyperextension(limb: LimbDesc, fkPose: PoseBuffers, ikPose: PoseBuffers): number {
  const fk = bendOffset(fkPose.boneWorld, limb);
  const ik = bendOffset(ikPose.boneWorld, limb);
  if (dot3(fk, ik) >= 0) return 0;
  const a = position(fkPose.boneWorld, limb.nodes.upper);
  const b = position(fkPose.boneWorld, limb.nodes.mid);
  const c = position(fkPose.boneWorld, limb.nodes.end);
  const u = sub3(b, a);
  const v = sub3(c, b);
  const denominator = len3(u) * len3(v);
  return denominator < 1e-12 ? 0 : Math.acos(Math.min(1, Math.max(-1, dot3(u, v) / denominator)));
}

/**
 * The warnings of a match (§5.6): for IK, hyperextension or a non-hinge mid joint, an end that misses (soft IK), and
 * toes that the foot roll bends (`toesErrorRad`); for FK, toes the foot roll moved off the foot (`toesErrorM`).
 */
export function matchWarnings(
  limb: LimbId,
  result: Pick<MatchResult, 'endErrorM' | 'midErrorM' | 'hyperextensionRad'> & {
    readonly toesErrorRad?: number;
    readonly toesErrorM?: number;
  },
): string[] {
  const out: string[] = [];
  const name = LIMB_NAME[limb] ?? limb;
  const mm = (metres: number): string => {
    const value = metres * 1000;
    return value >= 10 ? value.toFixed(0) : value.toFixed(1);
  };
  if (result.midErrorM > MID_ERROR_WARN_M) {
    if (result.hyperextensionRad > 0) {
      const degrees = (result.hyperextensionRad * 180) / Math.PI;
      const how = isLeg(limb) ? 'IK bends it forward' : 'IK bends it the normal way';
      out.push(
        `${name}: the ${midName(limb)} is hyperextended by ${degrees.toFixed(degrees < 10 ? 1 : 0)}°; ${how}, the ${midName(limb)} moves ${mm(result.midErrorM)} mm`,
      );
    } else {
      out.push(`${name}: the ${midName(limb)} is not a clean hinge; IK moves it ${mm(result.midErrorM)} mm`);
    }
  }
  if (result.endErrorM > END_ERROR_WARN_M) {
    out.push(`${name}: IK misses the FK ${endName(limb)} by ${mm(result.endErrorM)} mm (soft IK)`);
  }
  const toes = result.toesErrorRad ?? 0;
  if (toes > TOES_ERROR_WARN_RAD) {
    const degrees = (toes * 180) / Math.PI;
    out.push(
      `${name}: IK bends the toes by ${degrees.toFixed(degrees < 10 ? 1 : 0)}° (foot roll); set Roll to 0 to keep the FK toes`,
    );
  }
  if ((result.toesErrorM ?? 0) > END_ERROR_WARN_M) {
    out.push(
      `${name}: FK moves the toes by ${mm(result.toesErrorM ?? 0)} mm (foot roll); set Roll to 0 to keep the IK toes`,
    );
  }
  return out;
}

// ---------- writing ----------

/** Channel edits of matched values: keyable, unlocked channels (TRS and attributes) that the values name. */
export function matchEdits(app: EditorApp, values: ReadonlyMap<ControlId, ChannelValues>): ChannelEdit[] {
  const edits: ChannelEdit[] = [];
  for (const [id, channels] of values) {
    const control = app.store.get('controls', id);
    if (control === undefined) continue;
    for (const [channel, value] of Object.entries(channels) as [ChannelId, number | undefined][]) {
      if (value === undefined || !Number.isFinite(value)) continue;
      if (!isKeyable(control, channel) || isLocked(control, channel)) continue;
      edits.push({ control: id, channel, value });
    }
  }
  return edits;
}

/**
 * §5.6 key mode of a switch: the argument, else `prefs.ikFkSwitchKey`; 'auto' is 'seamless' when the limb's
 * `@ikFk` curve has keys (active clip) or auto-key is on, else 'none'.
 */
export function resolveSwitchKey(
  app: EditorApp,
  ctx: LimbContext,
  requested: IkFkKeyMode | undefined,
): Exclude<IkFkKeyMode, 'auto'> {
  const mode = requested ?? app.prefs.getState().ikFkSwitchKey;
  if (mode !== 'auto') return mode;
  if (app.prefs.getState().autoKey) return 'seamless';
  const layer = app.store.query.baseLayer(ctx.clip.id);
  const curve =
    layer === undefined
      ? undefined
      : app.store.query.curveFor(ctx.clip.id, layer.id, ctx.limb.params.ikControl, '@ikFk');
  return curve !== undefined && app.store.query.keysOfCurve(curve.id).length > 0 ? 'seamless' : 'none';
}

/** Frames `matchRange` matches at (§5.6): every integer frame, or the key times of the limb's influencing curves. */
export function matchRangeFrames(
  app: EditorApp,
  ctx: LimbContext,
  range: { readonly start: Frame; readonly end: Frame },
  step: 'keys' | 'frames',
): readonly Frame[] {
  if (step === 'frames') {
    const out: Frame[] = [];
    // `+ 0` turns −0 (Math.ceil of a tiny negative) into 0: key times are never −0.
    for (let f = Math.ceil(range.start - 1e-9) + 0; f <= range.end + 1e-9; f++) out.push(f);
    return out;
  }
  // §5.8 influencing curves: the rig's one definition, read off the chain nodes' tracks.
  const times = limbKitOf(app).computeInfluenceKeyTimes(ctx.program, ctx.runtime.sampler(ctx.clip.id), range, 'raw');
  const { upper, mid, end, toes } = ctx.limb.nodes;
  const set = new Set<number>();
  for (const node of [upper, mid, end, toes]) {
    if (node < 0) continue;
    for (const kind of ['rotation', 'translation', 'scale'] as const) {
      for (const t of times.get(`${node}/${kind}`) ?? [])
        if (t >= range.start - 1e-9 && t <= range.end + 1e-9) set.add(t);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** Plant Feet on an IK leg (§5.8): the IK control channels that put the foot bone on its pin. */
export function plantIkLeg(
  app: EditorApp,
  ctx: LimbContext,
  pose: PoseBuffers,
  ch: ChannelBuffer,
  footWorld: Mat4,
): ChannelValues {
  const reference =
    bufferValues(app, ctx.program, ch, [ctx.limb.params.ikControl]).get(ctx.limb.params.ikControl) ?? {};
  return limbKitOf(app).ikControlForEndWorld(ctx.program, pose, ch, ctx.limb.id, footWorld, reference);
}

// ---------- the "FK limbs only" notice (§5.7) ----------

const watchers = new WeakMap<EditorApp, { count: number; readonly dispose: Disposer }>();
/** Characters already told about, per app (kept across watcher remounts, e.g. React StrictMode). */
const toldAbout = new WeakMap<EditorApp, Set<CharacterId>>();

/** True for a humanoid rig without `ik2` solvers whose limbs can get IK (the rig implements it). */
export function isFkOnlyHumanoid(app: EditorApp, character: CharacterId): boolean {
  const runtime = app.characters.get(character);
  if (runtime === undefined || !isHumanoidProgram(runtime.program)) return false;
  if (limbsWithSolvers(app.store, character).size > 0) return false;
  return limbIkAvailable(app, runtime);
}

/**
 * Shows "This rig has FK limbs only…" once per character when the active character is a humanoid rig without
 * `ik2` solvers (§5.7), with the action Rig › Add Limb IK. Reference-counted per app (several panels may mount it).
 */
export function watchFkOnlyRigs(app: EditorApp): Disposer {
  let entry = watchers.get(app);
  if (entry === undefined) {
    let told = toldAbout.get(app);
    if (told === undefined) {
      told = new Set();
      toldAbout.set(app, told);
    }
    const seen = told;
    const check = (): void => {
      const character = app.session.getState().activeCharacter;
      if (character === null || seen.has(character)) return;
      if (app.characters.get(character) === undefined) return;
      seen.add(character);
      if (!isFkOnlyHumanoid(app, character)) return;
      app.services.notify.toast({
        kind: 'info',
        text: 'This rig has FK limbs only. Rig › Add Limb IK adds IK controls (your animation stays unchanged).',
        action: { label: 'Add Limb IK', op: 'rig.addLimbIk', args: { character } },
      });
    };
    const disposers = [
      app.session.subscribe((state, previous) => {
        if (state.activeCharacter !== previous.activeCharacter) check();
      }),
      app.characters.subscribe(() => check()),
    ];
    const created = {
      count: 0,
      dispose: () => {
        for (const dispose of disposers) dispose();
      },
    };
    watchers.set(app, created);
    entry = created;
    check();
  }
  entry.count++;
  const current = entry;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    current.count--;
    if (current.count === 0) {
      current.dispose();
      watchers.delete(app);
    }
  };
}

// ---------- import (§5.8) ----------

/**
 * The import result's limb warnings (§5.8): one per limb that `ik: 'auto'` kept FK for the clip, with the largest
 * chain rotation and mid-joint differences. Rows the rig already reported in `warnings` are not repeated.
 */
export function importLimbWarnings(
  clipName: string,
  imported: {
    readonly warnings: readonly string[];
    readonly limbs?: readonly {
      readonly limb: LimbId;
      readonly mode: 'ik' | 'fk';
      readonly maxRotationErrorRad: number;
      readonly maxMidErrorM: number;
    }[];
  },
): string[] {
  const out: string[] = [];
  for (const row of imported.limbs ?? []) {
    if (row.mode !== 'fk') continue;
    const name = LIMB_NAME[row.limb] ?? row.limb;
    if (imported.warnings.some((warning) => warning.includes(`${name} kept FK`))) continue;
    const degrees = (row.maxRotationErrorRad * 180) / Math.PI;
    const mm = row.maxMidErrorM * 1000;
    out.push(
      `${name} kept FK in '${clipName}': the ${midName(row.limb)} is not a clean hinge (max ${degrees.toFixed(1)}°, ` +
        `${mm.toFixed(mm < 10 ? 1 : 0)} mm). Rig › IK/FK › Match Range to IK converts it if you accept the difference.`,
    );
  }
  return out;
}
