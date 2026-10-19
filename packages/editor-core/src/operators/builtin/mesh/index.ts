// Kernel mesh operators (M6A-SPEC §6.1; B11, research 16 U-2): every `mesh.*` op registered from its **descriptor**
// (eager; no kernel code in the editor route) through `meshOperator` / `meshSetOperator` (B7), with Maya's label,
// Blender names as command-palette aliases, the tool that `G` (after a tool run) and `Y` re-activate, and the
// internal flag for the ops other operators run (`mesh.applyTransform`: Freeze and Bake Pivot; `mesh.paint.remap`:
// Replace Swatch).
//
// The LastRun recorder stores **resolved** args (§5.7: `OpResult.resolvedArgs` for kernel ops): `apply` is B7's
// commit path (the same calls `meshOperator.apply` makes) with the kernel's resolved args remembered for the outcome
// it returns. Until a kernel owner lands an op, the kernel's stub refuses it with "<Label> is not available yet".
import { EkzaError } from '@ekza-animator/anim-core';
import type { MeshOpDescriptor, MeshSetOpDescriptor } from '@ekza-animator/mesh-core';
import { MESH_OP_DESCRIPTORS, MESH_SET_OP_DESCRIPTORS } from '@ekza-animator/mesh-core/descriptors';
import { attachMeshes } from '../../../mesh';
import { meshKernel } from '../../../mesh/kernel';
import { kindOf, MESH_EXTRA_ARGS, meshOperator, meshSetOperator, opArgs, targetsOf } from '../../../mesh/operator';
import { runSeed, runSettings } from '../../../mesh/seed';
import type { MeshOpArgs, MeshOpOutcome, OperatorDef, ToolId } from '../../../types';
import type { AnyOperator } from '../define';
import { rememberResolvedArgs } from '../lastop';

export { MESH_EXTRA_ARGS };

/** Blender names (and a few Maya synonyms) the command palette also finds (§6: "Blender names are palette aliases"). */
export const MESH_OP_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'mesh.transformComponents': ['Move Components', 'Rotate Components', 'Scale Components', 'Grab'],
  'mesh.extrude': ['Extrude Region', 'Extrude Faces', 'Extrude Edges'],
  'mesh.inset': ['Inset Faces'],
  'mesh.bevel': ['Bevel Edges', 'Chamfer'],
  'mesh.insertLoop': ['Loop Cut', 'Loop Cut and Slide', 'Edge Loop'],
  'mesh.offsetLoop': ['Offset Edge Slide'],
  'mesh.connect': ['Connect Vertex Path', 'Connect Components'],
  'mesh.cut': ['Knife', 'Knife Tool'],
  'mesh.slide': ['Edge Slide', 'Vertex Slide'],
  'mesh.averageVertices': ['Smooth Vertices'],
  'mesh.bridge': ['Bridge Edge Loops'],
  'mesh.fillHole': ['Fill', 'Make Face'],
  'mesh.merge': ['Merge Vertices', 'Weld'],
  'mesh.mergeToCenter': ['Merge at Center', 'Collapse to Center'],
  'mesh.mergeByDistance': ['Remove Doubles', 'Merge Vertices by Distance'],
  'mesh.targetWeld': ['Weld to Target', 'Merge at Last'],
  'mesh.collapse': ['Collapse Edges'],
  'mesh.delete': ['Delete Faces', 'Delete Edges', 'Delete Vertices'],
  'mesh.deleteEdgeVertex': ['Dissolve', 'Dissolve Edges', 'Dissolve Vertices'],
  'mesh.spinEdge': ['Rotate Edge'],
  'mesh.flipTriangleEdge': ['Flip Edge'],
  'mesh.triangulate': ['Triangulate Faces'],
  'mesh.quadrangulate': ['Tris to Quads'],
  'mesh.harden': ['Mark Sharp', 'Harden Edges'],
  'mesh.soften': ['Clear Sharp', 'Soften Edges'],
  'mesh.setNormalAngle': ['Smooth by Angle', 'Auto Smooth'],
  'mesh.reverse': ['Flip Normals', 'Reverse Normals'],
  'mesh.conform': ['Recalculate Normals', 'Recalculate Outside'],
  'mesh.mirror': ['Mirror Mesh'],
  'mesh.symmetrize': ['Symmetrize Mesh'],
  'mesh.uv.planar': ['Project from View', 'Planar Projection'],
  'mesh.uv.box': ['Cube Projection', 'Box Mapping'],
  'mesh.uv.cylindrical': ['Cylinder Projection'],
  'mesh.cleanup': ['Clean Up Mesh'],
  'mesh.paint': ['Assign Colour', 'Paint Faces'],
  'mesh.combine': ['Join'],
  'mesh.separate': ['Separate by Loose Parts'],
  'mesh.extract': ['Separate Selection'],
  'mesh.duplicateFaces': ['Duplicate Faces'],
};

/** The tool `G` re-activates after a tool run and `Y` returns to (§6.1 UI column, §5.7 rules 1 and 3). */
export const MESH_OP_TOOLS: Readonly<Record<string, ToolId>> = {
  'mesh.insertLoop': 'insertLoop',
  'mesh.cut': 'multiCut',
  'mesh.slide': 'slide',
  'mesh.targetWeld': 'targetWeld',
  'mesh.paint': 'paint',
  'mesh.paint.fillShell': 'paint',
};

/** Ops only other operators run (not in menus, the palette or the Toolkit). */
export const INTERNAL_MESH_OPS: ReadonlySet<string> = new Set(['mesh.applyTransform', 'mesh.paint.remap']);

/**
 * Help-line wording of an op's selection problems (§7 `Mod+E`: "in object mode or over other panels it poll-fails
 * 'Select faces or border edges'"; §6.1 Extrude: "vertex mode poll 'not available yet'"). Replaces the wrappers'
 * generic "enter a component mode first" / "Select components first" / "works on …" reasons; the kernel's own
 * refusals and "Mesh tools are loading" pass through.
 */
export const MESH_OP_SELECTION_HINTS: Readonly<Record<string, { readonly select: string; readonly vertex?: string }>> =
  {
    'mesh.extrude': { select: 'Select faces or border edges', vertex: 'Vertex extrude is not available yet' },
  };

function withSelectionHint(
  desc: MeshOpDescriptor,
  poll: OperatorDef<MeshOpArgs, MeshOpOutcome, void>['poll'],
): OperatorDef<MeshOpArgs, MeshOpOutcome, void>['poll'] {
  const hint = MESH_OP_SELECTION_HINTS[desc.id];
  if (hint === undefined || poll === undefined) return poll;
  const generic = [`${desc.label}: enter a component mode first`, 'Select components first'];
  return (ctx, args) => {
    const result = poll(ctx, args);
    if (result === true) return result;
    const vertex = ctx.app.session.getState().model.componentMode === 'vertex' && args?.kind === undefined;
    if (result.reason.startsWith(`${desc.label} works on `)) {
      return { ok: false, reason: vertex && hint.vertex !== undefined ? hint.vertex : hint.select };
    }
    return generic.includes(result.reason) ? { ok: false, reason: hint.select } : result;
  };
}

/** One-line descriptions for the command palette and tooltips (the label says the rest). */
function descriptionOf(label: string, kinds: MeshOpDescriptor['kinds'] | null): string {
  if (kinds === null) return `${label} (mesh objects).`;
  return kinds === 'object' ? `${label} (whole meshes).` : `${label} (${kinds.join(', ')} components).`;
}

/** `meshOperator` with the kernel's resolved args remembered for the LastRun recorder (§5.7). */
export function registeredMeshOperator(desc: MeshOpDescriptor): OperatorDef<MeshOpArgs, MeshOpOutcome, void> {
  const tool = MESH_OP_TOOLS[desc.id];
  const aliases = MESH_OP_ALIASES[desc.id];
  const base = meshOperator(desc, {
    category: 'mesh',
    scope: 'model',
    ...(tool === undefined ? {} : { tool }),
    ...(aliases === undefined ? {} : { aliases }),
  });
  const objectLevel = desc.kinds === 'object';
  const poll = withSelectionHint(
    desc,
    base.poll === undefined ? undefined : (ctx, args) => base.poll?.(ctx, args) ?? true,
  );
  return {
    ...base,
    description: descriptionOf(desc.label, desc.kinds),
    flags: { ...base.flags, ...(INTERNAL_MESH_OPS.has(desc.id) ? { internal: true } : {}) },
    ...(poll === undefined ? {} : { poll }),
    apply(ctx, args): MeshOpOutcome {
      const op = meshKernel()?.MESH_OPS[desc.id];
      const meshes = attachMeshes(ctx.app);
      if (ctx.tx === null || op === undefined || meshes === null) {
        throw new EkzaError('mesh-loading', 'Mesh tools are loading');
      }
      const kind = objectLevel ? null : kindOf(ctx.app, args);
      const targets = targetsOf(ctx.app, args, kind, objectLevel);
      const settings = runSettings(ctx, desc.id);
      const result = meshes.commitOp(ctx.tx, op, targets, opArgs(args), {
        seed: runSeed(ctx, desc.id),
        kind,
        ...(settings === undefined ? {} : { settings }),
      });
      const outcome: MeshOpOutcome = { meshes: targets, warnings: result.warnings };
      rememberResolvedArgs(outcome, result.resolvedArgs);
      return outcome;
    },
  };
}

export function registeredMeshSetOperator(desc: MeshSetOpDescriptor): AnyOperator {
  const aliases = MESH_OP_ALIASES[desc.id];
  const base = meshSetOperator(desc, { category: 'mesh' });
  return {
    ...base,
    description: descriptionOf(desc.label, null),
    ...(aliases === undefined ? {} : { aliases }),
  };
}

/** Every §6.1 MeshOp and set-op, in descriptor order. */
export const MESH_OPERATORS: readonly AnyOperator[] = [
  ...Object.values(MESH_OP_DESCRIPTORS).map((desc) => registeredMeshOperator(desc) as unknown as AnyOperator),
  ...Object.values(MESH_SET_OP_DESCRIPTORS).map(registeredMeshSetOperator),
];
