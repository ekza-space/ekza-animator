// `meshOperator` / `meshSetOperator` (M6A-SPEC §4.6; B7): registry operators built from an op **descriptor** (eager:
// menus, cards and the palette need no kernel). Poll: the kernel chunk must be loaded (else "Mesh tools are loading",
// and the load starts), the targets must be ready, and the kernel op's own poll must pass on targets with edit links.
// Apply: `MeshRuntimeRegistry.commitOp` / `commitSetOp` inside the operator's one transaction, with the run's step
// seed, component kind and (for an adjusted re-run) the recorded symmetry/soft context. Params, JSON schema and
// defaults derive from `desc.params` (ADR 0016 D6); `meshes` and `kind` pass through `coerceArgs` untouched.
import { EkzaError, type ParamValues } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import type { ComponentKind, MeshOpDescriptor, MeshSetOpDescriptor } from '@ekza-animator/mesh-core';
import type {
  EditorApp,
  KeyScope,
  MeshOpArgs,
  MeshOpOutcome,
  MeshSetCommitResult,
  OperatorContext,
  OperatorDef,
  PollResult,
  ToolId,
} from '../types';
import { attachMeshes } from './index';
import { loadMeshKernel, meshKernel } from './kernel';
import type { KernelMeshRuntimes } from './registry';
import { runSeed, runSettings } from './seed';

/** The arg keys every mesh operator passes through `coerceArgs` untouched. */
export const MESH_EXTRA_ARGS: readonly string[] = ['meshes', 'kind'];

const fail = (reason: string): PollResult => ({ ok: false, reason });

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The op's own args: everything but the pass-through `meshes` and `kind`. */
export function opArgs(args: unknown): ParamValues {
  if (!isRecord(args)) return {};
  const out: Record<string, ParamValues[string]> = {};
  for (const [key, value] of Object.entries(args))
    if (!MESH_EXTRA_ARGS.includes(key)) out[key] = value as ParamValues[string];
  return out;
}

/** `kind` from the args, else the current component mode's (null in object mode). */
export function kindOf(app: EditorApp, args: unknown): ComponentKind | null {
  const kind = isRecord(args) ? args['kind'] : undefined;
  if (kind === 'vertex' || kind === 'edge' || kind === 'face') return kind;
  const mode = app.session.getState().model.componentMode;
  return mode === 'object' ? null : mode;
}

/**
 * Explicit `meshes`, else the default targets (§4.6 `MeshOpArgs`): for component ops the hilited meshes with a
 * selection of `kind`; for object-level ops the selected mesh objects.
 */
export function targetsOf(
  app: EditorApp,
  args: unknown,
  kind: ComponentKind | null,
  objectLevel: boolean,
): readonly MeshId[] {
  const explicit = isRecord(args) ? args['meshes'] : undefined;
  if (Array.isArray(explicit)) return explicit.filter((id): id is MeshId => typeof id === 'string');
  const state = app.session.getState();
  if (objectLevel) return state.selection.objects.filter((id): id is MeshId => id.startsWith('msh_'));
  if (kind === null) return [];
  const meshes = attachMeshes(app);
  return state.model.hilite.filter((id) => {
    const sel = meshes?.selectionFor(id, kind) ?? null;
    if (sel === null) return false;
    const set = kind === 'vertex' ? sel.verts : kind === 'edge' ? sel.edges : sel.faces;
    return !set.isEmpty();
  });
}

function readiness(app: EditorApp, targets: readonly MeshId[]): PollResult {
  for (const id of targets) {
    const runtime = app.meshes.get(id);
    if (runtime === undefined) return fail(`Unknown mesh ${id}`);
    if (runtime.state === 'loading') return fail('Mesh is loading');
    if (runtime.state === 'error') return fail(runtime.error ?? 'Mesh data is missing');
  }
  return true;
}

function registryOf(app: EditorApp): KernelMeshRuntimes {
  const meshes = attachMeshes(app);
  if (meshes === null) throw new EkzaError('unsupported', 'This editor has no mesh runtime registry');
  return meshes;
}

export function meshOperator(
  desc: MeshOpDescriptor,
  opts?: {
    readonly category?: string;
    readonly scope?: KeyScope;
    readonly tool?: ToolId;
    readonly aliases?: readonly string[];
  },
): OperatorDef<MeshOpArgs, MeshOpOutcome, void> {
  const objectLevel = desc.kinds === 'object';
  return {
    id: desc.id,
    label: desc.label,
    category: opts?.category ?? 'mesh',
    scope: opts?.scope ?? 'model',
    flags: { undo: true, adjustable: desc.flags.adjustable, repeatable: desc.flags.repeatable },
    params: desc.params,
    extraArgs: MESH_EXTRA_ARGS,
    workspaces: ['model'],
    ...(opts?.tool === undefined ? {} : { tool: opts.tool }),
    ...(opts?.aliases === undefined ? {} : { aliases: opts.aliases }),
    poll(ctx: OperatorContext, args: MeshOpArgs): PollResult {
      const kernel = meshKernel();
      if (kernel === null) {
        void loadMeshKernel();
        return fail('Mesh tools are loading');
      }
      const op = kernel.MESH_OPS[desc.id];
      if (op === undefined) return fail(`${desc.label} is not available`);
      const kind = kindOf(ctx.app, args);
      if (!objectLevel && kind === null) return fail(`${desc.label}: enter a component mode first`);
      if (!objectLevel && kind !== null && !desc.kinds.includes(kind)) {
        return fail(`${desc.label} works on ${desc.kinds.join(', ')} components`);
      }
      const targets = targetsOf(ctx.app, args, kind, objectLevel);
      if (targets.length === 0) return fail(objectLevel ? 'Select a mesh first' : 'Select components first');
      const ready = readiness(ctx.app, targets);
      if (ready !== true) return ready;
      const meshes = attachMeshes(ctx.app);
      const verdict = meshes?.pollOp(op, targets, objectLevel ? null : kind, runSettings(ctx, desc.id)) ?? true;
      return verdict === true ? true : fail(verdict.reason);
    },
    apply(ctx, args): MeshOpOutcome {
      const kernel = meshKernel();
      const op = kernel?.MESH_OPS[desc.id];
      if (ctx.tx === null || op === undefined) throw new EkzaError('mesh-loading', 'Mesh tools are loading');
      const meshes = registryOf(ctx.app);
      const kind = objectLevel ? null : kindOf(ctx.app, args);
      const targets = targetsOf(ctx.app, args, kind, objectLevel);
      const settings = runSettings(ctx, desc.id);
      const result = meshes.commitOp(ctx.tx, op, targets, opArgs(args), {
        seed: runSeed(ctx, desc.id),
        kind,
        ...(settings === undefined ? {} : { settings }),
      });
      return { meshes: targets, warnings: result.warnings };
    },
  };
}

export function meshSetOperator(
  desc: MeshSetOpDescriptor,
  opts?: { readonly category?: string },
): OperatorDef<MeshOpArgs, MeshSetCommitResult, void> {
  return {
    id: desc.id,
    label: desc.label,
    category: opts?.category ?? 'mesh',
    scope: 'model',
    flags: { undo: true, adjustable: desc.flags.adjustable, repeatable: desc.flags.repeatable },
    params: desc.params,
    extraArgs: MESH_EXTRA_ARGS,
    workspaces: ['model'],
    poll(ctx: OperatorContext, args: MeshOpArgs): PollResult {
      const kernel = meshKernel();
      if (kernel === null) {
        void loadMeshKernel();
        return fail('Mesh tools are loading');
      }
      if (kernel.MESH_SET_OPS[desc.id] === undefined) return fail(`${desc.label} is not available`);
      const inputs = targetsOf(ctx.app, args, null, true);
      if (desc.arity === 'many' && inputs.length < 2) return fail(`${desc.label} needs at least two meshes`);
      if (inputs.length === 0) return fail('Select a mesh first');
      return readiness(ctx.app, inputs);
    },
    apply(ctx, args): MeshSetCommitResult {
      const op = meshKernel()?.MESH_SET_OPS[desc.id];
      if (ctx.tx === null || op === undefined) throw new EkzaError('mesh-loading', 'Mesh tools are loading');
      const meshes = registryOf(ctx.app);
      const inputs = targetsOf(ctx.app, args, null, true);
      const kind = kindOf(ctx.app, args);
      return meshes.commitSetOp(ctx.tx, op, inputs, opArgs(args), { seed: runSeed(ctx, desc.id), kind });
    },
  };
}
