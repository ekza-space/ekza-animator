// `mesh.extrude` on faces (M6A-SPEC §5.8 steps 1–6, §5.14): regions (connected, or each face with
// `keepFacesTogether` off), the extrusion topology (./topology.ts), the cap transform per region (./place.ts) and H2
// on every wall edge. The cap keeps the original face indices; `selection′` = the cap faces. `adjust` re-places the
// cap for value args (positions and wall hardness only), bit-identical to a fresh run with the merged args; the
// result's warnings, frame and resolved args then follow the adjustment.
import type { ParamValue, ParamValues } from '@ekza-animator/anim-core';
import { applySmoothingAngle } from '../../normals/hard';
import { resolveSmoothingAngle } from '../../normals/normals';
import { refuse } from '../../refusal';
import type { EditMesh, OpContext, OpResult, OpWarning, Refusal } from '../../types';
import { EXTRUDE } from './descriptor';
import { capData, frameOf, PLACEMENT_ARGS } from './geometry';
import { type PlaceGroup, pairGroups, placeGroups } from './place';
import type { Mirror } from './shared/symmetry';
import { adjustableResult, bool, num, type PlacedState, resolveArgs, selectionResult } from './shared/util';
import { buildExtrusion, faceRegions, planExtrusion, regionNonManifold, sideEdges } from './topology';

/** Self-mirror keys of a cap vertex: its source and the smallest face of its fan (mapped through the mirror). */
function capKeys(
  mirror: Mirror | null,
  src: number,
  faces: readonly number[],
): { key: string; partnerKey: string | null } {
  const key = `${src}:${faces[0] as number}`;
  if (mirror === null) return { key, partnerKey: null };
  const pv = mirror.partner('vertex', src);
  const pf = faces.map((f) => mirror.partner('face', f));
  if (pv === -1 || pf.some((f) => f === -1)) return { key, partnerKey: null };
  return { key, partnerKey: `${pv}:${Math.min(...pf)}` };
}

export function extrudeFaces(
  m: EditMesh,
  faces: readonly number[],
  args: Record<string, ParamValue>,
  ctx: OpContext,
  mirror: Mirror | null,
  warnings: readonly OpWarning[],
): OpResult | Refusal {
  const regions = faceRegions(m, faces, bool(args, 'keepFacesTogether', true));
  for (const region of regions) {
    if (regionNonManifold(m, region).length > 0) {
      return refuse('extrude.non-manifold', 'Extrude needs manifold edges around the selected faces');
    }
  }
  const plan = planExtrusion(m, regions);
  // Everything the geometry reads comes from the pre-op mesh.
  const frames = regions.map((region) => frameOf(m, region));
  const data = plan.regions.map((region) =>
    region.caps.map((cap) => capData(m, cap.src, cap.faces, cap.dup ? cap.prev : -1, cap.dup ? cap.next : -1)),
  );
  const keys = plan.regions.map((region) => region.caps.map((cap) => capKeys(mirror, cap.src, cap.faces)));
  const roles = pairGroups(regions, 'face', mirror, (i) =>
    mirror === null ? 0 : mirror.distance((frames[i] as (typeof frames)[number]).pivot),
  );

  const built = buildExtrusion(m, plan, Math.round(num(args, 'divisions', 1)));
  const groups: PlaceGroup[] = built.regions.map((region, i) => {
    const role = roles[i] ?? { kind: 'own' };
    let frame = frames[i] as (typeof frames)[number];
    if (role.kind === 'partner' && mirror !== null) {
      const src = frames[role.source] as (typeof frames)[number];
      frame = {
        pivot: mirror.reflect(src.pivot),
        x: mirror.reflectDir(src.x),
        y: mirror.reflectDir(src.y),
        z: mirror.reflectDir(src.z),
      };
    }
    return {
      role,
      frame,
      edges: false,
      verts: region.caps.map((cap, j) => ({
        src: cap.src,
        out: cap.out,
        ring: cap.ring,
        data: (data[i] as (typeof data)[number])[j] as (typeof data)[number][number],
        ...((keys[i] as (typeof keys)[number])[j] as { key: string; partnerKey: string | null }),
      })),
    };
  });
  const hard = sideEdges(m, built);
  let current: Record<string, ParamValue> = args;
  const place = (values: Record<string, ParamValue>) => {
    const placed = placeGroups(m, groups, values, ctx.placement, mirror, 'extrude.offset-clamped');
    applySmoothingAngle(m, hard, num(values, 'smoothingAngle'));
    return placed;
  };
  const placed = place(current);
  const capFaces = regions.flat().sort((a, b) => a - b);
  const state = (values: Record<string, ParamValue>, at: typeof placed): PlacedState => ({
    warnings: [...warnings, ...at.warnings],
    frame: at.frame ?? undefined,
    resolvedArgs: values,
  });
  const adjust = (patch: ParamValues): PlacedState | null => {
    for (const key of Object.keys(patch)) if (!PLACEMENT_ARGS.has(key) && key !== 'smoothingAngle') return null;
    const merged = resolveArgs(EXTRUDE, { ...current, ...patch });
    merged['smoothingAngle'] = resolveSmoothingAngle(merged['smoothingAngle'] as number | null, ctx.faceted);
    const again = place(merged);
    current = merged;
    return state(merged, again);
  };
  return adjustableResult(selectionResult(m, 'face', capFaces), state(args, placed), adjust);
}
