// Fixtures of the `vrm.*` lint tests (M6B-SPEC §0.4.6; C10): a minimal VRM that OMOBA's runtime admits (VRM 1.0 or
// 0.x), built from a bone list, and one mutation per rule. Every fixture is built in memory (no files).
import { assembleGlb } from '../../src/glb/write';
import { ruleSeverity } from '../../src/lint/rules';
import { lintVrmBytes } from '../../src/lint/vrm';
import { encodePngRgb } from '../../src/png/encode';
import { BUILTIN_EXPORT_PROFILES } from '../../src/profiles/builtin';
import type { ExportProfileDef, LintIssue } from '../../src/types';

export type Json = Record<string, unknown>;

export const SPACE = BUILTIN_EXPORT_PROFILES.find((p) => p.id === 'ekza/space-avatar-v1') as ExportProfileDef;
export const LOCAL = BUILTIN_EXPORT_PROFILES.find((p) => p.id === 'local/generic') as ExportProfileDef;
export const OMOBA_GLB = BUILTIN_EXPORT_PROFILES.find((p) => p.id === 'ekza/omoba-humanoid-v1') as ExportProfileDef;

/** [bone, parent bone] in parent-first order: the 15 required bones (VRM 1.0). */
export const BONES_V1: readonly (readonly [string, string | null])[] = [
  ['hips', null],
  ['spine', 'hips'],
  ['head', 'spine'],
  ['leftUpperArm', 'spine'],
  ['leftLowerArm', 'leftUpperArm'],
  ['leftHand', 'leftLowerArm'],
  ['rightUpperArm', 'spine'],
  ['rightLowerArm', 'rightUpperArm'],
  ['rightHand', 'rightLowerArm'],
  ['leftUpperLeg', 'hips'],
  ['leftLowerLeg', 'leftUpperLeg'],
  ['leftFoot', 'leftLowerLeg'],
  ['rightUpperLeg', 'hips'],
  ['rightLowerLeg', 'rightUpperLeg'],
  ['rightFoot', 'rightLowerLeg'],
];

/** VRM 0.x also requires chest and neck. */
export const BONES_V0: readonly (readonly [string, string | null])[] = [
  ['hips', null],
  ['spine', 'hips'],
  ['chest', 'spine'],
  ['neck', 'chest'],
  ['head', 'neck'],
  ['leftUpperArm', 'chest'],
  ['leftLowerArm', 'leftUpperArm'],
  ['leftHand', 'leftLowerArm'],
  ['rightUpperArm', 'chest'],
  ['rightLowerArm', 'rightUpperArm'],
  ['rightHand', 'rightLowerArm'],
  ['leftUpperLeg', 'hips'],
  ['leftLowerLeg', 'leftUpperLeg'],
  ['leftFoot', 'leftLowerLeg'],
  ['rightUpperLeg', 'hips'],
  ['rightLowerLeg', 'rightUpperLeg'],
  ['rightFoot', 'rightLowerLeg'],
];

export interface VrmSpec {
  readonly version?: 'vrm0' | 'vrm1';
  readonly bones?: readonly (readonly [string, string | null])[];
  /** Bone names written to the humanoid map (default: every bone). */
  readonly mapped?: readonly string[];
  readonly meta?: Json | null;
  readonly thumbnail?: { readonly width: number; readonly height: number } | null;
}

/** A square 8 × 8 PNG (or any size). */
export function png(width = 8, height = 8): Uint8Array {
  return encodePngRgb(width, height, new Uint8Array(width * height * 3).fill(128));
}

export const VALID_META: Json = {
  name: 'Lad',
  authors: ['Tester'],
  licenseUrl: 'https://vrm.dev/licenses/1.0/',
};

/** A VRM document: one node per bone (TRS, unit rotation), a skinned mesh node with every bone as a joint. */
export function vrmDocument(spec: VrmSpec = {}): { json: Json; bin: Uint8Array } {
  const version = spec.version ?? 'vrm1';
  const bones = spec.bones ?? (version === 'vrm0' ? BONES_V0 : BONES_V1);
  const index = new Map(bones.map(([bone], i) => [bone, i]));
  const nodes: Json[] = bones.map(([bone]) => ({ name: bone, translation: [0, 0.1, 0], rotation: [0, 0, 0, 1] }));
  bones.forEach(([, parent], i) => {
    if (parent === null) return;
    const p = nodes[index.get(parent) as number] as Json;
    p['children'] = [...((p['children'] as number[] | undefined) ?? []), i];
  });
  const mesh = nodes.length;
  nodes.push({ name: 'body', mesh: 0, skin: 0 });
  // Binary: three positions (36 bytes) then the optional thumbnail PNG.
  const positions = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const thumb = spec.thumbnail === null ? null : png(spec.thumbnail?.width ?? 8, spec.thumbnail?.height ?? 8);
  const pad = (n: number) => (n + 3) & ~3;
  const binLength = pad(positions.length) + (thumb === null ? 0 : pad(thumb.length));
  const bin = new Uint8Array(binLength);
  bin.set(positions, 0);
  const bufferViews: Json[] = [{ buffer: 0, byteOffset: 0, byteLength: positions.length }];
  const json: Json = {
    asset: { version: '2.0', generator: 'vrm lint fixture' },
    scene: 0,
    scenes: [{ nodes: [0, mesh] }],
    nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    skins: [{ joints: bones.map((_, i) => i) }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };
  if (thumb !== null) {
    bin.set(thumb, pad(positions.length));
    bufferViews.push({ buffer: 0, byteOffset: pad(positions.length), byteLength: thumb.length });
    json['images'] = [{ bufferView: 1, mimeType: 'image/png' }];
  }
  const mapped = spec.mapped ?? bones.map(([bone]) => bone);
  if (version === 'vrm1') {
    const humanBones: Json = {};
    for (const bone of mapped) humanBones[bone] = { node: index.get(bone) };
    const meta =
      spec.meta === null
        ? undefined
        : { ...VALID_META, ...(thumb === null ? {} : { thumbnailImage: 0 }), ...spec.meta };
    json['extensionsUsed'] = ['VRMC_vrm'];
    json['extensions'] = {
      VRMC_vrm: { specVersion: '1.0', humanoid: { humanBones }, ...(meta === undefined ? {} : { meta }) },
    };
  } else {
    json['extensionsUsed'] = ['VRM'];
    json['extensions'] = {
      VRM: {
        specVersion: '0.0',
        meta: { title: 'Lad', author: 'Tester' },
        humanoid: { humanBones: mapped.map((bone) => ({ bone, node: index.get(bone) })) },
      },
    };
  }
  return { json, bin };
}

/** GLB bytes of a document. */
export function glb(doc: { json: Json; bin: Uint8Array | null }): Uint8Array {
  return assembleGlb(JSON.stringify(doc.json), doc.bin === null ? null : [doc.bin]);
}

/** A VRM's bytes after `mutate` edits its JSON. */
export function mutated(mutate: (json: Json) => void, spec: VrmSpec = {}): Uint8Array {
  const doc = vrmDocument(spec);
  mutate(doc.json);
  return glb(doc);
}

/** The `vrm.*` issues of bytes for a profile. */
export function vrmIssues(bytes: Uint8Array, profile: ExportProfileDef | null = SPACE): readonly LintIssue[] {
  return lintVrmBytes(bytes, (code) => ruleSeverity(code, profile));
}

export const codesOf = (issues: readonly LintIssue[]): string[] => [...new Set(issues.map((i) => i.code))].sort();

/** Node index of a bone in the default VRM 1.0 fixture. */
export function nodeOf(bone: string, bones: readonly (readonly [string, string | null])[] = BONES_V1): number {
  return bones.findIndex(([name]) => name === bone);
}

/** Hand-assembled GLB chunks (for container fixtures the assembler cannot produce). */
export function rawGlb(chunks: readonly { readonly type: 'JSON' | 'BIN'; readonly data: Uint8Array }[]): Uint8Array {
  const total = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.data.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  let offset = 12;
  for (const chunk of chunks) {
    dv.setUint32(offset, chunk.data.length, true);
    dv.setUint32(offset + 4, chunk.type === 'JSON' ? 0x4e4f534a : 0x004e4942, true);
    out.set(chunk.data, offset + 8);
    offset += 8 + chunk.data.length;
  }
  return out;
}

/** JSON text padded with spaces to a multiple of 4 bytes. */
export function jsonChunk(json: Json): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  return new TextEncoder().encode(text);
}
