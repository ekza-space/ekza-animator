// The records of a model-sourced character as the io functions take them (M6B-SPEC §5.1, §5.22; C1, in the lazy
// character-runtime chunk): `DocSkeletonInput` for skeletonFromDoc, `CharacterMeshIn`s and palettes for the writer and
// `characterVertices`, and the full `CharacterWriteInput` of the display container. C10's export builds on it.
//
// Meshes of the character are its live mesh records with data (`owner.character`), in record order. A mesh is bound
// when `MeshRecord.skin.skeleton` is the character's skeleton; its weights are its revision's skin layers (`readSkin`).
// Unbound meshes with a non-identity placement are written with the placement applied to their positions (the writer
// takes character-space data); bound meshes have identity placement (§5.1 bind = rest).
import { curveEngine, type Mat4, mat4Compose, mat4Multiply, type ReadonlyXf } from '@ekza-studio/anim-core';
import type {
  CharacterId,
  CharacterRecord,
  GroupId,
  JointRecord,
  MeshId,
  MeshRecord,
  PaletteId,
  ReadView,
  SkeletonRecord,
} from '@ekza-studio/doc';
import type { CharacterMeshIn, CharacterWriteInput, EkzaModelV1 } from '@ekza-studio/io';
import type { MeshData } from '@ekza-studio/mesh-core';
import type { DocSkeletonInput, SkeletonDesc } from '@ekza-studio/rig';
import type { MeshKernel } from '../mesh/kernel';
import type { EditorApp } from '../types';

/** The records and the resident data of a model-sourced character at one document state. */
export interface ModelParts {
  readonly character: CharacterRecord;
  readonly skeleton: SkeletonRecord;
  readonly joints: readonly JointRecord[];
  readonly meshes: readonly { readonly record: MeshRecord; readonly data: MeshData }[];
}

/** The live model-sourced character's skeleton record, or undefined. */
export function skeletonRecordOf(view: ReadView, character: CharacterRecord): SkeletonRecord | undefined {
  if (character.source?.kind !== 'model') return undefined;
  const own = view.get('skeletons', character.source.skeleton);
  return own ?? view.query.skeletonOfCharacter(character.id);
}

/** The character's live meshes with data, in record order. */
export function characterMeshRecords(view: ReadView, character: CharacterId): readonly MeshRecord[] {
  return view.query.meshesOfOwner(character).filter((record) => record.data !== null && record.deleted === null);
}

/**
 * The parts of a character when every mesh's data is resident ('loading' otherwise; null without a model character or
 * skeleton). `view` defaults to the store; a transaction passes itself (read-your-writes for the records; mesh data is
 * the runtimes' resident revisions).
 */
export function modelParts(
  app: Pick<EditorApp, 'store' | 'meshes'>,
  id: CharacterId,
  view: ReadView = app.store,
): ModelParts | 'loading' | null {
  const character = view.get('characters', id);
  if (character === undefined || character.source?.kind !== 'model') return null;
  const skeleton = skeletonRecordOf(view, character);
  if (skeleton === undefined) return null;
  const meshes: { record: MeshRecord; data: MeshData }[] = [];
  for (const record of characterMeshRecords(view, id)) {
    const runtime = app.meshes.get(record.id);
    const data = runtime?.data() ?? null;
    if (data === null) {
      if (runtime === undefined || runtime.state === 'loading') return 'loading';
      continue; // A mesh whose data cannot be read is left out (its runtime reports the error).
    }
    meshes.push({ record, data });
  }
  return { character, skeleton, joints: view.query.jointsOfSkeleton(skeleton.id), meshes };
}

/** Resolves once no mesh of the character is loading (a mesh in error does not block). */
export function meshesSettled(app: Pick<EditorApp, 'store' | 'meshes'>, id: CharacterId): Promise<void> {
  const waits: Promise<void>[] = [];
  for (const record of characterMeshRecords(app.store, id)) {
    const runtime = app.meshes.get(record.id);
    if (runtime === undefined || runtime.state !== 'loading') continue;
    waits.push(
      new Promise<void>((resolve) => {
        const off = runtime.subscribe((event) => {
          if (event.type === 'state' && event.state !== 'loading') {
            off();
            resolve();
          }
        });
        if (runtime.state !== 'loading') {
          off();
          resolve();
        }
      }),
    );
  }
  return Promise.all(waits).then(() => undefined);
}

/** Whether a mesh record is bound to `skeleton` (`MeshRecord.skin.skeleton`). */
export function isBoundTo(record: MeshRecord, skeleton: SkeletonRecord['id']): boolean {
  return record.skin !== null && 'skeleton' in record.skin && record.skin.skeleton === skeleton;
}

/** The character-space matrix of a mesh record: its placement composed with its parents' (not the character's). */
export function meshMatrix(view: ReadView, record: MeshRecord): Mat4 {
  let matrix = mat4Compose(record.placement);
  const seen = new Set<string>([record.id]);
  let parent: GroupId | MeshId | null = record.parent;
  while (parent !== null && !seen.has(parent)) {
    seen.add(parent);
    const node: { readonly placement: ReadonlyXf; readonly parent: GroupId | MeshId | null } | undefined =
      parent.startsWith('grp_') ? view.get('groups', parent as GroupId) : view.get('meshes', parent as MeshId);
    if (node === undefined) break;
    matrix = mat4Multiply(mat4Compose(node.placement), matrix);
    parent = node.parent;
  }
  return matrix;
}

const IDENTITY = mat4Compose({ t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });

export function isIdentity(matrix: ArrayLike<number>): boolean {
  for (let i = 0; i < 16; i++) if (matrix[i] !== IDENTITY[i]) return false;
  return true;
}

/** `data` with `matrix` applied (M6a's `mesh.applyTransform` kernel op on a copy); `data` itself for identity. */
export function transformedData(kernel: MeshKernel, data: MeshData, matrix: Mat4): MeshData {
  if (isIdentity(matrix)) return data;
  const op = kernel.MESH_OPS['mesh.applyTransform'];
  if (op === undefined) throw new Error('mesh.applyTransform is not in the kernel');
  const mesh = kernel.editMeshFrom(data);
  mesh.begin('char.freeze');
  const result = op.run(
    mesh,
    null,
    { matrix: Array.from(matrix) },
    {
      symmetry: null,
      hidden: null,
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      faceted: false,
      soft: null,
      curves: curveEngine,
      epsilon: 1e-9,
    },
  );
  if (kernel.isRefusal(result)) {
    mesh.abort();
    throw new Error(result.reason);
  }
  mesh.end();
  return mesh.snapshot();
}

/** The skeletonFromDoc input of the parts (bound meshes carry their weights). */
export function docSkeletonInput(view: ReadView, kernel: MeshKernel, parts: ModelParts): DocSkeletonInput {
  return {
    skeleton: parts.skeleton,
    joints: parts.joints,
    meshes: parts.meshes.map(({ record, data }) => ({
      id: record.id,
      data,
      skin: isBoundTo(record, parts.skeleton.id) ? kernel.readSkin(data) : null,
      placement: meshMatrix(view, record),
    })),
  };
}

/** The writer's meshes of the parts (palette materials from each mesh's preset; positions in character space). */
export function characterMeshes(view: ReadView, kernel: MeshKernel, parts: ModelParts): CharacterMeshIn[] {
  return parts.meshes.map(({ record, data }) => {
    const bound = isBoundTo(record, parts.skeleton.id);
    const skin = bound ? kernel.readSkin(data) : null;
    const preset = 'preset' in record.material && record.material.preset === 'lit' ? 'lit' : 'unlit';
    const slots = Math.max(1, ...Array.from(data.faceMaterial, (slot) => slot + 1));
    const paletteName =
      record.palette === null ? record.name : (view.get('palettes', record.palette)?.name ?? record.name);
    return {
      id: record.id,
      name: record.name,
      data: bound ? data : transformedData(kernel, data, meshMatrix(view, record)),
      skin,
      materials: Array.from({ length: slots }, () => ({ preset, name: paletteName })),
      colourOutput: record.colourOutput,
      paletteId: record.palette,
      prop: false,
    } satisfies CharacterMeshIn;
  });
}

/** The live swatches (slot, sRGB) of every palette the meshes paint with. */
export function characterPalettes(view: ReadView, meshes: readonly CharacterMeshIn[]): CharacterWriteInput['palettes'] {
  const out = new Map<string, readonly { readonly slot: number; readonly srgb: readonly [number, number, number] }[]>();
  for (const mesh of meshes) {
    const palette = mesh.paletteId as PaletteId | null;
    if (palette === null || out.has(palette)) continue;
    const slots = [...new Set(view.query.swatchesOfPalette(palette).map((swatch) => swatch.slot))].sort(
      (a, b) => a - b,
    );
    out.set(
      palette,
      slots.flatMap((slot) => {
        const swatch = view.query.swatchBySlot(palette, slot);
        return swatch === undefined ? [] : [{ slot, srgb: swatch.srgb }];
      }),
    );
  }
  return out;
}

/** The `ekza_model_v1` block of a model character's container (manual authoring; the template it was made from). */
export function modelProvenance(parts: ModelParts, skeleton: SkeletonDesc, toolVersion: string): EkzaModelV1 {
  const humanoid = skeleton.humanoid !== null;
  return {
    schema: 1,
    rig: humanoid ? 'vrm-humanoid' : 'generic',
    skeletonTemplate:
      parts.skeleton.template === 'vrm-humanoid'
        ? `vrm-humanoid@${parts.skeleton.templateVersion}/${parts.skeleton.preset}`
        : null,
    provenance: {
      tool: 'ekza-animator',
      toolVersion,
      projectSha256: null,
      derivedFrom: [],
      generator: { kind: 'manual' },
    },
  };
}
