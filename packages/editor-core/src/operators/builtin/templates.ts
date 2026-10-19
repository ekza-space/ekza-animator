// Starting templates and live primitive parameters (M6A-SPEC §5.16, §6.2; B13).
//
// `mesh.create.template {template, height?, style?, preset?}` (one step, adjustable): authored scene content at the
// world origin, selected, in object mode, with the default palette (the first modeling action creates it) and ids
// `derivedId(kind, 'mesh.create.template', [], seed, n)` (§3 rule 3: an adjusted re-run keeps them):
// - `prop`: a group "Prop" (template `prop`, budget `small-prop`) with a cube child whose pivot is at its bottom centre
//   on the ground;
// - `handheld`: a group "Handheld" (template `handheld`, budget `handheld`, the grip defaults; the group origin is the
//   grip, drawn as a gizmo on the helpers layer) with a 0.04 × 0.3 × 0.04 m cube child standing on the grip;
// - `humanoid`: the proportion guides — a group "Humanoid" (template `humanoid` with `height` and `preset`, budget
//   `hero`) and no mesh; meshes created into it take Object X symmetry (`mesh.create.*`, §5.16);
// - `humanoidBody`: one mesh "Body" from the kernel's generator with live parameters (`generator.kind`
//   'humanoidBody'), created into a selected template group like a primitive.
// Every mesh is faceted (all edges hard) with live parameters (`generator`) until its first component edit.
//
// `mesh.primitive.set {mesh, params}` (one step): regenerates a live primitive from its kind with the merged
// parameters (`rev + 1`, selection cleared, same id). After the first component edit `generator` is null and the
// poll fails with "Primitive parameters were frozen by a component edit".
import {
  coerceArgs,
  EkzaError,
  type ParamDef,
  type ParamValues,
  type ReadonlyVec3,
  xfIdentity,
} from '@ekza-animator/anim-core';
import {
  derivedId,
  type GroupId,
  type GroupRecord,
  type HandheldGrip,
  type IdKind,
  type MeshId,
  type MeshOwner,
  type MeshRecord,
  type ReadView,
  type Tx,
} from '@ekza-animator/doc';
import type { MeshData, PrimitiveKind } from '@ekza-animator/mesh-core';
import { PRIMITIVE_PARAMS } from '@ekza-animator/mesh-core/descriptors';
import { attachMeshes, type KernelMeshRuntimes, loadMeshKernel } from '../../mesh';
import { orderAfterSiblings, uniqueMeshName } from '../../mesh/records';
import { runSeed } from '../../mesh/seed';
import type { EditorApp, PollResult, SceneObjectId, SymmetrySettings } from '../../types';
import { templateGroupOf } from './create';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from './define';
import { ensureDefaultPalette } from './palette';
import { uniqueObjectName } from './scene';

export const TEMPLATES = ['prop', 'handheld', 'humanoid', 'humanoidBody'] as const;
export type TemplateId = (typeof TEMPLATES)[number];
export const HUMANOID_PRESETS = ['stylized', 'chibi', 'blocky'] as const;
export type HumanoidPreset = (typeof HUMANOID_PRESETS)[number];
export const FROZEN_REASON = 'Primitive parameters were frozen by a component edit';
const OP = 'mesh.create.template';

/** §5.16 handheld grip defaults. */
export const DEFAULT_GRIP: HandheldGrip = {
  bone: 'rightHand',
  offset: [0, 0, 0],
  rotationDegrees: [0, 0, 0],
  scale: 1,
};
/** The handheld template's cube (metres). */
const HANDHELD_CUBE = { width: 0.04, height: 0.3, depth: 0.04 } as const;

/** The template operator's params (the Last-op card): height for the humanoid templates, the body style, the guides
 *  preset. Templates ignore the ones they do not use. */
export const TEMPLATE_PARAMS: readonly ParamDef[] = [
  {
    name: 'height',
    label: 'Height',
    kind: 'distance',
    bound: 'value',
    default: 1.6,
    min: 0.5,
    max: 3,
    step: 0.01,
    primary: true,
    description: 'Humanoid guides and body height',
  },
  {
    name: 'style',
    label: 'Style',
    kind: 'enum',
    bound: 'value',
    default: 'smooth',
    options: [
      { value: 'smooth', label: 'Smooth' },
      { value: 'segmented', label: 'Segmented' },
    ],
    description: 'Humanoid body: one mesh, or rigid parts',
  },
  {
    name: 'preset',
    label: 'Proportions',
    kind: 'enum',
    bound: 'value',
    default: 'stylized',
    options: [
      { value: 'stylized', label: 'Stylized' },
      { value: 'chibi', label: 'Chibi' },
      { value: 'blocky', label: 'Blocky' },
    ],
    description: 'Humanoid guides proportions',
  },
];

type Scalars = Readonly<Record<string, number | boolean | string>>;

function scalars(values: ParamValues): Scalars {
  const out: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') out[key] = value;
  }
  return out;
}

/** The coerced parameters of a primitive kind (§6.3), the given ones over the low-poly defaults. */
export function primitiveParams(kind: PrimitiveKind, given: unknown): Scalars {
  return scalars(coerceArgs(PRIMITIVE_PARAMS[kind], isRecord(given) ? given : {}).args);
}

interface TemplateMesh {
  readonly kind: PrimitiveKind;
  readonly params: Scalars;
  readonly data: MeshData;
}

interface Prepared {
  readonly mesh: TemplateMesh | null;
}

const templateOf = (args: unknown): TemplateId | null => {
  const value = isRecord(args) ? args['template'] : undefined;
  return TEMPLATES.includes(value as TemplateId) ? (value as TemplateId) : null;
};

/** A derived id not used by any record, soft-deleted ones included (the next `seed:k` otherwise, like create.ts). */
function freeDerivedId<K extends 'mesh' | 'group'>(view: ReadView, kind: K, seed: string, n: number) {
  const table = kind === 'mesh' ? 'meshes' : 'groups';
  let id = derivedId(kind as IdKind, OP, [], seed, n);
  for (let k = 1; view.getIncludingDeleted(table, id as never) !== undefined; k++) {
    id = derivedId(kind as IdKind, OP, [], `${seed}:${k}`, n);
  }
  return id as K extends 'mesh' ? MeshId : GroupId;
}

function meshRecord(
  tx: Tx,
  fields: {
    readonly id: MeshId;
    readonly name: string;
    readonly owner: MeshOwner;
    readonly parent: GroupId | null;
    readonly placement?: { readonly t: ReadonlyVec3 };
    readonly pivot?: ReadonlyVec3;
    readonly generator: TemplateMesh;
    readonly data: MeshRecord['data'];
  },
): MeshRecord {
  return {
    id: fields.id,
    name: uniqueMeshName(tx, fields.owner, fields.name),
    owner: fields.owner,
    parent: fields.parent,
    order: orderAfterSiblings(tx, fields.owner, fields.parent),
    placement: fields.placement === undefined ? xfIdentity() : { t: fields.placement.t, q: [0, 0, 0, 1], s: [1, 1, 1] },
    pivot: fields.pivot ?? [0, 0, 0],
    source: null,
    data: fields.data,
    faceted: true,
    generator: { kind: fields.generator.kind, params: fields.generator.params, version: 1 },
    palette: ensureDefaultPalette(tx),
    material: { preset: 'unlit' },
    colourOutput: 'palette-texture',
    skin: null,
    budget: null,
    handheld: null,
    deleted: null,
  };
}

function groupRecord(
  tx: Tx,
  fields: Pick<GroupRecord, 'id' | 'template' | 'budget' | 'handheld'> & { readonly name: string },
): GroupRecord {
  const owner = { scene: true as const };
  return {
    id: fields.id,
    name: uniqueObjectName(tx, owner, fields.name),
    owner,
    parent: null,
    order: orderAfterSiblings(tx, owner, null),
    placement: xfIdentity(),
    pivot: [0, 0, 0],
    template: fields.template,
    budget: fields.budget,
    handheld: fields.handheld,
    deleted: null,
  };
}

function selectCreated(
  app: EditorApp,
  root: SceneObjectId,
  symmetry?: { mesh: MeshId; settings: SymmetrySettings },
): void {
  const state = app.session.getState();
  app.session.setState({
    selection: { ...state.selection, objects: [root] },
    model: {
      ...state.model,
      componentMode: 'object',
      ...(symmetry === undefined
        ? {}
        : { symmetry: new Map(state.model.symmetry).set(symmetry.mesh, symmetry.settings) }),
    },
  });
}

const createTemplate = defineOperator<typeof OP, Prepared>({
  id: OP,
  label: 'New From Template',
  description: 'Creates a prop, handheld item or humanoid starting setup.',
  category: 'mesh',
  scope: 'model',
  workspaces: ['model'],
  flags: { undo: true, adjustable: true },
  params: TEMPLATE_PARAMS,
  extraArgs: ['template'],
  aliases: ['Template', 'Humanoid Body', 'Prop Template', 'Handheld Template'],
  undoLabel: (args) => {
    const template = templateOf(args);
    return template === 'humanoidBody'
      ? 'Humanoid Body'
      : template === 'humanoid'
        ? 'Humanoid Guides'
        : template === 'handheld'
          ? 'Handheld Template'
          : 'Prop Template';
  },
  poll(_ctx, args): PollResult {
    return templateOf(args) === null ? fail('expects { template: prop | handheld | humanoid | humanoidBody }') : OK;
  },
  async prepare(_ctx, args): Promise<Prepared> {
    const template = templateOf(args) as TemplateId;
    if (template === 'humanoid') return { mesh: null };
    const kernel = await loadMeshKernel();
    const raw = coerceArgs(TEMPLATE_PARAMS, args).args;
    if (template === 'humanoidBody') {
      const params = primitiveParams('humanoidBody', { height: raw['height'], style: raw['style'] });
      return { mesh: { kind: 'humanoidBody', params, data: kernel.primitive('humanoidBody', params) } };
    }
    const params = primitiveParams('cube', template === 'handheld' ? HANDHELD_CUBE : {});
    return { mesh: { kind: 'cube', params, data: kernel.primitive('cube', params) } };
  },
  apply(ctx, args, prepared) {
    const { app, tx } = ctx;
    if (tx === null) throw new EkzaError('internal', `${OP} runs in a transaction`);
    const meshes = attachMeshes(app) as KernelMeshRuntimes;
    const template = templateOf(args) as TemplateId;
    const raw = coerceArgs(TEMPLATE_PARAMS, args).args;
    const seed = runSeed(ctx, OP);
    ensureDefaultPalette(tx);
    const created: SceneObjectId[] = [];
    const store = (mesh: TemplateMesh) => meshes.storeRevision(mesh.data, null, []);

    if (template === 'humanoidBody') {
      const mesh = prepared.mesh as TemplateMesh;
      const host = templateGroupOf(app);
      const owner = host?.owner ?? { scene: true as const };
      const id = freeDerivedId(tx, 'mesh', seed, 0);
      tx.put(
        'meshes',
        meshRecord(tx, { id, name: 'Body', owner, parent: host?.id ?? null, generator: mesh, data: store(mesh) }),
      );
      created.push(id);
      const symmetry =
        host?.template?.kind === 'humanoid'
          ? {
              mesh: id,
              settings: {
                mode: 'object-x' as const,
                tolerance: app.prefs.getState().modeling.symmetryTolerance,
                preserveSeam: true,
              },
            }
          : undefined;
      selectCreated(app, id, symmetry);
      return { root: id, created };
    }

    const group = freeDerivedId(tx, 'group', seed, 0);
    if (template === 'humanoid') {
      tx.put(
        'groups',
        groupRecord(tx, {
          id: group,
          name: 'Humanoid',
          template: { kind: 'humanoid', params: { height: raw['height'] as number, preset: raw['preset'] as string } },
          budget: { preset: 'hero' },
          handheld: null,
        }),
      );
      selectCreated(app, group);
      return { root: group, created: [group] };
    }

    const handheld = template === 'handheld';
    tx.put(
      'groups',
      groupRecord(tx, {
        id: group,
        name: handheld ? 'Handheld' : 'Prop',
        template: { kind: template, params: {} },
        budget: { preset: handheld ? 'handheld' : 'small-prop' },
        handheld: handheld ? DEFAULT_GRIP : null,
      }),
    );
    created.push(group);
    const mesh = prepared.mesh as TemplateMesh;
    const half = (handheld ? HANDHELD_CUBE.height : 1) / 2;
    const id = freeDerivedId(tx, 'mesh', seed, 1);
    tx.put(
      'meshes',
      meshRecord(tx, {
        id,
        name: 'Cube',
        owner: { scene: true },
        parent: group,
        // Standing on the group origin (the ground for a prop, the grip for a handheld) with the pivot at its base.
        placement: { t: [0, half, 0] },
        pivot: [0, -half, 0],
        generator: mesh,
        data: store(mesh),
      }),
    );
    created.push(id);
    selectCreated(app, group);
    return { root: group, created };
  },
});

// ---------- live primitive parameters ----------

interface Regenerated {
  readonly kind: PrimitiveKind;
  readonly params: Scalars;
  readonly data: MeshData;
}

function primitivePoll(app: EditorApp, args: unknown): PollResult {
  if (!isRecord(args) || typeof args['mesh'] !== 'string' || !isRecord(args['params'])) {
    return fail('expects { mesh, params }');
  }
  const record = app.store.get('meshes', args['mesh'] as MeshId);
  if (record === undefined) return fail(`Unknown mesh ${args['mesh']}`);
  if (record.generator === null) return fail(FROZEN_REASON);
  const runtime = app.meshes.get(record.id);
  if (runtime?.state === 'loading') return fail('Mesh is loading');
  return OK;
}

const primitiveSet = defineOperator<'mesh.primitive.set', Regenerated>({
  id: 'mesh.primitive.set',
  label: 'Primitive Parameters',
  description: "Changes a live primitive's parameters (until a component edit freezes them).",
  category: 'mesh',
  scope: 'model',
  workspaces: ['model'],
  flags: { undo: true, adjustable: true, internal: true },
  extraArgs: ['mesh', 'params'],
  poll: ({ app }, args) => primitivePoll(app, args),
  async prepare({ app }, args): Promise<Regenerated> {
    const kernel = await loadMeshKernel();
    const record = app.store.get('meshes', args.mesh) as MeshRecord;
    const generator = record.generator as NonNullable<MeshRecord['generator']>;
    const params = primitiveParams(generator.kind, { ...generator.params, ...args.params });
    return { kind: generator.kind, params, data: kernel.primitive(generator.kind, params) };
  },
  apply({ app, tx }, args, prepared) {
    if (tx === null) throw new EkzaError('internal', 'mesh.primitive.set runs in a transaction');
    const record = tx.get('meshes', args.mesh);
    if (record?.generator === null || record?.generator === undefined || record.generator.kind !== prepared.kind) {
      throw new EkzaError('unsupported', FROZEN_REASON);
    }
    tx.patch('meshes', args.mesh, { generator: { kind: prepared.kind, params: prepared.params, version: 1 } });
    app.meshes.writeData(tx, args.mesh, prepared.data);
    try {
      app.components.clear(args.mesh);
    } catch {
      // No component selection service: nothing is stored.
    }
  },
});

export const TEMPLATE_OPERATORS: readonly AnyOperator[] = [createTemplate, primitiveSet];
