// `extrudeGroupFrame` (M6A-SPEC §5.8 steps 4 and 7, §5.14; B12b): the frame `mesh.extrude` actually applies to the
// group that holds a picked component — the extrude session's frame. The selection is expanded and grouped exactly
// as the kernel groups it (face regions, or border-edge chains, of the symmetry-expanded selection), so a picked face
// whose mirror partner joins its region gets the joint region's frame. A mirrored **partner** group (§5.14: its
// source lies on the positive side of the plane) is moved with S ∘ T ∘ S, T the transform of its source group's
// frame (the reflected frame S·F, identical numbers): the result then carries the source group's frame and S, so a
// caller converts a drag of the picked group in the source's frame with the mirrored delta.
import type { ReadonlyXf } from '@ekza-animator/anim-core';
import type { EditMesh, OpFrame, SymmetryContext } from '../../types';
import { borderRecords, chainFrame, chainsOf } from './edges';
import { frameOf } from './geometry';
import { pairGroups } from './place';
import { expandIndices, Mirror } from './shared/symmetry';
import { uniqueSorted } from './shared/util';
import { faceRegions } from './topology';

/** A mesh-local reflection `p ↦ m·p + t` (`m` row-major 3×3). */
export interface ExtrudeMirror {
  readonly m: readonly number[];
  readonly t: readonly [number, number, number];
}

/** The frame the extrude kernel applies to one group (mesh-local). */
export interface ExtrudeGroupFrame {
  /**
   * The frame the group's `local*` args apply in: the group's own §5.8 frame, or — for a mirrored partner group — its
   * source group's frame (right-handed in both cases).
   */
  readonly frame: OpFrame;
  /** The group's §5.14 role: 'own' without symmetry or without a matched partner group. */
  readonly role: 'own' | 'self' | 'source' | 'partner';
  /** A partner group's reflection S (it moves with S ∘ T ∘ S, T the transform of `frame`); null for any other role. */
  readonly mirror: ExtrudeMirror | null;
}

const IDENTITY_XF: ReadonlyXf = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };

/**
 * The extrude frame of the group that holds the lowest-index picked component of `kind` (faces, or border edges:
 * interior, wire and out-of-range components are skipped, as the kernel refuses them), grouped as `mesh.extrude`
 * groups `picked` expanded by `symmetry` (its placement: the mesh's, for a world-space map). Null when nothing is left.
 */
export function extrudeGroupFrame(
  m: EditMesh,
  kind: 'face' | 'edge',
  picked: ArrayLike<number>,
  opts: {
    readonly keepFacesTogether?: boolean;
    readonly symmetry?: SymmetryContext | null;
    readonly placement?: ReadonlyXf;
  } = {},
): ExtrudeGroupFrame | null {
  const valid: number[] = [];
  for (let i = 0; i < picked.length; i++) {
    const c = picked[i] as number;
    if (!Number.isInteger(c) || c < 0) continue;
    if (kind === 'face' ? c < m.counts.faces : c < m.counts.edges && m.edgeFaceCount(c) === 1) valid.push(c);
  }
  const seeds = uniqueSorted(valid);
  const seed = seeds[0];
  if (seed === undefined) return null;
  const symmetry = opts.symmetry ?? null;
  const mirror = symmetry === null ? null : new Mirror(symmetry, opts.placement ?? IDENTITY_XF);
  let indices = expandIndices(mirror, kind, seeds).indices;
  if (kind === 'edge') indices = indices.filter((e) => m.edgeFaceCount(e) === 1);
  const groups =
    kind === 'face' ? faceRegions(m, indices, opts.keepFacesTogether !== false) : chainsOf(m, uniqueSorted(indices));
  const frames = groups.map((g) => (kind === 'face' ? frameOf(m, g) : chainFrame(m, borderRecords(m, g))));
  const roles = pairGroups(groups, kind, mirror, (i) =>
    mirror === null ? 0 : mirror.distance((frames[i] as (typeof frames)[number]).pivot),
  );
  const index = groups.findIndex((g) => g.includes(seed));
  const role = roles[index];
  const own = frames[index];
  if (role === undefined || own === undefined) return null;
  const at = (f: (typeof frames)[number]): OpFrame => ({ pivot: f.pivot, axes: [f.x, f.y, f.z] });
  if (role.kind === 'partner' && mirror !== null) {
    const source = frames[role.source] as (typeof frames)[number];
    const affine = mirror.affine();
    return { frame: at(source), role: 'partner', mirror: { m: [...affine.m], t: [...affine.t] } };
  }
  return { frame: at(own), role: role.kind, mirror: null };
}
