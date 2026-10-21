// The kernel's `OpContext` for one mesh (M6A-SPEC §4.3, §5.14, §5.15): world placement through the scene hierarchy,
// the mesh's symmetry and soft-select settings (or the ones a re-run recorded in `LastRun.context`, §5.7), hidden
// components (B10), the curve engine and the scale-relative epsilon.
import { type ReadonlyXf, xfIdentity, xfMultiply } from '@ekza-studio/anim-core';
import type { GroupId, MeshId, MeshRecord, ReadView } from '@ekza-studio/doc';
import type { CurveEngine } from '@ekza-studio/anim-core';
import type { EditMesh, HiddenSet, MeshData, OpContext, SoftContext, SymmetryMap } from '@ekza-studio/mesh-core';
import type { SoftSelectSettings, SymmetrySettings } from '../types';

/** The symmetry and soft context of a run: the session's (a first run) or the recorded ones (adjust/repeat). */
export interface RunSettings {
  readonly symmetry: Readonly<Record<string, SymmetrySettings>> | null;
  readonly soft: SoftSelectSettings | null | undefined;
}

/** World-from-local placement of a mesh record: its placement composed with every group/mesh parent and, for a
 *  character's mesh, the character root (M6A-SPEC §4.2 `placement`). Cycles (never written by M6a) stop the walk. */
export function worldPlacement(view: ReadView, record: MeshRecord): ReadonlyXf {
  let world = xfMultiply(xfIdentity(), record.placement);
  const seen = new Set<string>([record.id]);
  let parent: GroupId | MeshId | null = record.parent;
  while (parent !== null && !seen.has(parent)) {
    seen.add(parent);
    const node: { readonly placement: ReadonlyXf; readonly parent: GroupId | MeshId | null } | undefined =
      parent.startsWith('grp_') ? view.get('groups', parent as GroupId) : view.get('meshes', parent as MeshId);
    if (node === undefined) break;
    world = xfMultiply(node.placement, world);
    parent = node.parent;
  }
  if ('character' in record.owner) {
    const character = view.get('characters', record.owner.character);
    if (character !== undefined) world = xfMultiply(character.placement, world);
  }
  return world;
}

/** Scale-relative epsilon (§4.3): 1e-6 × the bounding-box diagonal, at least 1e-9 m. */
export function epsilonOf(position: ArrayLike<number>, points: number): number {
  if (points === 0) return 1e-9;
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < points; i++) {
    const x = position[3 * i] as number;
    const y = position[3 * i + 1] as number;
    const z = position[3 * i + 2] as number;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const diagonal = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  return Math.max(1e-9, 1e-6 * diagonal);
}

/** The symmetry axis/space of a mode, null for 'off'. */
export function symmetryAxisOf(
  settings: SymmetrySettings | null | undefined,
): { readonly space: 'object' | 'world'; readonly axis: 'x' | 'y' | 'z' } | null {
  if (settings === null || settings === undefined || settings.mode === 'off') return null;
  const [space, axis] = settings.mode.split('-') as ['object' | 'world', 'x' | 'y' | 'z'];
  return { space, axis };
}

export function softContextOf(settings: SoftSelectSettings | null | undefined): SoftContext | null {
  if (settings === null || settings === undefined || !settings.on) return null;
  return { radius: settings.radius, falloff: settings.falloff, curve: settings.curve };
}

export function buildOpContext(parts: {
  readonly placement: ReadonlyXf;
  readonly faceted: boolean;
  readonly symmetry: { readonly map: SymmetryMap; readonly preserveSeam: boolean } | null;
  readonly soft: SoftContext | null;
  readonly hidden: HiddenSet | null;
  readonly curves: CurveEngine;
  readonly mesh: EditMesh | MeshData;
}): OpContext {
  return {
    symmetry: parts.symmetry,
    hidden: parts.hidden,
    placement: parts.placement,
    faceted: parts.faceted,
    soft: parts.soft,
    curves: parts.curves,
    epsilon: epsilonOf(parts.mesh.position, parts.mesh.counts.points),
  };
}
