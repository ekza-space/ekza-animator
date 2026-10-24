// C1 (character runtime; M6B-SPEC §5.1, §6.1, §0.6): characters from models.
//
// - `char.fromModel {objects?, name?}` (Character from Selection): in ONE transaction a model-sourced
//   `CharacterRecord` (`source: {kind: 'model', skeleton}`, asset null, format 'vrm1', identity placement, vrm null,
//   name = the selected group's or first mesh's), its `SkeletonRecord` ('vrm-humanoid' 1.0.0, symmetry on, no joints
//   yet), an empty `RigRecord` (humanoid generator, `AUTORIG_VERSION`) and the adoption of every selected scene mesh
//   (groups flattened; a group left empty is soft-deleted). `skel.template.create` and the Quick Rig commit (C2) run
//   the same core, `createModelCharacter`, inside their own transaction.
// - `char.adopt {character, objects?}` (Add to Character): the same adoption into an existing model character; the
//   new meshes are unbound.
// - Adoption: a new record in `char:<id>` with the id `derivedId('mesh', 'char.adopt', [character, source], '', 0)`,
//   the source's name (unique among the character's), `parent` null, `skin` null, `generator` null and every other
//   field copied; its first revision is the source revision with its world placement frozen (M6a's
//   `mesh.applyTransform` on a copy: positions, custom normals by the inverse transpose, winding reversed for
//   det < 0), so the placement is identity; the source record is soft-deleted. One undo step restores the scene
//   meshes bit-equal. Asset-backed static meshes keep their `source` and asset materials.
// - Refusals: a skinned source ("Make the imported character editable instead"); a non-positive or non-uniform scale
//   on a source's placement or a parent group's ("Freeze Transformations first", with Freeze Transformations as the
//   way out).
// - `mesh.importStatic {bytes, name, dropSkin?}` (Import Static Model…): an unskinned `.glb` stored as a model asset
//   and one **scene** mesh per glTF mesh instance (M6a's `meshFromGltf`: `source: {asset, mesh}`, the asset's material
//   slots, `faceted` false, placement = the node's world, name = the node's); skinned files are refused ("Open skinned
//   models as characters (File › Open)") unless `dropSkin` (CR-AR-6), which imports their meshes at the bind pose.
import {
  EkzaError,
  mat4Compose,
  mat4Decompose,
  mat4Multiply,
  type ReadonlyXf,
  xfIdentity,
} from '@ekza-studio/anim-core';
import {
  type AssetRecord,
  type CharacterId,
  type CharacterRecord,
  derivedId,
  fractionalIndex,
  type GroupId,
  type GroupRecord,
  type MeshId,
  type MeshRecord,
  type ReadView,
  type RigRecord,
  type SkeletonId,
  type SkeletonRecord,
  type Tx,
} from '@ekza-studio/doc';
import type { MeshData } from '@ekza-studio/mesh-core';
import { AUTORIG_VERSION } from '@ekza-studio/rig';
import { transformedData } from '../../../characters/modelInput';
import { attachMeshes, loadMeshKernel, type MeshKernel } from '../../../mesh';
import { runSeed } from '../../../mesh/seed';
import type { ApplyContext, EditorApp, OperatorContext, PollResult, SceneObjectId } from '../../../types';
import { loadWritePath } from '../../../workflows/export';
import { baseName, isGenericMeshName } from '../../../workflows/names';
import { projectRecord } from '../../../workflows/records';
import { type AnyOperator, defineOperator, fail, isRecord, OK, optionalArgs } from '../define';
import { uniqueMeshName } from '../../../mesh/records';

export const SKINNED_SOURCE = 'Make the imported character editable instead';
export const FREEZE_FIRST = 'Freeze Transformations first';
export const NOTHING_SELECTED = 'Select the meshes of the character first';
export const SKINNED_IMPORT = 'Open skinned models as characters (File › Open)';
export const MESH_LOADING = 'Mesh is loading';
/** `jointsFingerprint([])`: the rig of a skeleton without joints yet (SHA-256 of the empty string). */
export const EMPTY_FINGERPRINT = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// ---------------------------------------------------------------------------------------------------------------
// sources

/** The scene meshes of the given objects (groups flattened, depth first; each mesh once), and the groups. */
export function sourceMeshes(
  view: ReadView,
  objects: readonly SceneObjectId[],
): { readonly meshes: readonly MeshRecord[]; readonly groups: readonly GroupRecord[] } | string {
  const meshes: MeshRecord[] = [];
  const groups: GroupRecord[] = [];
  const seen = new Set<string>();
  const visit = (id: string, depth: number): string | null => {
    if (seen.has(id) || depth > 1000) return null;
    seen.add(id);
    if (id.startsWith('grp_')) {
      const group = view.get('groups', id as GroupId);
      if (group === undefined) return `Unknown group ${id}`;
      if (!('scene' in group.owner)) return 'Only scene objects can make a character';
      groups.push(group);
      for (const child of view.query.childrenOf(group.id, 'scene')) {
        const problem = visit(child.id, depth + 1);
        if (problem !== null) return problem;
      }
      return null;
    }
    const mesh = view.get('meshes', id as MeshId);
    if (mesh === undefined) return `Unknown mesh ${id}`;
    if (!('scene' in mesh.owner)) return 'Only scene objects can make a character';
    meshes.push(mesh);
    for (const child of view.query.childrenOf(mesh.id, 'scene')) {
      const problem = visit(child.id, depth + 1);
      if (problem !== null) return problem;
    }
    return null;
  };
  for (const id of objects) {
    const problem = visit(id, 0);
    if (problem !== null) return problem;
  }
  return { meshes, groups };
}

/** The placements of a record and its parents (scene objects), innermost first. */
function placementChain(view: ReadView, record: MeshRecord): ReadonlyXf[] {
  const chain: ReadonlyXf[] = [record.placement];
  const seen = new Set<string>([record.id]);
  let parent: GroupId | MeshId | null = record.parent;
  while (parent !== null && !seen.has(parent)) {
    seen.add(parent);
    const node: { readonly placement: ReadonlyXf; readonly parent: GroupId | MeshId | null } | undefined =
      parent.startsWith('grp_') ? view.get('groups', parent as GroupId) : view.get('meshes', parent as MeshId);
    if (node === undefined) break;
    chain.push(node.placement);
    parent = node.parent;
  }
  return chain;
}

/** A positive uniform scale (relative tolerance 1e-6). */
export function uniformPositive(xf: ReadonlyXf): boolean {
  const [x, y, z] = xf.s;
  const max = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  return x > 0 && y > 0 && z > 0 && max - Math.min(x, y, z) <= 1e-6 * max;
}

/** The world matrix of a scene mesh (its placement composed with its parents'). */
function worldMatrix(view: ReadView, record: MeshRecord): Float64Array {
  let matrix = mat4Compose(xfIdentity());
  for (const placement of placementChain(view, record)) matrix = mat4Multiply(mat4Compose(placement), matrix);
  return matrix;
}

function hasSkinLayers(data: MeshData | null): boolean {
  return data !== null && (data.layers.has('skin.joints') || data.layers.has('skin.weights'));
}

/** Poll of the adoption sources: they exist and their data is resident (the kernel loads in prepare). */
function sourcesPoll(app: EditorApp, objects: readonly SceneObjectId[]): PollResult {
  if (objects.length === 0) return fail(NOTHING_SELECTED);
  const sources = sourceMeshes(app.store, objects);
  if (typeof sources === 'string') return fail(sources);
  if (sources.meshes.length === 0) return fail(NOTHING_SELECTED);
  for (const mesh of sources.meshes) {
    if (mesh.data === null) return fail(`${mesh.name} has no mesh data`);
    if (app.meshes.get(mesh.id)?.state === 'loading') return fail(MESH_LOADING);
  }
  return OK;
}

/**
 * Checks the sources of an adoption (prepare: the refusals with their way out) and returns their resident data.
 * Throws EkzaError('char.skinned-source' | 'char.scale' | 'mesh-not-ready').
 */
export async function prepareSources(
  app: EditorApp,
  objects: readonly SceneObjectId[],
): Promise<{ readonly kernel: MeshKernel; readonly data: ReadonlyMap<MeshId, MeshData> }> {
  const kernel = await loadMeshKernel();
  attachMeshes(app);
  const sources = sourceMeshes(app.store, objects);
  if (typeof sources === 'string') throw new EkzaError('invalid-input', sources);
  const data = new Map<MeshId, MeshData>();
  for (const mesh of sources.meshes) {
    const resident = app.meshes.get(mesh.id)?.data() ?? null;
    if (mesh.skin !== null || hasSkinLayers(resident)) throw new EkzaError('char.skinned-source', SKINNED_SOURCE);
    if (!placementChain(app.store, mesh).every(uniformPositive)) {
      throw new EkzaError('char.scale', FREEZE_FIRST, {
        action: { label: 'Freeze Transformations', op: 'mesh.freezeTransforms', args: { ids: [mesh.id] } },
      });
    }
    if (resident === null) throw new EkzaError('mesh-not-ready', `${mesh.name}: its mesh data is not available`);
    data.set(mesh.id, resident);
  }
  return { kernel, data };
}

/** The adopted record id of a source mesh (§5.1: stable, so a re-run or a peer never duplicates it). */
export function adoptedMeshId(character: CharacterId, source: MeshId): MeshId {
  return derivedId('mesh', 'char.adopt', [character, source], '', 0);
}

/**
 * Adopts scene meshes into a model character inside `tx` (§5.1): frozen first revisions, identity placements, unbound,
 * no live generator; the sources (and groups left empty) are soft-deleted. Returns the new mesh ids, in source order.
 */
export function adoptMeshes(
  app: EditorApp,
  tx: Tx,
  args: {
    readonly character: CharacterId;
    readonly objects: readonly SceneObjectId[];
    readonly kernel: MeshKernel;
    readonly data: ReadonlyMap<MeshId, MeshData>;
  },
): MeshId[] {
  const meshes = attachMeshes(app);
  if (meshes === null) throw new EkzaError('mesh-loading', 'Mesh tools are loading');
  const sources = sourceMeshes(tx, args.objects);
  if (typeof sources === 'string') throw new EkzaError('invalid-input', sources);
  const owner = { character: args.character } as const;
  const taken = new Set<string>();
  let order: string | null = null;
  for (const mesh of tx.query.meshesOfOwner(args.character))
    if (order === null || mesh.order > order) order = mesh.order;
  const adopted: MeshId[] = [];
  for (const source of sources.meshes) {
    const data = args.data.get(source.id);
    if (data === undefined) throw new EkzaError('mesh-not-ready', `${source.name}: its mesh data is not available`);
    const matrix = worldMatrix(tx, source);
    const frozen = transformedData(args.kernel, data, matrix);
    const pivot = mat4Decompose(
      mat4Multiply(matrix, mat4Compose({ t: source.pivot, q: [0, 0, 0, 1], s: [1, 1, 1] })),
    ).t;
    const id = adoptedMeshId(args.character, source.id);
    const name = uniqueMeshName(tx, owner, source.name, taken);
    taken.add(name);
    order = fractionalIndex(order, null);
    const record: MeshRecord = {
      ...source,
      id,
      name,
      owner,
      parent: null,
      order,
      placement: xfIdentity(),
      pivot: [pivot[0], pivot[1], pivot[2]],
      data: meshes.storeRevision(frozen, null, []),
      generator: null,
      skin: null,
      deleted: null,
    };
    if (tx.getIncludingDeleted('meshes', id) === undefined) tx.put('meshes', record);
    else {
      tx.restore('meshes', id);
      const { id: _, ...fields } = record;
      tx.patch('meshes', id, fields);
    }
    tx.softDelete('meshes', source.id);
    adopted.push(id);
  }
  // Groups are flattened: a group left without live children is soft-deleted (deepest first).
  for (const group of [...sources.groups].reverse()) {
    if (tx.query.childrenOf(group.id, 'scene').length === 0) tx.softDelete('groups', group.id);
  }
  return adopted;
}

/** The ids `createModelCharacter` writes for one run seed. */
export function modelCharacterIds(seed: string): {
  readonly character: CharacterId;
  readonly skeleton: SkeletonId;
  readonly rig: RigRecord['id'];
} {
  return {
    character: derivedId('character', 'char.fromModel', [], seed, 0),
    skeleton: derivedId('skeleton', 'char.fromModel', [], seed, 0),
    rig: derivedId('rig', 'char.fromModel', [], seed, 0),
  };
}

/**
 * The core of `char.fromModel` (§5.1), for operators that create a character inside their own transaction
 * (`skel.template.create`, `skel.quickRig.commit`): the character, its skeleton (no joints; `preset` 'custom' unless
 * given), its empty rig and the adopted meshes. Prepare the sources with `prepareSources` first.
 */
export function createModelCharacter(
  app: EditorApp,
  tx: Tx,
  args: {
    readonly objects: readonly SceneObjectId[];
    readonly name: string | null;
    readonly seed: string;
    readonly kernel: MeshKernel;
    readonly data: ReadonlyMap<MeshId, MeshData>;
    readonly preset?: SkeletonRecord['preset'];
  },
): {
  readonly character: CharacterId;
  readonly skeleton: SkeletonId;
  readonly rig: RigRecord['id'];
  readonly meshes: readonly MeshId[];
} {
  const ids = modelCharacterIds(args.seed);
  const sources = sourceMeshes(tx, args.objects);
  if (typeof sources === 'string') throw new EkzaError('invalid-input', sources);
  const lead = args.objects.find((id) => id.startsWith('grp_'));
  const first = lead === undefined ? sources.meshes[0]?.name : tx.get('groups', lead as GroupId)?.name;
  // a default name (pCube10, Mesh.003) gives way to the project's, which an import named after the file (AR-D10-8)
  const project = tx.get('project', 'project')?.name;
  const named =
    first !== undefined && isGenericMeshName(first) && project !== undefined && project !== 'Untitled'
      ? project
      : first;
  let order: string | null = null;
  for (const character of tx.list('characters')) if (order === null || character.order > order) order = character.order;
  const character: CharacterRecord = {
    id: ids.character,
    name: (args.name ?? named ?? 'Character').trim().slice(0, 64) || 'Character',
    asset: null,
    source: { kind: 'model', skeleton: ids.skeleton },
    format: 'vrm1',
    rig: ids.rig,
    placement: xfIdentity(),
    order: fractionalIndex(order, null),
    deleted: null,
    vrm: null,
  };
  const skeleton: SkeletonRecord = {
    id: ids.skeleton,
    character: ids.character,
    template: 'vrm-humanoid',
    templateVersion: '1.0.0',
    preset: args.preset ?? 'custom',
    symmetry: true,
    deleted: null,
  };
  const rig: RigRecord = {
    id: ids.rig,
    character: ids.character,
    format: 'ekza.rig',
    version: 1,
    generator: { name: 'ekza-autorig-humanoid', version: AUTORIG_VERSION },
    skeleton: { format: 'vrm1', fingerprint: EMPTY_FINGERPRINT, facing: [0, 0, 0, 1] },
    deleted: null,
  };
  tx.put('characters', character);
  tx.put('skeletons', skeleton);
  tx.put('rigs', rig);
  const meshes = adoptMeshes(app, tx, {
    character: ids.character,
    objects: args.objects,
    kernel: args.kernel,
    data: args.data,
  });
  return { character: ids.character, skeleton: ids.skeleton, rig: ids.rig, meshes };
}

// ---------------------------------------------------------------------------------------------------------------
// operators

function objectsArg(app: EditorApp, raw: Readonly<Record<string, unknown>>): readonly SceneObjectId[] | string {
  const objects = raw['objects'];
  if (objects === undefined || objects === null) return app.session.getState().selection.objects;
  if (!Array.isArray(objects) || !objects.every((id) => typeof id === 'string')) return 'objects must be ids';
  return objects as SceneObjectId[];
}

interface Sources {
  readonly kernel: MeshKernel;
  readonly data: ReadonlyMap<MeshId, MeshData>;
  readonly objects: readonly SceneObjectId[];
}

async function prepareFrom(ctx: OperatorContext, raw: unknown): Promise<Sources> {
  const args = optionalArgs(raw);
  const objects = args === null ? 'expects { objects?, name? }' : objectsArg(ctx.app, args);
  if (typeof objects === 'string') throw new EkzaError('invalid-input', objects);
  return { ...(await prepareSources(ctx.app, objects)), objects };
}

const fromModel = defineOperator<'char.fromModel', Sources>({
  id: 'char.fromModel',
  label: 'Character from Selection',
  description: 'Makes a character from the selected meshes (their transforms frozen); rig it in Rig & Skin.',
  category: 'char',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true },
  poll({ app }, raw) {
    const args = optionalArgs(raw);
    if (args === null) return fail('expects { objects?, name? }');
    const name = args['name'];
    if (name !== undefined && name !== null && typeof name !== 'string') return fail('name must be a string');
    const objects = objectsArg(app, args);
    return typeof objects === 'string' ? fail(objects) : sourcesPoll(app, objects);
  },
  prepare: prepareFrom,
  apply(ctx: ApplyContext, raw, prepared) {
    if (ctx.tx === null) throw new EkzaError('unsupported', 'char.fromModel needs a transaction');
    const args = optionalArgs(raw) ?? {};
    const name = typeof args['name'] === 'string' ? args['name'] : null;
    const created = createModelCharacter(ctx.app, ctx.tx, {
      objects: prepared.objects,
      name,
      seed: runSeed(ctx, 'char.fromModel'),
      kernel: prepared.kernel,
      data: prepared.data,
    });
    ctx.tx.annotate({ label: 'Character from Selection' });
    const state = ctx.app.session.getState();
    ctx.app.session.setState({ selection: { ...state.selection, objects: [...created.meshes] } });
    return { character: created.character, skeleton: created.skeleton };
  },
});

const adopt = defineOperator<'char.adopt', Sources>({
  id: 'char.adopt',
  label: 'Add to Character',
  description: 'Adds the selected scene meshes to a character made in the editor (unbound).',
  category: 'char',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true },
  extraArgs: ['character', 'objects'],
  poll({ app }, raw) {
    if (!isRecord(raw) || typeof raw['character'] !== 'string') return fail('expects { character, objects? }');
    const character = app.store.get('characters', raw['character']);
    if (character === undefined) return fail(`Unknown character ${raw['character']}`);
    if (character.source?.kind !== 'model') return fail('Add meshes to a character made in the editor');
    const objects = objectsArg(app, raw);
    return typeof objects === 'string' ? fail(objects) : sourcesPoll(app, objects);
  },
  prepare: prepareFrom,
  apply(ctx, args, prepared) {
    if (ctx.tx === null) throw new EkzaError('unsupported', 'char.adopt needs a transaction');
    const meshes = adoptMeshes(ctx.app, ctx.tx, {
      character: args.character,
      objects: prepared.objects,
      kernel: prepared.kernel,
      data: prepared.data,
    });
    ctx.tx.annotate({ label: 'Add to Character' });
    return { meshes };
  },
});

// ---------- mesh.importStatic ----------

/** What `mesh.importStatic` (and `mesh.intake {bytes}`) read from a file before writing anything (prepare). */
export interface ImportPlan {
  readonly asset: AssetRecord;
  readonly meshes: readonly {
    readonly meshIndex: number;
    readonly name: string;
    readonly placement: ReadonlyXf;
    readonly data: MeshData;
    readonly slots: readonly { readonly asset: AssetRecord['id']; readonly material: number }[];
  }[];
}

type GltfNode = {
  readonly mesh?: unknown;
  readonly skin?: unknown;
  readonly children?: unknown;
  readonly name?: unknown;
  readonly translation?: unknown;
  readonly rotation?: unknown;
  readonly scale?: unknown;
  readonly matrix?: unknown;
};

function nodeLocal(node: GltfNode): Float64Array {
  const nums = (value: unknown, n: number): number[] | null =>
    Array.isArray(value) && value.length === n && value.every((v) => typeof v === 'number' && Number.isFinite(v))
      ? (value as number[])
      : null;
  const matrix = nums(node.matrix, 16);
  if (matrix !== null) return Float64Array.from(matrix);
  const t = nums(node.translation, 3) ?? [0, 0, 0];
  const q = nums(node.rotation, 4) ?? [0, 0, 0, 1];
  const s = nums(node.scale, 3) ?? [1, 1, 1];
  return mat4Compose({
    t: [t[0] as number, t[1] as number, t[2] as number],
    q: [q[0] as number, q[1] as number, q[2] as number, q[3] as number],
    s: [s[0] as number, s[1] as number, s[2] as number],
  });
}

/**
 * Reads a static GLB for import: stores its bytes as a model asset and makes every mesh instance editable data with its
 * world placement. `maxTriangles` raises Make editable's 200,000-triangle gate for callers that decimate before
 * writing (`mesh.intake {bytes}`, MODELING-PLAN §7.2 G-a "Decimate first").
 */
export async function prepareImport(
  ctx: OperatorContext,
  raw: unknown,
  opts: { readonly maxTriangles?: number } = {},
): Promise<ImportPlan> {
  if (!isRecord(raw) || !(raw['bytes'] instanceof Uint8Array))
    throw new EkzaError('invalid-input', 'expects { bytes, name }');
  const bytes = raw['bytes'];
  const fileName = typeof raw['name'] === 'string' && raw['name'].trim() !== '' ? raw['name'].trim() : 'model.glb';
  const dropSkin = raw['dropSkin'] === true;
  await loadMeshKernel();
  const write = await loadWritePath();
  const io = await write.loadMeshIo();
  const { parseGlb } = await import('@ekza-studio/io');
  const container = await parseGlb(bytes);
  const json = container.json as {
    readonly nodes?: readonly GltfNode[];
    readonly skins?: readonly unknown[];
    readonly scenes?: readonly { readonly nodes?: readonly number[] }[];
    readonly scene?: number;
  };
  const nodes = json.nodes ?? [];
  if (!dropSkin && (nodes.some((node) => node.skin !== undefined) || (json.skins ?? []).length > 0)) {
    throw new EkzaError('import.skinned', SKINNED_IMPORT);
  }
  const asset = await ctx.app.services.assets.put(bytes, { name: fileName, ext: 'glb', role: 'model' });
  // Mesh instances in scene order (depth first from the default scene's roots), with their world matrices.
  const instances: { readonly node: number; readonly world: Float64Array }[] = [];
  const visit = (index: number, parent: Float64Array, depth: number): void => {
    const node = nodes[index];
    if (node === undefined || depth > 1000) return;
    const world = mat4Multiply(parent, nodeLocal(node));
    if (typeof node.mesh === 'number') instances.push({ node: index, world });
    for (const child of Array.isArray(node.children) ? (node.children as number[]) : []) visit(child, world, depth + 1);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots =
    scene?.nodes ??
    nodes
      .map((_, i) => i)
      .filter((i) => !nodes.some((n) => Array.isArray(n.children) && (n.children as number[]).includes(i)));
  for (const root of roots) visit(root, mat4Compose(xfIdentity()), 0);
  const meshes: ImportPlan['meshes'][number][] = [];
  for (const instance of instances) {
    const node = nodes[instance.node] as GltfNode;
    const meshIndex = node.mesh as number;
    const result = await io.meshFromGltf(
      container,
      meshIndex,
      opts.maxTriangles === undefined ? {} : { maxTriangles: opts.maxTriangles },
    );
    if ('refused' in result) throw new EkzaError(result.code, result.reason);
    let data = result.data;
    if (dropSkin) {
      const layers = new Map(data.layers);
      layers.delete('skin.joints');
      layers.delete('skin.weights');
      data = { ...data, layers };
    }
    // A skinned node ignores its transform in glTF (§5.1): its bind pose is its mesh data.
    const world = node.skin !== undefined ? mat4Compose(xfIdentity()) : instance.world;
    const name = typeof node.name === 'string' && node.name.trim() !== '' ? node.name : `Mesh ${meshIndex}`;
    meshes.push({
      meshIndex,
      name,
      placement: mat4Decompose(world),
      data,
      slots: result.slots.map((slot) => ({ asset: asset.id, material: slot.material })),
    });
  }
  if (meshes.length === 0) throw new EkzaError('import.empty', 'The file has no meshes');
  return { asset, meshes };
}

const importStatic = defineOperator<'mesh.importStatic', ImportPlan>({
  id: 'mesh.importStatic',
  label: 'Import Static Model…',
  description: 'Imports the meshes of an unskinned GLB as scene meshes (to rig them here).',
  category: 'mesh',
  scope: 'global',
  workspaces: ['model', 'rig'],
  flags: { undo: true },
  extraArgs: ['bytes', 'name', 'dropSkin'],
  poll(_ctx, raw) {
    return isRecord(raw) && raw['bytes'] instanceof Uint8Array ? OK : fail('expects { bytes, name }');
  },
  prepare: prepareImport,
  apply(ctx, args, plan) {
    if (ctx.tx === null) throw new EkzaError('unsupported', 'mesh.importStatic needs a transaction');
    const ids = putImportedMeshes(ctx, args.name, plan, runSeed(ctx, 'mesh.importStatic'));
    ctx.tx.annotate({ label: 'Import Static Model' });
    return { meshes: ids };
  },
});

/**
 * Writes an import plan inside the run's transaction: the project's name (first import), the asset, one scene mesh
 * record per instance with its first revision, and the new meshes as the object selection. `override` replaces an
 * instance's data, placement and colour fields (`mesh.intake {bytes}` writes the chain's result as the first revision,
 * so import and intake are one undo step). Ids derive from the asset and `seed`.
 */
export function putImportedMeshes(
  ctx: ApplyContext,
  fileName: unknown,
  plan: ImportPlan,
  seed: string,
  override?: (
    n: number,
  ) => Partial<Pick<MeshRecord, 'placement' | 'palette' | 'material' | 'source' | 'colourOutput'>> & {
    readonly data?: MeshData;
  },
): MeshId[] {
  const { app, tx } = ctx;
  if (tx === null) throw new EkzaError('unsupported', 'An import needs a transaction');
  // The first import names an untitled project (autosave and Recovery show that name; AR-D8-10) after the model it
  // brings: its first mesh's name, the name Auto-Rig's header and the character take (AR-D9-7); a file whose first
  // mesh has no name or a modelling tool's default one ("Mesh 0", "pCube10", "Cube.001") after the file (AR-D10-8).
  const project = tx.get('project', 'project');
  const name = typeof fileName === 'string' ? fileName.trim() : '';
  const first = plan.meshes[0]?.name.trim() ?? '';
  const projectName = first !== '' && !isGenericMeshName(first) ? first.slice(0, 64) : baseName(name);
  if (name !== '' && project === undefined) tx.put('project', projectRecord(projectName));
  else if (name !== '' && project?.name === 'Untitled') {
    tx.patch('project', 'project', { name: projectName });
  }
  const named = tx.get('project', 'project')?.name;
  if (named !== undefined && named !== app.session.getState().projectName) {
    app.session.setState({ projectName: named });
  }
  const meshes = attachMeshes(app);
  if (meshes === null) throw new EkzaError('mesh-loading', 'Mesh tools are loading');
  if (tx.get('assets', plan.asset.id) === undefined) tx.put('assets', plan.asset);
  const owner = { scene: true } as const;
  const taken = new Set<string>();
  let order: string | null = null;
  for (const child of tx.query.childrenOf(null, 'scene')) if (order === null || child.order > order) order = child.order;
  const ids: MeshId[] = [];
  plan.meshes.forEach((mesh, n) => {
    const id = derivedId('mesh', 'mesh.importStatic', [plan.asset.id], seed, n);
    const unique = uniqueMeshName(tx, owner, mesh.name, taken);
    taken.add(unique);
    order = fractionalIndex(order, null);
    const { data, ...fields } = override?.(n) ?? {};
    const record: MeshRecord = {
      id,
      name: unique,
      owner,
      parent: null,
      order,
      placement: mesh.placement,
      pivot: [0, 0, 0],
      source: { asset: plan.asset.id, mesh: mesh.meshIndex },
      data: meshes.storeRevision(data ?? mesh.data, null, []),
      faceted: false,
      generator: null,
      palette: null,
      material: { assetSlots: mesh.slots },
      colourOutput: 'palette-texture',
      skin: null,
      budget: null,
      handheld: null,
      deleted: null,
      ...fields,
    };
    tx.put('meshes', record);
    ids.push(id);
  });
  const state = app.session.getState();
  app.session.setState({ selection: { ...state.selection, objects: ids } });
  return ids;
}

export const CHARACTER_OPERATORS: readonly AnyOperator[] = [importStatic, fromModel, adopt];
