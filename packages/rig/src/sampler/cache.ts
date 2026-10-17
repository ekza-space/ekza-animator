import {
  type AnimCurve,
  type CompiledAnimCurve,
  type CurveEngine,
  curveEngine,
  EkzaError,
  type Frame,
} from '@ekza-animator/anim-core';
import {
  type AnyChange,
  type ChangeBatch,
  type ChannelId,
  type ClipId,
  type ControlId,
  type CurveId,
  type CurveRecord,
  type DocumentStore,
  TRS_CHANNELS,
} from '@ekza-animator/doc';
import { CHANNELS_PER_CONTROL, type ChannelBuffer, type ClipSampler, type CurveInfo, type RigProgram } from '../types';
import { channelDefaultValue, channelSlot } from './channels';

export interface CurveCache {
  get(curve: CurveId): CompiledAnimCurve;
  readonly version: number;
  dispose(): void;
}

/** Engine used by each cache (kept out of the CurveCache contract). */
const cacheEngines = new WeakMap<CurveCache, CurveEngine>();

/** Channel identity of a curve record: duplicates of one channel share it (ARCHITECTURE §4.2 projection rule). */
function channelKey(curve: Pick<CurveRecord, 'clip' | 'layer' | 'control' | 'channel'>): string {
  return `${curve.clip}\u0000${curve.layer}\u0000${curve.control}\u0000${curve.channel}`;
}

/**
 * Compiled curves by CurveId (ARCHITECTURE §5). A curve compiles from `store.query.keysOfCurve` (duplicate key times
 * and duplicate curves already projected) and is dropped whenever a batch, preview batches included, touches the
 * curve or a key of any curve of the same channel. `version` increments on every invalidation.
 */
export function createCurveCache(store: DocumentStore, engine: CurveEngine = curveEngine): CurveCache {
  const compiled = new Map<CurveId, CompiledAnimCurve>();
  const byChannel = new Map<string, Set<CurveId>>();
  const channelOf = new Map<CurveId, string>();
  let version = 0;
  let disposed = false;

  const forget = (curve: CurveId): void => {
    const key = channelOf.get(curve);
    if (key === undefined) return;
    for (const member of byChannel.get(key) ?? []) {
      compiled.delete(member);
      channelOf.delete(member);
    }
    byChannel.delete(key);
  };
  const forgetChannel = (curve: CurveRecord | undefined): void => {
    if (curve === undefined) return;
    const key = channelKey(curve);
    for (const member of byChannel.get(key) ?? []) {
      compiled.delete(member);
      channelOf.delete(member);
    }
    byChannel.delete(key);
  };
  const curveRecordOf = (id: CurveId): CurveRecord | undefined => store.getIncludingDeleted('curves', id);

  const onChange = (change: AnyChange): boolean => {
    if (change.table === 'curves') {
      forget(change.id);
      forgetChannel(change.before);
      forgetChannel(change.after);
      return true;
    }
    if (change.table === 'keys') {
      for (const key of [change.before, change.after]) {
        if (key === undefined) continue;
        forget(key.curve);
        forgetChannel(curveRecordOf(key.curve));
      }
      return true;
    }
    return false;
  };

  const unsubscribe = store.subscribe((batch: ChangeBatch) => {
    if (batch.origin === 'load') {
      compiled.clear();
      byChannel.clear();
      channelOf.clear();
      version++;
      return;
    }
    let touched = false;
    for (const change of batch.changes) touched = onChange(change) || touched;
    if (touched) version++;
  });

  const cache: CurveCache = {
    get(curveId: CurveId): CompiledAnimCurve {
      const hit = compiled.get(curveId);
      if (hit !== undefined) return hit;
      const curve = store.get('curves', curveId);
      if (curve === undefined) throw new EkzaError('invalid-record', `Curve ${curveId} does not exist`, { curve: curveId });
      const anim: AnimCurve = {
        keys: store.query.keysOfCurve(curveId),
        weighted: curve.weighted,
        pre: curve.pre,
        post: curve.post,
      };
      const result = engine.compile(anim);
      if (!disposed) {
        compiled.set(curveId, result);
        const key = channelKey(curve);
        channelOf.set(curveId, key);
        const members = byChannel.get(key);
        if (members === undefined) byChannel.set(key, new Set([curveId]));
        else members.add(curveId);
      }
      return result;
    },
    get version(): number {
      return version;
    },
    dispose(): void {
      disposed = true;
      unsubscribe();
      compiled.clear();
      byChannel.clear();
      channelOf.clear();
    },
  };
  cacheEngines.set(cache, engine);
  return cache;
}

/** The engine a cache compiles with (anim-core's AnimX engine for caches not made by `createCurveCache`). */
export function engineOf(cache: CurveCache): CurveEngine {
  return cacheEngines.get(cache) ?? curveEngine;
}

const TRS_ORDER = new Map<string, number>(TRS_CHANNELS.map((channel, i) => [channel, i]));

function compareChannels(a: ChannelId, b: ChannelId): number {
  const x = TRS_ORDER.get(a) ?? TRS_CHANNELS.length;
  const y = TRS_ORDER.get(b) ?? TRS_CHANNELS.length;
  if (x !== y) return x - y;
  return a < b ? -1 : a > b ? 1 : 0;
}

interface PlanEntry {
  readonly curve: CurveId;
  readonly control: ControlId;
  readonly channel: ChannelId;
  /** Offset into ChannelBuffer.values, −1 when the program has no such control or the channel has no slot. */
  readonly offset: number;
  /** Value without keys: staticValue ?? channel default. */
  readonly rest: number;
}

/**
 * Per-clip sampler over the clip's base layer (MVP-SPEC §4.11.8): keyed curves evaluate through the cache's engine,
 * key-less curves give `staticValue ?? default`, channels without a curve keep their defaults. The set of curves is
 * resolved once and re-resolved after batches that touch curves or layers; sampling allocates nothing.
 */
export function createClipSampler(
  store: DocumentStore,
  cache: CurveCache,
  clip: ClipId,
  program: RigProgram,
): ClipSampler {
  const engine = engineOf(cache);
  let plan: readonly PlanEntry[] | null = null;
  let byControl: Map<ControlId, PlanEntry[]> | null = null;

  const unsubscribe = store.subscribe((batch) => {
    if (batch.origin === 'load') {
      plan = null;
      byControl = null;
      return;
    }
    for (const change of batch.changes) {
      // Keys do not change the plan: key counts and values come from the compiled curves.
      if (change.table === 'curves' || change.table === 'layers') {
        plan = null;
        byControl = null;
        return;
      }
    }
  });

  const resolve = (): readonly PlanEntry[] => {
    if (plan !== null) return plan;
    const base = store.query.baseLayer(clip);
    const curves = base === undefined ? [] : store.query.curvesOfClip(clip).filter((curve) => curve.layer === base.id);
    const entries = curves
      .map((curve): PlanEntry => {
        const index = program.controlIndex.get(curve.control);
        const slot = channelSlot(curve.channel);
        return {
          curve: curve.id,
          control: curve.control,
          channel: curve.channel,
          offset: index === undefined || slot === -1 ? -1 : index * CHANNELS_PER_CONTROL + slot,
          rest: curve.staticValue ?? channelDefaultValue(curve.channel),
        };
      })
      .sort((a, b) => (a.control < b.control ? -1 : a.control > b.control ? 1 : compareChannels(a.channel, b.channel)));
    const grouped = new Map<ControlId, PlanEntry[]>();
    for (const entry of entries) {
      const list = grouped.get(entry.control);
      if (list === undefined) grouped.set(entry.control, [entry]);
      else list.push(entry);
    }
    plan = entries;
    byControl = grouped;
    return entries;
  };

  const valueOf = (entry: PlanEntry, frame: Frame): number => {
    const compiled = cache.get(entry.curve);
    return compiled.keyCount > 0 ? engine.evaluate(compiled, frame) : entry.rest;
  };

  return {
    clip,
    sample(frame: Frame, out: ChannelBuffer): void {
      program.resetChannels(out);
      const entries = resolve();
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i] as PlanEntry;
        if (entry.offset === -1) continue;
        out.values[entry.offset] = valueOf(entry, frame);
      }
    },
    value(control: ControlId, channel: ChannelId, frame: Frame): number | undefined {
      resolve();
      const entry = byControl?.get(control)?.find((candidate) => candidate.channel === channel);
      return entry === undefined ? undefined : valueOf(entry, frame);
    },
    keyTimes(controls: readonly ControlId[] | null): readonly Frame[] {
      const entries = resolve();
      const wanted = controls === null ? null : new Set(controls);
      const times = new Set<number>();
      for (const entry of entries) {
        if (wanted !== null && !wanted.has(entry.control)) continue;
        const compiled = cache.get(entry.curve);
        for (let k = 0; k < compiled.keyCount; k++) times.add(compiled.t[k] as number);
      }
      return [...times].sort((a, b) => a - b);
    },
    curveInfo(control: ControlId): readonly CurveInfo[] {
      resolve();
      return (byControl?.get(control) ?? []).map((entry): CurveInfo => {
        const keys = store.query.keysOfCurve(entry.curve);
        const record = store.get('curves', entry.curve);
        return {
          channel: entry.channel,
          keyTimes: [...new Set(keys.map((key) => key.t))].sort((a, b) => a - b),
          steppedThroughout: keys.length > 0 && keys.every((key) => key.outType === 'step'),
          pre: record?.pre ?? 'constant',
          post: record?.post ?? 'constant',
        };
      });
    },
    dispose(): void {
      unsubscribe();
      plan = null;
      byControl = null;
    },
  };
}
