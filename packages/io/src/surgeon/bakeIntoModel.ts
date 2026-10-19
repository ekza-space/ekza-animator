// The append-only "surgeon" (MVP-SPEC §4.11.11, ADR 0005 §6): bakes clips into the user's original GLB/VRM without
// re-serializing anything it does not understand. Existing array entries keep their indices (so every extension's
// references stay valid), the original BIN bytes are copied verbatim as a prefix, and new accessors/bufferViews/
// animations are appended. A baseline marker in asset.extras lets a later bake roll back to the original first.
//
// M6a (M6A-SPEC §5.22): `opts.geometry` adds the geometry step ("replace primitives") before the clips. A bake with a
// geometry step writes marker v2 instead of v1 (the original primitives of every replaced mesh and the original
// extension lists); a re-bake of such a file rolls geometry and clips back together and re-applies both: meshes edited
// now are written from their new data, meshes the previous bake replaced are carried over as they are. Bakes without
// any geometry write v1 and stay byte-identical to M2a outputs.
import { EkzaError } from '@ekza-animator/anim-core';
import type { SkeletonDesc, TrackKey } from '@ekza-animator/rig';
import { parseTrackKey, trackKey } from '../bake/bake';
import { normalizeClipMeta } from '../bake/meta';
import { align4, assembleGlb } from '../glb/write';
import { GltfReader } from '../gltf/accessor';
import { animationsOf, isIndex, isRecord, listField, textOf, unknownList } from '../gltf/schema';
import { sha256Hex, sha256HexSync } from '../hash/sha256';
import { ruleSeverity } from '../lint/rules';
import type {
  BakedClip,
  BakedTrack,
  EkzaAnimationV1,
  EkzaClipMetaV1,
  ExportArtifact,
  ExportProfileDef,
  GlbContainer,
  LintIssue,
  PrimitiveEdit,
} from '../types';
import { finalizeArtifact } from '../writers/artifact';
import { clipNameKey, outputMeta } from '../writers/names';
import { assertUniqueNames, generatorName } from '../writers/write';
import {
  arrayOf,
  BAKE_MARKER_KEY,
  BAKE_MARKER_V2_KEY,
  binLength,
  binPrefix,
  hasGenerator,
  type MutableJson,
  type MutableMarker,
  readMarker,
  rollBack,
  rollbackBlocker,
  rollbackBlockerAsync,
  setBinLength,
  writeMarker,
} from './marker';
import {
  applyGeometry,
  assertSelfContained,
  type CarriedMesh,
  extensionLists,
  GeometryWriter,
  primitivesOfEdits,
} from './replacePrimitives';

export { BAKE_MARKER_KEY, BAKE_MARKER_V2_KEY };
export const ANIMATION_META_KEY = 'ekza_animation_v1';
const FLOAT = 5126;

export interface SurgeonOptions {
  readonly meta: EkzaAnimationV1;
  readonly fileName: string;
  readonly profile: ExportProfileDef | null;
  /** M6a (§5.22): edited meshes of the model, written by the geometry step before the clips (marker v2). */
  readonly geometry?: readonly PrimitiveEdit[];
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
  assertSelfContained(json);
  checkMatrixNodes(clips, skeleton);
  const edits = opts.geometry ?? [];
  const outputs = await primitivesOfEdits(edits);

  const writerLints: LintIssue[] = [];
  const existing = readMarker(json);
  let marker: MutableMarker;
  let rolledBack = false;
  let carried: CarriedMesh[] = [];
  if (existing === null) {
    const baseBinLength = binLength(json);
    marker = {
      version: 1,
      baseAnimations: arrayOf(json, 'animations').length,
      baseAccessors: arrayOf(json, 'accessors').length,
      baseBufferViews: arrayOf(json, 'bufferViews').length,
      baseBinLength,
      baseBinSha256: await sha256Hex(binPrefix(original.bin, baseBinLength)),
      baseSha256: original.sha256,
      replaced: {},
      replacedPrimitives: {},
      originalExtensions: null,
      ...(hasGenerator(json) ? {} : { generatorAdded: true as const }),
    };
  } else {
    marker = {
      ...existing,
      replaced: { ...existing.replaced },
      replacedPrimitives: { ...existing.replacedPrimitives },
    };
    const blocker = await rollbackBlockerAsync(json, existing, original.bin);
    if (blocker === null) {
      // Meshes the previous bake replaced and nobody edits now keep their current geometry (re-appended verbatim).
      const editedNow = new Set(edits.map((edit) => edit.meshIndex));
      const reader = new GltfReader(original.json, original.bin);
      const meshes = arrayOf(original.json, 'meshes');
      carried = Object.keys(existing.replacedPrimitives)
        .map(Number)
        .filter((mesh) => !editedNow.has(mesh))
        .map((mesh) => {
          const current = meshes[mesh];
          const primitives = isRecord(current) && Array.isArray(current['primitives']) ? current['primitives'] : [];
          return { meshIndex: mesh, primitives, reader, json: original.json };
        });
      rollBack(json, existing);
      rolledBack = true;
    } else {
      writerLints.push({
        code: 'surgeon.no-rollback',
        severity: 'warning',
        message: `The previous bake could not be rolled back (${blocker}); the new clips were appended after it`,
        pointer: `/asset/extras/${existing.version === 2 ? BAKE_MARKER_V2_KEY : BAKE_MARKER_KEY}`,
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
  // M6a geometry step (§5.22): after the baseline, before the clips.
  let geometryBytes: Uint8Array = new Uint8Array(0);
  if (outputs.length > 0 || carried.length > 0) {
    const listsBefore = extensionLists(json);
    const writer = new GeometryWriter(json, appendOffset);
    const before = applyGeometry(json, writer, outputs, carried);
    geometryBytes = writer.finish();
    setBinLength(json, appendOffset + geometryBytes.length);
    marker.version = 2;
    marker.originalExtensions ??= listsBefore;
    for (const [mesh, primitives] of before) {
      if (!Object.hasOwn(marker.replacedPrimitives, String(mesh))) marker.replacedPrimitives[String(mesh)] = primitives;
    }
    for (const edit of edits) {
      if (!edit.hadTangents || !edit.dropTangents) continue;
      const severity = ruleSeverity('mesh.tangents-dropped', opts.profile);
      if (severity === null) continue;
      writerLints.push({
        code: 'mesh.tangents-dropped',
        severity,
        message: `Mesh ${edit.meshIndex} was exported without its tangents (normal maps may shade differently)`,
        pointer: `/meshes/${edit.meshIndex}`,
      });
    }
  }
  const animationOffset = appendOffset + geometryBytes.length;
  const appender = new BinAppender(json, animationOffset);
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
  if (appended.length > 0) setBinLength(json, animationOffset + appended.length);

  const keptMeta = rolledBack
    ? []
    : keptClipMeta(
        json,
        written.map((w) => w.index),
      );
  const meta = outputMeta(opts.meta, written, keptMeta);
  writeAsset(json, marker, meta, written.length > 0);

  const binParts =
    binLength(json) > 0 || original.bin !== null
      ? [binPrefix(original.bin, appendOffset), geometryBytes, appended]
      : null;
  const bytes = assembleGlb(JSON.stringify(json), binParts);
  return finalizeArtifact({
    kind: 'bake-into-model',
    fileName: opts.fileName,
    bytes,
    clips: complete,
    skeleton,
    profile: opts.profile,
    writerLints,
    stats: { clips: complete.length, channels, keys, bytesAppended: geometryBytes.length + appended.length },
    context: { source: original },
  });
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
  writeMarker(extras, marker);
  extras[ANIMATION_META_KEY] = meta;
  asset['extras'] = extras;
  json['asset'] = asset;
}
