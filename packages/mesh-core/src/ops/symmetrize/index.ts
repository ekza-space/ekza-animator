// Kernel op `mesh.symmetrize {axis, keep, tolerance}` (M6A-SPEC §5.13; owner B4). Moves each partner vertex to the
// mirror image of its source-side partner (`keep: 'positive'` = the +axis half is the source) and copies its point
// layers by their mirror rules; seam vertices (their own partners) are put exactly on the plane. Partners come from the
// current symmetry map when it is on the same axis (and `tolerance` is null or the map's), otherwise from a map built
// on the object plane with `tolerance` (null → the map's tolerance, else 0.001 m: `prefs.modeling.symmetryTolerance`).
// Object mode acts on every visible vertex, vertex mode on the pairs the selection touches. Vertices without a partner
// stay and are reported (`symmetrize.unmatched`, with the vertices for a selection action). Positions only.
import type { ParamValues } from '@ekza-animator/anim-core';
import { mirrorPointAttributes } from '../../layers/propagate';
import { refuse } from '../../refusal';
import { argsOf, keptSelection, positiveZeros, scopeVerts, str } from '../../subset/support';
import { axisIndex, vertexPartners } from '../../subset/symmetry';
import type {
  ComponentSelection,
  EditMesh,
  MeshOp,
  OpContext,
  OpResult,
  OpWarning,
  Refusal,
  SymmetryAxis,
} from '../../types';
import { SYMMETRIZE } from './descriptor';

/** The default symmetry tolerance in metres (`prefs.modeling.symmetryTolerance`, §5.14). */
export const DEFAULT_SYMMETRY_TOLERANCE = 0.001;

function symmetrizePoll(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  return scopeVerts(m, sel, ctx.hidden).length > 0
    ? true
    : refuse('symmetrize.no-vertices', 'Symmetrize needs vertices: select them or run it on the object');
}

export const symmetrize: MeshOp = Object.freeze({
  ...SYMMETRIZE,
  poll: symmetrizePoll,
  run(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
    const verdict = symmetrizePoll(m, sel, ctx);
    if (verdict !== true) return verdict;
    const parsed = argsOf(SYMMETRIZE.params, raw);
    const axis = str<SymmetryAxis>(parsed, 'axis', 'x');
    const k = axisIndex(axis);
    const keep = str<string>(parsed, 'keep', 'positive') === 'negative' ? -1 : 1;
    const given = typeof parsed['tolerance'] === 'number' ? parsed['tolerance'] : null;
    const map = ctx.symmetry?.map ?? null;
    const current = map !== null && map.axis === axis && (given === null || given === map.tolerance) ? map : null;
    const tolerance = given ?? map?.tolerance ?? DEFAULT_SYMMETRY_TOLERANCE;
    const plane = current?.plane ?? 0;
    const partner = current?.vertex ?? vertexPartners(m, axis, 0, tolerance).partner;
    const args = { ...parsed, tolerance };

    const hidden = ctx.hidden?.verts;
    const scope = scopeVerts(m, sel, ctx.hidden);
    const done = new Set<number>();
    const unmatched: number[] = [];
    const p = m.position;
    for (const v of scope) {
      if (done.has(v)) continue;
      done.add(v);
      const q = partner[v] ?? -1;
      if (q === v) {
        if ((p[3 * v + k] as number) !== plane) {
          const at = [p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number];
          at[k] = plane;
          m.setPosition(v, at[0] as number, at[1] as number, at[2] as number);
        }
        continue;
      }
      if (q < 0) {
        unmatched.push(v);
        continue;
      }
      done.add(q);
      const vSide = ((p[3 * v + k] as number) - plane) * keep;
      const [source, target] = vSide >= 0 ? [v, q] : [q, v];
      if (hidden?.has(target) === true) continue;
      const at = [p[3 * source] as number, p[3 * source + 1] as number, p[3 * source + 2] as number];
      at[k] = 2 * plane - (at[k] as number) + 0;
      if (
        !Object.is(p[3 * target], Math.fround(at[0] as number)) ||
        !Object.is(p[3 * target + 1], Math.fround(at[1] as number)) ||
        !Object.is(p[3 * target + 2], Math.fround(at[2] as number))
      ) {
        m.setPosition(target, at[0] as number, at[1] as number, at[2] as number);
      }
      mirrorPointAttributes(m, source, target, axis);
      positiveZeros(m, 'point', target);
    }
    const warnings: OpWarning[] =
      unmatched.length === 0
        ? []
        : [
            {
              code: 'symmetrize.unmatched',
              message: `${unmatched.length} vertices have no mirror partner`,
              count: unmatched.length,
              elements: Uint32Array.from(unmatched),
            },
          ];
    return { selection: keptSelection(m, sel, sel?.kind ?? 'vertex'), warnings, resolvedArgs: args };
  },
});
