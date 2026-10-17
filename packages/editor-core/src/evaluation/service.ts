// Evaluation service (ARCHITECTURE §5, MVP-SPEC §4.11.8): compiled-curve cache, per-character clip samplers, scene →
// clip time per character, once-per-tick pose evaluation into each runtime's buffers, and channel values/states for
// the Channel Box. Channel values and states read the store directly (preview overlay included), so they are
// correct between ticks and for characters without a runtime.
import { type CompiledAnimCurve, type Disposer, EkzaError, type Frame } from '@ekza-animator/anim-core';
import {
  type ChannelId,
  type CharacterId,
  type ClipId,
  type ControlId,
  type CurveId,
  type CurveRecord,
  type DocumentStore,
  TRS_CHANNELS,
  type TrsChannel,
} from '@ekza-animator/doc';
import type { ChannelBuffer, CurveCache, PoseBuffers, RigProgram } from '@ekza-animator/rig';
import type { KernelDeps } from '../app/deps';
import { channelDefault, isKeyable, isLocked, trsSlot } from '../edit/channelMeta';
import type { CharacterRegistry, CharacterRuntime, ChannelState, EvaluationService, SessionStore } from '../types';
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
}): KernelEvaluation {
  const { store, session, characters, deps, cache } = ctx;
  const engine = deps.curves.engine;
  const listeners = new Set<PoseListener>();
  /** Characters marked by document or override changes. */
  const dirty = new Set<CharacterId>();
  let allDirty = true;
  /** Clip and frame each runtime's pose was last evaluated at; a runtime re-evaluates when they change. */
  const evaluatedAt = new Map<CharacterRuntime, { clip: ClipId | null; frame: Frame | null; program: RigProgram }>();
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
    return compiled.keyCount > 0
      ? engine.evaluate(compiled, frame)
      : (curve.staticValue ?? channelDefault(curve.channel));
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

  const evaluateRuntime = (runtime: CharacterRuntime): void => {
    const state = session.getState();
    const clip = activeClipOf(store, state, runtime.id);
    const frame = clip === undefined ? null : clipFrameAt(deps, sceneFpsOf(store), clip, state.time.sceneFrame);
    const program = runtime.program;
    if (clip === undefined || frame === null) program.resetChannels(runtime.channels);
    else runtime.sampler(clip.id).sample(frame, runtime.channels);
    if (state.overrides.size > 0) deps.rig.applyOverrides(program, runtime.channels, state.overrides);
    program.evaluate(runtime.channels, runtime.pose);
    const last = evaluatedAt.get(runtime);
    if (last === undefined) evaluatedAt.set(runtime, { clip: clip?.id ?? null, frame, program });
    else {
      last.clip = clip?.id ?? null;
      last.frame = frame;
      last.program = program;
    }
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
      for (const runtime of characters.list()) {
        if (!allDirty && !dirty.has(runtime.id) && !stale(runtime)) continue;
        evaluateRuntime(runtime);
        evaluated.push(runtime.id);
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
      if (record === undefined || trsSlot(channel) === -1 || !isKeyable(record, channel)) return 'non-keyable';
      if (isLocked(record, channel)) return 'locked';
      if (session.getState().overrides.get(control)?.[channel] !== undefined) return 'changed';
      const { curve, frame } = curveAt(control, channel);
      const keys = curve === undefined ? [] : store.query.keysOfCurve(curve.id);
      if (keys.length === 0) return 'static';
      return frame !== null && keys.some((key) => Math.abs(key.t - frame) < 1e-6) ? 'keyed-on-frame' : 'keyed';
    },
    compiledCurve: (curve: CurveId): CompiledAnimCurve => cache.get(curve),
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
      evaluatedAt.clear();
    },
  };
  return service;
}
