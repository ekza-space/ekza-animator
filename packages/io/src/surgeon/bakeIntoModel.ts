// The append-only "surgeon" (MVP-SPEC §4.11.11, ADR 0005 §6): bakes clips into the user's original GLB/VRM without
// re-serializing anything it does not understand. Existing array entries keep their indices (so every extension's
// references stay valid), the original BIN bytes are copied verbatim as a prefix, and new accessors/bufferViews/
// animations are appended. A baseline marker in asset.extras lets a later bake roll back to the original first.
import { EkzaError } from '@ekza-animator/anim-core';
import type { SkeletonDesc, TrackKey } from '@ekza-animator/rig';
import { parseTrackKey, trackKey } from '../bake/bake';
import { normalizeClipMeta } from '../bake/meta';
import { align4, assembleGlb } from '../glb/write';
import { animationsOf, isIndex, isRecord, listField, textOf, unknownList } from '../gltf/schema';
import { sha256Hex, sha256HexSync } from '../hash/sha256';
import type {
  BakedClip,
  BakedTrack,
  EkzaAnimationV1,
  EkzaBakeMarkerV1,
  EkzaClipMetaV1,
  ExportArtifact,
  ExportProfileDef,
  GlbContainer,
  LintIssue,
} from '../types';
import { finalizeArtifact } from '../writers/artifact';
import { clipNameKey, outputMeta } from '../writers/names';
import { assertUniqueNames, generatorName } from '../writers/write';

export const BAKE_MARKER_KEY = 'ekza_animator_bake_v1';
export const ANIMATION_META_KEY = 'ekza_animation_v1';
const FLOAT = 5126;

type MutableJson = Record<string, unknown>;

export interface SurgeonOptions {
  readonly meta: EkzaAnimationV1;
  readonly fileName: string;
  readonly profile: ExportProfileDef | null;
}

/** Node indices (SkeletonDesc) and paths animated by the original file's animations that stay after a re-bake. */
export function preexistingTracks(
  original: GlbContainer,
  skeleton: SkeletonDesc,
  replacing: readonly string[],
): ReadonlySet<TrackKey> {
  const json = structuredClone(original.json) as unknown as MutableJson;
  const marker = readMarker(json);
  if (marker !== null && rollbackBlocker(json, marker, original.bin, sha256HexSync) === null) rollBack(json, marker);
  return tracksOf(json, skeleton, new Set(replacing.map(clipNameKey)));
}

export async function bakeIntoModel(
  original: GlbContainer,
  skeleton: SkeletonDesc,
  clips: readonly BakedClip[],
  opts: SurgeonOptions,
): Promise<ExportArtifact> {
  if (clips.some((clip) => clip.target !== 'raw')) {
    throw new EkzaError('unsupported', 'Baking into the model needs raw-target clips');
  }
  assertUniqueNames(clips);
  const json = structuredClone(original.json) as unknown as MutableJson;
  const buffers = arrayOf(json, 'buffers');
  const buffer0 = buffers[0];
  if (isRecord(buffer0) && buffer0['uri'] !== undefined) {
    throw new EkzaError(
      'external-buffer',
      'The model keeps buffers[0] in an external file; only self-contained GLB/VRM can be baked into',
      {
        pointer: '/buffers/0/uri',
      },
    );
  }
  checkMatrixNodes(clips, skeleton);

  const writerLints: LintIssue[] = [];
  const existing = readMarker(json);
  let marker: MutableMarker;
  let rolledBack = false;
  if (existing === null) {
    const baseBinLength = binLength(json);
    marker = {
      baseAnimations: arrayOf(json, 'animations').length,
      baseAccessors: arrayOf(json, 'accessors').length,
      baseBufferViews: arrayOf(json, 'bufferViews').length,
      baseBinLength,
      baseBinSha256: await sha256Hex(binPrefix(original.bin, baseBinLength)),
      baseSha256: original.sha256,
      replaced: {},
      ...(hasGenerator(json) ? {} : { generatorAdded: true as const }),
    };
  } else {
    marker = { ...existing, replaced: { ...existing.replaced } };
    const blocker = await rollbackBlockerAsync(json, existing, original.bin);
    if (blocker === null) {
      rollBack(json, existing);
      rolledBack = true;
    } else {
      writerLints.push({
        code: 'surgeon.no-rollback',
        severity: 'warning',
        message: `The previous bake could not be rolled back (${blocker}); the new clips were appended after it`,
        pointer: `/asset/extras/${BAKE_MARKER_KEY}`,
      });
    }
  }

  const animations = arrayOf(json, 'animations');
  const replacing = new Set(clips.map((clip) => clipNameKey(clip.name)));
  const staying = tracksOf(json, skeleton, replacing);
  const ours = new Set<TrackKey>(clips.flatMap((clip) => clip.tracks.map((t) => trackKey(t.node, t.path))));
  lintMissingPreexisting(json, skeleton, replacing, ours, writerLints);
  const complete = clips.map((clip) => withTracks(clip, new Set([...ours, ...staying]), skeleton));

  // Placement: same-named animations are replaced in place, others appended.
  const placements = complete.map((clip) => {
    const index = animations.findIndex((a) => isRecord(a) && clipNameKey(textOf(a['name'])) === clipNameKey(clip.name));
    if (index === -1) return { clip, index: -1 };
    if (index < marker.baseAnimations && !Object.hasOwn(marker.replaced, String(index))) {
      marker.replaced[String(index)] = structuredClone(animations[index]);
    }
    return { clip, index };
  });
  let next = animations.length;
  const written = placements.map((p) => ({ clip: p.clip, index: p.index === -1 ? next++ : p.index }));

  const prefixLength = binLength(json);
  const appendOffset = align4(prefixLength);
  const appender = new BinAppender(json, appendOffset);
  let channels = 0;
  let keys = 0;
  for (const { clip, index } of written) {
    const def = appender.animation(clip, skeleton);
    channels += clip.tracks.length;
    keys += clip.tracks.reduce((sum, t) => sum + t.times.length, 0);
    if (index < animations.length) animations[index] = def;
    else animations.push(def);
  }
  if (animations.length > 0) json['animations'] = animations;
  const appended = appender.finish();
  if (appended.length > 0) setBinLength(json, appendOffset + appended.length);

  const keptMeta = rolledBack
    ? []
    : keptClipMeta(
        json,
        written.map((w) => w.index),
      );
  const meta = outputMeta(opts.meta, written, keptMeta);
  writeAsset(json, marker, meta, written.length > 0);

  const binParts =
    binLength(json) > 0 || original.bin !== null ? [binPrefix(original.bin, appendOffset), appended] : null;
  const bytes = assembleGlb(JSON.stringify(json), binParts);
  return finalizeArtifact({
    kind: 'bake-into-model',
    fileName: opts.fileName,
    bytes,
    clips: complete,
    skeleton,
    profile: opts.profile,
    writerLints,
    stats: { clips: complete.length, channels, keys, bytesAppended: appended.length },
    context: { source: original },
  });
}

// ---------- marker and rollback ----------

type MutableMarker = Omit<EkzaBakeMarkerV1, 'replaced'> & { replaced: Record<string, unknown> };

function readMarker(json: MutableJson): EkzaBakeMarkerV1 | null {
  const asset = json['asset'];
  const extras = isRecord(asset) ? asset['extras'] : undefined;
  const marker = isRecord(extras) ? extras[BAKE_MARKER_KEY] : undefined;
  if (!isRecord(marker)) return null;
  const counts = ['baseAnimations', 'baseAccessors', 'baseBufferViews', 'baseBinLength'] as const;
  if (!counts.every((key) => isIndex(marker[key]))) return null;
  if (typeof marker['baseBinSha256'] !== 'string' || typeof marker['baseSha256'] !== 'string') return null;
  const replaced = isRecord(marker['replaced']) ? marker['replaced'] : {};
  return {
    baseAnimations: marker['baseAnimations'] as number,
    baseAccessors: marker['baseAccessors'] as number,
    baseBufferViews: marker['baseBufferViews'] as number,
    baseBinLength: marker['baseBinLength'] as number,
    baseBinSha256: marker['baseBinSha256'],
    baseSha256: marker['baseSha256'],
    replaced,
    ...(marker['generatorAdded'] === true ? { generatorAdded: true as const } : {}),
  };
}

/** Why a rollback to the marker's baseline is not safe, or null when it is (§4.11.11 rule 7). */
function rollbackBlocker(
  json: MutableJson,
  marker: EkzaBakeMarkerV1,
  bin: Uint8Array | null,
  hash: (bytes: Uint8Array) => string,
): string | null {
  const structural = structuralBlocker(json, marker, bin);
  if (structural !== null) return structural;
  return hash(binPrefix(bin, marker.baseBinLength)) === marker.baseBinSha256 ? null : 'the original BIN bytes changed';
}

async function rollbackBlockerAsync(
  json: MutableJson,
  marker: EkzaBakeMarkerV1,
  bin: Uint8Array | null,
): Promise<string | null> {
  const structural = structuralBlocker(json, marker, bin);
  if (structural !== null) return structural;
  return (await sha256Hex(binPrefix(bin, marker.baseBinLength))) === marker.baseBinSha256
    ? null
    : 'the original BIN bytes changed';
}

function structuralBlocker(json: MutableJson, marker: EkzaBakeMarkerV1, bin: Uint8Array | null): string | null {
  if (arrayOf(json, 'animations').length < marker.baseAnimations) return 'animations were removed';
  if (arrayOf(json, 'accessors').length < marker.baseAccessors) return 'accessors were removed';
  if (arrayOf(json, 'bufferViews').length < marker.baseBufferViews) return 'bufferViews were removed';
  if (binLength(json) < marker.baseBinLength || (bin?.length ?? 0) < marker.baseBinLength)
    return 'the BIN is shorter than the baseline';
  const animations = arrayOf(json, 'animations').length;
  for (const key of Object.keys(marker.replaced)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= Math.min(animations, marker.baseAnimations)) {
      return 'the marker lists a replaced animation that no longer exists';
    }
  }
  const asset = json['asset'];
  const extras = isRecord(asset) ? asset['extras'] : undefined;
  for (const [key, value] of Object.entries(isRecord(extras) ? extras : {})) {
    if (key === BAKE_MARKER_KEY || !isRecord(value)) continue;
    const later =
      (isIndex(value['baseAnimations']) && value['baseAnimations'] > marker.baseAnimations) ||
      (isIndex(value['baseAccessors']) && value['baseAccessors'] > marker.baseAccessors) ||
      (isIndex(value['baseBufferViews']) && value['baseBufferViews'] > marker.baseBufferViews) ||
      (isIndex(value['baseBinLength']) && value['baseBinLength'] > marker.baseBinLength);
    if (later) return `another tool (${key}) appended after the previous bake`;
  }
  return null;
}

/** Restores replaced animations, then truncates the arrays and the BIN to the baseline. */
function rollBack(json: MutableJson, marker: EkzaBakeMarkerV1): void {
  const animations = arrayOf(json, 'animations');
  for (const [key, value] of Object.entries(marker.replaced)) animations[Number(key)] = structuredClone(value);
  if (marker.generatorAdded === true && isRecord(json['asset'])) {
    const { generator: _ours, ...asset } = json['asset'];
    json['asset'] = asset;
  }
  truncate(json, 'animations', marker.baseAnimations);
  truncate(json, 'accessors', marker.baseAccessors);
  truncate(json, 'bufferViews', marker.baseBufferViews);
  if (marker.baseBinLength === 0) {
    // buffers[0] was created by the first bake (a glTF buffer is never empty).
    const buffers = arrayOf(json, 'buffers');
    if (buffers.length > 0) buffers.shift();
    if (buffers.length === 0) delete json['buffers'];
    else json['buffers'] = buffers;
  } else {
    setBinLength(json, marker.baseBinLength);
  }
}

function truncate(json: MutableJson, key: string, length: number): void {
  const list = arrayOf(json, key);
  if (length === 0) delete json[key];
  else json[key] = list.slice(0, length);
}

// ---------- tracks ----------

/** Tracks (SkeletonDesc index/path) of the animations that stay in `json` when clips named `replacing` are written. */
function tracksOf(json: MutableJson, skeleton: SkeletonDesc, replacing: ReadonlySet<string>): Set<TrackKey> {
  const nodeOf = new Map(skeleton.nodes.map((node) => [node.gltfIndex, node.index]));
  const out = new Set<TrackKey>();
  for (const animation of animationsOf(json)) {
    if (replacing.has(clipNameKey(textOf(animation.name)))) continue;
    for (const channel of listField(animation.channels)) {
      const target = isRecord(channel.target) ? channel.target : null;
      const node = target !== null && isIndex(target.node) ? nodeOf.get(target.node) : undefined;
      const path = target?.path;
      if (node !== undefined && (path === 'translation' || path === 'rotation' || path === 'scale')) {
        out.add(trackKey(node, path));
      }
    }
  }
  return out;
}

/** A clip completed with 2-key rest tracks for every required track it lacks (self-contained clips, ADR 0005 §3). */
function withTracks(clip: BakedClip, required: ReadonlySet<TrackKey>, skeleton: SkeletonDesc): BakedClip {
  const have = new Set(clip.tracks.map((t) => trackKey(t.node, t.path)));
  const extra: BakedTrack[] = [];
  for (const key of required) {
    if (have.has(key)) continue;
    const parsed = parseTrackKey(key);
    const node = parsed === null ? undefined : skeleton.nodes[parsed.node];
    if (parsed === null || node === undefined) continue;
    const rest =
      parsed.path === 'translation'
        ? node.restLocal.t
        : parsed.path === 'rotation'
          ? node.restLocal.q
          : node.restLocal.s;
    const values = new Float32Array(rest.length * 2);
    values.set(rest, 0);
    values.set(rest, rest.length);
    const times = clip.duration > 0 ? new Float32Array([0, clip.duration]) : new Float32Array([0]);
    extra.push({
      node: parsed.node,
      path: parsed.path,
      interpolation: 'LINEAR',
      times,
      values: values.subarray(0, times.length * rest.length),
    });
  }
  if (extra.length === 0) return clip;
  const order = { translation: 0, rotation: 1, scale: 2 } as const;
  const tracks = [...clip.tracks, ...extra].sort((a, b) => a.node - b.node || order[a.path] - order[b.path]);
  return { ...clip, tracks };
}

function lintMissingPreexisting(
  json: MutableJson,
  skeleton: SkeletonDesc,
  replacing: ReadonlySet<string>,
  ours: ReadonlySet<TrackKey>,
  out: LintIssue[],
): void {
  animationsOf(json).forEach((animation, index) => {
    const name = textOf(animation.name);
    if (replacing.has(clipNameKey(name))) return;
    const single = new Set<TrackKey>();
    const nodeOf = new Map(skeleton.nodes.map((node) => [node.gltfIndex, node.index]));
    for (const channel of listField(animation.channels)) {
      const node =
        isRecord(channel.target) && isIndex(channel.target.node) ? nodeOf.get(channel.target.node) : undefined;
      const path = channel.target?.path;
      if (node !== undefined && (path === 'translation' || path === 'rotation' || path === 'scale'))
        single.add(trackKey(node, path));
    }
    const missing = [...ours].filter((key) => !single.has(key)).length;
    if (missing > 0) {
      out.push({
        code: 'surgeon.preexisting-missing-track',
        severity: 'warning',
        message: `Existing clip '${name}' does not animate ${missing} track${missing === 1 ? '' : 's'} the new clips animate; switching to it may leave a stale pose`,
        pointer: `/animations/${index}`,
      });
    }
  });
}

function checkMatrixNodes(clips: readonly BakedClip[], skeleton: SkeletonDesc): void {
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const node = skeleton.nodes[track.node];
      if (node === undefined) throw new EkzaError('unsupported', `Track node ${track.node} is not in the skeleton`);
      if (node.hasMatrix) {
        const issue: LintIssue = {
          code: 'surgeon.matrix-node',
          severity: 'error',
          message: `Node '${node.name}' uses a matrix and cannot be animated in place (export an animation-only GLB or VRMA instead)`,
          pointer: `/nodes/${node.gltfIndex}/matrix`,
        };
        throw new EkzaError('matrix-node', issue.message, { lints: [issue] });
      }
    }
  }
}

// ---------- BIN and JSON writing ----------

class BinAppender {
  private readonly parts: Uint8Array[] = [];
  private length = 0;
  private readonly inputs = new Map<string, { readonly times: Float32Array; readonly accessor: number }[]>();

  constructor(
    private readonly json: MutableJson,
    private readonly offset: number,
  ) {}

  animation(clip: BakedClip, skeleton: SkeletonDesc): MutableJson {
    const channels: MutableJson[] = [];
    const samplers: MutableJson[] = [];
    for (const track of clip.tracks) {
      const node = skeleton.nodes[track.node] as SkeletonDesc['nodes'][number];
      const input = this.input(track.times);
      const rotation = track.path === 'rotation';
      const output = this.accessor(track.values, rotation ? 'VEC4' : 'VEC3', rotation ? 4 : 3);
      channels.push({ sampler: samplers.length, target: { node: node.gltfIndex, path: track.path } });
      samplers.push({ input, interpolation: track.interpolation, output });
    }
    return { name: clip.name, channels, samplers };
  }

  private input(times: Float32Array): number {
    const key = `${times.length}:${times[0] ?? 0}:${times[times.length - 1] ?? 0}`;
    const bucket = this.inputs.get(key) ?? [];
    const found = bucket.find(
      (entry) => entry.times.length === times.length && entry.times.every((t, i) => t === times[i]),
    );
    if (found !== undefined) return found.accessor;
    const accessor = this.accessor(times, 'SCALAR', 1);
    bucket.push({ times, accessor });
    this.inputs.set(key, bucket);
    return accessor;
  }

  /** Appends float32 data as a new bufferView + accessor with min/max; returns the accessor index. */
  private accessor(values: Float32Array, type: 'SCALAR' | 'VEC3' | 'VEC4', components: number): number {
    const bytes = new Uint8Array(values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength));
    const byteOffset = this.offset + this.length;
    this.parts.push(bytes);
    this.length += bytes.length; // float32 data keeps every view 4-byte aligned
    const views = arrayOf(this.json, 'bufferViews');
    views.push({ buffer: 0, byteOffset, byteLength: bytes.length });
    this.json['bufferViews'] = views;
    const min = Array.from({ length: components }, () => Infinity);
    const max = Array.from({ length: components }, () => -Infinity);
    for (let i = 0; i < values.length; i++) {
      const c = i % components;
      const v = values[i] as number;
      if (v < (min[c] as number)) min[c] = v;
      if (v > (max[c] as number)) max[c] = v;
    }
    const accessors = arrayOf(this.json, 'accessors');
    accessors.push({
      bufferView: views.length - 1,
      componentType: FLOAT,
      count: values.length / components,
      type,
      min,
      max,
    });
    this.json['accessors'] = accessors;
    return accessors.length - 1;
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

/** Whether `asset.generator` is present (any value counts: an existing key is never rewritten). */
function hasGenerator(json: MutableJson): boolean {
  const asset = json['asset'];
  return isRecord(asset) && asset['generator'] !== undefined;
}

function arrayOf(json: MutableJson, key: string): unknown[] {
  const value = json[key];
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** buffers[0].byteLength (0 when there is no buffer). */
function binLength(json: MutableJson): number {
  const buffer = arrayOf(json, 'buffers')[0];
  return isRecord(buffer) && isIndex(buffer['byteLength']) ? buffer['byteLength'] : 0;
}

function setBinLength(json: MutableJson, length: number): void {
  const buffers = arrayOf(json, 'buffers');
  const buffer = buffers[0];
  if (isRecord(buffer)) buffers[0] = { ...buffer, byteLength: length };
  else buffers.unshift({ byteLength: length });
  json['buffers'] = buffers;
}

/** The first `length` bytes of the original BIN chunk (zero-padded if the chunk is shorter). */
function binPrefix(bin: Uint8Array | null, length: number): Uint8Array {
  if (bin !== null && bin.length >= length) return bin.subarray(0, length);
  const out = new Uint8Array(length);
  if (bin !== null) out.set(bin);
  return out;
}

function keptClipMeta(json: MutableJson, overwritten: readonly number[]): EkzaClipMetaV1[] {
  const asset = json['asset'];
  const extras = isRecord(asset) ? asset['extras'] : undefined;
  const meta = isRecord(extras) ? extras[ANIMATION_META_KEY] : undefined;
  const clips = isRecord(meta) ? unknownList(meta['clips']) : [];
  const animations = arrayOf(json, 'animations');
  const skip = new Set(overwritten);
  return clips
    .filter((clip): clip is EkzaClipMetaV1 => {
      if (!isRecord(clip) || !isIndex(clip['index']) || skip.has(clip['index'])) return false;
      const animation = animations[clip['index']];
      return isRecord(animation) && clipNameKey(textOf(animation['name'])) === clipNameKey(textOf(clip['name']));
    })
    .map((clip) => normalizeClipMeta(clip));
}

/**
 * Writes the marker and the clip metadata into `asset.extras`. `asset.generator` is written only when the file has
 * none and clips are baked (§4.11.11 rule 8); it goes right after `version` so a rollback that removed it and a
 * re-bake that adds it again serialize identically. An existing generator names the model's tool and stays.
 */
function writeAsset(json: MutableJson, marker: MutableMarker, meta: EkzaAnimationV1, baked: boolean): void {
  let asset: MutableJson = isRecord(json['asset']) ? { ...json['asset'] } : { version: '2.0' };
  if (baked && !hasGenerator(json)) {
    const entries = Object.entries(asset).filter(([key]) => key !== 'generator');
    const at = entries.findIndex(([key]) => key === 'version') + 1;
    entries.splice(at, 0, ['generator', generatorName(meta)]);
    asset = Object.fromEntries(entries);
  }
  const extras: MutableJson = isRecord(asset['extras']) ? { ...asset['extras'] } : {};
  extras[BAKE_MARKER_KEY] = {
    baseAnimations: marker.baseAnimations,
    baseAccessors: marker.baseAccessors,
    baseBufferViews: marker.baseBufferViews,
    baseBinLength: marker.baseBinLength,
    baseBinSha256: marker.baseBinSha256,
    baseSha256: marker.baseSha256,
    // Integer-like keys iterate in ascending order, so re-bakes serialize identically.
    replaced: { ...marker.replaced },
    ...(marker.generatorAdded === true ? { generatorAdded: true } : {}),
  };
  extras[ANIMATION_META_KEY] = meta;
  asset['extras'] = extras;
  json['asset'] = asset;
}
