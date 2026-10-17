// Evaluation side of the fake app: compiled-curve cache, clip samplers, scene → clip time and the evaluation
// service (MVP-SPEC §4.11.8 scene time and clip evaluation, ARCHITECTURE §5). Linear scans throughout.
import { type CompiledAnimCurve, type Disposer, EkzaError, type Fps, type Frame } from '@ekza-animator/anim-core';
import {
  type ChannelId,
  type CharacterId,
  type ClipId,
  type ClipRecord,
  type ControlId,
  type CurveId,
  type CurveRecord,
  type DocumentStore,
  TRS_CHANNELS,
} from '@ekza-animator/doc';
import {
  CHANNELS_PER_CONTROL,
  type ChannelBuffer,
  type ClipSampler,
  type CurveInfo,
  type PoseBuffers,
  type RigProgram,
} from '@ekza-animator/rig';
import type { CharacterRegistry, ChannelState, EvaluationService, SessionStore } from '../types';
import { compileNaiveCurve, evaluateNaiveCurve } from './curves';
import { channelDefault, channelSlot } from './rig';
import { compareStrings } from './store/rows';

/** Compiled curves per CurveId, dropped whenever a batch touches curves or keys (preview batches included). */
export interface CurveCompiler {
  get(curve: CurveId): CompiledAnimCurve;
  /** Value of a curve record at a clip frame: keys → curve, no keys → staticValue ?? default. */
  value(curve: CurveRecord, frame: Frame): number;
  dispose(): void;
}

export function createCurveCompiler(store: DocumentStore): CurveCompiler {
  const cache = new Map<CurveId, CompiledAnimCurve>();
  const unsubscribe = store.subscribe((batch) => {
    if (batch.origin === 'load' || batch.changes.some((c) => c.table === 'curves' || c.table === 'keys')) cache.clear();
  });
  const compiler: CurveCompiler = {
    get(curveId: CurveId): CompiledAnimCurve {
      const cached = cache.get(curveId);
      if (cached !== undefined) return cached;
      const curve = store.get('curves', curveId);
      if (curve === undefined) throw new EkzaError('invalid-record', `Curve ${curveId} does not exist`);
      const compiled = compileNaiveCurve({
        keys: store.query.keysOfCurve(curveId),
        weighted: curve.weighted,
        pre: curve.pre,
        post: curve.post,
      });
      cache.set(curveId, compiled);
      return compiled;
    },
    value(curve: CurveRecord, frame: Frame): number {
      const compiled = compiler.get(curve.id);
      if (compiled.keyCount > 0) return evaluateNaiveCurve(compiled, frame);
      return curve.staticValue ?? channelDefault(curve.channel);
    },
    dispose: unsubscribe,
  };
  return compiler;
}

/** Scene frame → clip frame (§4.11.8); loop wraps outside the range, once clamps. */
export function clipFrameAt(sceneFps: Fps, clip: ClipRecord, sceneFrame: Frame): Frame {
  const frame = ((sceneFrame - clip.sceneStart) * (clip.fps.num * sceneFps.den)) / (clip.fps.den * sceneFps.num);
  const { start, end } = clip.range;
  if (frame >= start && frame <= end) return frame;
  if (!clip.loop) return Math.min(Math.max(frame, start), end);
  const span = end - start;
  return span <= 0 ? start : start + ((((frame - start) % span) + span) % span);
}

export function createNaiveSampler(
  store: DocumentStore,
  compiler: CurveCompiler,
  clip: ClipId,
  program: RigProgram,
): ClipSampler {
  const baseCurves = (): CurveRecord[] => {
    const base = store.query.baseLayer(clip);
    return base === undefined ? [] : store.query.curvesOfClip(clip).filter((curve) => curve.layer === base.id);
  };
  const keyTimesOf = (curves: readonly CurveRecord[]): number[] => {
    const times = new Set<number>();
    for (const curve of curves) for (const key of store.query.keysOfCurve(curve.id)) times.add(key.t);
    return [...times].sort((a, b) => a - b);
  };
  return {
    clip,
    sample(frame: Frame, out: ChannelBuffer): void {
      program.resetChannels(out);
      for (const curve of baseCurves()) {
        const index = program.controlIndex.get(curve.control);
        const slot = channelSlot(curve.channel);
        if (index === undefined || slot === -1) continue;
        out.values[index * CHANNELS_PER_CONTROL + slot] = compiler.value(curve, frame);
      }
    },
    value(control: ControlId, channel: ChannelId, frame: Frame): number | undefined {
      const curve = baseCurves().find((c) => c.control === control && c.channel === channel);
      return curve === undefined ? undefined : compiler.value(curve, frame);
    },
    keyTimes(controls: readonly ControlId[] | null): readonly Frame[] {
      const wanted = controls === null ? null : new Set(controls);
      return keyTimesOf(baseCurves().filter((curve) => wanted === null || wanted.has(curve.control)));
    },
    curveInfo(control: ControlId): readonly CurveInfo[] {
      return baseCurves()
        .filter((curve) => curve.control === control)
        .sort((a, b) => compareStrings(a.channel, b.channel))
        .map((curve) => {
          const keys = store.query.keysOfCurve(curve.id);
          return {
            channel: curve.channel,
            keyTimes: keys.map((key) => key.t),
            steppedThroughout: keys.length > 0 && keys.every((key) => key.outType === 'step'),
            pre: curve.pre,
            post: curve.post,
          };
        });
    },
    dispose(): void {},
  };
}

export interface FakeEvaluation extends EvaluationService {
  /** Marks every character dirty and requests a frame (store batches and time/override changes call it). */
  invalidate(): void;
  dispose(): void;
}

export function createFakeEvaluation(deps: {
  readonly store: DocumentStore;
  readonly session: SessionStore;
  readonly characters: CharacterRegistry;
  readonly compiler: CurveCompiler;
  readonly requestFrame: () => void;
}): FakeEvaluation {
  const { store, session, characters, compiler } = deps;
  const listeners = new Set<
    (e: { readonly poseVersion: number; readonly characters: readonly CharacterId[] }) => void
  >();
  let poseVersion = 0;
  let dirty = true;

  const sceneFps = (): Fps => store.get('project', 'project')?.sceneFps ?? { num: 30, den: 1 };
  const activeClipOf = (character: CharacterId): ClipRecord | undefined => {
    const clipId = session.getState().activeClip[character];
    return clipId === undefined ? undefined : store.get('clips', clipId);
  };
  const clipFrame = (character: CharacterId): Frame | null => {
    const clip = activeClipOf(character);
    return clip === undefined ? null : clipFrameAt(sceneFps(), clip, session.getState().time.sceneFrame);
  };
  const characterOfControl = (control: ControlId): CharacterId | null => {
    const record = store.get('controls', control);
    const rig = record === undefined ? undefined : store.get('rigs', record.rig);
    return rig?.character ?? null;
  };
  const curveOf = (control: ControlId, channel: ChannelId): CurveRecord | undefined => {
    const character = characterOfControl(control);
    const clip = character === null ? undefined : activeClipOf(character);
    const base = clip === undefined ? undefined : store.query.baseLayer(clip.id);
    return clip === undefined || base === undefined
      ? undefined
      : store.query.curveFor(clip.id, base.id, control, channel);
  };
  const applyOverrides = (program: RigProgram, ch: ChannelBuffer): void => {
    for (const [control, values] of session.getState().overrides) {
      const index = program.controlIndex.get(control);
      if (index === undefined) continue;
      for (const [channel, value] of Object.entries(values)) {
        const slot = channelSlot(channel);
        if (slot !== -1 && value !== undefined) ch.values[index * CHANNELS_PER_CONTROL + slot] = value;
      }
    }
  };

  const service: FakeEvaluation = {
    get poseVersion() {
      return poseVersion;
    },
    tick(): boolean {
      if (!dirty) return false;
      dirty = false;
      const evaluated: CharacterId[] = [];
      for (const runtime of characters.list()) {
        const clip = activeClipOf(runtime.id);
        const frame = clipFrame(runtime.id);
        if (clip === undefined || frame === null) runtime.program.resetChannels(runtime.channels);
        else runtime.sampler(clip.id).sample(frame, runtime.channels);
        applyOverrides(runtime.program, runtime.channels);
        runtime.program.evaluate(runtime.channels, runtime.pose);
        evaluated.push(runtime.id);
      }
      poseVersion++;
      for (const listener of listeners) listener({ poseVersion, characters: evaluated });
      return true;
    },
    evaluateAt(
      character: CharacterId,
      clip: ClipId,
      frame: Frame,
      out: PoseBuffers,
      opts?: { readonly withOverrides?: boolean },
    ): void {
      const runtime = characters.get(character);
      if (runtime === undefined) throw new EkzaError('unsupported', `Character ${character} has no runtime`);
      const channels = runtime.program.allocChannels();
      runtime.sampler(clip).sample(frame, channels);
      if (opts?.withOverrides === true) applyOverrides(runtime.program, channels);
      runtime.program.evaluate(channels, out);
    },
    clipFrame,
    channelValues(control: ControlId) {
      const values = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
      const character = characterOfControl(control);
      const frame = character === null ? null : clipFrame(character);
      for (const channel of TRS_CHANNELS) {
        const curve = frame === null ? undefined : curveOf(control, channel);
        if (curve !== undefined && frame !== null) values[channel] = compiler.value(curve, frame);
      }
      const override = session.getState().overrides.get(control);
      for (const channel of TRS_CHANNELS) {
        const value = override?.[channel];
        if (value !== undefined) values[channel] = value;
      }
      return values;
    },
    channelState(control: ControlId, channel: ChannelId): ChannelState {
      const record = store.get('controls', control);
      const slot = channelSlot(channel);
      if (record === undefined || slot === -1) return 'non-keyable';
      const group = slot < 3 ? 't' : slot < 6 ? 'r' : 's';
      const axis = (slot % 3) as 0 | 1 | 2;
      if (!record.keyable[group][axis]) return 'non-keyable';
      if (record.locked[group][axis]) return 'locked';
      if (session.getState().overrides.get(control)?.[channel] !== undefined) return 'changed';
      const curve = curveOf(control, channel);
      const keys = curve === undefined ? [] : store.query.keysOfCurve(curve.id);
      if (keys.length === 0) return 'static';
      const character = characterOfControl(control);
      const frame = character === null ? null : clipFrame(character);
      return frame !== null && keys.some((key) => Math.abs(key.t - frame) < 1e-6) ? 'keyed-on-frame' : 'keyed';
    },
    compiledCurve: (curve: CurveId) => compiler.get(curve),
    subscribe(listener): Disposer {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidate(): void {
      dirty = true;
      deps.requestFrame();
    },
    dispose(): void {
      listeners.clear();
    },
  };
  return service;
}
