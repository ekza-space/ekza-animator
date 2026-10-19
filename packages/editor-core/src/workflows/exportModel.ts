// Static-model export (M6A-SPEC §6.2 `file.exportModel`, §5.19, §5.22; B8): the export roots (the request's objects,
// else the selected objects, else every top-level scene object) become a `StaticScene` — TRS nodes, meshes with
// their latest revisions, materials from the mesh presets, the palettes they paint with, the handheld grip of the
// root, and `ekza_model_v1` — written by io's author writer, linted for the profile (budgets resolved per mesh, Mesh
// Check, palette, handheld), read back, and validated by the host's glTF-Validator when it has one. A lazy chunk:
// `file.exportModel` loads it on its first run, like the animation export pipeline.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ColourOutput, GroupId, GroupRecord, MeshBudget, MeshId, MeshRecord, PaletteId } from '@ekza-animator/doc';
import type { ExportArtifact, ExportProfileDef, LintIssue, StaticExportRequest, StaticNode } from '@ekza-animator/io';
import type { MeshData } from '@ekza-animator/mesh-core';
import { loadMeshKernel } from '../mesh';
import type { EditorApp, MeshRuntimeRegistry } from '../types';
import type { MeshLintInput } from '@ekza-animator/io/write';
import { loadWritePath } from './export';
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

async function meshData(meshes: MeshRuntimeRegistry, record: MeshRecord): Promise<MeshData> {
  await loadMeshKernel();
  const runtime = meshes.get(record.id);
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
    throw new EkzaError('mesh-not-ready', `${record.name}: ${runtime?.error ?? 'its mesh data is not available'}`);
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
    const data = await meshData(app.meshes, record);
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
