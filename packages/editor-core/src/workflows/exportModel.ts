// The lazy half of B8's editor-core workflows (a chunk loaded on first use, like the animation export pipeline; the
// eager half is `workflows/meshDisplay.ts`):
//
// - static-model export (M6A-SPEC §6.2 `file.exportModel`, §5.19, §5.22): the export roots (the request's objects,
//   else the selected objects, else every top-level scene object) become a `StaticScene` — TRS nodes, meshes with
//   their latest revisions, materials from the mesh presets, the palettes they paint with, the handheld grip of the
//   root, and `ekza_model_v1` — written by io's author writer, linted for the profile (budgets resolved per mesh, Mesh
//   Check, palette, handheld), read back, and validated by the host's glTF-Validator when it has one;
// - the edits of a character as surgeon `PrimitiveEdit`s (bake into model, §5.22) and its rebuilt display container
//   (§5.23);
// - Make editable's record (§5.21), built from the lazy io/mesh entry for `mesh.makeEditable`.
import { EkzaError } from '@ekza-animator/anim-core';
import type {
  CharacterId,
  ColourOutput,
  GroupId,
  GroupRecord,
  MeshBudget,
  MeshId,
  MeshRecord,
  PaletteId,
} from '@ekza-animator/doc';
import type {
  ExportArtifact,
  ExportProfileDef,
  GlbContainer,
  LintIssue,
  MakeEditableReport,
  PrimitiveEdit,
  StaticExportRequest,
  StaticNode,
} from '@ekza-animator/io';
import type { MeshLintInput } from '@ekza-animator/io/write';
import type { MeshData } from '@ekza-animator/mesh-core';
import { isAssetCharacter } from '../characters/registry';
import { loadMeshKernel } from '../mesh';
import type { CharacterRuntime, EditorApp, MeshRuntimeRegistry } from '../types';
import { loadWritePath } from './export';
import { assetMeshId, characterMeshRecords, isEditedMesh } from './meshDisplay';
import { orderAfter } from './records';
import { EDITOR_VERSION } from './samples';

type SceneObject = MeshRecord | GroupRecord;

const isMesh = (record: SceneObject): record is MeshRecord => 'data' in record;

/** The export roots of a request (§4.5 `StaticExportRequest.objects`). */
export function exportRoots(app: EditorApp, req: Pick<StaticExportRequest, 'objects'>): readonly SceneObject[] {
  const lookup = (id: string): SceneObject | undefined =>
    app.store.get('meshes', id as MeshId) ?? app.store.get('groups', id as GroupId);
  let ids: readonly string[] = req.objects;
  if (ids.length === 0) ids = app.session.getState().selection.objects;
  if (ids.length === 0) return app.store.query.childrenOf(null, 'scene');
  const roots: SceneObject[] = [];
  for (const id of ids) {
    const record = lookup(id);
    if (record !== undefined && !roots.includes(record)) roots.push(record);
  }
  return roots;
}

/** Why a static export request cannot run, or null. */
export function exportModelProblem(app: EditorApp, req: unknown): string | null {
  if (typeof req !== 'object' || req === null) return 'expects a static export request';
  const r = req as Partial<StaticExportRequest>;
  if (!Array.isArray(r.objects) || !r.objects.every((id) => typeof id === 'string')) return 'expects a list of objects';
  if (typeof r.fileName !== 'string' || r.fileName.trim() === '') return 'expects a file name';
  if (r.profile !== null && typeof r.profile !== 'string') return 'expects a profile id or null';
  if (
    r.colourOutput !== undefined &&
    !['palette-texture', 'vertex-colour', 'material-per-colour'].includes(r.colourOutput)
  ) {
    return `Unknown colour output '${String(r.colourOutput)}'`;
  }
  if (r.materialPreset !== undefined && r.materialPreset !== 'unlit' && r.materialPreset !== 'lit') {
    return r.materialPreset === ('toon' as never)
      ? 'Toon palette arrives with the VRM writer (v0.4)'
      : `Unknown material preset '${String(r.materialPreset)}'`;
  }
  if (typeof r.profile === 'string') {
    const profile = app.exportProfiles.get(r.profile);
    if (profile === undefined) return `Unknown export profile '${r.profile}'`;
    if (profile.kind !== 'static-glb' && profile.kind !== '*') return `${profile.label} is not a static model profile`;
  }
  for (const id of r.objects) {
    const record = app.store.get('meshes', id as MeshId) ?? app.store.get('groups', id as GroupId);
    if (record === undefined) return `Object ${id} does not exist`;
    if ('character' in record.owner) {
      return `${record.name} belongs to a character: it is exported with the character (bake into model)`;
    }
  }
  const roots = exportRoots(app, r as StaticExportRequest);
  const meshes = roots.flatMap((root) => meshesUnder(app, root));
  if (meshes.length === 0) return 'Nothing to export: create a mesh first';
  if (meshes.some((mesh) => 'character' in mesh.owner))
    return 'Select scene objects to export (character meshes bake into the character)';
  const toon = meshes.find((mesh) => 'preset' in mesh.material && mesh.material.preset === 'toon');
  if (toon !== undefined && r.materialPreset === undefined) return 'Toon palette arrives with the VRM writer (v0.4)';
  return null;
}

/** The mesh records at or under a scene object. */
function meshesUnder(app: EditorApp, root: SceneObject): MeshRecord[] {
  const out: MeshRecord[] = [];
  const visit = (record: SceneObject, depth: number): void => {
    if (depth > 1000) return;
    if (isMesh(record)) out.push(record);
    for (const child of app.store.query.childrenOf(record.id, 'scene')) visit(child, depth + 1);
  };
  visit(root, 0);
  return out;
}

/** The revision data of a mesh once its runtime is ready (waits for the kernel and a loading runtime). */
async function readyData(meshes: MeshRuntimeRegistry, id: MeshId, name: string): Promise<MeshData> {
  await loadMeshKernel();
  const runtime = meshes.get(id);
  if (runtime !== undefined && runtime.state === 'loading') {
    await new Promise<void>((resolve) => {
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
    });
  }
  const data = runtime?.data() ?? null;
  if (data === null) {
    throw new EkzaError('mesh-not-ready', `${name}: ${runtime?.error ?? 'its mesh data is not available'}`);
  }
  return data;
}

function liveSwatches(app: EditorApp, palette: PaletteId) {
  const slots = [...new Set(app.store.query.swatchesOfPalette(palette).map((swatch) => swatch.slot))].sort(
    (a, b) => a - b,
  );
  return slots.flatMap((slot) => {
    const swatch = app.store.query.swatchBySlot(palette, slot);
    return swatch === undefined ? [] : [{ slot, srgb: swatch.srgb }];
  });
}

/** Runs a static export (§6.2): one artifact; error lints block the download in the operator. */
export async function runExportModel(app: EditorApp, req: StaticExportRequest): Promise<ExportArtifact> {
  const problem = exportModelProblem(app, req);
  if (problem !== null) throw new EkzaError('unsupported', problem);
  const write = await loadWritePath();
  const profile: ExportProfileDef | null = req.profile === null ? null : (app.exportProfiles.get(req.profile) ?? null);
  const roots = exportRoots(app, req);
  const palettes = new Map<
    string,
    readonly { readonly slot: number; readonly srgb: readonly [number, number, number] }[]
  >();
  const meshInputs: MeshLintInput[] = [];

  const build = async (record: SceneObject, rootBudget: MeshBudget): Promise<StaticNode> => {
    const children: StaticNode[] = [];
    for (const child of app.store.query.childrenOf(record.id, 'scene')) children.push(await build(child, rootBudget));
    if (!isMesh(record)) {
      return { id: record.id, name: record.name, placement: record.placement, mesh: null, children };
    }
    const data = await readyData(app.meshes, record.id, record.name);
    const colourOutput: ColourOutput = req.colourOutput ?? record.colourOutput;
    const preset =
      req.materialPreset ??
      ('preset' in record.material && record.material.preset !== 'toon' ? record.material.preset : 'unlit');
    const slots = Math.max(1, ...Array.from(data.faceMaterial, (slot) => slot + 1));
    const swatches = record.palette === null ? [] : liveSwatches(app, record.palette);
    if (record.palette !== null && !palettes.has(record.palette)) palettes.set(record.palette, swatches);
    const usedSlots = new Set<number>();
    const paint = data.layers.get('paint');
    if (paint !== undefined) for (let f = 0; f < data.counts.faces; f++) usedSlots.add(paint.data[f] as number);
    const textureSide =
      colourOutput === 'palette-texture' && record.palette !== null ? (swatches.length <= 64 ? 64 : 128) : 0;
    meshInputs.push({
      id: record.id,
      name: record.name,
      data,
      budget: write.resolveBudget(record.budget, rootBudget, profile),
      swatchSlots: record.palette === null ? null : new Set(swatches.map((swatch) => swatch.slot)),
      materials: colourOutput === 'material-per-colour' ? Math.max(1, usedSlots.size) : 1,
      textureSide,
      joints: 0,
    });
    return {
      id: record.id,
      name: record.name,
      placement: record.placement,
      mesh: {
        data,
        materials: Array.from({ length: slots }, () => ({ preset, name: record.name })),
        colourOutput,
        paletteId: record.palette,
      },
      children,
    };
  };

  const nodes: StaticNode[] = [];
  for (const root of roots) nodes.push(await build(root, root.budget));
  const handheld = roots.find((root) => root.handheld !== null)?.handheld ?? null;
  const fileName = /\.glb$/i.test(req.fileName) ? req.fileName : `${req.fileName}.glb`;
  let artifact = await write.exportStaticModel(
    {
      roots: nodes,
      palettes,
      handheld,
      model: write.manualModelProvenance({ toolVersion: EDITOR_VERSION }),
    },
    { fileName, profile, generator: `Ekza Animator ${EDITOR_VERSION}`, meshes: meshInputs },
  );
  const validate = app.services.validate;
  if (req.validate !== false && validate !== null) {
    const report = await validate(artifact.bytes);
    const lints: LintIssue[] = report.issues
      .filter((issue) => issue.severity === 0)
      .map((issue) => ({
        code: `validator.${issue.code}`,
        severity: 'error',
        message: `glTF-Validator: ${issue.message}`,
        ...(issue.pointer === undefined ? {} : { pointer: issue.pointer }),
      }));
    artifact = { ...artifact, validation: report, lints: [...artifact.lints, ...lints] };
  }
  return artifact;
}

// ---------- character edits and the display (§5.22, §5.23) ----------

/**
 * The edited meshes of a character as surgeon edits (§5.22): the latest revision of every record whose revision moved
 * past Make editable's, with the source facts the export needs (targets that had NORMAL deltas, tangents).
 */
export async function characterEdits(
  app: Pick<EditorApp, 'store' | 'meshes' | 'characters'>,
  character: CharacterId,
  opts: { readonly dropTangents?: boolean } = {},
): Promise<PrimitiveEdit[]> {
  const records = characterMeshRecords(app.store, character).filter(isEditedMesh);
  if (records.length === 0) return [];
  const runtime = app.characters.get(character);
  if (runtime === undefined) throw new EkzaError('unsupported', 'The character is still loading');
  const io = await (await loadWritePath()).loadMeshIo();
  const edits: PrimitiveEdit[] = [];
  for (const record of records) {
    const meshIndex = (record.source as { readonly mesh: number }).mesh;
    const facts = io.meshFacts(runtime.container, meshIndex);
    edits.push({
      meshIndex,
      data: await readyData(app.meshes, record.id, record.name),
      morphNormals: new Set(facts.morphNormals),
      hadTangents: facts.hadTangents,
      dropTangents: opts.dropTangents === true,
    });
  }
  return edits;
}

/**
 * The container to display for a character: its model rebuilt with the edited meshes (tangents dropped: display
 * only), or null when it has none (its own container).
 */
export async function displayContainer(
  app: Pick<EditorApp, 'store' | 'meshes' | 'characters'>,
  runtime: CharacterRuntime,
): Promise<GlbContainer | null> {
  const edits = await characterEdits(app, runtime.id, { dropTangents: true });
  if (edits.length === 0) return null;
  return (await loadWritePath()).rebuildContainer(runtime.container, edits);
}

// ---------- Make editable (§5.21) ----------

export interface MakeEditablePrepared {
  readonly record: MeshRecord;
  readonly data: MeshData;
  readonly report: MakeEditableReport;
}

/**
 * Builds the record and first revision of a character's glTF mesh (`mesh.makeEditable`'s prepare): the lazy io/mesh
 * entry decodes, welds and gates; the record gets the derived id, the source, the imported skin, the asset's material
 * slots, a unique name among the owner's meshes and the mesh node's placement. Throws the refusal's code and reason.
 */
export async function prepareMakeEditable(
  app: EditorApp,
  args: { readonly character: CharacterId; readonly meshIndex: number },
): Promise<MakeEditablePrepared> {
  const character = app.store.get('characters', args.character);
  const runtime = app.characters.get(args.character);
  if (character === undefined || !isAssetCharacter(character) || runtime === undefined) {
    throw new EkzaError('unsupported', 'The character is still loading');
  }
  await loadMeshKernel();
  const io = await (await loadWritePath()).loadMeshIo();
  const result = await io.meshFromGltf(runtime.container, args.meshIndex);
  if ('refused' in result) throw new EkzaError(result.code, result.reason);
  const json = runtime.container.json;
  const nodes = Array.isArray(json['nodes']) ? (json['nodes'] as unknown[]) : [];
  const mesh = (json['meshes'] as unknown[])[args.meshIndex];
  const name = isRecordValue(mesh) && typeof mesh['name'] === 'string' ? mesh['name'] : `Mesh ${args.meshIndex}`;
  const skinned = nodes.find(
    (node) => isRecordValue(node) && node['mesh'] === args.meshIndex && typeof node['skin'] === 'number',
  );
  const skin = isRecordValue(skinned) ? (skinned['skin'] as number) : null;
  const record: MeshRecord = {
    id: assetMeshId(character.id, args.meshIndex),
    name: uniqueName(app, character.id, name),
    owner: { character: character.id },
    parent: null,
    order: orderAfter(app.store.query.meshesOfOwner(character.id).map((other) => other.order)),
    placement: placementOf(nodes, args.meshIndex),
    pivot: [0, 0, 0],
    source: { asset: character.asset, mesh: args.meshIndex },
    data: null,
    faceted: false,
    generator: null,
    palette: null,
    material: { assetSlots: result.slots.map((slot) => ({ asset: character.asset, material: slot.material })) },
    colourOutput: 'palette-texture',
    skin: skin === null ? null : { asset: character.asset, skin },
    budget: null,
    handheld: null,
    deleted: null,
  };
  return { record, data: result.data, report: result.report };
}

function isRecordValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A unique record name among the owner's live meshes (≤ 64 characters; ' 2', ' 3' … on a clash). */
function uniqueName(app: EditorApp, character: CharacterId, wanted: string): string {
  const taken = new Set(app.store.query.meshesOfOwner(character).map((record) => record.name));
  const base = (wanted.trim() === '' ? 'Mesh' : wanted.trim()).slice(0, 60);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

type Quat = readonly [number, number, number, number];

function qmul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/**
 * Placement of the record (object transform under the character root): identity for skinned meshes (glTF ignores
 * their node transform), else the composed rest TRS of the first node using the mesh (matrix nodes count as identity).
 */
function placementOf(nodes: readonly unknown[], meshIndex: number): MeshRecord['placement'] {
  const identity: MeshRecord['placement'] = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
  const index = nodes.findIndex((node) => isRecordValue(node) && node['mesh'] === meshIndex);
  const node = nodes[index];
  if (!isRecordValue(node) || node['skin'] !== undefined) return identity;
  const parentOf = new Map<number, number>();
  nodes.forEach((n, i) => {
    if (isRecordValue(n) && Array.isArray(n['children'])) {
      for (const child of n['children'] as unknown[]) parentOf.set(child as number, i);
    }
  });
  const chain: Readonly<Record<string, unknown>>[] = [];
  for (let i: number | undefined = index; i !== undefined && chain.length <= nodes.length; i = parentOf.get(i)) {
    const n = nodes[i];
    if (isRecordValue(n)) chain.unshift(n);
  }
  let t: readonly [number, number, number] = [0, 0, 0];
  let q: Quat = [0, 0, 0, 1];
  let s: readonly [number, number, number] = [1, 1, 1];
  const triple = (value: unknown, fallback: number): [number, number, number] => {
    const list = Array.isArray(value) ? (value as unknown[]) : [];
    const at = (k: number): number => {
      const c = list[k];
      return typeof c === 'number' ? c : fallback;
    };
    return [at(0), at(1), at(2)];
  };
  for (const n of chain) {
    const nt = triple(n['translation'], 0);
    const rotation = Array.isArray(n['rotation']) ? (n['rotation'] as number[]) : [0, 0, 0, 1];
    const ns = triple(n['scale'], 1);
    const local: Quat = [nt[0] * s[0], nt[1] * s[1], nt[2] * s[2], 0];
    const r = qmul(qmul(q, local), [-q[0], -q[1], -q[2], q[3]]);
    t = [t[0] + r[0], t[1] + r[1], t[2] + r[2]];
    q = qmul(q, [rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, rotation[3] ?? 1]);
    s = [s[0] * ns[0], s[1] * ns[1], s[2] * ns[2]];
  }
  return { t, q, s };
}
