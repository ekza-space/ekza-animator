// The `vrm.*` lints (M6B-SPEC §0.4.6, §5.21, §4.4; C10): OMOBA's runtime admission of a VRM avatar
// (`omoba-bevy/passport/src/humanoid.rs`, `HumanoidRig::from_glb`), check for check, plus the VRM 1.0 meta rows
// `vrm.meta-required`, `vrm.licence-unset` and `vrm.thumbnail-square`.
//
// - The rules run on the written bytes. They accept VRM 0.x and VRM 1.0 exactly as OMOBA does, the version taken from
//   the file (`extensions.VRM` with a "0." specVersion, or `extensions.VRMC_vrm` with "1.0"); VRM 0 adds `chest` and
//   `neck` to the required bones and names its thumb segments Proximal / Intermediate / Distal.
// - OMOBA stops at its first failure; the lints report every failing rule (a rule reports at most `MAX_PER_RULE`
//   findings). Messages quote OMOBA's error text.
// - Severities (`rules.ts`): the runtime rows are warnings for `local/generic` (and exports without a profile) and do
//   not apply to the other Ekza profiles; `ekza/space-avatar-v1` raises them to errors. The meta rows apply only to
//   `ekza/space-avatar-v1`, and only to VRM 1.0 files: an asset bake keeps the asset's VRM 0.x meta value-equal
//   (`rendition_format`), so its meta is the asset author's, not the exporter's.
// - When they run (`lintExport`): every non-VRMA, non-static export with a profile whose file declares a VRM
//   extension, and every export with a profile that lists them (the Space profile: a file without VRM fails
//   `vrm.spec-version`). A plain GLB through `local/generic` gets none, and so does an export without a profile (the
//   M1 "generic lints only" choice).
import { CHUNK_BIN, CHUNK_JSON } from '../glb/parse';
import { isIndex, isRecord, type JsonRecord } from '../gltf/schema';
import type { ExportProfileDef, LintIssue, LintSeverity } from '../types';
import type { LintRuleDef } from './rules';

const MiB = 1_048_576;
/** OMOBA `MAX_HUMANOID_GLB_BYTES`. */
export const VRM_MAX_GLB_BYTES = 50 * MiB;
/** OMOBA `MAX_HUMANOID_JSON_BYTES`. */
export const VRM_MAX_JSON_BYTES = 4 * MiB;
/** OMOBA `MAX_HUMANOID_NODES`. */
export const VRM_MAX_NODES = 4096;
/** OMOBA: "VRM humanoid map exceeds 64 bones". */
export const VRM_MAX_HUMANOID_BONES = 64;
const MAX_PER_RULE = 20;
const ALLOWED_REQUIRED = new Set(['KHR_materials_unlit', 'KHR_texture_transform']);

/** The OMOBA runtime rows (warning locally, error for the Space profile, absent for the other Ekza profiles). */
export const VRM_RUNTIME_RULE_IDS = [
  'vrm.spec-version',
  'vrm.container',
  'vrm.glb-size',
  'vrm.json-size',
  'vrm.node-count',
  'vrm.humanoid-bone-count',
  'vrm.bone-names',
  'vrm.required-bones',
  'vrm.parent-map',
  'vrm.node-tree',
  'vrm.trs-only',
  'vrm.unit-rotation',
  'vrm.translation-range',
  'vrm.uniform-scale',
  'vrm.extensions-required',
  'vrm.bones-skinned',
] as const;

/** The VRM 1.0 meta rows (§5.21; the Space profile only). */
export const VRM_META_RULE_IDS = ['vrm.meta-required', 'vrm.licence-unset', 'vrm.thumbnail-square'] as const;

export type VrmLintCode = (typeof VRM_RUNTIME_RULE_IDS)[number] | (typeof VRM_META_RULE_IDS)[number];

const DESCRIPTIONS: Readonly<Record<VrmLintCode, string>> = {
  'vrm.spec-version': 'Exactly one of VRM (specVersion 0.x) or VRMC_vrm (specVersion 1.0); glTF 2.0',
  'vrm.container': 'One JSON chunk then at most one BIN chunk; one embedded buffer matching it; no buffer or image uri',
  'vrm.glb-size': 'GLB between 20 bytes and 50 MiB',
  'vrm.json-size': 'JSON chunk at most 4 MiB',
  'vrm.node-count': '1 to 4,096 nodes',
  'vrm.humanoid-bone-count': 'At most 64 humanoid bones',
  'vrm.bone-names': "Humanoid bones of the file's VRM version, each name and node mapped once",
  'vrm.required-bones': 'The 15 required humanoid bones (VRM 0.x also chest and neck)',
  'vrm.parent-map': 'Mapped bones keep the VRM humanoid parent relations',
  'vrm.node-tree': 'One parent per node, no cycle, distinct scene 0 roots, no duplicate skin joints',
  'vrm.trs-only': 'TRS nodes only (no matrix)',
  'vrm.unit-rotation': 'Node rotations are unit quaternions (1e-4)',
  'vrm.translation-range': 'Node translations within ±1e6',
  'vrm.uniform-scale': 'Positive uniform node scales in 1e-6..1e6',
  'vrm.extensions-required': 'extensionsRequired ⊆ {KHR_materials_unlit, KHR_texture_transform}',
  'vrm.bones-skinned': 'Every mapped bone is a skin joint of a mesh node under scene 0',
  'vrm.meta-required': 'VRM 1.0 meta with a name and at least one author',
  'vrm.licence-unset': 'VRM 1.0 meta with a licence (licenseUrl)',
  'vrm.thumbnail-square': 'VRM 1.0 meta thumbnail present and square',
};

/** Rule rows for `LINT_RULES` (§4.4 `VRM_LINT_RULES`). */
export const VRM_LINT_RULES: readonly LintRuleDef[] = Object.freeze([
  ...VRM_RUNTIME_RULE_IDS.map(
    (id): LintRuleDef => ({ id, local: 'warning', ekza: null, description: DESCRIPTIONS[id] }),
  ),
  ...VRM_META_RULE_IDS.map((id): LintRuleDef => ({ id, local: null, ekza: null, description: DESCRIPTIONS[id] })),
]);

/** The Space profile's severity overrides for the `vrm.*` rows (§0.4.6: errors; the thumbnail a warning). */
export const SPACE_VRM_RULES: readonly { readonly id: string; readonly severity: LintSeverity }[] = [
  ...VRM_RUNTIME_RULE_IDS.map((id) => ({ id, severity: 'error' as const })),
  { id: 'vrm.meta-required', severity: 'error' },
  { id: 'vrm.licence-unset', severity: 'error' },
  { id: 'vrm.thumbnail-square', severity: 'warning' },
];

const VRM_CODES = new Set<string>([...VRM_RUNTIME_RULE_IDS, ...VRM_META_RULE_IDS]);

/** Whether a lint code is one of the `vrm.*` rows. */
export function isVrmLintCode(code: string): boolean {
  return VRM_CODES.has(code);
}

/** Whether a profile asks for the `vrm.*` rows even on a file without VRM extensions (an Ekza profile that lists them:
 *  the Space profile). `local/generic` lists them as warnings for VRM files only. */
export function profileWantsVrm(profile: ExportProfileDef | null): boolean {
  return profile?.ekza === true && profile.rules.some((rule) => rule.id === 'vrm.spec-version');
}

type Emit = (code: VrmLintCode, message: string, at?: string) => void;

export type VrmVersion = 'vrm0' | 'vrm1';

/** The parts of a VRM file the runtime rules saw (null fields: not reached). */
export interface VrmRuntimeReport {
  readonly version: VrmVersion | null;
  readonly nodes: number;
  readonly bones: ReadonlyMap<string, number>;
  readonly sceneRoots: readonly number[];
}

/**
 * OMOBA's runtime checks over GLB bytes (`HumanoidRig::from_glb`), every rule reported. Returns what the checks read,
 * for tests and the read-back; null when the container cannot be read at all.
 */
export function checkVrmRuntime(bytes: Uint8Array, emit: Emit): VrmRuntimeReport | null {
  const capped = capPerRule(emit);
  const document = checkContainer(bytes, capped);
  if (document === null) return null;
  return checkDocument(document, capped);
}

/** The VRM 1.0 meta rows (§5.21) over the parsed JSON and the BIN chunk (for the thumbnail's PNG header). */
export function checkVrmMeta(json: JsonRecord, bin: Uint8Array | null, emit: Emit): void {
  const extensions = isRecord(json['extensions']) ? json['extensions'] : {};
  const vrmc = extensions['VRMC_vrm'];
  if (!isRecord(vrmc) || isRecord(extensions['VRM'])) return; // VRM 0.x (or no / both VRM): not this rule's case
  const meta = vrmc['meta'];
  const at = '/extensions/VRMC_vrm/meta';
  if (!isRecord(meta)) {
    emit('vrm.meta-required', 'VRMC_vrm has no meta: set the VRM meta (name and authors)', at);
    emit('vrm.licence-unset', 'VRMC_vrm has no meta: choose a licence', at);
    emit('vrm.thumbnail-square', 'The VRM has no thumbnail: render one', at);
    return;
  }
  const name = typeof meta['name'] === 'string' ? meta['name'].trim() : '';
  const authors = Array.isArray(meta['authors'])
    ? (meta['authors'] as unknown[]).filter((a) => typeof a === 'string' && a.trim() !== '')
    : [];
  if (name === '') emit('vrm.meta-required', 'The VRM meta has no name', `${at}/name`);
  if (authors.length === 0) emit('vrm.meta-required', 'The VRM meta needs at least one author', `${at}/authors`);
  if (typeof meta['licenseUrl'] !== 'string' || meta['licenseUrl'].trim() === '') {
    emit('vrm.licence-unset', 'The VRM meta has no licenseUrl: choose a licence', `${at}/licenseUrl`);
  }
  const image = meta['thumbnailImage'];
  if (!isIndex(image)) {
    emit('vrm.thumbnail-square', 'The VRM has no thumbnail: render one', `${at}/thumbnailImage`);
    return;
  }
  const size = imageSize(json, bin, image);
  if (size === null) {
    emit('vrm.thumbnail-square', `The thumbnail (images[${image}]) cannot be read as a PNG`, `/images/${image}`);
  } else if (size.width !== size.height) {
    emit(
      'vrm.thumbnail-square',
      `The thumbnail is ${size.width} × ${size.height}; it must be square`,
      `/images/${image}`,
    );
  }
}

/** All `vrm.*` findings of a file with the severities of `profile` (tests, the e2e fixtures, the Export dialog). */
export function lintVrmBytes(
  bytes: Uint8Array,
  severityOf: (code: string) => LintSeverity | null,
): readonly LintIssue[] {
  const issues: LintIssue[] = [];
  const emit: Emit = (code, message, at) => {
    const severity = severityOf(code);
    if (severity === null) return;
    issues.push({ code, severity, message, ...(at === undefined ? {} : { pointer: at }) });
  };
  checkVrmRuntime(bytes, emit);
  const parsed = readContainer(bytes);
  if (parsed !== null && isRecord(parsed.json)) checkVrmMeta(parsed.json, parsed.bin, emit);
  return issues;
}

// ---------------------------------------------------------------------------------------------------------------
// The container (OMOBA `from_glb`)

function capPerRule(emit: Emit): Emit {
  const counts = new Map<string, number>();
  return (code, message, at) => {
    const n = counts.get(code) ?? 0;
    if (n >= MAX_PER_RULE) return;
    counts.set(code, n + 1);
    emit(code, message, at);
  };
}

const u32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] as number) |
    ((bytes[offset + 1] as number) << 8) |
    ((bytes[offset + 2] as number) << 16) |
    ((bytes[offset + 3] as number) << 24)) >>>
  0;

/** The JSON value and BIN chunk of a GLB, leniently (null when there is no readable JSON chunk). */
function readContainer(bytes: Uint8Array): { readonly json: unknown; readonly bin: Uint8Array | null } | null {
  if (bytes.byteLength < 20 || u32(bytes, 0) !== 0x46546c67) return null;
  let offset = 12;
  let json: unknown = undefined;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const length = u32(bytes, offset);
    const type = u32(bytes, offset + 4);
    const start = offset + 8;
    if (start + length > bytes.byteLength) break;
    if (type === CHUNK_JSON && json === undefined) {
      try {
        json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length)));
      } catch {
        return null;
      }
    } else if (type === CHUNK_BIN && bin === null) {
      bin = bytes.subarray(start, start + length);
    }
    offset = start + length;
  }
  return json === undefined ? null : { json, bin };
}

function checkContainer(bytes: Uint8Array, emit: Emit): JsonRecord | null {
  if (bytes.byteLength < 20 || bytes.byteLength > VRM_MAX_GLB_BYTES) {
    emit('vrm.glb-size', `VRM GLB must be between 20 bytes and 50 MiB (it is ${bytes.byteLength} bytes)`);
    if (bytes.byteLength < 20) return null;
  }
  if (u32(bytes, 0) !== 0x46546c67 || u32(bytes, 4) !== 2 || u32(bytes, 8) !== bytes.byteLength) {
    emit('vrm.container', 'VRM must have an exact-length glTF 2.0 binary container');
    if (u32(bytes, 0) !== 0x46546c67) return null;
  }
  let offset = 12;
  let document: unknown = undefined;
  let binaryLength: number | null = null;
  let broken = false;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 8) {
      emit('vrm.container', 'VRM GLB contains a truncated chunk header');
      broken = true;
      break;
    }
    const length = u32(bytes, offset);
    const kind = u32(bytes, offset + 4);
    offset += 8;
    if (length % 4 !== 0 || length > bytes.byteLength - offset) {
      emit('vrm.container', 'VRM GLB contains an invalid chunk length');
      broken = true;
      break;
    }
    if (kind === CHUNK_JSON && document === undefined && binaryLength === null) {
      if (length > VRM_MAX_JSON_BYTES) emit('vrm.json-size', 'VRM JSON exceeds the 4 MiB runtime limit');
      try {
        document = JSON.parse(new TextDecoder().decode(bytes.subarray(offset, offset + length)));
      } catch {
        emit('vrm.container', 'VRM GLB contains invalid JSON');
        return null;
      }
    } else if (kind === CHUNK_BIN && document !== undefined && binaryLength === null) {
      binaryLength = length;
    } else {
      emit('vrm.container', 'VRM GLB requires one JSON chunk followed by at most one BIN chunk');
      broken = true;
      break;
    }
    offset += length;
  }
  if (document === undefined) {
    if (!broken) emit('vrm.container', 'VRM GLB has no JSON chunk');
    return null;
  }
  if (!isRecord(document)) {
    emit('vrm.container', 'VRM GLB contains invalid JSON');
    return null;
  }
  const buffers = document['buffers'];
  if (!Array.isArray(buffers)) {
    emit('vrm.container', 'VRM GLB has no embedded buffer', '/buffers');
  } else if (buffers.length !== 1) {
    emit('vrm.container', 'VRM GLB must contain exactly one embedded buffer', '/buffers');
  } else {
    const declared = isRecord(buffers[0]) ? buffers[0]['byteLength'] : undefined;
    if (!isIndex(declared)) {
      emit('vrm.container', 'VRM buffer has no valid byteLength', '/buffers/0/byteLength');
    } else if (binaryLength === null) {
      if (!broken) emit('vrm.container', 'VRM GLB has no BIN chunk');
    } else if (declared > binaryLength || binaryLength - declared > 3) {
      emit('vrm.container', 'VRM embedded buffer length does not match its BIN chunk', '/buffers/0/byteLength');
    }
  }
  return document;
}

// ---------------------------------------------------------------------------------------------------------------
// The document (OMOBA `from_document`)

function checkDocument(document: JsonRecord, emit: Emit): VrmRuntimeReport {
  const asset = document['asset'];
  if (!isRecord(asset) || asset['version'] !== '2.0') {
    emit('vrm.spec-version', 'Humanoid runtime requires glTF 2.0', '/asset/version');
  }
  checkRequiredExtensions(document, emit);
  for (const field of ['buffers', 'images']) {
    const entries = document[field];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) {
      emit('vrm.container', `VRM ${field} must be an array`, `/${field}`);
      continue;
    }
    entries.forEach((entry, i) => {
      if (isRecord(entry) && entry['uri'] !== undefined) {
        emit(
          'vrm.container',
          `VRM ${field} must be embedded; external/data URIs are unsupported`,
          `/${field}/${i}/uri`,
        );
      }
    });
  }

  const rawNodes = Array.isArray(document['nodes']) ? (document['nodes'] as unknown[]) : null;
  if (rawNodes === null) emit('vrm.node-count', 'VRM has no skeleton nodes', '/nodes');
  else if (rawNodes.length === 0 || rawNodes.length > VRM_MAX_NODES) {
    emit('vrm.node-count', `VRM requires 1..=${VRM_MAX_NODES} nodes (it has ${rawNodes.length})`, '/nodes');
  }
  const nodes = rawNodes ?? [];
  const count = nodes.length;
  const children: number[][] = nodes.map(() => []);
  const parents: (number | null)[] = nodes.map(() => null);
  const scales: number[] = nodes.map(() => 1);
  nodes.forEach((node, index) => {
    const at = `/nodes/${index}`;
    if (!isRecord(node)) {
      emit('vrm.node-tree', `VRM node ${index} must be an object`, at);
      return;
    }
    if (node['matrix'] !== undefined) {
      emit('vrm.trs-only', `VRM node ${index} uses a matrix; export explicit TRS transforms`, `${at}/matrix`);
    }
    const translation = vector(node, 'translation', [0, 0, 0], index, 'vrm.translation-range', emit);
    if (translation !== null && translation.some((v) => Math.abs(v) > 1_000_000)) {
      emit('vrm.translation-range', `VRM node ${index} translation exceeds the supported range`, `${at}/translation`);
    }
    const rotation = vector(node, 'rotation', [0, 0, 0, 1], index, 'vrm.unit-rotation', emit);
    if (rotation !== null) {
      const length = Math.sqrt(rotation.reduce((sum, v) => sum + v * v, 0));
      if (length < 1e-8) {
        emit('vrm.unit-rotation', `VRM node ${index} has a zero rotation quaternion`, `${at}/rotation`);
      } else if (Math.abs(length - 1) > 1e-4) {
        emit(
          'vrm.unit-rotation',
          `VRM node ${index} requires a unit rotation quaternion; normalize the source model before importing`,
          `${at}/rotation`,
        );
      }
    }
    const scale = vector(node, 'scale', [1, 1, 1], index, 'vrm.uniform-scale', emit);
    if (scale !== null) {
      const s0 = scale[0] as number;
      if (scale.some((v) => !(v >= 1e-6 && v <= 1e6)) || scale.some((v) => Math.abs(v - s0) > s0 * 1e-5)) {
        emit(
          'vrm.uniform-scale',
          `VRM node ${index} requires positive uniform scale in 0.000001..=1000000`,
          `${at}/scale`,
        );
      } else {
        scales[index] = s0;
      }
    }
    const rawChildren = node['children'];
    if (rawChildren === undefined) return;
    if (!Array.isArray(rawChildren)) {
      emit('vrm.node-tree', `VRM node ${index} children must be an array`, `${at}/children`);
      return;
    }
    if (rawChildren.length > count) emit('vrm.node-tree', `VRM node ${index} has too many children`, `${at}/children`);
    for (const raw of rawChildren) {
      const child = nodeIndex(raw, count);
      if (child === null) {
        emit('vrm.node-tree', 'VRM child index is missing or out of range', `${at}/children`);
        continue;
      }
      if (parents[child] !== null) {
        emit('vrm.node-tree', `VRM node ${child} has multiple parents or duplicate child references`, `${at}/children`);
        continue;
      }
      parents[child] = index;
      (children[index] as number[]).push(child);
    }
  });

  // Topological order from the parentless nodes; accumulated scale; cycles.
  const queue: number[] = [];
  parents.forEach((parent, i) => {
    if (parent === null) queue.push(i);
  });
  const world = new Float64Array(count).fill(1);
  let visited = 0;
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head] as number;
    visited++;
    const parent = parents[node];
    world[node] = (parent === null || parent === undefined ? 1 : (world[parent] as number)) * (scales[node] as number);
    const w = world[node];
    if (!(w >= 1e-12 && w <= 1e12)) {
      emit('vrm.uniform-scale', `VRM node ${node} accumulated scale exceeds the supported range`, `/nodes/${node}`);
    }
    queue.push(...(children[node] as number[]));
  }
  if (visited !== count) emit('vrm.node-tree', 'VRM node hierarchy contains a cycle', '/nodes');

  // Scene 0 roots and what they reach.
  const scenes = Array.isArray(document['scenes']) ? (document['scenes'] as unknown[]) : [];
  const scene0 = scenes[0];
  const rawRoots = isRecord(scene0) && Array.isArray(scene0['nodes']) ? (scene0['nodes'] as unknown[]) : null;
  const sceneRoots: number[] = [];
  const reachable = new Set<number>();
  if (rawRoots === null) {
    emit('vrm.node-tree', 'VRM scene 0 has no root nodes', '/scenes/0/nodes');
  } else if (rawRoots.length === 0 || rawRoots.length > count) {
    emit('vrm.node-tree', 'VRM scene 0 has an invalid root count', '/scenes/0/nodes');
  } else {
    for (const raw of rawRoots) {
      const root = nodeIndex(raw, count);
      if (root === null) {
        emit('vrm.node-tree', 'VRM scene root index is missing or out of range', '/scenes/0/nodes');
        continue;
      }
      if (parents[root] !== null || sceneRoots.includes(root)) {
        emit('vrm.node-tree', 'VRM scene 0 contains duplicate or non-root nodes', '/scenes/0/nodes');
        continue;
      }
      sceneRoots.push(root);
      const stack = [root];
      while (stack.length > 0) {
        const node = stack.pop() as number;
        if (reachable.has(node)) continue;
        reachable.add(node);
        stack.push(...(children[node] as number[]));
      }
    }
  }

  const parsed = parseBones(document, count, emit);
  const version = parsed?.version ?? null;
  const bones = parsed?.bones ?? new Map<string, number>();
  if (version !== null) {
    for (const bone of requiredBones(version)) {
      if (!bones.has(bone)) {
        emit(
          'vrm.required-bones',
          `VRM humanoid map is missing required bone ${bone}`,
          version === 'vrm1' ? '/extensions/VRMC_vrm/humanoid/humanBones' : '/extensions/VRM/humanoid/humanBones',
        );
      }
    }
  }

  checkSkins(document, nodes, count, reachable, bones, emit);
  if (version !== null) checkHierarchy(bones, parents, version, emit);
  return { version, nodes: count, bones, sceneRoots };
}

function checkRequiredExtensions(document: JsonRecord, emit: Emit): void {
  const required = document['extensionsRequired'];
  if (required === undefined) return;
  if (!Array.isArray(required)) {
    emit(
      'vrm.extensions-required',
      'VRM extensionsRequired must be an array of extension names',
      '/extensionsRequired',
    );
    return;
  }
  for (const extension of required) {
    if (typeof extension !== 'string') {
      emit('vrm.extensions-required', 'VRM extensionsRequired must contain extension names', '/extensionsRequired');
    } else if (!ALLOWED_REQUIRED.has(extension)) {
      emit(
        'vrm.extensions-required',
        `Required extension ${extension} is unsupported by the current renderer; use a compatible export or a renderer adapter that implements this extension`,
        '/extensionsRequired',
      );
    }
  }
}

/** OMOBA `vector`: a missing field reads as the default; a malformed one is the field's rule. */
function vector(
  node: JsonRecord,
  field: string,
  fallback: readonly number[],
  index: number,
  rule: VrmLintCode,
  emit: Emit,
): number[] | null {
  const value = node[field];
  if (value === undefined) return [...fallback];
  const at = `/nodes/${index}/${field}`;
  if (!Array.isArray(value) || value.length !== fallback.length) {
    emit(rule, `VRM node ${index} ${field} requires ${fallback.length} components`, at);
    return null;
  }
  const out: number[] = [];
  for (const v of value as unknown[]) {
    if (typeof v !== 'number') {
      emit(rule, `VRM node ${index} ${field} must be numeric`, at);
      return null;
    }
    const f = Math.fround(v);
    if (!Number.isFinite(f)) {
      emit(rule, `VRM node ${index} ${field} must be finite`, at);
      return null;
    }
    out.push(f);
  }
  return out;
}

function nodeIndex(value: unknown, count: number): number | null {
  return isIndex(value) && value < count ? value : null;
}

const REQUIRED_BONES = [
  'hips',
  'spine',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
] as const;

/** OMOBA `required_bones`: 15, and VRM 0 adds chest and neck. */
export function requiredBones(version: VrmVersion): readonly string[] {
  return version === 'vrm0' ? [...REQUIRED_BONES, 'chest', 'neck'] : REQUIRED_BONES;
}

function parseBones(
  document: JsonRecord,
  count: number,
  emit: Emit,
): { readonly version: VrmVersion; readonly bones: Map<string, number> } | null {
  const extensions = isRecord(document['extensions']) ? document['extensions'] : {};
  const vrm0 = extensions['VRM'];
  const vrm1 = extensions['VRMC_vrm'];
  let version: VrmVersion;
  let raw: [string | null, unknown][];
  let base: string;
  if (vrm0 !== undefined && vrm1 === undefined) {
    version = 'vrm0';
    base = '/extensions/VRM';
    const spec = isRecord(vrm0) ? vrm0['specVersion'] : undefined;
    if (typeof spec !== 'string' || !spec.startsWith('0.')) {
      emit('vrm.spec-version', 'Unsupported VRM 0.x specVersion', `${base}/specVersion`);
      return null;
    }
    const humanoid = isRecord(vrm0) ? vrm0['humanoid'] : undefined;
    const list = isRecord(humanoid) ? humanoid['humanBones'] : undefined;
    if (!Array.isArray(list)) {
      emit('vrm.bone-names', 'VRM0 humanBones must be an array', `${base}/humanoid/humanBones`);
      return null;
    }
    if (list.length > VRM_MAX_HUMANOID_BONES) {
      emit('vrm.humanoid-bone-count', 'VRM humanoid map exceeds 64 bones', `${base}/humanoid/humanBones`);
      return null;
    }
    raw = (list as unknown[]).map((bone) => [
      isRecord(bone) && typeof bone['bone'] === 'string' ? bone['bone'] : null,
      isRecord(bone) ? bone['node'] : undefined,
    ]);
  } else if (vrm0 === undefined && vrm1 !== undefined) {
    version = 'vrm1';
    base = '/extensions/VRMC_vrm';
    const spec = isRecord(vrm1) ? vrm1['specVersion'] : undefined;
    if (spec !== '1.0') {
      emit('vrm.spec-version', 'Unsupported VRM1 specVersion; expected 1.0', `${base}/specVersion`);
      return null;
    }
    const humanoid = isRecord(vrm1) ? vrm1['humanoid'] : undefined;
    const map = isRecord(humanoid) ? humanoid['humanBones'] : undefined;
    if (!isRecord(map)) {
      emit('vrm.bone-names', 'VRM1 humanBones must be an object', `${base}/humanoid/humanBones`);
      return null;
    }
    const entries = Object.entries(map);
    if (entries.length > VRM_MAX_HUMANOID_BONES) {
      emit('vrm.humanoid-bone-count', 'VRM humanoid map exceeds 64 bones', `${base}/humanoid/humanBones`);
      return null;
    }
    raw = entries.map(([name, value]) => [name, isRecord(value) ? value['node'] : undefined]);
  } else if (vrm0 === undefined) {
    emit('vrm.spec-version', 'Model has no VRM0 or VRM1 humanoid metadata', '/extensions');
    return null;
  } else {
    emit('vrm.spec-version', 'Model declares conflicting VRM0 and VRM1 extensions', '/extensions');
    return null;
  }
  const bones = new Map<string, number>();
  const nodes = new Set<number>();
  const at = `${base}/humanoid/humanBones`;
  for (const [name, rawIndex] of raw) {
    if (name === null) {
      emit('vrm.bone-names', 'VRM0 bone has no semantic name', at);
      continue;
    }
    if (semanticParent(name, version) === null && name !== 'hips') {
      emit('vrm.bone-names', `Unsupported humanoid bone ${name}`, at);
      continue;
    }
    const index = nodeIndex(rawIndex, count);
    if (index === null) {
      emit('vrm.bone-names', 'VRM humanoid bone index is missing or out of range', at);
      continue;
    }
    if (bones.has(name) || nodes.has(index)) {
      emit('vrm.bone-names', `VRM humanoid assignment ${name} is duplicated`, at);
      continue;
    }
    bones.set(name, index);
    nodes.add(index);
  }
  return { version, bones };
}

/** OMOBA `semantic_parent` (null for an unsupported name and for hips). */
export function semanticParent(bone: string, version: VrmVersion): string | null {
  switch (bone) {
    case 'spine':
      return 'hips';
    case 'chest':
      return 'spine';
    case 'upperChest':
      return 'chest';
    case 'neck':
      return 'upperChest';
    case 'head':
      return 'neck';
    case 'leftEye':
    case 'rightEye':
    case 'jaw':
      return 'head';
    default:
      break;
  }
  const side = bone.startsWith('left') ? 'left' : bone.startsWith('right') ? 'right' : null;
  if (side === null) return null;
  const part = bone.slice(side.length);
  switch (part) {
    case 'Shoulder':
      return 'upperChest';
    case 'UpperArm':
      return `${side}Shoulder`;
    case 'LowerArm':
      return `${side}UpperArm`;
    case 'Hand':
      return `${side}LowerArm`;
    case 'UpperLeg':
      return 'hips';
    case 'LowerLeg':
      return `${side}UpperLeg`;
    case 'Foot':
      return `${side}LowerLeg`;
    case 'Toes':
      return `${side}Foot`;
    default:
      break;
  }
  for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
    if (!part.startsWith(finger)) continue;
    const segment = part.slice(finger.length);
    if (finger === 'Thumb' && version === 'vrm1') {
      if (segment === 'Metacarpal') return `${side}Hand`;
      if (segment === 'Proximal') return `${side}ThumbMetacarpal`;
      if (segment === 'Distal') return `${side}ThumbProximal`;
      return null;
    }
    if (segment === 'Proximal') return `${side}Hand`;
    if (segment === 'Intermediate') return `${side}${finger}Proximal`;
    if (segment === 'Distal') return `${side}${finger}Intermediate`;
    return null;
  }
  return null;
}

function checkSkins(
  document: JsonRecord,
  nodes: readonly unknown[],
  count: number,
  reachable: ReadonlySet<number>,
  bones: ReadonlyMap<string, number>,
  emit: Emit,
): void {
  const skins = Array.isArray(document['skins']) ? (document['skins'] as unknown[]) : [];
  if (skins.length === 0) {
    emit('vrm.bones-skinned', 'VRM runtime requires a skinned humanoid mesh', '/skins');
    return;
  }
  if (skins.length > count) emit('vrm.node-tree', 'VRM has too many skins', '/skins');
  const skinJoints: Set<number>[] = skins.map((skin, index) => {
    const joints = new Set<number>();
    const raw = isRecord(skin) && Array.isArray(skin['joints']) ? (skin['joints'] as unknown[]) : [];
    if (raw.length === 0) {
      emit('vrm.bones-skinned', `VRM skin ${index} has no joints`, `/skins/${index}/joints`);
      return joints;
    }
    if (raw.length > count) emit('vrm.node-tree', `VRM skin ${index} has too many joints`, `/skins/${index}/joints`);
    for (const value of raw) {
      const joint = nodeIndex(value, count);
      if (joint === null) {
        emit('vrm.node-tree', 'VRM skin joint index is missing or out of range', `/skins/${index}/joints`);
      } else if (joints.has(joint)) {
        emit('vrm.node-tree', `VRM skin ${index} contains duplicate joints`, `/skins/${index}/joints`);
      } else {
        joints.add(joint);
      }
    }
    return joints;
  });
  const meshCount = Array.isArray(document['meshes']) ? (document['meshes'] as unknown[]).length : 0;
  const bound = new Set<number>();
  for (const index of [...reachable].sort((a, b) => a - b)) {
    const node = nodes[index];
    if (!isRecord(node) || node['skin'] === undefined) continue;
    const skin = nodeIndex(node['skin'], skins.length);
    if (skin === null) {
      emit('vrm.bones-skinned', 'VRM skin index is missing or out of range', `/nodes/${index}/skin`);
      continue;
    }
    if (nodeIndex(node['mesh'], meshCount) === null) {
      emit('vrm.bones-skinned', 'VRM skinned mesh index is missing or out of range', `/nodes/${index}/mesh`);
      continue;
    }
    for (const joint of skinJoints[skin] as Set<number>) bound.add(joint);
  }
  for (const [bone, node] of bones) {
    if (!reachable.has(node)) {
      emit('vrm.bones-skinned', `VRM bone ${bone} is not instantiated in scene 0`, `/nodes/${node}`);
    } else if (!bound.has(node)) {
      emit(
        'vrm.bones-skinned',
        `VRM bone ${bone} is not a skin joint in scene 0; unweighted humanoid nodes are unsupported`,
        `/nodes/${node}`,
      );
    }
  }
}

function checkHierarchy(
  bones: ReadonlyMap<string, number>,
  parents: readonly (number | null)[],
  version: VrmVersion,
  emit: Emit,
): void {
  const reverse = new Map<number, string>();
  for (const [name, index] of bones) reverse.set(index, name);
  for (const [bone, index] of [...bones].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    let expected = semanticParent(bone, version);
    while (expected !== null && !bones.has(expected)) expected = semanticParent(expected, version);
    let ancestor = parents[index] ?? null;
    const seen = new Set<number>();
    while (ancestor !== null && !reverse.has(ancestor) && !seen.has(ancestor)) {
      seen.add(ancestor);
      ancestor = parents[ancestor] ?? null;
    }
    const actual = ancestor === null ? null : (reverse.get(ancestor) ?? null);
    if (actual !== expected) {
      emit(
        'vrm.parent-map',
        `VRM bone ${bone} has incompatible parent ${actual === null ? 'None' : `Some("${actual}")`}; expected ${
          expected === null ? 'None' : `Some("${expected}")`
        }`,
        `/nodes/${index}`,
      );
    }
    if (bone === 'upperChest' && !bones.has('chest')) {
      emit('vrm.parent-map', 'VRM upperChest requires chest', `/nodes/${index}`);
    }
    const segment =
      bone.endsWith('Intermediate') ||
      bone.endsWith('Distal') ||
      (version === 'vrm1' && bone.endsWith('ThumbProximal'));
    const before = semanticParent(bone, version);
    if (segment && before !== null && !bones.has(before)) {
      emit('vrm.parent-map', `VRM finger bone ${bone} requires its preceding segment`, `/nodes/${index}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Thumbnail size (PNG IHDR; JPEG SOF)

function imageSize(
  json: JsonRecord,
  bin: Uint8Array | null,
  image: number,
): { readonly width: number; readonly height: number } | null {
  const images = Array.isArray(json['images']) ? (json['images'] as unknown[]) : [];
  const views = Array.isArray(json['bufferViews']) ? (json['bufferViews'] as unknown[]) : [];
  const def = images[image];
  if (!isRecord(def) || bin === null) return null;
  const view = isIndex(def['bufferView']) ? views[def['bufferView']] : undefined;
  if (!isRecord(view) || !isIndex(view['byteLength'])) return null;
  const offset = isIndex(view['byteOffset']) ? view['byteOffset'] : 0;
  const bytes = bin.subarray(offset, offset + view['byteLength']);
  return pngSize(bytes) ?? jpegSize(bytes);
}

/** Width and height from a PNG's IHDR, or null for anything else. */
export function pngSize(bytes: Uint8Array): { readonly width: number; readonly height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
  const be = (o: number) =>
    (((bytes[o] as number) << 24) |
      ((bytes[o + 1] as number) << 16) |
      ((bytes[o + 2] as number) << 8) |
      (bytes[o + 3] as number)) >>>
    0;
  return { width: be(16), height: be(20) };
}

function jpegSize(bytes: Uint8Array): { readonly width: number; readonly height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < bytes.byteLength) {
    if (bytes[o] !== 0xff) return null;
    const marker = bytes[o + 1] as number;
    const length = ((bytes[o + 2] as number) << 8) | (bytes[o + 3] as number);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: ((bytes[o + 5] as number) << 8) | (bytes[o + 6] as number),
        width: ((bytes[o + 7] as number) << 8) | (bytes[o + 8] as number),
      };
    }
    o += 2 + length;
  }
  return null;
}
