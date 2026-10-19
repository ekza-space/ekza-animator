// Snapping of Model's transform drags (M6A-SPEC §5.15; B12a): `X` grid (the moved pivot snaps per moved axis to
// `prefs.modeling.gridStep`), `V` vertex (the pivot snaps to the nearest visible vertex within
// `prefs.modeling.vertexSnapRadiusPx` on any mesh the pane draws, the moved vertices excluded, so a separate part can
// be aligned before Combine; constrained handles take the candidate's projection on their axis or plane), `J`
// increments (0.1 m, 15°, 0.1). Snapping moves the pivot and the selection keeps its spacing (Maya's Retain component
// spacing on).
import type { ReadonlyVec3, Vec3 } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import { type EditorApp, objectsDrawnIn } from '@ekza-animator/editor-core';
import type { ManipHandle } from '../../../types';
import { meshWorld, transformPoint } from './frame';
import { type Motion, movedAxes, PLANE_NORMAL, TRANSLATE_AXIS } from './motion';
import type { ManipulatorFrame } from './types';

export interface SnapModes {
  readonly grid: boolean;
  readonly vertex: boolean;
  readonly increment: boolean;
}

/** A vertex the pivot snaps to. */
export interface SnapCandidate {
  readonly mesh: MeshId;
  readonly index: number;
  readonly world: Vec3;
  /** Pane CSS px. */
  readonly x: number;
  readonly y: number;
  /** "→ vertex 128 · Torso". */
  readonly label: string;
}

/**
 * The nearest visible vertex to a pane point within `radiusPx` on any mesh the pane draws (hidden components and
 * `exclude`d vertices skipped; ties to the nearer one in depth), or null.
 */
export function nearestVertex(
  app: EditorApp,
  paneId: string,
  frame: Pick<ManipulatorFrame, 'projector'>,
  x: number,
  y: number,
  radiusPx: number,
  exclude: (mesh: MeshId, v: number) => boolean,
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestDistance = radiusPx;
  let bestDepth = Infinity;
  const out = [0, 0, 0];
  for (const id of objectsDrawnIn(app, paneId)) {
    if (!id.startsWith('msh_')) continue;
    const mesh = id as MeshId;
    const runtime = app.meshes.get(mesh);
    const data = runtime?.state === 'ready' ? runtime.data() : null;
    const world = meshWorld(app, mesh);
    if (data === null || world === null) continue;
    let hidden: { has(v: number): boolean } | null = null;
    try {
      hidden = app.components.hidden(mesh).verts;
    } catch {
      hidden = null;
    }
    const p = data.position;
    for (let v = 0; v < data.counts.points; v++) {
      if (exclude(mesh, v) || hidden?.has(v) === true) continue;
      const w = transformPoint(world, p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number);
      if (!frame.projector.project(w[0], w[1], w[2], out)) continue;
      const d = Math.hypot((out[0] as number) - x, (out[1] as number) - y);
      const depth = out[2] as number;
      // Ties (vertices on one line of sight project onto the same point) go to the nearer one.
      const tie = Math.abs(d - bestDistance) < 1e-6;
      if ((d < bestDistance && !tie) || (tie && depth < bestDepth) || (best === null && d <= bestDistance)) {
        bestDistance = d;
        bestDepth = depth;
        const name = app.store.get('meshes', mesh)?.name ?? mesh;
        best = { mesh, index: v, world: w, x: out[0] as number, y: out[1] as number, label: `→ vertex ${v} · ${name}` };
      }
    }
  }
  return best;
}

function dot(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The translation that brings the pivot to `target` under a handle's constraint (axis line, plane, free). */
export function deltaTowards(
  handle: ManipHandle,
  pivot: ReadonlyVec3,
  axes: readonly [ReadonlyVec3, ReadonlyVec3, ReadonlyVec3],
  target: ReadonlyVec3,
): Vec3 {
  const d: Vec3 = [target[0] - pivot[0], target[1] - pivot[1], target[2] - pivot[2]];
  const axis = TRANSLATE_AXIS[handle];
  if (axis !== undefined) {
    const u = axes[axis];
    const s = dot(d, u);
    return [u[0] * s, u[1] * s, u[2] * s];
  }
  const normal = PLANE_NORMAL[handle];
  if (normal !== undefined) {
    const n = axes[normal];
    const s = dot(d, n);
    return [d[0] - n[0] * s, d[1] - n[1] * s, d[2] - n[2] * s];
  }
  return d;
}

const round = (value: number, step: number): number => (step > 0 ? Math.round(value / step) * step : value);

/**
 * Grid snapping (`X`): the moved pivot's coordinate along each moved axis (measured from the world origin) snaps to
 * the grid; increments (`J`): the move along each moved axis snaps to the move increment.
 */
export function snapTranslation(
  delta: ReadonlyVec3,
  handle: ManipHandle,
  pivot: ReadonlyVec3,
  axes: readonly [ReadonlyVec3, ReadonlyVec3, ReadonlyVec3],
  modes: { readonly grid: boolean; readonly increment: boolean },
  steps: { readonly grid: number; readonly move: number },
): Vec3 {
  if (!modes.grid && !modes.increment) return [delta[0], delta[1], delta[2]];
  const out: Vec3 = [delta[0], delta[1], delta[2]];
  for (const k of movedAxes(handle)) {
    const u = axes[k];
    const along = dot(delta, u);
    const snapped = modes.grid ? round(dot(pivot, u) + along, steps.grid) - dot(pivot, u) : round(along, steps.move);
    const change = snapped - along;
    out[0] += u[0] * change;
    out[1] += u[1] * change;
    out[2] += u[2] * change;
  }
  return out;
}

/** Increment snapping of rotations (15°) and scales (0.1); translations go through `snapTranslation`. */
export function snapIncrement(motion: Motion, increments: { readonly rotate: number; readonly scale: number }): Motion {
  if (motion.kind === 'rotate') return { ...motion, angle: round(motion.angle, increments.rotate) };
  if (motion.kind === 'scale') {
    return { kind: 'scale', factors: motion.factors.map((f) => 1 + round(f - 1, increments.scale)) as Vec3 };
  }
  return motion;
}
