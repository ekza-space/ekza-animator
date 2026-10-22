// Auto-Rig ① Model compositions (AUTORIG-SPEC §4.5, §5.2, §6.1, §6.2; D3). Each runs at most one existing operator from
// its `prepare` (the runner refuses runs only inside `apply`), records no undo step of its own and returns the
// IntakeReport (or nothing):
//
// - `autorig.sample {sample}`: a static fixture fetched from `<samplesPath>` (`cube-lad.glb`,
//   `polybot-unskinned-tpose.glb`, `polybot-unskinned.glb`; copied by `apps/web/scripts/copy-assets.mjs`) through
//   `autorig.intake`, or the shipped `file.loadSample` for the VRM samples (`SampleId` is not extended, AR-D15).
// - `autorig.intake {bytes, name, dropSkin?}`: sniffs the file by content (GLB magic, `extensions.VRM` / `VRMC_vrm`,
//   skins, `VRMC_vrm_animation`), not only by its extension, and runs **one** of `mesh.importStatic {bytes, name,
//   dropSkin}` (static, and a skinned file re-rigged from scratch), `file.importModel` (VRM, rigged humanoid) or
//   `file.openProject` (`.ekzanim`). A skinned GLB the importer does not map as humanoid imports nothing: the report
//   says `rigged-other` and the shell offers *Re-rig from scratch* (`dropSkin: true`) or *Open in Studio*. Animations,
//   unsupported formats and models over 200,000 triangles are refused with the §5.2 / §6.2 messages.
// - `autorig.inspect {meshes}` (U): the report of scene meshes as they are now — world bounds and a BVH (C2's
//   `rigGeometry`), C2's start checks (`quickRigStartChecks`: centred, grounded, facing — so ① and ② agree), the
//   upright and size rows, the triangle tier and the pose class from C2's `guessMarkers` arm angle.
// - `autorig.fix {fix, meshes, height?}`: one inner operator, one undo step — `center` → `skel.quickRig.center`,
//   `face` → `skel.quickRig.faceForward`, `standUp` → `scene.object.transform` −90° about X around the bounds centre,
//   `scale` → `scene.object.transform` uniform scale to `height` (default 1.70 m) about the ground point, `freeze` →
//   `mesh.freezeTransforms {translate: false, rotate: true, scale: true}`.
import { EkzaError, quatFromAxisAngle, type ReadonlyXf, xfMultiply } from '@ekza-studio/anim-core';
import type { AssetId, CharacterId, MeshId, ReadView } from '@ekza-studio/doc';
import { guessMarkers, quickRigStartChecks, VRM_REQUIRED_BONES } from '@ekza-studio/rig';
import { kernelMeshes, loadMeshKernel, worldPlacement } from '../../../../mesh';
import { localFromWorld } from '../../../../mesh/records';
import type { AutoRigFix, AutoRigPoseClass, AutoRigSampleId, EditorApp, IntakeReport } from '../../../../types';
import { SAMPLE_BASE_URL } from '../../../../workflows/samples';
import { type AnyOperator, defineOperator, fail, forward, isRecord, OK } from '../../define';
import { type RigGeometry, rigGeometry } from '../skeleton';

// ---------------------------------------------------------------------------------------------------------------------
// messages and thresholds (§5.2, §6.2)

export const ANIMATION_FILE = 'This is an animation. Rig a model first, then add it in step 4.';
export const UNSUPPORTED_FILE = 'Auto-Rig reads GLB and VRM. In Blender: File › Export › glTF 2.0 (.glb).';
/** §6.2 too-heavy: the hard limit is io's (`MAKE_EDITABLE_MAX_TRIANGLES`); Auto-Rig says it before importing. */
export const MAX_TRIANGLES = 200_000;
export const tooHeavyMessage = (triangles: number): string =>
  `This model has ${triangles.toLocaleString('en-US')} triangles. Reduce it to under 200,000 triangles ` +
  '(Blender: Decimate modifier) and try again.';
export const NO_SCENE_MESHES = 'Choose the scene meshes to check';
/** §6.2 tiers (all subject meshes). */
export const WEIGHT_TIERS = { light: 20_000, medium: 60_000, heavy: MAX_TRIANGLES } as const;
/** §5.2 Size: "tiny" under 0.3 m, "huge" over 3 m; the fix's default height. */
export const SIZE_LIMITS = { tiny: 0.3, huge: 3, target: 1.7 } as const;
/** §4.3: the pose class limit (the `skel.tpose` 5°); C2's own `aPose` notice is > 15°. */
export const A_POSE_LIMIT = (5 * Math.PI) / 180;
/** §5.2 Upright: bounds taller in Z than 1.5× their height in Y means the model lies down. */
export const UPRIGHT_RATIO = 1.5;

/** `autorig.sample`'s static fixtures under `<samplesPath>` (AR-D15); the others are `file.loadSample` ids. */
export const STATIC_SAMPLES: Readonly<Partial<Record<AutoRigSampleId, string>>> = {
  'cube-lad': 'cube-lad.glb',
  'polybot-tpose': 'polybot-unskinned-tpose.glb',
  'polybot-apose': 'polybot-unskinned.glb',
};
const VRM_SAMPLES: ReadonlySet<AutoRigSampleId> = new Set(['polybot', 'seed-san']);
const SAMPLE_IDS: readonly AutoRigSampleId[] = ['cube-lad', 'polybot-tpose', 'polybot-apose', 'polybot', 'seed-san'];
const FIXES: readonly AutoRigFix[] = ['center', 'face', 'standUp', 'scale', 'freeze'];

export function weightOf(triangles: number): IntakeReport['weight'] {
  if (triangles <= WEIGHT_TIERS.light) return 'light';
  if (triangles <= WEIGHT_TIERS.medium) return 'medium';
  if (triangles <= WEIGHT_TIERS.heavy) return 'heavy';
  return 'too-heavy';
}

export function scaleOf(height: number): IntakeReport['checks']['scale'] {
  if (!(height >= SIZE_LIMITS.tiny)) return 'tiny';
  return height > SIZE_LIMITS.huge ? 'huge' : 'ok';
}

export function poseClassOf(armAngle: number): AutoRigPoseClass {
  return { armAngle, kind: armAngle > A_POSE_LIMIT ? 'a' : 't' };
}

// ---------------------------------------------------------------------------------------------------------------------
// sniffing (content first, §5.2)

interface GltfLike {
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly extensionsUsed?: readonly string[];
  readonly skins?: readonly unknown[];
  readonly nodes?: readonly {
    readonly mesh?: number;
    readonly skin?: number;
    readonly children?: readonly number[];
  }[];
  readonly meshes?: readonly {
    readonly primitives?: readonly {
      readonly mode?: number;
      readonly indices?: number;
      readonly attributes?: Readonly<Record<string, number>>;
    }[];
  }[];
  readonly accessors?: readonly { readonly count?: number }[];
  readonly textures?: readonly unknown[];
  readonly images?: readonly unknown[];
  readonly animations?: readonly unknown[];
}

export type SniffedKind = 'static' | 'skinned' | 'vrm' | 'vrma' | 'project' | 'unsupported';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

/** The JSON chunk of a GLB, or null when the bytes are not a readable GLB. */
export function glbJson(bytes: Uint8Array): GltfLike | null {
  if (bytes.byteLength < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(16, true) !== JSON_CHUNK) return null;
  const length = view.getUint32(12, true);
  if (length > bytes.byteLength - 20) return null;
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
    return typeof json === 'object' && json !== null && !Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

const hasExtension = (json: GltfLike, name: string): boolean =>
  (json.extensions !== undefined && name in json.extensions) || (json.extensionsUsed ?? []).includes(name);

/** What a file is, by content and then by name (§5.2 table). */
export function sniffFile(name: string, bytes: Uint8Array): SniffedKind {
  const lower = name.toLowerCase();
  if (lower.endsWith('.ekzanim') || lower.endsWith('.ekzanim.json')) return 'project';
  const json = glbJson(bytes);
  if (json === null) return lower.endsWith('.vrma') ? 'vrma' : 'unsupported';
  if (hasExtension(json, 'VRMC_vrm_animation') || lower.endsWith('.vrma')) return 'vrma';
  if (hasExtension(json, 'VRMC_vrm') || hasExtension(json, 'VRM')) return 'vrm';
  const skinned = (json.skins ?? []).length > 0 || (json.nodes ?? []).some((node) => node.skin !== undefined);
  return skinned ? 'skinned' : 'static';
}

/** Triangles of the file's mesh instances (each node with a mesh, once per instance), from the accessors. */
export function gltfTriangles(json: GltfLike): number {
  const meshes = json.meshes ?? [];
  const accessors = json.accessors ?? [];
  const meshTriangles = (index: number): number => {
    let total = 0;
    for (const primitive of meshes[index]?.primitives ?? []) {
      const mode = primitive.mode ?? 4;
      const indices = primitive.indices === undefined ? undefined : accessors[primitive.indices]?.count;
      const position = primitive.attributes?.['POSITION'];
      const count = indices ?? (position === undefined ? 0 : (accessors[position]?.count ?? 0));
      if (mode === 4) total += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) total += Math.max(0, count - 2);
    }
    return total;
  };
  const instances = (json.nodes ?? []).filter((node) => typeof node.mesh === 'number');
  if (instances.length === 0) return meshes.reduce((sum, _, i) => sum + meshTriangles(i), 0);
  return instances.reduce((sum, node) => sum + meshTriangles(node.mesh as number), 0);
}

const textured = (json: GltfLike | null): boolean =>
  json !== null && (json.textures ?? []).length > 0 && (json.images ?? []).length > 0;

// ---------------------------------------------------------------------------------------------------------------------
// the report of scene meshes (inspect)

/** Waits until every mesh's data is resident (C2's geometry reads the triangles); bounded (5 s). */
async function residentGeometry(app: EditorApp, meshes: readonly MeshId[]): Promise<RigGeometry> {
  for (let attempt = 0; ; attempt++) {
    try {
      return rigGeometry(app, app.store, meshes);
    } catch (error) {
      if (!(error instanceof EkzaError) || error.code !== 'mesh-loading' || attempt >= 200) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The live scene meshes among `ids` (an Auto-Rig subject before Create Skeleton). */
function sceneMeshes(view: ReadView, ids: readonly unknown[]): MeshId[] | string {
  if (ids.length === 0) return NO_SCENE_MESHES;
  const out: MeshId[] = [];
  for (const id of ids) {
    if (typeof id !== 'string') return 'meshes must be mesh ids';
    const record = view.get('meshes', id as MeshId);
    if (record === undefined) return `Unknown mesh ${id}`;
    if (!('scene' in record.owner)) return 'Works on scene meshes, before Create Skeleton';
    if (!out.includes(record.id)) out.push(record.id);
  }
  return out;
}

/** The one model asset every mesh comes from, or null. */
function sharedAsset(view: ReadView, meshes: readonly MeshId[]): AssetId | null {
  let asset: AssetId | null = null;
  for (const id of meshes) {
    const source = view.get('meshes', id)?.source ?? null;
    if (source === null || (asset !== null && source.asset !== asset)) return null;
    asset = source.asset;
  }
  return asset;
}

async function assetJson(app: EditorApp, asset: AssetId | null): Promise<GltfLike | null> {
  if (asset === null) return null;
  try {
    return glbJson(app.services.assets.peek(asset) ?? (await app.services.assets.get(asset)));
  } catch {
    return null;
  }
}

/** The IntakeReport of scene meshes as they are now (§5.2 checks; C2's start checks and guess). */
export async function inspectMeshes(
  app: EditorApp,
  meshes: readonly MeshId[],
  kind: IntakeReport['kind'] = 'static',
): Promise<IntakeReport> {
  await loadMeshKernel();
  const geometry = await residentGeometry(app, meshes);
  const runtimes = kernelMeshes(app);
  let triangles = 0;
  for (const id of meshes) triangles += (runtimes?.get(id)?.triangulation().tris.length ?? 0) / 3;
  const [lo, hi] = geometry.bounds;
  const height = hi[1] - lo[1];
  const start = quickRigStartChecks(geometry.bounds, geometry.bvh);
  const upright = height > 0 && hi[2] - lo[2] <= UPRIGHT_RATIO * height;
  const guess = upright ? guessMarkers(geometry.bvh, geometry.bounds) : null;
  const assetId = sharedAsset(app.store, meshes);
  const asset = assetId === null ? undefined : app.store.get('assets', assetId);
  return {
    kind,
    fileName: asset?.name ?? null,
    bytes: asset?.size ?? null,
    meshes: kind === 'static' ? [...meshes] : [],
    triangles,
    textured: textured(await assetJson(app, assetId)),
    height: Number.isFinite(height) ? Math.max(0, height) : 0,
    checks: { ...start, upright, scale: scaleOf(height) },
    weight: weightOf(triangles),
    pose: guess === null ? null : poseClassOf(guess.armAngle),
  };
}

/** The report of an imported character (VRM, rigged humanoid): facts from its runtime once it has loaded. */
async function characterReport(
  app: EditorApp,
  character: CharacterId,
  kind: 'vrm' | 'rigged-humanoid',
  file: { readonly name: string; readonly bytes: number | null; readonly json: GltfLike | null },
): Promise<IntakeReport> {
  let runtime = app.characters.get(character);
  for (let attempt = 0; runtime === undefined && attempt < 200; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    runtime = app.characters.get(character);
  }
  const json = file.json ?? (runtime === undefined ? null : (runtime.container.json as GltfLike));
  const height = runtime?.skeleton.height ?? 0;
  const triangles = json === null ? 0 : gltfTriangles(json);
  return {
    kind,
    fileName: file.name,
    bytes: file.bytes,
    meshes: [],
    triangles,
    textured: textured(json),
    height,
    // The start checks are the static meshes' (§5.2); an imported character is placed by its own file.
    checks: { centred: true, grounded: true, facing: true, upright: true, scale: scaleOf(height) },
    weight: weightOf(triangles),
    pose: null,
  };
}

const EMPTY_REPORT = (kind: IntakeReport['kind'], name: string, bytes: number): IntakeReport => ({
  kind,
  fileName: name,
  bytes,
  meshes: [],
  triangles: 0,
  textured: false,
  height: 0,
  checks: { centred: true, grounded: true, facing: true, upright: true, scale: 'ok' },
  weight: 'light',
  pose: null,
});

/** A skinned GLB the shipped importer maps to the VRM humanoid (`skeletonFromGltf` + the required bones). */
async function mapsHumanoid(bytes: Uint8Array): Promise<boolean> {
  const { parseGlb, skeletonFromGltf } = await import('@ekza-studio/io');
  const skeleton = skeletonFromGltf(await parseGlb(bytes));
  const map = skeleton.humanoid;
  return map !== null && VRM_REQUIRED_BONES.every((bone) => Number.isInteger(map[bone]));
}

// ---------------------------------------------------------------------------------------------------------------------
// operators

interface IntakeArgs {
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly dropSkin?: boolean;
}

function intakeArgsProblem(raw: unknown): string | null {
  if (!isRecord(raw) || !(raw['bytes'] instanceof Uint8Array) || typeof raw['name'] !== 'string') {
    return 'expects { bytes, name }';
  }
  if (raw['dropSkin'] !== undefined && typeof raw['dropSkin'] !== 'boolean') return 'dropSkin must be true or false';
  return null;
}

/** §5.2: one import by the sniffed kind; returns the report. Runs from a composition's `prepare`. */
export async function intakeFile(ctx: Parameters<typeof forward>[0], args: IntakeArgs): Promise<IntakeReport> {
  const { app } = ctx;
  const { bytes } = args;
  const name = args.name.trim() === '' ? 'model.glb' : args.name.trim();
  const kind = sniffFile(name, bytes);
  if (kind === 'vrma') throw new EkzaError('autorig.animation', ANIMATION_FILE);
  if (kind === 'unsupported') throw new EkzaError('unsupported', UNSUPPORTED_FILE);
  if (kind === 'project') {
    await forward(ctx, 'file.openProject', { name, bytes });
    const meshes = app.store.list('meshes').filter((mesh) => 'scene' in mesh.owner);
    if (app.store.list('characters').length > 0 || meshes.length === 0) {
      return EMPTY_REPORT('project', name, bytes.byteLength);
    }
    const report = await inspectMeshes(
      app,
      meshes.map((mesh) => mesh.id),
      'project',
    );
    return { ...report, fileName: name, bytes: bytes.byteLength };
  }
  const json = glbJson(bytes);
  const triangles = json === null ? 0 : gltfTriangles(json);
  if (triangles > MAX_TRIANGLES) throw new EkzaError('autorig.too-heavy', tooHeavyMessage(triangles));
  const file = { name, bytes: bytes.byteLength, json };
  if (kind === 'vrm' || (kind === 'skinned' && args.dropSkin !== true)) {
    const humanoid = kind === 'vrm' || (await mapsHumanoid(bytes));
    if (!humanoid)
      return { ...EMPTY_REPORT('rigged-other', name, bytes.byteLength), triangles, textured: textured(json) };
    const imported = (await forward(ctx, 'file.importModel', { name, bytes })) as { readonly character: CharacterId };
    return characterReport(app, imported.character, kind === 'vrm' ? 'vrm' : 'rigged-humanoid', file);
  }
  const imported = (await forward(ctx, 'mesh.importStatic', {
    bytes,
    name,
    ...(args.dropSkin === true ? { dropSkin: true } : {}),
  })) as { readonly meshes: readonly MeshId[] };
  const report = await inspectMeshes(app, imported.meshes);
  return { ...report, fileName: name, bytes: bytes.byteLength };
}

const sample = defineOperator<'autorig.sample', IntakeReport>({
  id: 'autorig.sample',
  label: 'Load Auto-Rig Sample',
  description: 'Loads a sample model at the Model step: the Cube Lad, Polybot (T- or A-pose, no rig), or a VRM sample.',
  category: 'autorig',
  scope: 'global',
  poll(_ctx, args) {
    return isRecord(args) && (SAMPLE_IDS as readonly unknown[]).includes(args['sample'])
      ? OK
      : fail(`expects { sample: ${SAMPLE_IDS.join(' | ')} }`);
  },
  async prepare(ctx, args) {
    const file = STATIC_SAMPLES[args.sample];
    if (file === undefined) {
      if (!VRM_SAMPLES.has(args.sample)) throw new EkzaError('invalid-input', `Unknown sample ${args.sample}`);
      const imported = (await forward(ctx, 'file.loadSample', { sample: args.sample })) as {
        readonly character: CharacterId;
      };
      return characterReport(ctx.app, imported.character, 'vrm', {
        name: `${args.sample}.vrm`,
        bytes: null,
        json: null,
      });
    }
    const base = ctx.app.services.samplesPath ?? SAMPLE_BASE_URL;
    let response: Response;
    try {
      response = await fetch(`${base.endsWith('/') ? base : `${base}/`}${file}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new EkzaError('asset-missing', `The sample ${file} could not be downloaded: ${message}`);
    }
    if (!response.ok) {
      throw new EkzaError('asset-missing', `The sample ${file} could not be downloaded (HTTP ${response.status})`);
    }
    return intakeFile(ctx, { bytes: new Uint8Array(await response.arrayBuffer()), name: file });
  },
  apply: (_ctx, _args, report) => report,
});

const intake = defineOperator<'autorig.intake', IntakeReport>({
  id: 'autorig.intake',
  label: 'Auto-Rig: Load Model',
  description: 'Loads a GLB, VRM or project for Auto-Rig by its content and reports what it found (§5.2).',
  category: 'autorig',
  scope: 'global',
  poll(_ctx, args) {
    const problem = intakeArgsProblem(args);
    return problem === null ? OK : fail(problem);
  },
  prepare: (ctx, args) => intakeFile(ctx, args),
  apply: (_ctx, _args, report) => report,
});

const inspect = defineOperator<'autorig.inspect', IntakeReport>({
  id: 'autorig.inspect',
  label: 'Auto-Rig: Inspect Model',
  description: 'Reports the checks of scene meshes as they are now: centred, grounded, facing, upright, size, pose.',
  category: 'autorig',
  scope: 'global',
  poll({ app }, args) {
    if (!isRecord(args) || !Array.isArray(args['meshes'])) return fail('expects { meshes }');
    const meshes = sceneMeshes(app.store, args['meshes']);
    return typeof meshes === 'string' ? fail(meshes) : OK;
  },
  async prepare({ app }, args) {
    const meshes = sceneMeshes(app.store, args.meshes);
    if (typeof meshes === 'string') throw new EkzaError('op-refused', meshes);
    return inspectMeshes(app, meshes);
  },
  apply: (_ctx, _args, report) => report,
});

// ---------------------------------------------------------------------------------------------------------------------
// fixes

/** New local placements for the meshes after a world-space `delta` (a mesh under another one of them moves with it). */
export function placementsAfter(
  view: ReadView,
  meshes: readonly MeshId[],
  delta: ReadonlyXf,
): { readonly ids: MeshId[]; readonly placements: ReadonlyXf[] } {
  const targets = new Set<string>(meshes);
  const ids: MeshId[] = [];
  const placements: ReadonlyXf[] = [];
  for (const id of meshes) {
    const record = view.get('meshes', id);
    if (record === undefined) continue;
    let parent: string | null = record.parent;
    let nested = false;
    const seen = new Set<string>();
    while (parent !== null && !seen.has(parent)) {
      if (targets.has(parent)) nested = true;
      seen.add(parent);
      const node: { readonly parent: string | null } | undefined = parent.startsWith('grp_')
        ? view.get('groups', parent as never)
        : view.get('meshes', parent as MeshId);
      parent = node?.parent ?? null;
    }
    if (nested) continue;
    const world = xfMultiply(delta, worldPlacement(view, record));
    ids.push(id);
    placements.push(localFromWorld(view, record.owner, record.parent, world));
  }
  return { ids, placements };
}

/** `standUp`: −90° about X around the bounds centre (+Z up becomes +Y up). */
export function standUpDelta(bounds: RigGeometry['bounds']): ReadonlyXf {
  const c = [0, 1, 2].map((k) => ((bounds[0][k] as number) + (bounds[1][k] as number)) / 2) as [number, number, number];
  // T(c)·Rx(−90°)·T(−c): Rx(−90°) maps (x, y, z) to (x, z, −y).
  return {
    t: [0, c[1] - c[2], c[2] + c[1]],
    q: quatFromAxisAngle([1, 0, 0], -Math.PI / 2),
    s: [1, 1, 1],
  };
}

/** `scale`: a uniform scale to `height` about the ground point (the bounds' bottom centre). */
export function scaleDelta(bounds: RigGeometry['bounds'], height: number): ReadonlyXf {
  const current = bounds[1][1] - bounds[0][1];
  const k = height / current;
  const g = [(bounds[0][0] + bounds[1][0]) / 2, bounds[0][1], (bounds[0][2] + bounds[1][2]) / 2];
  // T(g)·S(k)·T(−g)
  return {
    t: [(g[0] as number) * (1 - k), (g[1] as number) * (1 - k), (g[2] as number) * (1 - k)],
    q: [0, 0, 0, 1],
    s: [k, k, k],
  };
}

const fix = defineOperator<'autorig.fix'>({
  id: 'autorig.fix',
  label: 'Auto-Rig: Fix Model',
  description: 'One-click fixes of the Model step: centre and ground, face +Z, stand up, set the size, freeze.',
  category: 'autorig',
  scope: 'global',
  poll({ app }, args) {
    if (!isRecord(args) || !(FIXES as readonly unknown[]).includes(args['fix'])) {
      return fail(`expects { fix: ${FIXES.join(' | ')}, meshes }`);
    }
    if (!Array.isArray(args['meshes'])) return fail('expects { fix, meshes }');
    const height = args['height'];
    if (height !== undefined && !(typeof height === 'number' && Number.isFinite(height) && height > 0)) {
      return fail('height must be a positive number of metres');
    }
    const meshes = sceneMeshes(app.store, args['meshes']);
    return typeof meshes === 'string' ? fail(meshes) : OK;
  },
  async prepare(ctx, args) {
    const { app } = ctx;
    const meshes = sceneMeshes(app.store, args.meshes);
    if (typeof meshes === 'string') throw new EkzaError('op-refused', meshes);
    switch (args.fix) {
      case 'center':
        await forward(ctx, 'skel.quickRig.center', { meshes });
        return;
      case 'face':
        await forward(ctx, 'skel.quickRig.faceForward', { meshes });
        return;
      case 'freeze':
        await forward(ctx, 'mesh.freezeTransforms', { ids: meshes, translate: false, rotate: true, scale: true });
        return;
      case 'standUp':
      case 'scale': {
        await loadMeshKernel();
        const { bounds } = await residentGeometry(app, meshes);
        if (args.fix === 'scale' && !(bounds[1][1] - bounds[0][1] > 0)) {
          throw new EkzaError('op-refused', 'The model has no height to scale');
        }
        const delta =
          args.fix === 'standUp' ? standUpDelta(bounds) : scaleDelta(bounds, args.height ?? SIZE_LIMITS.target);
        await forward(ctx, 'scene.object.transform', placementsAfter(app.store, meshes, delta));
        return;
      }
    }
  },
  apply() {},
});

export const WIZARD_INTAKE_OPERATORS: readonly AnyOperator[] = [sample, intake, inspect, fix];
