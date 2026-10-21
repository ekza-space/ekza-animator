// The Quick Rig markers' rules (M6B-SPEC §0.4.2; C3), pure so they are unit-tested without a renderer:
//
// - Axis rule: a drag in an orthographic pane writes only the two axes that pane shows (front: x, y; side: z, y; top:
//   x, z) — the marker plus the pointer's travel on the plane through the marker facing the pane — and copies the
//   hidden axis from the marker bit for bit. Centre markers keep x = 0. Perspective panes never drag markers.
// - Pick rule: a press collects every marker and ghost within 8 CSS px; the selected marker wins when it is among
//   them, else the nearest, ties in list order (centre markers, then side markers). A click without a drag within 2 px
//   of the previous click selects the next marker of that set in list order (cycling).
import type { ViewPreset } from '@ekza-studio/editor-core';
import type { QuickRigMarker } from '@ekza-studio/rig';

export type Vec3 = readonly [number, number, number];
export type Axis = 0 | 1 | 2;

/** Pick radius of markers and ghosts (CSS px). */
export const MARKER_PICK_PX = 8;
/** A click within this distance of the previous click cycles (CSS px). */
export const MARKER_CYCLE_PX = 2;
/** Pointer travel before a press on a marker becomes a drag (CSS px). */
export const MARKER_DRAG_PX = 2;

/** The axis an orthographic view hides: front → z, side → x, top → y; null for perspective (read-only) and shots. */
export function hiddenAxisOf(preset: ViewPreset | null): Axis | null {
  if (preset === 'front') return 2;
  if (preset === 'side') return 0;
  if (preset === 'top') return 1;
  return null;
}

/**
 * §0.4.2 axis rule. `startHit` and `hit` are the pointer's points on the plane through the marker that faces the pane
 * (at the press and now); the visible axes take the marker plus the travel (× `scale`, e.g. 0.1 with Shift; snapped to
 * `snap` metres when given), the hidden axis is the marker's own value, and a centre marker's x is +0.
 */
export function axisRuleDrag(
  marker: Vec3,
  startHit: Vec3,
  hit: Vec3,
  hidden: Axis,
  opts?: { readonly centre?: boolean; readonly scale?: number; readonly snap?: number | null },
): Vec3 {
  const scale = opts?.scale ?? 1;
  const snap = opts?.snap ?? null;
  const out: [number, number, number] = [marker[0], marker[1], marker[2]];
  for (let k = 0 as Axis; k < 3; k = (k + 1) as Axis) {
    if (k === hidden) continue;
    let value = marker[k] + (hit[k] - startHit[k]) * scale;
    if (snap !== null && snap > 0) value = Math.round(value / snap) * snap;
    out[k] = value === 0 ? 0 : value;
  }
  if (opts?.centre === true) out[0] = 0;
  return out;
}

/** A marker (or its left ghost) under the pointer. */
export interface MarkerHit {
  readonly name: QuickRigMarker;
  /** 'R' = the marker itself (the character's right side, or a centre marker), 'L' = its mirrored ghost. */
  readonly side: 'R' | 'L';
  readonly distPx: number;
}

/** The pick of a press: the marker it selects and whether it can drag (a ghost never drags). */
export interface MarkerPick {
  readonly name: QuickRigMarker;
  readonly ghost: boolean;
  /** The markers under the pointer, in list order (the cycling set). */
  readonly set: readonly QuickRigMarker[];
}

/** §0.4.2 pick rule over the hits within the pick radius; `order` is the list order. Null without a hit. */
export function pickMarker(
  hits: readonly MarkerHit[],
  selected: QuickRigMarker | null,
  order: readonly QuickRigMarker[],
  radiusPx: number = MARKER_PICK_PX,
): MarkerPick | null {
  const within = hits.filter((hit) => hit.distPx <= radiusPx);
  if (within.length === 0) return null;
  const set = order.filter((name) => within.some((hit) => hit.name === name));
  const best = new Map<QuickRigMarker, number>();
  for (const hit of within) best.set(hit.name, Math.min(best.get(hit.name) ?? Number.POSITIVE_INFINITY, hit.distPx));
  let name: QuickRigMarker;
  if (selected !== null && best.has(selected)) name = selected;
  else {
    name = set[0] as QuickRigMarker;
    for (const candidate of set) if ((best.get(candidate) as number) < (best.get(name) as number)) name = candidate;
  }
  const ghost = !within.some((hit) => hit.name === name && hit.side === 'R');
  return { name, ghost, set };
}

/** The marker a repeated click selects: the one after `current` in the set (list order, wrapping). */
export function cycleMarker(set: readonly QuickRigMarker[], current: QuickRigMarker | null): QuickRigMarker | null {
  if (set.length === 0) return null;
  const at = current === null ? -1 : set.indexOf(current);
  return set[(at + 1) % set.length] as QuickRigMarker;
}

/** Whether a click repeats the previous one (same pane, within `MARKER_CYCLE_PX`). */
export function isRepeatClick(
  previous: { readonly paneId: string; readonly x: number; readonly y: number } | null,
  paneId: string,
  x: number,
  y: number,
): boolean {
  return (
    previous !== null && previous.paneId === paneId && Math.hypot(x - previous.x, y - previous.y) <= MARKER_CYCLE_PX
  );
}

/** The left ghost of a marker: its (−x, y, z) mirror (centre markers have none). */
export function ghostOf(point: Vec3): Vec3 {
  return [point[0] === 0 ? 0 : -point[0], point[1], point[2]];
}
