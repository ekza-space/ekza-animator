// Record builders for the workflows (MVP-SPEC §4.2 records, §4.9 defaults). Every field is spelled out, so the
// records written by operators are deterministic and complete; the store validates them on write. IDs come from the
// caller (generated in `prepare` with the app's ID source, so the partitions they land in can be opened first).
import type { Fps, Frame, KeyData, ReadonlyXf } from '@ekza-animator/anim-core';
import {
  type AssetId,
  type CameraId,
  type CameraRecord,
  type ChannelId,
  type CharacterId,
  type CharacterRecord,
  type ClipId,
  type ClipProvenance,
  type ClipRecord,
  type ClipSource,
  type ControlId,
  type CurveId,
  type CurveRecord,
  fractionalIndex,
  type KeyId,
  type KeyRecord,
  type LayerId,
  type LayerRecord,
  type ModelFormat,
  type ProjectRecord,
  type RigId,
  type RootMotionMode,
  SCHEMA_VERSION,
} from '@ekza-animator/doc';

/** Default clip range of `clip.new` and of the empty clip an import creates (§4.9). */
export const DEFAULT_CLIP_RANGE: { readonly start: Frame; readonly end: Frame } = { start: 0, end: 60 };
/** Provenance of clips authored from scratch (ADR 0010 §3). */
export const AUTHORED_PROVENANCE: ClipProvenance = { derivedFrom: [], redistributable: 'yes' };
/** Scene clock of a project without a project record (doc's default). */
export const DEFAULT_SCENE_FPS: Fps = { num: 30, den: 1 };

/** A fractional index after every given one (`orders` in any order); the first index when there is none. */
export function orderAfter(orders: Iterable<string>): string {
  let last: string | null = null;
  for (const order of orders) if (last === null || order > last) last = order;
  return fractionalIndex(last, null);
}

/** A fractional index between `before` and the smallest given order greater than it (siblings in any order). */
export function orderBetween(before: string, siblings: Iterable<string>): string {
  let next: string | null = null;
  for (const order of siblings) if (order > before && (next === null || order < next)) next = order;
  return fractionalIndex(before, next);
}

export function projectRecord(name: string, sceneFps: Fps = DEFAULT_SCENE_FPS): ProjectRecord {
  return {
    id: 'project',
    name,
    schemaVersion: SCHEMA_VERSION,
    minWriterVersion: 1, // M2A-SPEC §4.2 item 3: fresh documents; snapshot() raises it with an enabled ik2 solver
    sceneFps,
    sceneRange: DEFAULT_CLIP_RANGE,
    units: 'm',
    upAxis: 'Y',
  };
}

export function characterRecord(fields: {
  readonly id: CharacterId;
  readonly name: string;
  readonly asset: AssetId;
  readonly format: ModelFormat;
  readonly rig: RigId;
  readonly placement: ReadonlyXf;
  readonly order: string;
}): CharacterRecord {
  // M6a schema 3: an imported character is asset-sourced (`source.asset === asset`).
  return { ...fields, source: { kind: 'asset', asset: fields.asset }, deleted: null };
}

export function clipRecord(fields: {
  readonly id: ClipId;
  readonly character: CharacterId;
  readonly name: string;
  readonly fps: Fps;
  readonly order: string;
  readonly range?: { readonly start: Frame; readonly end: Frame };
  readonly sceneStart?: Frame;
  readonly loop?: boolean;
  readonly rootMotion?: RootMotionMode;
  readonly slot?: string | null;
  readonly contact?: Frame | null;
  readonly tags?: readonly string[];
  readonly provenance?: ClipProvenance;
  readonly source?: ClipSource;
}): ClipRecord {
  return {
    id: fields.id,
    character: fields.character,
    name: fields.name,
    slot: fields.slot ?? null,
    fps: fields.fps,
    range: fields.range ?? DEFAULT_CLIP_RANGE,
    sceneStart: fields.sceneStart ?? 0,
    loop: fields.loop ?? false,
    rootMotion: fields.rootMotion ?? 'hips',
    contact: fields.contact ?? null,
    tags: fields.tags ?? [],
    provenance: fields.provenance ?? AUTHORED_PROVENANCE,
    source: fields.source ?? { kind: 'new' },
    order: fields.order,
    deleted: null,
  };
}

/** The base layer of a clip ('Base', override, weight 1, lowest order). */
export function baseLayerRecord(id: LayerId, clip: ClipId): LayerRecord {
  return {
    id,
    clip,
    name: 'Base',
    mode: 'override',
    weight: 1,
    mute: false,
    solo: false,
    owner: null,
    order: fractionalIndex(null, null),
    deleted: null,
  };
}

/** A curve with the `ensureCurve` defaults (§4.11.0): not weighted, constant infinities, no static value. */
export function curveRecord(fields: {
  readonly id: CurveId;
  readonly clip: ClipId;
  readonly layer: LayerId;
  readonly control: ControlId;
  readonly channel: ChannelId;
  readonly weighted?: boolean;
}): CurveRecord {
  return {
    id: fields.id,
    clip: fields.clip,
    layer: fields.layer,
    control: fields.control,
    channel: fields.channel,
    weighted: fields.weighted ?? false,
    pre: 'constant',
    post: 'constant',
    staticValue: null,
    locked: false,
    muted: false,
    deleted: null,
  };
}

/** A key record carrying exactly the KeyData fields of `data`. */
export function keyRecord(id: KeyId, clip: ClipId, curve: CurveId, data: KeyData): KeyRecord {
  const record: KeyRecord = {
    id,
    clip,
    curve,
    t: data.t,
    v: data.v,
    inType: data.inType,
    outType: data.outType,
    inHandle: { dt: data.inHandle.dt, dv: data.inHandle.dv },
    outHandle: { dt: data.outHandle.dt, dv: data.outHandle.dv },
    broken: data.broken,
    weightLocked: data.weightLocked,
  };
  return data.breakdown === undefined ? record : { ...record, breakdown: data.breakdown };
}

export function cameraRecord(fields: {
  readonly id: CameraId;
  readonly name: string;
  readonly fovY: number;
  readonly transform: ReadonlyXf;
  readonly target: readonly [number, number, number];
  readonly locked: boolean;
  readonly order: string;
}): CameraRecord {
  return {
    id: fields.id,
    name: fields.name,
    projection: 'perspective',
    fovY: fields.fovY,
    orthoHeight: 2,
    near: 0.01,
    far: 1000,
    transform: fields.transform,
    target: fields.target,
    aspect: null,
    locked: fields.locked,
    order: fields.order,
    deleted: null,
  };
}
