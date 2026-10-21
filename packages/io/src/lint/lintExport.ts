// Export lints (MVP-SPEC §4.11.13, ADR 0010 §4): checks on the exported bytes, with severities from the profile.
// Rules about "our" clips (slot names, unit quaternions) use the clip indices recorded in
// `asset.extras.ekza_animation_v1`; rules about admission of the whole file (unique names, hips-only translation,
// required clips) look at every animation.
import { HUMAN_BONE_NAMES } from '@ekza-studio/rig';
import { CHUNK_BIN, CHUNK_JSON, parseGlbSync, readGlbLayout } from '../glb/parse';
import { GltfReader } from '../gltf/accessor';
import { readEmbeddedAvatarHeightScale } from '../gltf/ekzaMeta';
import { jsonEqual } from '../gltf/json';
import {
  animationsOf,
  buffersOf,
  extensionsRequired,
  extensionsUsed,
  type GltfAnimationDef,
  isIndex,
  isRecord,
  type JsonRecord,
  listField,
  nodesOf,
  pointer,
  rootExtensions,
  scenesOf,
  skinsOf,
  unknownList,
} from '../gltf/schema';
import type { ExportKind, ExportProfileDef, GlbContainer, GltfJson, LintIssue } from '../types';
import { clipNameKey } from '../writers/names';
import { ruleSeverity } from './rules';
import { checkStatic } from './static';
import { checkVrmMeta, checkVrmRuntime, profileWantsVrm } from './vrm';

const MiB = 1_048_576;
export const HARD_JSON_LIMIT = 8 * MiB;
export const DEFAULT_JSON_LIMIT = 4 * MiB;
const ALLOWED_REQUIRED = new Set(['KHR_materials_unlit', 'KHR_texture_transform']);
const SLOT_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_URI_ISSUES = 20;
const MAX_PATH_ISSUES = 20;

export interface LintContext {
  /** The original file of a bake into model: its VRM block must survive value-equal (`rendition_format`). */
  readonly source?: GlbContainer;
}

export function lintExport(
  kind: ExportKind,
  bytes: Uint8Array,
  profile: ExportProfileDef | null,
): Promise<readonly LintIssue[]> {
  return lintExportWithContext(kind, bytes, profile, {});
}

export async function lintExportWithContext(
  kind: ExportKind,
  bytes: Uint8Array,
  profile: ExportProfileDef | null,
  context: LintContext,
): Promise<readonly LintIssue[]> {
  await Promise.resolve();
  const issues: LintIssue[] = [];
  const emit = (code: string, message: string, at?: string): void => {
    const severity = ruleSeverity(code, profile);
    if (severity === null) return;
    issues.push({ code, severity, message, ...(at === undefined ? {} : { pointer: at }) });
  };

  if (!checkChunks(bytes, emit)) return issues;
  let parsed: ReturnType<typeof parseGlbSync>;
  try {
    parsed = parseGlbSync(bytes);
  } catch (error) {
    emit('ekza.chunk-alignment', `The output cannot be parsed: ${(error as Error).message}`);
    return issues;
  }
  const json = parsed.json;
  const root = json as unknown as JsonRecord;
  const extensions = rootExtensions(json);
  const animations = animationsOf(json);
  const meta = ekzaMeta(json);
  const ours = ourAnimations(meta, animations.length);

  findUriKeys(root, '', emit, { count: 0 });
  checkFormat(extensions, context, emit);
  if (profile !== null && bytes.byteLength > profile.maxBytes) {
    emit('source_too_large', `The file is ${bytes.byteLength} bytes; ${profile.label} allows ${profile.maxBytes}`);
  }
  checkHumanoid(kind, extensions, profile, emit);
  if (ruleSeverity('rendition_animation', profile) !== null) checkRequiredClips(animations, profile, emit);
  if (kind === 'bake-into-model') checkSkins(json, emit);

  const buffers = buffersOf(json);
  if (buffers.length !== 1 || buffers[0]?.uri !== undefined) {
    emit(
      'ekza.single-buffer',
      `The file has ${buffers.length} buffers; exactly one embedded buffer is expected`,
      '/buffers',
    );
  }
  const jsonLimit = profile?.jsonMaxBytes ?? DEFAULT_JSON_LIMIT;
  if (parsed.jsonByteLength > HARD_JSON_LIMIT) {
    issues.push({
      code: 'ekza.json-chunk-size',
      severity: 'error',
      message: `The JSON chunk is ${parsed.jsonByteLength} bytes; more than 8 MiB is never accepted`,
    });
  } else if (parsed.jsonByteLength > jsonLimit) {
    emit('ekza.json-chunk-size', `The JSON chunk is ${parsed.jsonByteLength} bytes; the limit is ${jsonLimit}`);
  }
  const required = extensionsRequired(json).filter((name) => !ALLOWED_REQUIRED.has(name));
  if (required.length > 0) {
    emit('ekza.extensions-required', `extensionsRequired lists ${required.join(', ')}`, '/extensionsRequired');
  }

  // M6a (M6A-SPEC §4.5): static models have no clips; their own rules replace the animation checks.
  if (kind === 'static-glb') {
    checkStatic(json, new GltfReader(json, parsed.bin), bytes, profile, emit);
    return issues;
  }
  checkNames(animations, ours, emit);
  if (kind !== 'vrma') checkHipsOnlyTranslation(extensions, animations, emit);
  checkUnitQuaternions(new GltfReader(json, parsed.bin), animations, ours, emit);
  checkProvenance(meta, emit);
  const heightScale = readEmbeddedAvatarHeightScale(json);
  if (heightScale !== null && (heightScale < 0.5 || heightScale > 2)) {
    emit('ekza.height-scale-range', `extras.ekza.avatar.heightScale is ${heightScale}; Ekza clamps it to 0.5..2`);
  }
  if (kind === 'vrma') checkVrma(json, extensions, animations, emit);
  else checkBevyPaths(json, animations, emit);
  // M6b (M6B-SPEC §0.4.6; C10): OMOBA's runtime rules on VRM files exported for a profile (errors for the Space
  // profile, warnings for local/generic; an export without a profile keeps the generic lints only) and on every file
  // of a profile that lists them (the Space profile: a plain GLB fails vrm.spec-version).
  const vrm = extensions['VRM'] !== undefined || extensions['VRMC_vrm'] !== undefined;
  if (kind !== 'vrma' && ((vrm && profile !== null) || profileWantsVrm(profile))) {
    checkVrmRuntime(bytes, emit);
    checkVrmMeta(root, parsed.bin, emit);
  }
  return issues;
}

type Emit = (code: string, message: string, at?: string) => void;

function checkChunks(bytes: Uint8Array, emit: Emit): boolean {
  let layout: ReturnType<typeof readGlbLayout>;
  try {
    layout = readGlbLayout(bytes);
  } catch (error) {
    emit('ekza.chunk-alignment', (error as Error).message);
    return false;
  }
  const [first, ...rest] = layout.chunks;
  if (first === undefined || first.type !== CHUNK_JSON) {
    emit('ekza.chunk-alignment', 'The GLB does not start with a JSON chunk');
    return false;
  }
  const problems: string[] = [];
  if (layout.declaredLength !== bytes.byteLength) problems.push('the header length differs from the file size');
  if (layout.truncated || layout.trailingBytes > 0) problems.push('the chunk table does not end at the file end');
  if (rest.length > 1 || (rest[0] !== undefined && rest[0].type !== CHUNK_BIN))
    problems.push('only one BIN chunk may follow the JSON chunk');
  if (layout.chunks.some((chunk) => chunk.length % 4 !== 0)) problems.push('a chunk length is not a multiple of 4');
  if (problems.length > 0) emit('ekza.chunk-alignment', `GLB container: ${problems.join('; ')}`);
  return true;
}

function findUriKeys(value: unknown, at: string, emit: Emit, state: { count: number }): void {
  if (state.count >= MAX_URI_ISSUES) return;
  if (Array.isArray(value)) {
    value.forEach((entry, i) => findUriKeys(entry, `${at}/${i}`, emit, state));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const child = `${at}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    if (key.toLowerCase() === 'uri') {
      state.count++;
      emit('rendition_external_data', `A key named '${key}' is not allowed (self-contained GLB)`, child);
      if (state.count >= MAX_URI_ISSUES) return;
    }
    findUriKeys(entry, child, emit, state);
  }
}

function checkFormat(extensions: JsonRecord, context: LintContext, emit: Emit): void {
  const v0 = isRecord(extensions['VRM']);
  const v1 = isRecord(extensions['VRMC_vrm']);
  if (v0 && v1) emit('rendition_format', 'The file declares both VRM 0.x and VRM 1.0', '/extensions');
  const source = context.source;
  if (source === undefined) return;
  const sourceExtensions = rootExtensions(source.json);
  for (const name of ['VRM', 'VRMC_vrm']) {
    if (sourceExtensions[name] !== undefined && !jsonEqual(sourceExtensions[name], extensions[name])) {
      emit('rendition_format', `The ${name} block changed during export`, pointer('extensions', name));
    }
  }
}

function humanoidHasHips(extensions: JsonRecord): boolean {
  const v1 = extensions['VRMC_vrm'];
  if (isRecord(v1)) {
    const bones = isRecord(v1['humanoid']) ? v1['humanoid']['humanBones'] : undefined;
    return isRecord(bones) && isRecord(bones['hips']);
  }
  const v0 = extensions['VRM'];
  if (isRecord(v0)) {
    const bones = isRecord(v0['humanoid']) ? v0['humanoid']['humanBones'] : undefined;
    return Array.isArray(bones) && bones.some((bone) => isRecord(bone) && bone['bone'] === 'hips');
  }
  return false;
}

function checkHumanoid(kind: ExportKind, extensions: JsonRecord, profile: ExportProfileDef | null, emit: Emit): void {
  if (kind === 'vrma') {
    const ext = extensions['VRMC_vrm_animation'];
    const bones = isRecord(ext) && isRecord(ext['humanoid']) ? ext['humanoid']['humanBones'] : undefined;
    if (!isRecord(bones) || !isRecord(bones['hips']))
      emit('source_humanoid', 'The VRMA humanoid has no hips', '/extensions');
    return;
  }
  const isVrm = isRecord(extensions['VRM']) || isRecord(extensions['VRMC_vrm']);
  const humanoidProfile = profile !== null && /humanoid/i.test(profile.profile);
  if ((isVrm || humanoidProfile) && kind === 'bake-into-model' && !humanoidHasHips(extensions)) {
    emit('source_humanoid', 'The model has no humanoid map with hips', '/extensions');
  }
}

function checkRequiredClips(
  animations: readonly GltfAnimationDef[],
  profile: ExportProfileDef | null,
  emit: Emit,
): void {
  const names = new Set(animations.map((a) => clipNameKey(String(a.name ?? ''))));
  for (const required of profile?.requiredClips ?? []) {
    if (!names.has(clipNameKey(required)))
      emit('rendition_animation', `The profile requires a clip named '${required}'`, '/animations');
  }
  animations.forEach((animation, a) => {
    listField(animation.channels).forEach((channel, c) => {
      if (!isRecord(channel.target) || !isIndex(channel.target.node)) {
        emit(
          'rendition_animation',
          `animations[${a}].channels[${c}] has no target node`,
          pointer('animations', a, 'channels', c),
        );
      }
    });
  });
}

function checkSkins(json: GltfJson, emit: Emit): void {
  const skins = skinsOf(json);
  const nodeCount = nodesOf(json).length;
  if (skins.length === 0) {
    emit('rendition_skeleton', 'The model has no skin', '/skins');
    return;
  }
  skins.forEach((skin, s) => {
    const joints = listField(skin.joints);
    if (joints.length === 0 || joints.some((j) => !isIndex(j) || j >= nodeCount)) {
      emit('rendition_skeleton', `skins[${s}] has missing or invalid joints`, pointer('skins', s, 'joints'));
    }
  });
}

interface ClipMeta {
  readonly index?: unknown;
  readonly redistributable?: unknown;
  readonly name?: unknown;
}

function ekzaMeta(json: GltfJson): { readonly clips: readonly ClipMeta[] } | null {
  const extras = json.asset.extras;
  const meta = isRecord(extras) ? extras['ekza_animation_v1'] : undefined;
  if (!isRecord(meta)) return null;
  return { clips: unknownList(meta['clips']).filter(isRecord) };
}

/** Animation indices written by the animator (from the metadata); every animation when there is none. */
function ourAnimations(meta: { readonly clips: readonly ClipMeta[] } | null, count: number): Set<number> {
  if (meta === null) return new Set(Array.from({ length: count }, (_, i) => i));
  return new Set(meta.clips.map((clip) => clip.index).filter((i): i is number => isIndex(i) && i < count));
}

function checkNames(animations: readonly GltfAnimationDef[], ours: ReadonlySet<number>, emit: Emit): void {
  const seen = new Map<string, number>();
  animations.forEach((animation, i) => {
    const name = typeof animation.name === 'string' ? animation.name : '';
    if (ours.has(i)) {
      if (name.trim().toLowerCase() === 'tpose') {
        emit('ekza.slot-name', "The reserved clip name 'tpose' is never exported", pointer('animations', i, 'name'));
      } else if (!SLOT_NAME.test(name)) {
        emit(
          'ekza.slot-name',
          `Clip name '${name}' is not a slot name ([a-z][a-z0-9_]{0,31})`,
          pointer('animations', i, 'name'),
        );
      }
    }
    if (name.trim() === '') return;
    const key = clipNameKey(name);
    const first = seen.get(key);
    if (first !== undefined) {
      emit(
        'ekza.unique-names',
        `Clip names '${name}' (animations ${first} and ${i}) collide case-insensitively`,
        pointer('animations', i, 'name'),
      );
    } else {
      seen.set(key, i);
    }
  });
}

function humanoidNodes(extensions: JsonRecord): Map<number, string> {
  const out = new Map<number, string>();
  const v1 = extensions['VRMC_vrm'];
  if (isRecord(v1)) {
    const bones = isRecord(v1['humanoid']) ? v1['humanoid']['humanBones'] : undefined;
    for (const [name, bone] of Object.entries(isRecord(bones) ? bones : {})) {
      if (isRecord(bone) && isIndex(bone['node'])) out.set(bone['node'], name);
    }
  }
  const v0 = extensions['VRM'];
  if (isRecord(v0)) {
    const bones = isRecord(v0['humanoid']) ? v0['humanoid']['humanBones'] : undefined;
    for (const bone of unknownList(bones)) {
      if (isRecord(bone) && isIndex(bone['node']) && typeof bone['bone'] === 'string')
        out.set(bone['node'], bone['bone']);
    }
  }
  return out;
}

function checkHipsOnlyTranslation(extensions: JsonRecord, animations: readonly GltfAnimationDef[], emit: Emit): void {
  const humans = humanoidNodes(extensions);
  if (humans.size === 0) return;
  animations.forEach((animation, a) => {
    listField(animation.channels).forEach((channel, c) => {
      const node = isRecord(channel.target) ? channel.target.node : undefined;
      const bone = isIndex(node) ? humans.get(node) : undefined;
      if (channel.target?.path === 'translation' && bone !== undefined && bone !== 'hips') {
        emit(
          'ekza.hips-only-translation',
          `animations[${a}] translates humanoid bone '${bone}'`,
          pointer('animations', a, 'channels', c),
        );
      }
    });
  });
}

function checkUnitQuaternions(
  reader: GltfReader,
  animations: readonly GltfAnimationDef[],
  ours: ReadonlySet<number>,
  emit: Emit,
): void {
  for (const a of ours) {
    const animation = animations[a];
    if (animation === undefined) continue;
    const samplers = listField(animation.samplers);
    const checked = new Set<number>();
    for (const channel of listField(animation.channels)) {
      if (channel.target?.path !== 'rotation' || !isIndex(channel.sampler) || checked.has(channel.sampler)) continue;
      checked.add(channel.sampler);
      const sampler = samplers[channel.sampler];
      if (sampler === undefined || !isIndex(sampler.output)) continue;
      let values: Float32Array;
      try {
        if (reader.isCompressed(sampler.output)) continue;
        values = reader.readFloat(sampler.output);
      } catch {
        continue; // unreadable data is the validator's finding, not a lint
      }
      for (let i = 0; i + 3 < values.length; i += 4) {
        const length = Math.hypot(
          values[i] as number,
          values[i + 1] as number,
          values[i + 2] as number,
          values[i + 3] as number,
        );
        if (Math.abs(length - 1) > 1e-6) {
          emit(
            'ekza.unit-quaternions',
            `animations[${a}] has a rotation of length ${length}`,
            pointer('animations', a, 'samplers', channel.sampler),
          );
          break;
        }
      }
    }
  }
}

function checkProvenance(meta: { readonly clips: readonly ClipMeta[] } | null, emit: Emit): void {
  if (meta === null) {
    emit('ekza.provenance-unknown', 'The file carries no ekza_animation_v1 metadata', '/asset/extras');
    return;
  }
  meta.clips.forEach((clip, i) => {
    const name = typeof clip.name === 'string' ? clip.name : `#${i}`;
    if (clip.redistributable === 'no') {
      emit(
        'ekza.non-redistributable',
        `Clip '${name}' is derived from material that may not be redistributed`,
        `/asset/extras/ekza_animation_v1/clips/${i}`,
      );
    } else if (clip.redistributable !== 'yes') {
      emit(
        'ekza.provenance-unknown',
        `Clip '${name}' has unknown provenance`,
        `/asset/extras/ekza_animation_v1/clips/${i}`,
      );
    }
  });
}

function checkVrma(json: GltfJson, extensions: JsonRecord, animations: readonly GltfAnimationDef[], emit: Emit): void {
  const ext = extensions['VRMC_vrm_animation'];
  if (!extensionsUsed(json).includes('VRMC_vrm_animation') || !isRecord(ext)) {
    emit(
      'vrma.spec-version',
      'extensionsUsed must list VRMC_vrm_animation with its extension object',
      '/extensionsUsed',
    );
    return;
  }
  if (ext['specVersion'] !== '1.0') {
    emit(
      'vrma.spec-version',
      `specVersion is ${JSON.stringify(ext['specVersion'])}; "1.0" is required`,
      '/extensions/VRMC_vrm_animation/specVersion',
    );
  }
  if (animations.length !== 1)
    emit('vrma.animation-count', `The VRMA has ${animations.length} animations; exactly one is written`, '/animations');
  const bones = isRecord(ext['humanoid']) ? ext['humanoid']['humanBones'] : undefined;
  const boneOf = new Map<number, string>();
  for (const [name, bone] of Object.entries(isRecord(bones) ? bones : {})) {
    if (isRecord(bone) && isIndex(bone['node'])) boneOf.set(bone['node'], name);
    if (name === 'leftEye' || name === 'rightEye') {
      emit(
        'vrma.eyes',
        `Humanoid bone '${name}' must not be mapped in VRMA (gaze uses lookAt)`,
        `/extensions/VRMC_vrm_animation/humanoid/humanBones/${name}`,
      );
    }
    if (!HUMAN_BONE_NAMES.includes(name as never)) {
      emit(
        'vrma.non-humanoid-channel',
        `'${name}' is not a VRM 1.0 humanoid bone`,
        `/extensions/VRMC_vrm_animation/humanoid/humanBones/${name}`,
      );
    }
  }
  const allowed = new Set(boneOf.keys());
  const expressions = ext['expressions'];
  for (const group of ['preset', 'custom']) {
    const entries = isRecord(expressions) ? expressions[group] : undefined;
    for (const entry of Object.values(isRecord(entries) ? entries : {}))
      if (isRecord(entry) && isIndex(entry['node'])) allowed.add(entry['node']);
  }
  const lookAt = ext['lookAt'];
  if (isRecord(lookAt) && isIndex(lookAt['node'])) allowed.add(lookAt['node']);
  animations.forEach((animation, a) => {
    listField(animation.channels).forEach((channel, c) => {
      const at = pointer('animations', a, 'channels', c);
      const node = isRecord(channel.target) ? channel.target.node : undefined;
      const path = channel.target?.path;
      if (!isIndex(node) || !allowed.has(node))
        emit('vrma.non-humanoid-channel', `animations[${a}].channels[${c}] does not target a humanoid node`, at);
      if (path === 'scale') emit('vrma.no-scale', `animations[${a}].channels[${c}] animates scale`, at);
      if (path === 'translation' && isIndex(node) && boneOf.has(node) && boneOf.get(node) !== 'hips') {
        emit('vrma.non-hips-translation', `animations[${a}].channels[${c}] translates '${boneOf.get(node)}'`, at);
      }
    });
  });
}

/**
 * Bevy (M1-stretch, ADR 0010 `bevy.*`) binds a clip's curves to `AnimationTargetId`s hashed from the node-name path
 * from the scene root, so every node on an animated path needs a name (unnamed nodes get index-based names that do
 * not survive another export) and must not share it with a sibling (both siblings would get the same target id).
 */
function checkBevyPaths(json: GltfJson, animations: readonly GltfAnimationDef[], emit: Emit): void {
  const nodes = nodesOf(json);
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((node, i) => {
    for (const child of listField(node.children)) if (isIndex(child) && child < nodes.length) parent[child] = i;
  });
  const onPath = new Set<number>();
  for (const animation of animations) {
    for (const channel of listField(animation.channels)) {
      const target = isRecord(channel.target) ? channel.target.node : undefined;
      if (!isIndex(target) || target >= nodes.length) continue;
      // The visited set also stops a (malformed) parent cycle.
      for (let n = target; n !== -1 && !onPath.has(n); n = parent[n] as number) onPath.add(n);
    }
  }
  if (onPath.size === 0) return;
  const nameOf = (i: number): string => {
    const name = nodes[i]?.name;
    return typeof name === 'string' ? name : '';
  };
  let reported = 0;
  for (const i of [...onPath].sort((a, b) => a - b)) {
    if (nameOf(i).trim() !== '' || reported >= MAX_PATH_ISSUES) continue;
    reported++;
    emit(
      'bevy.unnamed-path-node',
      `nodes[${i}] is animated or above an animated node but has no name`,
      pointer('nodes', i),
    );
  }
  // Sibling groups: the children of each node, and the roots of every scene (all parentless nodes without scenes).
  const groups: number[][] = nodes.map((node) =>
    listField(node.children).filter((c): c is number => isIndex(c) && c < nodes.length),
  );
  const scenes = scenesOf(json);
  if (scenes.length > 0) {
    for (const scene of scenes)
      groups.push(listField(scene.nodes).filter((n): n is number => isIndex(n) && n < nodes.length));
  } else {
    groups.push(nodes.map((_, i) => i).filter((i) => parent[i] === -1));
  }
  reported = 0;
  const seen = new Set<number>();
  for (const group of groups) {
    const byName = new Map<string, number[]>();
    for (const i of group) {
      const name = nameOf(i);
      if (name === '') continue;
      byName.set(name, [...(byName.get(name) ?? []), i]);
    }
    for (const [name, members] of byName) {
      const animated = members.filter((i) => onPath.has(i) && !seen.has(i));
      if (members.length < 2 || animated.length === 0 || reported >= MAX_PATH_ISSUES) continue;
      for (const i of animated) seen.add(i);
      reported++;
      emit(
        'bevy.duplicate-sibling-name',
        `Sibling nodes ${members.map((i) => `nodes[${i}]`).join(', ')} share the name '${name}' on an animated path`,
        pointer('nodes', animated[0] as number),
      );
    }
  }
}
