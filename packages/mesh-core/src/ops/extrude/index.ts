// Kernel ops of `ops/extrude/` (M6A-SPEC §6.1, §5.8; B3): `mesh.extrude` on faces (regions or individual faces) and
// on border edges, with divisions, the cap transform in its region frame, mirror-consistent frames under symmetry
// (§5.14) and an `adjust` fast path for the value args. Vertex mode poll-fails ("not available yet", §1.2).
import type { ParamValues } from '@ekza-studio/anim-core';
import { resolveSmoothingAngle } from '../../normals/normals';
import { refuse } from '../../refusal';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, Refusal } from '../../types';
import { EXTRUDE } from './descriptor';
import { extrudeEdges } from './edges';
import { extrudeFaces } from './faces';
import { expandIndices, mirrorOf, unmatchedWarnings } from './shared/symmetry';
import { guarded, resolveArgs, selected } from './shared/util';

function pollExtrude(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  if (sel === null) return refuse('extrude.no-selection', 'Select faces or border edges');
  if (sel.kind === 'vertex') return refuse('extrude.vertex', 'Vertex extrude is not available yet');
  if (selected(m, sel, sel.kind, ctx.hidden).length === 0) {
    return refuse('extrude.no-selection', 'Select faces or border edges');
  }
  return true;
}

function runExtrude(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const verdict = pollExtrude(m, sel, ctx);
  if (verdict !== true) return verdict;
  const selection = sel as ComponentSelection;
  const args = resolveArgs(EXTRUDE, rawArgs);
  args['smoothingAngle'] = resolveSmoothingAngle(args['smoothingAngle'] as number | null, ctx.faceted);
  const mirror = mirrorOf(ctx);
  const kind = selection.kind === 'edge' ? 'edge' : 'face';
  const expanded = expandIndices(mirror, kind, selected(m, selection, kind, ctx.hidden));
  const warnings = unmatchedWarnings(expanded.unmatched);
  return kind === 'edge'
    ? extrudeEdges(m, expanded.indices, args, ctx, mirror, warnings)
    : extrudeFaces(m, expanded.indices, args, ctx, mirror, warnings);
}

export const extrude: MeshOp = Object.freeze({
  ...EXTRUDE,
  poll: pollExtrude,
  run: guarded(EXTRUDE, runExtrude),
});
