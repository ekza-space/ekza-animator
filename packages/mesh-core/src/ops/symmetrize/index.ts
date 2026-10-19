// Kernel op `mesh.symmetrize {axis, keep, tolerance}` (M6A-SPEC §5.13; owner B4). Moves each partner vertex to the
// mirror image of its source-side partner (`keep: 'positive'` = the +axis half is the source) and copies its point
// layers by their mirror rules; seam vertices (their own partners) are put exactly on the plane. Partners and the plane
// come from the current symmetry map when it is on the same axis (and `tolerance` is null or the map's) — its mirror in
// mesh-local space, Object or World (the world plane mapped through the placement) — otherwise from a map built on the
// object plane with `tolerance` (null → the map's tolerance, else 0.001 m: `prefs.modeling.symmetryTolerance`).
// Object mode acts on every visible vertex, vertex mode on the pairs the selection touches. Vertices without a partner
// stay and are reported (`symmetrize.unmatched`, with the vertices for a selection action). Positions only.
import type { ParamValues } from '@ekza-animator/anim-core';
import { refuse } from '../../refusal';
import { argsOf, keptSelection, positiveZeros, scopeVerts, str } from '../../subset/support';
import {
  mirrorOf,
  mirrorPlane,
  mirrorPointLayers,
  planeDistance,
  projectOntoPlane,
  reflectPoint,
  vertexPartners,
} from '../../subset/symmetry';
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
    const keep = str<string>(parsed, 'keep', 'positive') === 'negative' ? -1 : 1;
    const given = typeof parsed['tolerance'] === 'number' ? parsed['tolerance'] : null;
    const map = ctx.symmetry?.map ?? null;
    const current = map !== null && map.axis === axis && (given === null || given === map.tolerance) ? map : null;
    const tolerance = given ?? map?.tolerance ?? DEFAULT_SYMMETRY_TOLERANCE;
    const mirror =
      current !== null
        ? mirrorOf(current, ctx.placement)
        : mirrorPlane({ axis, space: 'object', placement: ctx.placement, plane: 0 });
    const partner = current?.vertex ?? vertexPartners(m, mirror, tolerance).partner;
    const args = { ...parsed, tolerance };

    const hidden = ctx.hidden?.verts;
    const scope = scopeVerts(m, sel, ctx.hidden);
    const done = new Set<number>();
    const unmatched: number[] = [];
    const p = m.position;
    const at = new Float64Array(3);
    const writeIfMoved = (v: number): void => {
      const x = (at[0] as number) + 0;
      const y = (at[1] as number) + 0;
      const z = (at[2] as number) + 0;
      if (
        !Object.is(p[3 * v], Math.fround(x)) ||
        !Object.is(p[3 * v + 1], Math.fround(y)) ||
        !Object.is(p[3 * v + 2], Math.fround(z))
      ) {
        m.setPosition(v, x, y, z);
      }
    };
    for (const v of scope) {
      if (done.has(v)) continue;
      done.add(v);
      const q = partner[v] ?? -1;
      if (q === v) {
        projectOntoPlane(mirror, p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number, at);
        writeIfMoved(v);
        continue;
      }
      if (q < 0) {
        unmatched.push(v);
        continue;
      }
      done.add(q);
      const vSide = planeDistance(mirror, p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number) * keep;
      const [source, target] = vSide >= 0 ? [v, q] : [q, v];
      if (hidden?.has(target) === true) continue;
      reflectPoint(mirror, p[3 * source] as number, p[3 * source + 1] as number, p[3 * source + 2] as number, at);
      writeIfMoved(target);
      mirrorPointLayers(m, mirror, source, target);
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
