// Imported clips as records: the clip, its base layer, one curve per imported channel and its keys. IDs are taken
// in `prepare` (the clip's partition is opened before the transaction); `writeClipPlan` puts the records in
// dependency order inside the import transaction (clip before layer before curves before keys, §4.11.21).
import type { Fps, Frame } from '@ekza-animator/anim-core';
import type {
  CharacterId,
  ClipId,
  ClipProvenance,
  ClipRecord,
  ClipSource,
  CurveRecord,
  KeyRecord,
  LayerRecord,
  Tx,
} from '@ekza-animator/doc';
import type { ImportedClipKeys, ReduceSpec } from '@ekza-animator/rig';
import { newRecordId } from '../app/internals';
import type { EditorApp } from '../types';
import { baseLayerRecord, clipRecord, curveRecord, keyRecord } from './records';

export interface ClipWritePlan {
  /** The clip with a provisional `order` (`writeClipPlan` gives it its final one). */
  readonly clip: ClipRecord;
  readonly layer: LayerRecord;
  readonly curves: readonly { readonly curve: CurveRecord; readonly keys: readonly KeyRecord[] }[];
  /** Source keys and keys after reduction, over all curves (import summary). */
  readonly stats: { readonly sourceKeys: number; readonly keys: number; readonly maxReduceError: number };
}

export function planImportedClip(
  app: EditorApp,
  fields: {
    readonly id: ClipId;
    readonly character: CharacterId;
    readonly name: string;
    readonly loop: boolean;
    readonly provenance: ClipProvenance;
    readonly source: ClipSource;
  },
  imported: ImportedClipKeys,
): ClipWritePlan {
  const clip = clipRecord({
    id: fields.id,
    character: fields.character,
    name: fields.name,
    fps: imported.fps,
    range: imported.range,
    loop: fields.loop,
    provenance: fields.provenance,
    source: fields.source,
    order: 'a0',
  });
  const layer = baseLayerRecord(newRecordId(app, 'layer'), clip.id);
  let sourceKeys = 0;
  let keyCount = 0;
  let maxReduceError = 0;
  const curves = imported.curves.map((imp) => {
    const curve = curveRecord({
      id: newRecordId(app, 'curve'),
      clip: clip.id,
      layer: layer.id,
      control: imp.control,
      channel: imp.channel,
    });
    sourceKeys += imp.stats.sourceKeys;
    keyCount += imp.keys.length;
    maxReduceError = Math.max(maxReduceError, imp.stats.maxReduceError);
    return { curve, keys: imp.keys.map((data) => keyRecord(newRecordId(app, 'key'), clip.id, curve.id, data)) };
  });
  return { clip, layer, curves, stats: { sourceKeys, keys: keyCount, maxReduceError } };
}

/** An empty clip (no curves): the clip an import creates when it imports none, and `clip.new`. */
export function planEmptyClip(
  app: EditorApp,
  fields: {
    readonly id: ClipId;
    readonly character: CharacterId;
    readonly name: string;
    readonly fps: Fps;
    readonly range: { readonly start: Frame; readonly end: Frame };
  },
): ClipWritePlan {
  const clip = clipRecord({ ...fields, order: 'a0' });
  return {
    clip,
    layer: baseLayerRecord(newRecordId(app, 'layer'), clip.id),
    curves: [],
    stats: { sourceKeys: 0, keys: 0, maxReduceError: 0 },
  };
}

/** Writes a planned clip with its final name and order. */
export function writeClipPlan(
  tx: Tx,
  plan: ClipWritePlan,
  final: { readonly name: string; readonly order: string },
): void {
  tx.put('clips', { ...plan.clip, name: final.name, order: final.order });
  tx.put('layers', plan.layer);
  for (const { curve } of plan.curves) tx.put('curves', curve);
  for (const { keys } of plan.curves) for (const key of keys) tx.put('keys', key);
}

/** Import options resolved for one clip (§4.11.6 step 5). */
export interface ResolvedClipOptions {
  readonly fps: Fps;
  readonly keyMode: 'source-times' | 'resample';
  readonly eulerFilter: boolean;
  readonly reduce: ReduceSpec | null;
  readonly warnings: readonly string[];
}

/** Frames per second as a number. */
export function fpsValue(fps: Fps): number {
  return fps.num / fps.den;
}

/** True when every source time at `source` fps lands on an integer frame at `target` fps. */
export function landsOnFrames(source: Fps, target: Fps): boolean {
  const ratio = fpsValue(target) / fpsValue(source);
  const rounded = Math.round(ratio);
  return rounded >= 1 && Math.abs(ratio - rounded) < 1e-9;
}

export function sameFps(a: Fps, b: Fps): boolean {
  return a.num * b.den === b.num * a.den;
}

/**
 * Frame rate, key mode, Euler filter and reduction of one imported clip: `clipFps: 'source'` takes the detected rate
 * (else the scene rate); source times are kept by default only when they land on whole frames at that rate (import
 * never creates sub-frame keys by default); reduction follows the explicit option, else `prefs.reduceOnImport`
 * ('auto': when any channel has more than 0.5 keys per frame).
 */
export function resolveClipOptions(input: {
  readonly name: string;
  readonly detected: Fps | null;
  readonly sceneFps: Fps;
  readonly clipFps: Fps | 'source' | undefined;
  readonly keyMode: 'source-times' | 'resample' | undefined;
  readonly eulerFilter: boolean | undefined;
  readonly reduce: ReduceSpec | null | undefined;
  readonly reducePref: 'auto' | 'always' | 'never';
  readonly defaultReduce: ReduceSpec;
  /** Largest per-channel key count and the clip duration in seconds (density for 'auto' reduction). */
  readonly maxChannelKeys: number;
  readonly duration: number;
}): ResolvedClipOptions {
  const warnings: string[] = [];
  const fps =
    input.clipFps === undefined || input.clipFps === 'source' ? (input.detected ?? input.sceneFps) : input.clipFps;
  const onFrames = input.detected !== null && landsOnFrames(input.detected, fps);
  const keyMode = input.keyMode ?? (onFrames ? 'source-times' : 'resample');
  if (keyMode === 'source-times' && !onFrames) {
    warnings.push(
      `${input.name}: source key times do not fall on whole frames at ${fpsValue(fps)} fps (sub-frame keys)`,
    );
  }
  let reduce: ReduceSpec | null;
  if (input.reduce !== undefined) reduce = input.reduce;
  else if (input.reducePref === 'always') reduce = input.defaultReduce;
  else if (input.reducePref === 'never') reduce = null;
  else {
    const frames = Math.max(1, input.duration * fpsValue(fps));
    const keysPerFrame = keyMode === 'resample' ? 1 : input.maxChannelKeys / (frames + 1);
    reduce = keysPerFrame > 0.5 ? input.defaultReduce : null;
  }
  return { fps, keyMode, eulerFilter: input.eulerFilter ?? true, reduce, warnings };
}
