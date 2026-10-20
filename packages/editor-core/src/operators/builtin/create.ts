// Primitive creation (M6A-SPEC §5.16, §6.2, §6.3; B7): `mesh.create.<kind>` creates an authored scene mesh at the world
// origin, centred (Maya), selected, in object mode: `faceted: true`, every edge hard (the kernel's primitives are
// faceted), the default palette (created by this first modeling action when missing, B13), live parameters in `generator` (§6.3 with the
// `prefs.modeling.primitiveDefaults` set), id `derivedId('mesh', 'mesh.create.<kind>', [], seed, 0)` so an adjusted
// re-run (Last-op card, INPUTS) keeps the id. With exactly one template group as the lead of the object selection the
// mesh is created as its child at the group's origin and takes the template's symmetry (humanoid: Object X).
//
// The kernel is a lazy chunk: `prepare` loads it and builds the primitive (the B0a reference kernel builds cube,
// plane and cylinder; sphere, cone and torus poll-fail until B1's kernel provides them).
import { coerceArgs, EkzaError, type ParamValues, xfIdentity } from '@ekza-animator/anim-core';
import { derivedId, type GroupId, type GroupRecord, type MeshRecord } from '@ekza-animator/doc';
import { MAYA_PRIMITIVE_DEFAULTS, PRIMITIVE_PARAMS } from '@ekza-animator/mesh-core/descriptors';
import type { MeshData, PrimitiveKind } from '@ekza-animator/mesh-core';
import { attachMeshes, type KernelMeshRuntimes, loadMeshKernel, meshKernel } from '../../mesh';
import { orderAfterSiblings, uniqueMeshName } from '../../mesh/records';
import { runSeed } from '../../mesh/seed';
import type { EditorApp, OperatorContext, PollResult, SymmetrySettings } from '../../types';
import { type AnyOperator, defineOperator, fail, OK } from './define';
import { type ContentApplyModule, loadContentApply } from './contentLoad';

type CreateKind = Exclude<PrimitiveKind, 'humanoidBody'>;

const LABELS: Readonly<Record<CreateKind, string>> = {
  cube: 'Cube',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  plane: 'Plane',
  torus: 'Torus',
};

/** The default palette's id (M6A-SPEC §3 rule 3; B13's palette module owns it). */
export { DEFAULT_PALETTE_ID } from './palette';

/** Kinds the loaded kernel can build (probed once per kernel module). */
const supported = new WeakMap<object, Map<CreateKind, boolean>>();
function kernelBuilds(kind: CreateKind): boolean | null {
  const kernel = meshKernel();
  if (kernel === null) return null;
  let known = supported.get(kernel);
  if (known === undefined) {
    known = new Map();
    supported.set(kernel, known);
  }
  let ok = known.get(kind);
  if (ok === undefined) {
    try {
      kernel.primitive(kind, {});
      ok = true;
    } catch (error) {
      if (!(error instanceof EkzaError) || error.code !== 'not-implemented') throw error;
      ok = false;
    }
    known.set(kind, ok);
  }
  return ok;
}

/** The primitive parameters of a run: §6.3 defaults of the preferred set, then the given args (coerced). */
export function primitiveArgs(app: EditorApp, kind: CreateKind, raw: unknown): ParamValues {
  const preferred = app.prefs.getState().modeling.primitiveDefaults;
  const given = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const base = preferred === 'maya' ? MAYA_PRIMITIVE_DEFAULTS[kind] : {};
  return coerceArgs(PRIMITIVE_PARAMS[kind], { ...base, ...given }).args;
}

/** The template group a new mesh goes into: exactly one template group, the lead of the object selection. */
export function templateGroupOf(app: EditorApp): GroupRecord | null {
  const objects = app.session.getState().selection.objects;
  const lead = objects[objects.length - 1];
  if (lead === undefined || !lead.startsWith('grp_')) return null;
  const group = app.store.get('groups', lead as GroupId);
  if (group === undefined || group.template === null) return null;
  const templates = objects.filter((id) => id.startsWith('grp_') && app.store.get('groups', id as GroupId)?.template);
  return templates.length === 1 ? group : null;
}

type PrimitiveParams = Readonly<Record<string, number | boolean | string>>;

interface Prepared {
  readonly params: PrimitiveParams;
  readonly data: MeshData;
  /** B13's lazy bodies (the default palette, M6A-B13-10). */
  readonly content: ContentApplyModule;
}

/** Primitive params are scalars (§6.3): nulls and JSON values never appear after coercion; drop any that would. */
function scalarParams(values: ParamValues): PrimitiveParams {
  const out: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') out[key] = value;
  }
  return out;
}

function createOperator(kind: CreateKind): AnyOperator {
  const id = `mesh.create.${kind}` as const;
  const label = LABELS[kind];
  return defineOperator<typeof id, Prepared>({
    id,
    label,
    description: `Creates a polygon ${kind} at the origin.`,
    category: 'mesh',
    scope: 'model',
    workspaces: ['model'],
    flags: { undo: true, adjustable: true, repeatable: true },
    params: PRIMITIVE_PARAMS[kind],
    ...(kind === 'cube' ? { aliases: ['Box'] } : kind === 'sphere' ? { aliases: ['UV Sphere'] } : {}),
    ...(kind === 'plane' ? { aliases: ['Grid'] } : {}),
    poll(): PollResult {
      // Before the kernel loads, `prepare` loads it; afterwards a kind it cannot build is not available yet.
      if (kernelBuilds(kind) === false) return fail(`${label} is not available yet`);
      return OK;
    },
    async prepare(ctx: OperatorContext, args): Promise<Prepared> {
      const [kernel, content] = await Promise.all([loadMeshKernel(), loadContentApply()]);
      const params = scalarParams(primitiveArgs(ctx.app, kind, args));
      return { params, data: kernel.primitive(kind, params), content };
    },
    apply(ctx, _args, prepared) {
      const { app, tx } = ctx;
      if (tx === null) throw new EkzaError('unsupported', `${id} needs a transaction`);
      const meshes = attachMeshes(app) as KernelMeshRuntimes;
      const seed = runSeed(ctx, id);
      let mesh = derivedId('mesh', id, [], seed, 0);
      for (let k = 1; tx.getIncludingDeleted('meshes', mesh) !== undefined; k++) {
        mesh = derivedId('mesh', id, [], `${seed}:${k}`, 0);
      }
      const group = templateGroupOf(app);
      const owner = group?.owner ?? { scene: true as const };
      const parent = group === null ? null : group.id;
      // B13: the first modeling action creates the default palette (§5.19, §10 "Model scene").
      const palette = prepared.content.ensureDefaultPalette(tx);
      const record: MeshRecord = {
        id: mesh,
        name: uniqueMeshName(tx, owner, label),
        owner,
        parent,
        order: orderAfterSiblings(tx, owner, parent),
        placement: xfIdentity(),
        pivot: [0, 0, 0],
        source: null,
        data: meshes.storeRevision(prepared.data, null, []),
        faceted: true,
        generator: { kind, params: prepared.params, version: 1 },
        palette,
        material: { preset: 'unlit' },
        colourOutput: 'palette-texture',
        skin: null,
        budget: null,
        handheld: null,
        deleted: null,
      };
      tx.put('meshes', record);
      const state = app.session.getState();
      const symmetry =
        group?.template?.kind === 'humanoid'
          ? new Map(state.model.symmetry).set(mesh, {
              mode: 'object-x',
              tolerance: app.prefs.getState().modeling.symmetryTolerance,
              preserveSeam: true,
            } satisfies SymmetrySettings)
          : state.model.symmetry;
      app.session.setState({
        selection: { ...state.selection, objects: [mesh] },
        model: { ...state.model, componentMode: 'object', symmetry },
      });
      return { mesh };
    },
  });
}

export const CREATE_OPERATORS: readonly AnyOperator[] = (
  ['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'] as const
).map(createOperator);
