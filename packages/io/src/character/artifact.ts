// The character export artifact (M6B-SPEC §5.22, §6.4; C10): write, lint for the profile, read back, hash.
//
// - Lints: the clips' bake warnings, then `lintExport` as a model file ('bake-into-model' rules: skins, humanoid with
//   hips, slot names, provenance, hips-only translation, unit quaternions, `vrm.*` for the profile).
// - Read-back (§5.22 "Validation and read-back"): the written file read by `skeletonFromGltf` equals the export's
//   `skeletonFromDoc` on the joint subset — names, parent names, rest locals within 1e-6, the humanoid map by name,
//   `jointsFingerprint`, radii by joint name within 1e-4 H — its triangle count equals the meshes', and every baked
//   clip reads back within the M1 tolerances (`readBackCheck`). Mesh nodes, their order and names are not compared.
//   `vrmaPlayed` is the e2e route's (`/e2e/character-check`), null here.
import type { DerivedFrom } from '@ekza-studio/doc';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { parseGlbSync } from '../glb/parse';
import { GltfReader } from '../gltf/accessor';
import { isIndex, isRecord, listField, meshesOf } from '../gltf/schema';
import { sha256Hex } from '../hash/sha256';
import { lintExportWithContext } from '../lint/lintExport';
import { jointsFingerprint } from '../skeleton/fromDoc';
import { skeletonFromGltf } from '../skeleton/read';
import type {
  BakedClip,
  CharacterMeshIn,
  CharacterWriteInput,
  EkzaAnimationV1,
  ExportArtifact,
  ExportProfileDef,
  ReadBackReport,
} from '../types';
import { readBackCheckSync } from '../validate/readBack';
import { reductionOf } from '../writers/artifact';
import { assertUniqueNames } from '../writers/write';
import { outputMeta } from '../writers/names';
import { writeCharacter } from './index';

/** `ExportArtifact.kind` of a character export (`lastExport()` reports it, §4.8). */
export const CHARACTER_EXPORT_KIND = 'character';
/** The lint kind a character file is checked as (a model with clips). */
const LINT_KIND = 'bake-into-model';

/** The read-back of a character export (an M1 `ReadBackReport` plus the §5.22 equalities). */
export interface CharacterReadBack extends ReadBackReport {
  readonly kind: 'character';
  /** Joint nodes read back / written. */
  readonly joints: number;
  readonly expectedJoints: number;
  /** Humanoid bones read back, and whether the map equals the document's by name (null: a plain GLB has none). */
  readonly humanoid: number;
  readonly humanoidEqual: boolean | null;
  readonly tris: number;
  readonly expectedTris: number;
  readonly fingerprintEqual: boolean;
  /** Names, parents, rest locals and radii on the joint subset. */
  readonly jointsEqual: boolean;
  /** What differed (empty when ok). */
  readonly problems: readonly string[];
  /** Set by the e2e route that plays a VRMA idle on the file (three-vrm); null in the app. */
  readonly vrmaPlayed: boolean | null;
  /** The file's VRM version as the read-back saw it. */
  readonly vrm: '1.0' | null;
}

export interface CharacterArtifact extends ExportArtifact {
  readonly kind: typeof CHARACTER_EXPORT_KIND;
  readonly readBack: CharacterReadBack;
  readonly format: 'vrm' | 'glb';
}

export interface CharacterArtifactInput {
  readonly write: CharacterWriteInput;
  /** The baked clips the write input's `clips` were made from (same order and names). */
  readonly baked: readonly BakedClip[];
  readonly format: 'vrm' | 'glb';
  readonly fileName: string;
  readonly profile: ExportProfileDef | null;
  readonly generator: string;
  /** The clips' metadata (`ekzaAnimationMeta` of `baked`); the writer's `outputMeta` indexes it. */
  readonly animationMeta: EkzaAnimationV1;
  /** Sources of the character's parts (for the meta's thirdPartyLicenses; the clips' sources are added). */
  readonly derivedFrom?: readonly DerivedFrom[];
}

/** Writes, lints and reads back one character file. */
export async function exportCharacterArtifact(input: CharacterArtifactInput): Promise<CharacterArtifact> {
  assertUniqueNames(input.baked);
  const meta = outputMeta(
    input.animationMeta,
    input.baked.map((clip, index) => ({ clip, index })),
  );
  const bytes = await writeCharacter(input.write, {
    generator: input.generator,
    format: input.format,
    animationMeta: meta,
    derivedFrom: [...(input.derivedFrom ?? []), ...meta.provenance.derivedFrom],
  });
  const lints = [
    ...input.baked.flatMap((clip) => clip.warnings),
    ...(await lintExportWithContext(LINT_KIND, bytes, input.profile, {})),
  ];
  const readBack = readBackCharacter(bytes, input.write.skeleton, input.write.meshes, input.baked);
  const channels = input.baked.reduce((sum, clip) => sum + clip.tracks.length, 0);
  const keys = input.baked.reduce((sum, clip) => sum + clip.tracks.reduce((n, track) => n + track.times.length, 0), 0);
  const reduction = reductionOf(input.baked);
  const stats = { clips: input.baked.length, channels, keys };
  return {
    kind: CHARACTER_EXPORT_KIND,
    format: input.format,
    fileName: input.fileName,
    mime: 'model/gltf-binary',
    bytes,
    sha256: await sha256Hex(bytes),
    lints,
    readBack,
    validation: null,
    stats: reduction === undefined ? stats : { ...stats, reduction },
  };
}

/** Triangles the writer emits for meshes (one per face corner beyond the second: the triangulation of an n-gon). */
export function trianglesOf(meshes: readonly CharacterMeshIn[]): number {
  let tris = 0;
  for (const mesh of meshes) {
    const data = mesh.data;
    for (let f = 0; f < data.counts.faces; f++) {
      const first = data.faceCorner[f] as number;
      let n = 0;
      let c = first;
      do {
        n++;
        c = data.cornerNext[c] as number;
      } while (c !== first && n <= data.counts.corners);
      tris += Math.max(0, n - 2);
    }
  }
  return tris;
}

/** §5.22 read-back of a written character file against the skeleton and meshes it was written from. */
export function readBackCharacter(
  bytes: Uint8Array,
  skeleton: SkeletonDesc,
  meshes: readonly CharacterMeshIn[],
  clips: readonly BakedClip[],
): CharacterReadBack {
  const problems: string[] = [];
  const expectedJoints = skeleton.nodes.filter((node) => node.isJoint).length;
  const expectedTris = trianglesOf(meshes);
  let read: SkeletonDesc;
  let tris = 0;
  let vrm: '1.0' | null = null;
  try {
    const parsed = parseGlbSync(bytes);
    read = skeletonFromGltf({ ...parsed, sha256: '' });
    const reader = new GltfReader(parsed.json, parsed.bin);
    for (const mesh of meshesOf(parsed.json)) {
      for (const primitive of listField(mesh.primitives)) {
        if ((primitive.mode ?? 4) !== 4) continue;
        const indices = primitive.indices;
        const counted = isIndex(indices) ? indices : primitive.attributes['POSITION'];
        if (isIndex(counted)) tris += reader.accessor(counted).count / 3;
      }
    }
    const extensions = isRecord(parsed.json.extensions) ? parsed.json.extensions : {};
    const vrmc = extensions['VRMC_vrm'];
    if (isRecord(vrmc) && vrmc['specVersion'] === '1.0') vrm = '1.0';
  } catch (error) {
    return {
      kind: 'character',
      ok: false,
      animations: 0,
      channels: 0,
      maxRotationErrorRad: Infinity,
      maxTranslationErrorM: Infinity,
      joints: 0,
      expectedJoints,
      humanoid: 0,
      humanoidEqual: false,
      tris: 0,
      expectedTris,
      fingerprintEqual: false,
      jointsEqual: false,
      problems: [`The written file cannot be read: ${(error as Error).message}`],
      vrmaPlayed: null,
      vrm: null,
    };
  }
  // A plain GLB carries no humanoid map: the reader cannot know the humanoid chain children that end the arm, spine
  // and hand segments, so the humanoid map and the radii are compared on VRM files only.
  const vrmFile = vrm !== null;
  const doc = jointSubset(skeleton);
  const file = jointSubset(read);
  const H = Math.max(skeleton.height, 1e-9);
  for (const [name, x] of doc) {
    const y = file.get(name);
    if (y === undefined) {
      problems.push(`joint ${name} is missing`);
      continue;
    }
    if (x.parent !== y.parent) problems.push(`joint ${name}: parent ${y.parent} instead of ${x.parent}`);
    if (x.t.some((v, i) => Math.abs(v - (y.t[i] as number)) > 1e-6)) problems.push(`joint ${name}: rest translation`);
    if (x.q.some((v, i) => Math.abs(v - (y.q[i] as number)) > 1e-6)) problems.push(`joint ${name}: rest rotation`);
    if (!vrmFile) continue;
    if ((x.radius === null) !== (y.radius === null)) problems.push(`joint ${name}: radius ${y.radius} vs ${x.radius}`);
    else if (x.radius !== null && y.radius !== null && Math.abs(x.radius - y.radius) > 1e-4 * H) {
      problems.push(`joint ${name}: radius ${y.radius} vs ${x.radius}`);
    }
  }
  for (const name of file.keys()) if (!doc.has(name)) problems.push(`joint ${name} is extra`);
  const jointsEqual = problems.length === 0;
  const byName = (desc: SkeletonDesc): Record<string, string | undefined> =>
    Object.fromEntries(
      Object.entries(desc.humanoid ?? {})
        .map(([bone, node]) => [bone, desc.nodes[node]?.name] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  const humanoidEqual = vrmFile ? JSON.stringify(byName(read)) === JSON.stringify(byName(skeleton)) : null;
  if (humanoidEqual === false) problems.push('the humanoid map differs');
  const fingerprintEqual = jointsFingerprint(read.nodes) === skeleton.fingerprint;
  if (!fingerprintEqual) problems.push('jointsFingerprint differs');
  if (tris !== expectedTris) problems.push(`${tris} triangles instead of ${expectedTris}`);
  const joints = read.nodes.filter((node) => node.isJoint).length;
  if (joints !== expectedJoints) problems.push(`${joints} joints instead of ${expectedJoints}`);
  const clipsBack = readBackCheckSync(LINT_KIND, bytes, clips, skeleton);
  if (!clipsBack.ok) problems.push('a clip does not read back within tolerance');
  return {
    kind: 'character',
    ...clipsBack,
    ok: problems.length === 0,
    joints,
    expectedJoints,
    humanoid: Object.keys(read.humanoid ?? {}).length,
    humanoidEqual,
    tris,
    expectedTris,
    fingerprintEqual,
    jointsEqual,
    problems,
    vrmaPlayed: null,
    vrm,
  };
}

function jointSubset(desc: SkeletonDesc) {
  return new Map(
    desc.nodes
      .filter((node) => node.isJoint)
      .map((node) => [
        node.name,
        {
          parent: node.parent === -1 ? '' : (desc.nodes[node.parent]?.name ?? ''),
          t: node.restLocal.t,
          q: node.restLocal.q,
          radius: desc.boneRadii[node.index] ?? null,
        },
      ]),
  );
}
