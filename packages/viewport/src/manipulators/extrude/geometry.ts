// The extrude manipulator's handle layout and picking (M6A-SPEC §5.8, §4.7; B12b), pure functions of the manipulator
// frame and a pane's projector: the DCC's polyExtrude manipulator — translate arrows X/Y/Z on the cap's axes (or world
// axes with the local/world toggle), rotate rings, scale cubes on the cap's axes, a centre cube for uniform scale and
// the local/world toggle — at a constant pixel size. Handle ids are the `ManipHandle`s of the W/E/R manipulators, so
// `screenOfManipulator` addresses them the same way (§4.7); the toggle is `space`.
import type { Vec3 } from '@ekza-studio/anim-core';
import type { ExtrudeManipFrame } from '@ekza-studio/editor-core';
import { type Camera, OrthographicCamera, PerspectiveCamera } from 'three';
import { handleGrowPx } from '../../input/tolerance';
import type { PaneProjector } from '../../picking/geometry';
import type { ManipHandle } from '../../types';

export type ExtrudeHandle = 'tx' | 'ty' | 'tz' | 'rx' | 'ry' | 'rz' | 'sx' | 'sy' | 'sz' | 'suniform' | 'space';

/** Layout in manipulator units (1 unit = the manipulator size in px at the pivot). */
export const EXTRUDE_LAYOUT = {
  axisStart: 0.18,
  axisEnd: 1,
  cone: 0.16,
  scaleAt: 0.55,
  scaleHalf: 0.045,
  ring: 0.75,
  centreHalf: 0.06,
  toggle: [-0.42, 0.42, 0] as Vec3,
  toggleHalf: 0.04,
} as const;

/**
 * Pick tolerances in CSS px: cubes and the centre first, then arrows, then rings. A finger or the pen adds the growth
 * of the manipulator pick radius to each (STUDIO-TOUCH-SPEC §5.4, `handleGrowPx`), keeping their order.
 */
const PICK_PX = { cube: 8, centre: 10, arrow: 7, ring: 6 } as const;
const RING_SAMPLES = 64;

export const TRANSLATE: readonly ExtrudeHandle[] = ['tx', 'ty', 'tz'];
export const ROTATE: readonly ExtrudeHandle[] = ['rx', 'ry', 'rz'];
export const SCALE: readonly ExtrudeHandle[] = ['sx', 'sy', 'sz'];

const AXIS: Partial<Record<ExtrudeHandle, 0 | 1 | 2>> = {
  tx: 0,
  ty: 1,
  tz: 2,
  rx: 0,
  ry: 1,
  rz: 2,
  sx: 0,
  sy: 1,
  sz: 2,
};

/** Axis index of an axis handle (null for the centre and the toggle). */
export function axisOf(handle: ExtrudeHandle): 0 | 1 | 2 | null {
  return AXIS[handle] ?? null;
}

/** World units per CSS px at `point` in a pane (constant pixel size). */
export function worldPerPixel(camera: Camera, heightPx: number, projector: PaneProjector, point: Vec3): number {
  if (camera instanceof OrthographicCamera) return (camera.top - camera.bottom) / camera.zoom / Math.max(heightPx, 1);
  if (camera instanceof PerspectiveCamera) {
    const depth = Math.max(projector.depth(point[0], point[1], point[2]), 1e-4);
    return (2 * depth * Math.tan((camera.getEffectiveFOV() * Math.PI) / 360)) / Math.max(heightPx, 1);
  }
  return 0.01;
}

const at = (frame: ExtrudeManipFrame, axes: readonly [Vec3, Vec3, Vec3], s: number, local: Vec3): Vec3 => [
  frame.pivot[0] + s * (axes[0][0] * local[0] + axes[1][0] * local[1] + axes[2][0] * local[2]),
  frame.pivot[1] + s * (axes[0][1] * local[0] + axes[1][1] * local[1] + axes[2][1] * local[2]),
  frame.pivot[2] + s * (axes[0][2] * local[0] + axes[1][2] * local[1] + axes[2][2] * local[2]),
];

const unit = (i: 0 | 1 | 2, length: number): Vec3 => {
  const out: Vec3 = [0, 0, 0];
  out[i] = length;
  return out;
};

/** The world point of a handle's grab spot (`s`: world units per manipulator unit). */
export function handlePoint(frame: ExtrudeManipFrame, handle: ExtrudeHandle, s: number): Vec3 {
  const i = axisOf(handle);
  if (handle === 'suniform') return [...frame.pivot] as Vec3;
  if (handle === 'space') return at(frame, frame.axes, s, EXTRUDE_LAYOUT.toggle);
  if (i === null) return [...frame.pivot] as Vec3;
  if (SCALE.includes(handle)) return at(frame, frame.scaleAxes, s, unit(i, EXTRUDE_LAYOUT.scaleAt));
  if (TRANSLATE.includes(handle))
    return at(frame, frame.axes, s, unit(i, EXTRUDE_LAYOUT.axisEnd - EXTRUDE_LAYOUT.cone / 2));
  return ringPoints(frame, i, s)[0] as Vec3;
}

/** Points of a rotate ring (world). */
export function ringPoints(frame: ExtrudeManipFrame, axis: 0 | 1 | 2, s: number): Vec3[] {
  const a = ((axis + 1) % 3) as 0 | 1 | 2;
  const b = ((axis + 2) % 3) as 0 | 1 | 2;
  const out: Vec3[] = [];
  for (let k = 0; k < RING_SAMPLES; k++) {
    const angle = (k / RING_SAMPLES) * Math.PI * 2;
    const local: Vec3 = [0, 0, 0];
    local[a] = Math.cos(angle) * EXTRUDE_LAYOUT.ring;
    local[b] = Math.sin(angle) * EXTRUDE_LAYOUT.ring;
    out.push(at(frame, frame.axes, s, local));
  }
  return out;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** The handle under a pane point (CSS px), or null. */
export function pickExtrudeHandle(
  frame: ExtrudeManipFrame,
  s: number,
  projector: PaneProjector,
  x: number,
  y: number,
): ExtrudeHandle | null {
  const out = [0, 0, 0];
  const screen = (p: Vec3): [number, number] | null =>
    projector.project(p[0], p[1], p[2], out) ? [out[0] as number, out[1] as number] : null;
  const grow = handleGrowPx();
  const near = (p: Vec3, radius: number): number | null => {
    const q = screen(p);
    if (q === null) return null;
    const d = Math.hypot(q[0] - x, q[1] - y);
    return d <= radius + grow ? d : null;
  };
  // Small targets first: the centre cube, the toggle, the scale cubes.
  if (near(frame.pivot, PICK_PX.centre) !== null) return 'suniform';
  if (near(handlePoint(frame, 'space', s), PICK_PX.cube) !== null) return 'space';
  let best: { handle: ExtrudeHandle; d: number } | null = null;
  const consider = (handle: ExtrudeHandle, d: number | null): void => {
    if (d !== null && (best === null || d < best.d)) best = { handle, d };
  };
  for (const handle of SCALE) consider(handle, near(handlePoint(frame, handle, s), PICK_PX.cube));
  if (best !== null) return (best as { handle: ExtrudeHandle }).handle;
  TRANSLATE.forEach((handle, i) => {
    const a = screen(at(frame, frame.axes, s, unit(i as 0 | 1 | 2, EXTRUDE_LAYOUT.axisStart)));
    const b = screen(at(frame, frame.axes, s, unit(i as 0 | 1 | 2, EXTRUDE_LAYOUT.axisEnd)));
    if (a === null || b === null) return;
    const d = segmentDistance(x, y, a[0], a[1], b[0], b[1]);
    consider(handle, d <= PICK_PX.arrow + grow ? d : null);
  });
  if (best !== null) return (best as { handle: ExtrudeHandle }).handle;
  ROTATE.forEach((handle, i) => {
    const points = ringPoints(frame, i as 0 | 1 | 2, s).map(screen);
    let d = Number.POSITIVE_INFINITY;
    for (let k = 0; k < points.length; k++) {
      const p = points[k];
      const q = points[(k + 1) % points.length];
      if (p === null || p === undefined || q === null || q === undefined) continue;
      d = Math.min(d, segmentDistance(x, y, p[0], p[1], q[0], q[1]));
    }
    consider(handle, d <= PICK_PX.ring + grow ? d : null);
  });
  return best === null ? null : (best as { handle: ExtrudeHandle }).handle;
}

/**
 * A grab point of a handle in pane CSS px (`screenOfManipulator`): a point on the handle that picks back as that
 * handle (other handles in front of it on screen are avoided) — arrows from their cone inwards, cubes and the centre
 * at their centre, rings from their widest point on screen round the ring.
 */
export function extrudeGrabPoint(
  frame: ExtrudeManipFrame,
  handle: ManipHandle | 'space',
  s: number,
  projector: PaneProjector,
): { readonly x: number; readonly y: number } | null {
  if (!isExtrudeHandle(handle)) return null;
  const out = [0, 0, 0];
  const screen = (p: Vec3): { x: number; y: number } | null =>
    projector.project(p[0], p[1], p[2], out) ? { x: out[0] as number, y: out[1] as number } : null;
  const picks = (p: { x: number; y: number } | null): p is { x: number; y: number } =>
    p !== null && pickExtrudeHandle(frame, s, projector, p.x, p.y) === handle;
  const i = axisOf(handle);
  let candidates: Vec3[];
  if (ROTATE.includes(handle) && i !== null) {
    const centre = screen(frame.pivot);
    if (centre === null) return null;
    candidates = ringPoints(frame, i, s)
      .map((p) => ({ p, q: screen(p) }))
      .filter((c) => c.q !== null)
      .sort((a, b) => {
        const qa = a.q as { x: number; y: number };
        const qb = b.q as { x: number; y: number };
        return Math.hypot(qb.x - centre.x, qb.y - centre.y) - Math.hypot(qa.x - centre.x, qa.y - centre.y);
      })
      .map((c) => c.p);
  } else if (TRANSLATE.includes(handle) && i !== null) {
    candidates = [];
    for (let u = EXTRUDE_LAYOUT.axisEnd - EXTRUDE_LAYOUT.cone / 2; u > EXTRUDE_LAYOUT.axisStart; u -= 0.04) {
      candidates.push(at(frame, frame.axes, s, unit(i, u)));
    }
  } else candidates = [handlePoint(frame, handle, s)];
  for (const p of candidates) {
    const q = screen(p);
    if (picks(q)) return q;
  }
  const first = candidates[0];
  return first === undefined ? null : screen(first);
}

export function isExtrudeHandle(handle: string): handle is ExtrudeHandle {
  return (
    TRANSLATE.includes(handle as ExtrudeHandle) ||
    ROTATE.includes(handle as ExtrudeHandle) ||
    SCALE.includes(handle as ExtrudeHandle) ||
    handle === 'suniform' ||
    handle === 'space'
  );
}
