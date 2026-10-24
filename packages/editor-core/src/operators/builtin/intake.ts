// The AI intake operators (MODELING-PLAN §7.2 G-a, research 15 §5.9, ADR 0017 decision 5; contract DECISIONS
// M7-GA-CONTRACT-*): local, key-free clean-up of any imported or generated model, each an undoable, adjustable operator
// with ParamDefs (the Last-op card, Echo chips, ⚙ Options and the agent schema read them), part of the Model chunk.
//
// - `mesh.normalize {height?, forward?, up?, unit?, origin?, meshes?}`: the model's frame → +Y up, +Z forward, metres,
//   origin at the bottom centre of the targets' combined bounds; the world transforms are baked into the data.
// - `mesh.reduce {preset?, triangles?, …, meshes?}`: meshoptimizer to one triangle budget over the targets (Prop 500,
//   Character 3,000, Hero 10,000, or `triangles`).
// - `mesh.paletteBake {colours?, samples?, meshes?}`: ≤ 16 colours (default) from the base colour, one new palette,
//   per-face `paint` slots; the meshes become palette-coloured (unlit preset) and paintable.
// - `mesh.textureDownsize {size?, meshes?}`: the targets' material images re-encoded at ≤ size (a new model asset).
// - `mesh.intake {preset?, height?, colours?, …, meshes?, bytes?, name?}`: the intake preset as one operator and one
//   undo step — normalize → reduce → quadrangulate (Q-MOD-K-9: automatic only here) → palette bake (or texture
//   downsize with `texture: 'keep'`). With `bytes` it imports the GLB in the same step, and meshes over 200,000
//   triangles are decimated first instead of refused.
//
// Targets: explicit `meshes` (group ids stand for their meshes), else the selected mesh objects. The chain runs in the
// intake worker (`../../intake/client.ts`) from `prepare`; `apply` writes the results in the run's one transaction
// (`../../intake/run.ts`, a lazy module).
import type { ParamDef } from '@ekza-studio/anim-core';
import { EkzaError } from '@ekza-studio/anim-core';
import type { MeshId } from '@ekza-studio/doc';
import { isAssetCharacter } from '../../characters/registry';
import { INTAKE_BUDGETS, type IntakeArgs, type IntakePreset } from '../../intake/types';
import type { IntakePrepared } from '../../intake/run';
import type { EditorApp, OperatorContext, PollResult } from '../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from './define';
import { pollEditable } from './polls';

const DEG = Math.PI / 180;

const PRESET_OPTIONS = [
  { value: 'prop', label: 'Prop (≤ 500)' },
  { value: 'character', label: 'Character (≤ 3,000)' },
  { value: 'hero', label: 'Hero (≤ 10,000)' },
] as const;
const AXIS_OPTIONS = ['+z', '-z', '+x', '-x', '+y', '-y'].map((value) => ({ value, label: value.toUpperCase() }));

const preset = (description: string): ParamDef => ({
  name: 'preset',
  label: 'Budget',
  kind: 'enum',
  bound: 'value',
  default: 'character',
  options: PRESET_OPTIONS,
  description,
});
const triangles: ParamDef = {
  name: 'triangles',
  label: 'Triangles',
  kind: 'int',
  bound: 'value',
  default: null,
  nullable: true,
  min: 4,
  max: 1_000_000,
  softMin: 100,
  softMax: 20_000,
  step: 100,
  description: "Empty: the budget's count",
};
const height = (description: string): ParamDef => ({
  name: 'height',
  label: 'Height',
  kind: 'distance',
  bound: 'value',
  default: null,
  nullable: true,
  min: 0.01,
  max: 1000,
  softMin: 0.1,
  softMax: 3,
  step: 0.01,
  description,
});
const FRAME_PARAMS: readonly ParamDef[] = [
  {
    name: 'forward',
    label: 'Model Faces',
    kind: 'enum',
    bound: 'value',
    default: '+z',
    options: AXIS_OPTIONS,
    group: 'Source',
    description: 'The axis the model faces in its file (most generators: +Z; Tripo: +X); it becomes +Z',
  },
  {
    name: 'up',
    label: 'Model Up',
    kind: 'enum',
    bound: 'value',
    default: '+y',
    options: AXIS_OPTIONS,
    group: 'Source',
    description: 'The up axis in the file; it becomes +Y',
  },
];
const colours: ParamDef = {
  name: 'colours',
  label: 'Colours',
  kind: 'int',
  bound: 'value',
  default: 16,
  min: 1,
  max: 64,
  step: 1,
  description: 'At most this many palette colours',
};

/** `mesh.normalize` (DECISIONS M7-GA-CONTRACT-2). */
export const NORMALIZE_PARAMS: readonly ParamDef[] = [
  { ...height('Empty: keep the size'), primary: true },
  ...FRAME_PARAMS,
  {
    name: 'unit',
    label: 'File Unit',
    kind: 'enum',
    bound: 'value',
    default: 'm',
    options: [
      { value: 'm', label: 'Metres' },
      { value: 'cm', label: 'Centimetres' },
      { value: 'mm', label: 'Millimetres' },
      { value: 'in', label: 'Inches' },
    ],
    group: 'Source',
  },
  {
    name: 'origin',
    label: 'Origin',
    kind: 'enum',
    bound: 'value',
    default: 'bottom-center',
    options: [
      { value: 'bottom-center', label: 'Bottom centre' },
      { value: 'center', label: 'Centre' },
      { value: 'keep', label: 'Keep' },
    ],
  },
];

/** The reduce options shared by `mesh.reduce` (all) and `mesh.intake` (defaults). */
const REDUCE_OPTIONS: readonly ParamDef[] = [
  { name: 'uvWeight', label: 'UV Weight', kind: 'number', bound: 'value', default: 1, min: 0, max: 100, step: 0.1, group: 'Reduce' },
  {
    name: 'normalWeight',
    label: 'Normal Weight',
    kind: 'number',
    bound: 'value',
    default: 0.5,
    min: 0,
    max: 100,
    step: 0.1,
    group: 'Reduce',
  },
  {
    name: 'lockSeams',
    label: 'Lock UV Seams',
    kind: 'bool',
    bound: 'value',
    default: false,
    group: 'Reduce',
    description: 'Seam vertices never move (seams never crack either way)',
  },
  {
    name: 'lockPalette',
    label: 'Lock Palette Borders',
    kind: 'bool',
    bound: 'value',
    default: true,
    group: 'Reduce',
    description: 'Vertices between colours or materials never move',
  },
  { name: 'lockBorder', label: 'Lock Open Borders', kind: 'bool', bound: 'value', default: false, group: 'Reduce' },
  {
    name: 'regularize',
    label: 'Even Triangles',
    kind: 'bool',
    bound: 'value',
    default: null,
    nullable: true,
    group: 'Reduce',
    description: 'More even triangles for skinning (Auto: on for skinned meshes)',
  },
  {
    name: 'prune',
    label: 'Remove Small Parts',
    kind: 'bool',
    bound: 'value',
    default: false,
    group: 'Reduce',
  },
  {
    name: 'hardAngle',
    label: 'Hard Edges Above',
    kind: 'angle',
    bound: 'value',
    default: 60 * DEG,
    min: 0,
    max: Math.PI,
    step: DEG,
    group: 'Reduce',
  },
];

/** `mesh.reduce` (DECISIONS M7-GA-CONTRACT-1). */
export const REDUCE_PARAMS: readonly ParamDef[] = [
  preset('Prop ≤ 500, Character ≤ 3,000, Hero ≤ 10,000 triangles'),
  { ...triangles, primary: true },
  ...REDUCE_OPTIONS,
];

/** `mesh.paletteBake` (DECISIONS M7-GA-CONTRACT-3). */
export const PALETTE_BAKE_PARAMS: readonly ParamDef[] = [
  { ...colours, primary: true },
  {
    name: 'samples',
    label: 'Samples per Triangle',
    kind: 'int',
    bound: 'value',
    default: 6,
    min: 1,
    max: 64,
    step: 1,
  },
];

/** `mesh.textureDownsize` (DECISIONS M7-GA-CONTRACT-5). */
export const TEXTURE_DOWNSIZE_PARAMS: readonly ParamDef[] = [
  {
    name: 'size',
    label: 'Largest Side',
    kind: 'int',
    bound: 'value',
    default: 1024,
    min: 16,
    max: 8192,
    softMin: 256,
    softMax: 2048,
    step: 256,
    primary: true,
  },
];

/** `mesh.intake` (DECISIONS M7-GA-CONTRACT-4). */
export const INTAKE_PARAMS: readonly ParamDef[] = [
  { ...preset('Prop ≤ 500, Character ≤ 3,000, Hero ≤ 10,000 triangles'), primary: true },
  height('Empty: 1.70 m for characters and heroes, the model’s own size for props'),
  colours,
  triangles,
  ...FRAME_PARAMS,
  {
    name: 'quadrangulate',
    label: 'Quadrangulate',
    kind: 'bool',
    bound: 'value',
    default: true,
    description: 'Pair triangles into quads after the reduce (the intake preset only, Q-MOD-K-9)',
  },
  {
    name: 'texture',
    label: 'Colour',
    kind: 'enum',
    bound: 'value',
    default: 'palette',
    options: [
      { value: 'palette', label: 'Palette (flat colours)' },
      { value: 'keep', label: 'Keep the texture' },
    ],
  },
  {
    name: 'textureSize',
    label: 'Texture Size',
    kind: 'int',
    bound: 'value',
    default: 1024,
    min: 16,
    max: 8192,
    step: 256,
    description: 'Largest side when the texture is kept',
  },
];

/** The operator ids of this module. */
export type IntakeOperatorId =
  | 'mesh.normalize'
  | 'mesh.reduce'
  | 'mesh.paletteBake'
  | 'mesh.textureDownsize'
  | 'mesh.intake';

export const INTAKE_LABELS: Readonly<Record<IntakeOperatorId, string>> = {
  'mesh.normalize': 'Normalize',
  'mesh.reduce': 'Reduce',
  'mesh.paletteBake': 'Palette Bake',
  'mesh.textureDownsize': 'Downsize Textures',
  'mesh.intake': 'Intake',
};

/** Poll reasons (plain words: the Halo, the palette and agents show them as they are). */
export const SELECT_A_MESH = 'Select a mesh';
export const NOT_BEFORE_RIGGING = 'Normalize works before rigging';

// ---------- targets ----------

/** Explicit `meshes` (group ids → their meshes), else the selected mesh objects (and the meshes of selected groups). */
export function intakeTargets(app: EditorApp, args: unknown): MeshId[] {
  const explicit = isRecord(args) && Array.isArray(args['meshes']) ? (args['meshes'] as unknown[]) : null;
  const ids = (explicit ?? app.session.getState().selection.objects).filter(
    (id): id is string => typeof id === 'string',
  );
  const live = app.store.list('meshes').filter((mesh) => mesh.deleted === null);
  const out: MeshId[] = [];
  const add = (id: MeshId): void => {
    if (!out.includes(id)) out.push(id);
  };
  for (const id of ids) {
    if (id.startsWith('msh_')) {
      if (live.some((mesh) => mesh.id === id)) add(id as MeshId);
    } else if (id.startsWith('grp_')) {
      // Every live mesh under the group (any depth), in record order.
      for (const mesh of live) {
        let parent: string | null = mesh.parent;
        const seen = new Set<string>();
        while (parent !== null && !seen.has(parent)) {
          if (parent === id) {
            add(mesh.id);
            break;
          }
          seen.add(parent);
          const node: { readonly parent: string | null } | undefined = parent.startsWith('grp_')
            ? app.store.get('groups', parent as never)
            : app.store.get('meshes', parent as MeshId);
          parent = node?.parent ?? null;
        }
      }
    }
  }
  return out;
}

/** Triangles of a mesh's current revision (n-gons as fans), or null while its data is not resident. */
function trianglesOf(app: EditorApp, id: MeshId): number | null {
  const data = app.meshes.get(id)?.data() ?? null;
  return data === null ? null : data.counts.corners - 2 * data.counts.faces;
}

function pollTargets(app: EditorApp, id: IntakeOperatorId, args: unknown, targets: readonly MeshId[]): PollResult {
  const editable = pollEditable(app);
  if (editable !== true) return editable;
  if (targets.length === 0) return fail(SELECT_A_MESH);
  for (const mesh of targets) {
    const record = app.store.get('meshes', mesh);
    if (record === undefined) return fail(SELECT_A_MESH);
    const runtime = app.meshes.get(mesh);
    if (runtime?.state === 'loading') return fail('Mesh is loading');
    if (runtime?.state === 'error') return fail(runtime.error ?? 'Mesh data is missing');
    if (record.data === null) return fail(`${record.name} has no mesh data`);
    const owner = 'character' in record.owner ? app.store.get('characters', record.owner.character) : undefined;
    if ((id === 'mesh.normalize' || id === 'mesh.intake') && (record.skin !== null || owner !== undefined)) {
      return fail(`${NOT_BEFORE_RIGGING}: ${record.name} ${record.skin !== null ? 'is skinned' : 'belongs to a character'}`);
    }
    if (
      (id === 'mesh.paletteBake' || id === 'mesh.textureDownsize') &&
      owner !== undefined &&
      isAssetCharacter(owner)
    ) {
      return fail(`${record.name} belongs to an imported character: its look stays the file's`);
    }
    if (id === 'mesh.textureDownsize' && !('assetSlots' in record.material)) {
      return fail(`${record.name} has no image textures`);
    }
  }
  if (id === 'mesh.reduce') {
    const raw = isRecord(args) ? args : {};
    const budget =
      typeof raw['triangles'] === 'number'
        ? raw['triangles']
        : INTAKE_BUDGETS[(raw['preset'] as IntakePreset | undefined) ?? 'character'] ?? INTAKE_BUDGETS.character;
    let total = 0;
    for (const mesh of targets) {
      const count = trianglesOf(app, mesh);
      if (count === null) return OK;
      total += count;
    }
    if (total <= budget) return fail(`Already under the budget (${total.toLocaleString('en-US')} triangles)`);
  }
  return OK;
}

function poll(app: EditorApp, id: IntakeOperatorId, args: unknown): PollResult {
  if (args !== undefined && args !== null && !isRecord(args)) return fail('expects an object of parameters');
  if (id === 'mesh.intake' && isRecord(args) && args['bytes'] !== undefined) {
    if (!(args['bytes'] instanceof Uint8Array)) return fail('bytes must be the file’s bytes');
    const editable = pollEditable(app);
    return editable === true ? OK : editable;
  }
  return pollTargets(app, id, args, intakeTargets(app, args));
}

// ---------- the operators ----------

type Run = typeof import('../../intake/run');

function intakeOperator(id: IntakeOperatorId, params: readonly ParamDef[], description: string): AnyOperator {
  const label = INTAKE_LABELS[id];
  return defineOperator<IntakeOperatorId, { readonly run: Run; readonly prepared: IntakePrepared }>({
    id,
    label,
    description,
    category: 'mesh',
    scope: 'model',
    workspaces: ['model', 'rig'],
    flags: { undo: true, adjustable: true, repeatable: true },
    params,
    extraArgs: id === 'mesh.intake' ? ['meshes', 'bytes', 'name'] : ['meshes'],
    undoLabel: () => label,
    poll: ({ app }, args) => poll(app, id, args),
    async prepare(ctx: OperatorContext, args) {
      const busy = `${label}…`;
      ctx.app.session.setState({ busy: { label: busy, progress: null } });
      try {
        const run = await import('../../intake/run');
        const prepared = await run.prepareIntake(ctx, id, args as IntakeArgs, intakeTargets(ctx.app, args));
        return { run, prepared };
      } finally {
        if (ctx.app.session.getState().busy?.label === busy) ctx.app.session.setState({ busy: null });
      }
    },
    apply(ctx, args, { run, prepared }) {
      if (ctx.tx === null) throw new EkzaError('internal', `${id} runs in a transaction`);
      return run.applyIntake(ctx, id, args as IntakeArgs, prepared);
    },
  });
}

export const INTAKE_OPERATORS: readonly AnyOperator[] = [
  intakeOperator(
    'mesh.normalize',
    NORMALIZE_PARAMS,
    'Turns the model to face +Z with +Y up, in metres, standing on its bottom centre (optionally at a height).',
  ),
  intakeOperator(
    'mesh.reduce',
    REDUCE_PARAMS,
    'Reduces the meshes to a triangle budget (Prop 500, Character 3,000, Hero 10,000) without cracking UV seams.',
  ),
  intakeOperator(
    'mesh.paletteBake',
    PALETTE_BAKE_PARAMS,
    'Bakes the base colour into a palette of at most 16 colours, one per face (the low-poly look).',
  ),
  intakeOperator(
    'mesh.textureDownsize',
    TEXTURE_DOWNSIZE_PARAMS,
    'Re-encodes the textures of the meshes so their largest side is at most the given size.',
  ),
  intakeOperator(
    'mesh.intake',
    INTAKE_PARAMS,
    'Cleans up an imported or generated model in one step: normalize, reduce, quadrangulate and palette bake.',
  ),
];
