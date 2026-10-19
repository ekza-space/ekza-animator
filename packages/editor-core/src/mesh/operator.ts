// `meshOperator` / `meshSetOperator` (M6A-SPEC §4.6; B0a's working wrappers over the stub runtime, B7 owns them):
// registry operators built from an op **descriptor** (eager: menus, cards and the palette need no kernel). Poll: the
// kernel chunk must be loaded (else "Mesh tools are loading", and the load starts), the targets must be ready, and the
// kernel op's own poll must pass on open targets. Apply: `MeshRuntimeRegistry.commitOp` / `commitSetOp` inside the
// operator's one transaction. Params, JSON schema and defaults derive from `desc.params` (ADR 0016 D6); `meshes` and
// `kind` pass through `coerceArgs` untouched (`extraArgs`).
import { EkzaError, type ParamValues } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import type { ComponentKind, MeshOpDescriptor, MeshSetOpDescriptor } from '@ekza-animator/mesh-core';
import { newRecordId } from '../app/internals';
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
import { loadMeshKernel, meshKernel } from './index';

/** The arg keys every mesh operator passes through `coerceArgs` untouched. */
export const MESH_EXTRA_ARGS: readonly string[] = ['meshes', 'kind'];

const fail = (reason: string): PollResult => ({ ok: false, reason });

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The op's own args: everything but the pass-through `meshes` and `kind`. */
function opArgs(args: unknown): ParamValues {
  if (!isRecord(args)) return {};
  const out: Record<string, ParamValues[string]> = {};
  for (const [key, value] of Object.entries(args))
    if (!MESH_EXTRA_ARGS.includes(key)) out[key] = value as ParamValues[string];
  return out;
}

/** `kind` from the args, else the current component mode's (null in object mode). */
function kindOf(app: EditorApp, args: unknown): ComponentKind | null {
  const kind = isRecord(args) ? args['kind'] : undefined;
  if (kind === 'vertex' || kind === 'edge' || kind === 'face') return kind;
  const mode = app.session.getState().model.componentMode;
  return mode === 'object' ? null : mode;
}

/** Explicit `meshes`, else the hilited meshes (component ops) or the selected mesh objects (object-level ops). */
function targetsOf(app: EditorApp, args: unknown, objectLevel: boolean): readonly MeshId[] {
  const explicit = isRecord(args) ? args['meshes'] : undefined;
  if (Array.isArray(explicit)) return explicit.filter((id): id is MeshId => typeof id === 'string');
  const state = app.session.getState();
  if (objectLevel) return state.selection.objects.filter((id): id is MeshId => id.startsWith('msh_'));
  return state.model.hilite;
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
      const targets = targetsOf(ctx.app, args, objectLevel);
      if (targets.length === 0) return fail(objectLevel ? 'Select a mesh first' : 'Select components first');
      const ready = readiness(ctx.app, targets);
      if (ready !== true) return ready;
      for (const id of targets) {
        const runtime = ctx.app.meshes.get(id);
        if (runtime?.mesh === null || runtime?.mesh === undefined) continue;
        const selection = kind === null ? null : ctx.app.components.get(id, kind);
        const placement = ctx.app.store.get('meshes', id)?.placement ?? { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
        const verdict = op.poll(runtime.mesh, selection, {
          symmetry: null,
          hidden: null,
          placement,
          faceted: ctx.app.store.get('meshes', id)?.faceted ?? true,
          soft: null,
          curves: { compile: () => ({}) as never, evaluate: () => 0 },
          epsilon: 1e-9,
        });
        if (verdict !== true) return fail(verdict.reason);
      }
      return true;
    },
    apply(ctx, args): MeshOpOutcome {
      const kernel = meshKernel();
      const op = kernel?.MESH_OPS[desc.id];
      if (ctx.tx === null || op === undefined) throw new EkzaError('mesh-loading', 'Mesh tools are loading');
      const targets = targetsOf(ctx.app, args, objectLevel);
      const result = ctx.app.meshes.commitOp(ctx.tx, op, targets, opArgs(args), { seed: newRecordId(ctx.app, 'tx') });
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
      const inputs = targetsOf(ctx.app, args, true);
      if (desc.arity === 'many' && inputs.length < 2) return fail(`${desc.label} needs at least two meshes`);
      if (inputs.length === 0) return fail('Select a mesh first');
      return readiness(ctx.app, inputs);
    },
    apply(ctx, args): MeshSetCommitResult {
      const op = meshKernel()?.MESH_SET_OPS[desc.id];
      if (ctx.tx === null || op === undefined) throw new EkzaError('mesh-loading', 'Mesh tools are loading');
      const inputs = targetsOf(ctx.app, args, true);
      return ctx.app.meshes.commitSetOp(ctx.tx, op, inputs, opArgs(args), { seed: newRecordId(ctx.app, 'tx') });
    },
  };
}
