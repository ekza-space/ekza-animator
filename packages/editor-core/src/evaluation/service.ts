// Evaluation service (ARCHITECTURE §5, MVP-SPEC §4.11.8): compiled-curve cache, per-character clip samplers, scene →
// clip time per character, once-per-tick pose evaluation into each runtime's buffers, and channel values/states for
// the Channel Box. Channel values and states read the store directly (preview overlay included), so they are
// correct between ticks and for characters without a runtime.
import { type CompiledAnimCurve, type Disposer, EkzaError, type Frame } from '@ekza-studio/anim-core';
import {
  type ChannelId,
  type ChannelValues,
  type CharacterId,
  type ClipId,
  type ControlId,
  type CurveId,
  type CurveRecord,
  type DocumentStore,
  TRS_CHANNELS,
  type TrsChannel,
} from '@ekza-studio/doc';
import type { ChannelBuffer, CurveCache, LimbId, PoseBuffers, RigProgram } from '@ekza-studio/rig';
import type { KernelDeps } from '../app/deps';
import { channelDefault, channelDefaultOf, isKeyable, isLocked } from '../edit/channelMeta';
import type {
  CharacterRegistry,
  CharacterRuntime,
  ChannelSource,
  ChannelState,
  EvaluationService,
  SessionStore,
  TestPoseService,
} from '../types';
import { createChannelSources } from './rigSource';
import { activeClipOf, clipFrameAt, sceneFpsOf } from './time';

type PoseListener = (e: { readonly poseVersion: number; readonly characters: readonly CharacterId[] }) => void;

export interface KernelEvaluation extends EvaluationService {
  /** Marks characters (all when omitted) for re-evaluation at the next tick and requests a frame. */
  invalidate(characters?: Iterable<CharacterId>): void;
  /** The character a control belongs to (null for unknown or deleted controls). */
  characterOf(control: ControlId): CharacterId | null;
  /** Value of a curve record at a clip frame: its keys, else `staticValue ?? default`. */
  curveValue(curve: CurveRecord, frame: Frame): number;
  dispose(): void;
}

export function createEvaluationService(ctx: {
  readonly store: DocumentStore;
  readonly session: SessionStore;
  readonly characters: CharacterRegistry;
  readonly deps: KernelDeps;
  readonly cache: CurveCache;
  readonly requestFrame: () => void;
  /** M6b: the test pose of the 'test' channel source (null before the app exists). */
  readonly testPose?: () => TestPoseService | null;
}): KernelEvaluation {
  const { store, session, characters, deps, cache } = ctx;
  const engine = deps.curves.engine;
  const listeners = new Set<PoseListener>();
  // M6b (§0.5, §5.17): the channel sources; a registered 'preview' provider wins in every workspace.
  const sources = createChannelSources({ testPose: ctx.testPose ?? (() => null) });
  /** Characters marked by document or override changes. */
  const dirty = new Set<CharacterId>();
  let allDirty = true;
  /** Clip and frame each runtime's pose was last evaluated at; a runtime re-evaluates when they change. */
  const evaluatedAt = new WeakMap<
    CharacterRuntime,
    { clip: ClipId | null; frame: Frame | null; program: RigProgram }
  >();
  /**
   * M-1 mechanism 6 (M2A-SPEC §5.21.1): the channels each runtime's pose was last evaluated from. A re-evaluation
   * whose sampled channels (curves ⊕ overrides) are bit-identical keeps the pose and reports no pose change, so the
   * frame loop renders no viewport frame for it (a drag of keys that leaves the current frame's values unchanged).
   */
  const lastChannels = new WeakMap<
    CharacterRuntime,
    { program: RigProgram; values: Float64Array; attrs: Float64Array }
  >();

  /** True when `channels` equal the last evaluated ones of `runtime` (same program); else remembers them. */
  const sameAsLast = (runtime: CharacterRuntime, program: RigProgram, channels: ChannelBuffer): boolean => {
    const last = lastChannels.get(runtime);
    if (
      last !== undefined &&
      last.program === program &&
      equalArrays(last.values, channels.values) &&
      equalArrays(last.attrs, channels.attrs)
    ) {
      return true;
    }
    if (
      last === undefined ||
      last.program !== program ||
      last.values.length !== channels.values.length ||
      last.attrs.length !== channels.attrs.length
    ) {
      lastChannels.set(runtime, { program, values: channels.values.slice(), attrs: channels.attrs.slice() });
    } else {
      last.values.set(channels.values);
      last.attrs.set(channels.attrs);
    }
    return false;
  };
  /** Reused per tick (listeners must not keep it). */
  const evaluated: CharacterId[] = [];
  /** Scratch channel buffers for `evaluateAt`, per program. */
  const scratch = new WeakMap<RigProgram, ChannelBuffer>();
  let poseVersion = 0;

  const clipFrame = (character: CharacterId): Frame | null => {
    const clip = activeClipOf(store, session.getState(), character);
    return clip === undefined ? null : clipFrameAt(deps, sceneFpsOf(store), clip, session.getState().time.sceneFrame);
  };

  const characterOf = (control: ControlId): CharacterId | null => {
    const record = store.get('controls', control);
    if (record === undefined) return null;
    return store.get('rigs', record.rig)?.character ?? null;
  };

  const curveValue = (curve: CurveRecord, frame: Frame): number => {
    const compiled = cache.get(curve.id);
    if (compiled.keyCount > 0) return engine.evaluate(compiled, frame);
    if (curve.staticValue !== null) return curve.staticValue;
    // Attribute curves fall back to their AttrDef.default (M2A-SPEC §5.1 rules 3 and 6).
    return curve.channel.startsWith('@')
      ? channelDefaultOf(store.get('controls', curve.control) ?? null, curve.channel)
      : channelDefault(curve.channel);
  };

  /** M2a: any channel (TRS or '@attr') at the control's clip frame: curve (else its default), then the override. */
  const channelValue = (control: ControlId, channel: ChannelId): number => {
    const override = session.getState().overrides.get(control)?.[channel];
    if (override !== undefined) return override;
    const { curve, frame } = curveAt(control, channel);
    if (curve !== undefined && frame !== null) return curveValue(curve, frame);
    return channelDefaultOf(store.get('controls', control) ?? null, channel);
  };

  /** The base-layer curve of a control's channel in its character's active clip, with the clip frame. */
  const curveAt = (
    control: ControlId,
    channel: ChannelId,
  ): { readonly curve: CurveRecord | undefined; readonly frame: Frame | null } => {
    const character = characterOf(control);
    const clip = character === null ? undefined : activeClipOf(store, session.getState(), character);
    if (character === null || clip === undefined) return { curve: undefined, frame: null };
    const base = store.query.baseLayer(clip.id);
    const curve = base === undefined ? undefined : store.query.curveFor(clip.id, base.id, control, channel);
    return { curve, frame: clipFrame(character) };
  };

  /** Samples and evaluates a runtime; false when its channels did not change (the pose is kept, M-1). */
  const evaluateRuntime = (runtime: CharacterRuntime): boolean => {
    const state = session.getState();
    const clip = activeClipOf(store, state, runtime.id);
    const frame = clip === undefined ? null : clipFrameAt(deps, sceneFpsOf(store), clip, state.time.sceneFrame);
    const program = runtime.program;
    const apply = (values: ReadonlyMap<ControlId, ChannelValues>): void =>
      deps.rig.applyOverrides(program, runtime.channels, values);
    const source = sources.fill(runtime.id, program, runtime.channels, apply);
    if (source === 'animate' || source === 'clip') {
      if (clip === undefined || frame === null) program.resetChannels(runtime.channels);
      else runtime.sampler(clip.id).sample(frame, runtime.channels);
      if (source === 'animate' && state.overrides.size > 0) apply(state.overrides);
    }
    const last = evaluatedAt.get(runtime);
    if (last === undefined) evaluatedAt.set(runtime, { clip: clip?.id ?? null, frame, program });
    else {
      last.clip = clip?.id ?? null;
      last.frame = frame;
      last.program = program;
    }
    if (sameAsLast(runtime, program, runtime.channels)) return false;
    program.evaluate(runtime.channels, runtime.pose);
    return true;
  };

  /** True when the runtime's clip, clip frame or program differ from its last evaluation. */
  const stale = (runtime: CharacterRuntime): boolean => {
    const last = evaluatedAt.get(runtime);
    if (last === undefined || last.program !== runtime.program) return true;
    const state = session.getState();
    const clip = activeClipOf(store, state, runtime.id);
    if ((clip?.id ?? null) !== last.clip) return true;
    if (clip === undefined) return false;
    return clipFrameAt(deps, sceneFpsOf(store), clip, state.time.sceneFrame) !== last.frame;
  };

  const service: KernelEvaluation = {
    get poseVersion() {
      return poseVersion;
    },
    tick(): boolean {
      evaluated.length = 0;
      if (sources.previewMoved()) allDirty = true;
      for (const runtime of characters.list()) {
        if (!allDirty && !dirty.has(runtime.id) && !stale(runtime)) continue;
        if (evaluateRuntime(runtime)) evaluated.push(runtime.id);
      }
      allDirty = false;
      dirty.clear();
      if (evaluated.length === 0) return false;
      poseVersion++;
      for (const listener of listeners) listener({ poseVersion, characters: evaluated });
      return true;
    },
    evaluateAt(character, clip, frame, out: PoseBuffers, opts): void {
      const runtime = characters.get(character);
      if (runtime === undefined) throw new EkzaError('unsupported', `Character ${character} has no runtime`);
      const program = runtime.program;
      let channels = scratch.get(program);
      if (channels === undefined) {
        channels = program.allocChannels();
        scratch.set(program, channels);
      }
      runtime.sampler(clip).sample(frame, channels);
      const overrides = session.getState().overrides;
      if (opts?.withOverrides === true && overrides.size > 0) deps.rig.applyOverrides(program, channels, overrides);
      program.evaluate(channels, out);
    },
    clipFrame,
    channelValues(control: ControlId): Readonly<Record<TrsChannel, number>> {
      const values: Record<TrsChannel, number> = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
      const character = characterOf(control);
      const clip = character === null ? undefined : activeClipOf(store, session.getState(), character);
      const frame = character === null ? null : clipFrame(character);
      const base = clip === undefined ? undefined : store.query.baseLayer(clip.id);
      if (clip !== undefined && base !== undefined && frame !== null) {
        for (const channel of TRS_CHANNELS) {
          const curve = store.query.curveFor(clip.id, base.id, control, channel);
          if (curve !== undefined) values[channel] = curveValue(curve, frame);
        }
      }
      const override = session.getState().overrides.get(control);
      if (override !== undefined) {
        for (const channel of TRS_CHANNELS) {
          const value = override[channel];
          if (value !== undefined) values[channel] = value;
        }
      }
      return values;
    },
    channelState(control: ControlId, channel: ChannelId): ChannelState {
      const record = store.get('controls', control);
      // M2a (A2): '@name' attributes are keyable by their AttrDef (M2A-SPEC §5.1 rule 1); unknown channels are not.
      if (record === undefined || !isKeyable(record, channel)) return 'non-keyable';
      if (isLocked(record, channel)) return 'locked';
      if (session.getState().overrides.get(control)?.[channel] !== undefined) return 'changed';
      const { curve, frame } = curveAt(control, channel);
      const keys = curve === undefined ? [] : store.query.keysOfCurve(curve.id);
      if (keys.length === 0) return 'static';
      return frame !== null && keys.some((key) => Math.abs(key.t - frame) < 1e-6) ? 'keyed-on-frame' : 'keyed';
    },
    compiledCurve: (curve: CurveId): CompiledAnimCurve => cache.get(curve),
    channelValue,
    attrValues(control: ControlId): Readonly<Record<string, number>> {
      const record = store.get('controls', control);
      const out: Record<string, number> = {};
      if (record === undefined) return out;
      for (const name of Object.keys(record.attrs ?? {})) out[name] = channelValue(control, `@${name}`);
      return out;
    },
    ikFk(character: CharacterId, limb: LimbId): number | null {
      // The limb's IK control owns '@ikFk' (M2A-SPEC §4.3); the op clamps it to [0, 1] where it is consumed.
      const program = characters.get(character)?.program;
      const desc = program?.limbs.find((candidate) => candidate.id === limb);
      if (program === undefined || desc === undefined) return null;
      // §5.4 rule 4: an ik2 op whose compile threw stays in `limbs` but is skipped at run time: the limb is FK.
      if (deps.rig.isRigOpSkipped?.(program, desc.solver) === true) return 0;
      const value = channelValue(desc.params.ikControl, '@ikFk');
      return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    },
    setChannelSource(character: CharacterId, source: ChannelSource): void {
      if (sources.set(character, source)) service.invalidate([character]);
    },
    subscribe(listener: PoseListener): Disposer {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    invalidate(ids?: Iterable<CharacterId>): void {
      if (ids === undefined) allDirty = true;
      else for (const id of ids) dirty.add(id);
      ctx.requestFrame();
    },
    characterOf,
    curveValue,
    dispose(): void {
      listeners.clear();
    },
  };
  return service;
}

/** Bit-identical Float64Arrays (NaN equals NaN, +0 differs from −0: the pose may differ by a sign). */
function equalArrays(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (x !== y || (x === 0 && 1 / x !== 1 / y)) {
      if (!(Number.isNaN(x) && Number.isNaN(y))) return false;
    }
  }
  return true;
}
