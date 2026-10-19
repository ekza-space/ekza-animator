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
// The document writes live in the lazy `contentApply.ts` (M6A-B13-10): `prepare` loads it, `apply` runs its body.
import { coerceArgs, type ParamDef, type ParamValues } from '@ekza-animator/anim-core';
import { type HandheldGrip, type MeshId, type MeshRecord } from '@ekza-animator/doc';
import type { MeshData, PrimitiveKind } from '@ekza-animator/mesh-core';
import { PRIMITIVE_PARAMS } from '@ekza-animator/mesh-core/descriptors';
import { loadMeshKernel } from '../../mesh';
import type { EditorApp, PollResult } from '../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from './define';
import { type ContentApplyModule, loadContentApply } from './contentLoad';

export const TEMPLATES = ['prop', 'handheld', 'humanoid', 'humanoidBody'] as const;
export type TemplateId = (typeof TEMPLATES)[number];
export const HUMANOID_PRESETS = ['stylized', 'chibi', 'blocky'] as const;
export type HumanoidPreset = (typeof HUMANOID_PRESETS)[number];
export const FROZEN_REASON = 'Primitive parameters were frozen by a component edit';
export const OP = 'mesh.create.template';

/** §5.16 handheld grip defaults. */
export const DEFAULT_GRIP: HandheldGrip = {
  bone: 'rightHand',
  offset: [0, 0, 0],
  rotationDegrees: [0, 0, 0],
  scale: 1,
};
/** The handheld template's cube (metres). */
export const HANDHELD_CUBE = { width: 0.04, height: 0.3, depth: 0.04 } as const;

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

export interface TemplateMesh {
  readonly kind: PrimitiveKind;
  readonly params: Scalars;
  readonly data: MeshData;
}

export interface Prepared {
  readonly mesh: TemplateMesh | null;
  readonly impl: ContentApplyModule;
}

export const templateOf = (args: unknown): TemplateId | null => {
  const value = isRecord(args) ? args['template'] : undefined;
  return TEMPLATES.includes(value as TemplateId) ? (value as TemplateId) : null;
};

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
    const [kernel, impl] = await Promise.all([loadMeshKernel(), loadContentApply()]);
    if (template === 'humanoid') return { mesh: null, impl };
    const raw = coerceArgs(TEMPLATE_PARAMS, args).args;
    if (template === 'humanoidBody') {
      const params = primitiveParams('humanoidBody', { height: raw['height'], style: raw['style'] });
      return { mesh: { kind: 'humanoidBody', params, data: kernel.primitive('humanoidBody', params) }, impl };
    }
    const params = primitiveParams('cube', template === 'handheld' ? HANDHELD_CUBE : {});
    return { mesh: { kind: 'cube', params, data: kernel.primitive('cube', params) }, impl };
  },
  apply: (ctx, args, prepared) => prepared.impl.createTemplate(ctx, args, prepared),
});

// ---------- live primitive parameters ----------

export interface Regenerated {
  readonly kind: PrimitiveKind;
  readonly params: Scalars;
  readonly data: MeshData;
  readonly impl: ContentApplyModule;
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
    const [kernel, impl] = await Promise.all([loadMeshKernel(), loadContentApply()]);
    const record = app.store.get('meshes', args.mesh) as MeshRecord;
    const generator = record.generator as NonNullable<MeshRecord['generator']>;
    const params = primitiveParams(generator.kind, { ...generator.params, ...args.params });
    return { kind: generator.kind, params, data: kernel.primitive(generator.kind, params), impl };
  },
  apply: (ctx, args, prepared) => prepared.impl.primitiveSet(ctx, args, prepared),
});

export const TEMPLATE_OPERATORS: readonly AnyOperator[] = [createTemplate, primitiveSet];
