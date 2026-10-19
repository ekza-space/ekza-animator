// Kernel ops of `ops/inset/` (M6A-SPEC §6.1, §5.9; B3): `mesh.inset` — per region (or per face with `individual`)
// the boundary is inset inside the region surface by `offset` (even offset 1 / sin(α/2) per vertex; `clamp` limits
// each vertex to half its shortest region edge and warns `inset.clamped`), then the inner faces move along their
// even-thickness normals by `depth`. Topology as an extrude with one division (rim quads between the old and the
// inset boundary, ../extrude/topology.ts); the inner faces keep their indices and are `selection′`; rim edges follow
// H2. A region whose boundary is not manifold (a non-manifold edge or a vertex the region touches in two fans)
// refuses `inset.non-manifold`. Symmetry (§5.14): runs on the expanded selection; a self-mirrored region is
// symmetrized. `adjust` re-places the inner faces for offset, depth, even offset, clamp and smoothing angle.
import type { ParamValue, ParamValues } from '@ekza-animator/anim-core';
import { applySmoothingAngle } from '../../normals/hard';
import { resolveSmoothingAngle } from '../../normals/normals';
import { refuse } from '../../refusal';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, OpWarning, Refusal } from '../../types';
import { type CapData, capData, frameOf } from '../extrude/geometry';
import { pairGroups } from '../extrude/place';
import { type Mirror, expandIndices, mirrorOf, unmatchedWarnings } from '../extrude/shared/symmetry';
import {
  type V3,
  add,
  bool,
  num,
  opResult,
  resolveArgs,
  scale,
  selected,
  selectionResult,
  setPos,
} from '../extrude/shared/util';
import { buildExtrusion, faceRegions, planExtrusion, regionNonManifold, sideEdges } from '../extrude/topology';
import { INSET } from './descriptor';

const VALUE_ARGS: ReadonlySet<string> = new Set(['offset', 'depth', 'evenOffset', 'clamp', 'smoothingAngle']);

function pollInset(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  if (sel === null || sel.kind !== 'face' || selected(m, sel, 'face', ctx.hidden).length === 0) {
    return refuse('inset.no-selection', 'Select faces to inset');
  }
  return true;
}

interface InsetVertex {
  readonly key: string;
  readonly partnerKey: string | null;
  readonly out: number;
  readonly data: CapData;
}

/** Inner positions for `args`; the clamp count and the largest clamped reduction go to `clamped`. */
function insetPositions(
  verts: readonly InsetVertex[],
  args: Readonly<Record<string, ParamValue>>,
  self: boolean,
  mirror: Mirror | null,
  clamped: { count: number; max: number },
): Map<string, V3> {
  const offset = Math.max(0, num(args, 'offset'));
  const depth = num(args, 'depth');
  const even = bool(args, 'evenOffset', true);
  const clamp = bool(args, 'clamp', true);
  const out = new Map<string, V3>();
  for (const vert of verts) {
    const d = vert.data;
    let p = d.p;
    if (offset > 0 && d.bisector !== null) {
      let dist = offset * (even ? d.invSin : 1);
      if (clamp && dist > d.limit) {
        clamped.count++;
        clamped.max = Math.max(clamped.max, dist - d.limit);
        dist = d.limit;
      }
      p = add(p, scale(d.bisector, dist));
    }
    if (depth !== 0) p = add(p, scale(d.n, depth * d.thick));
    out.set(vert.key, p);
  }
  if (self && mirror !== null) {
    const symmetric = new Map<string, V3>();
    for (const vert of verts) {
      const q = out.get(vert.key) as V3;
      const partner = vert.partnerKey === null ? undefined : out.get(vert.partnerKey);
      if (partner === undefined) symmetric.set(vert.key, q);
      else if (vert.partnerKey === vert.key) symmetric.set(vert.key, mirror.project(q));
      else symmetric.set(vert.key, mirror.symmetrize(q, partner));
    }
    return symmetric;
  }
  return out;
}

function runInset(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const verdict = pollInset(m, sel, ctx);
  if (verdict !== true) return verdict;
  const args = resolveArgs(INSET, rawArgs);
  args['smoothingAngle'] = resolveSmoothingAngle(args['smoothingAngle'] as number | null, ctx.faceted);
  const mirror = mirrorOf(ctx);
  const expanded = expandIndices(mirror, 'face', selected(m, sel, 'face', ctx.hidden));
  const regions = faceRegions(m, expanded.indices, !bool(args, 'individual'));
  for (const region of regions) {
    if (regionNonManifold(m, region).length > 0) {
      return refuse('inset.non-manifold', 'Inset needs a manifold boundary around the selected faces');
    }
  }
  const plan = planExtrusion(m, regions);
  for (const region of plan.regions) {
    const fans = new Map<number, number>();
    for (const cap of region.caps) fans.set(cap.src, (fans.get(cap.src) ?? 0) + 1);
    for (const cap of region.caps) {
      if ((fans.get(cap.src) ?? 0) > 1 || (cap.dup && (cap.prev === -1 || cap.next === -1))) {
        return refuse('inset.non-manifold', 'Inset needs a manifold boundary around the selected faces');
      }
    }
  }
  const frames = regions.map((region) => frameOf(m, region));
  const roles = pairGroups(regions, 'face', mirror, (i) =>
    mirror === null ? 0 : mirror.distance((frames[i] as (typeof frames)[number]).pivot),
  );
  const groups = plan.regions.map((region) =>
    region.caps.map((cap) => {
      const data = capData(m, cap.src, cap.faces, cap.dup ? cap.prev : -1, cap.dup ? cap.next : -1);
      const key = `${cap.src}:${cap.faces[0] as number}`;
      let partnerKey: string | null = null;
      if (mirror !== null) {
        const pv = mirror.partner('vertex', cap.src);
        const pf = cap.faces.map((f) => mirror.partner('face', f));
        if (pv !== -1 && pf.every((f) => f !== -1)) partnerKey = `${pv}:${Math.min(...pf)}`;
      }
      return { key, partnerKey, data };
    }),
  );
  const built = buildExtrusion(m, plan, 1);
  const verts: InsetVertex[][] = built.regions.map((region, i) =>
    region.caps.map((cap, j) => ({
      ...((groups[i] as (typeof groups)[number])[j] as (typeof groups)[number][number]),
      out: cap.out,
    })),
  );
  const hard = sideEdges(m, built);
  let current: Record<string, ParamValue> = args;
  const place = (values: Record<string, ParamValue>): OpWarning[] => {
    const clamped = { count: 0, max: 0 };
    verts.forEach((list, i) => {
      const positions = insetPositions(list, values, roles[i]?.kind === 'self', mirror, clamped);
      for (const vert of list) setPos(m, vert.out, positions.get(vert.key) as V3);
    });
    applySmoothingAngle(m, hard, num(values, 'smoothingAngle'));
    return clamped.count === 0
      ? []
      : [
          {
            code: 'inset.clamped',
            message: `Inset clamped at ${clamped.count} vertex${clamped.count === 1 ? '' : 'es'} (by up to ${clamped.max.toFixed(3)} m)`,
            count: clamped.count,
          },
        ];
  };
  const placed = place(current);
  const first = frames[0] as (typeof frames)[number];
  const depth = num(args, 'depth');
  const frame = { pivot: add(first.pivot, scale(first.z, depth)), axes: [first.x, first.y, first.z] as [V3, V3, V3] };
  const adjust = (patch: ParamValues): boolean => {
    for (const key of Object.keys(patch)) if (!VALUE_ARGS.has(key)) return false;
    const merged = resolveArgs(INSET, { ...current, ...patch });
    merged['smoothingAngle'] = resolveSmoothingAngle(merged['smoothingAngle'] as number | null, ctx.faceted);
    place(merged);
    current = merged;
    return true;
  };
  const inner = regions.flat().sort((a, b) => a - b);
  return opResult(selectionResult(m, 'face', inner), [...unmatchedWarnings(expanded.unmatched), ...placed], args, {
    frame,
    adjust,
  });
}

export const inset: MeshOp = Object.freeze({ ...INSET, poll: pollInset, run: runInset });
