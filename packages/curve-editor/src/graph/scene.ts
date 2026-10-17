// What one Graph Editor frame shows: view, size, curves, selection and time context. Painters and hit-testing read
// the same scene, so what is hit is what is drawn.
import type { CurveId, KeyId } from '@ekza-animator/doc';
import type { KeyPartSelection } from '@ekza-animator/editor-core';
import { GRAPH_METRICS } from '../painters/theme';
import type { GraphViewState } from '../types';
import { frameToX, valueToY } from '../view/transform';
import type { CurveEntry, CurveSet } from './curveSet';

export interface GraphScene {
  readonly view: GraphViewState;
  /** Canvas CSS size. */
  readonly width: number;
  readonly height: number;
  readonly curves: CurveSet;
  readonly selection: ReadonlyMap<KeyId, KeyPartSelection>;
  /** prefs.graphHandles: handles of keys with a selected part, or of every key. */
  readonly handles: 'selected' | 'all';
  /** Curves drawn at full strength; null when every curve is (nothing selected). */
  readonly focus: ReadonlySet<CurveId> | null;
  /** Active-clip frame range drawn unshaded (playback range or clip range); null: no shading. */
  readonly range: { readonly start: number; readonly end: number } | null;
  /** Current active-clip frame; null without an active clip. */
  readonly playhead: number | null;
}

export interface Point {
  x: number;
  y: number;
}

export function keyX(scene: GraphScene, entry: CurveEntry, i: number): number {
  return frameToX(scene.view, entry.compiled.t[i] as number);
}

export function keyY(scene: GraphScene, entry: CurveEntry, i: number): number {
  return valueToY(scene.view, scene.height, (entry.compiled.v[i] as number) * entry.scale);
}

/** True when the key's handles are drawn (and hit-testable). */
export function handlesShown(scene: GraphScene, entry: CurveEntry, i: number): boolean {
  if (scene.handles === 'all') return true;
  const key = entry.keys[i];
  return key !== undefined && scene.selection.has(key.id);
}

/**
 * Screen position of a key's handle end: non-weighted curves at a fixed 40 px along the tangent (MVP-SPEC §4.11.4),
 * weighted curves at the true handle offset (degenerate zero-length handles fall back to 40 px).
 */
export function handlePosition(scene: GraphScene, entry: CurveEntry, i: number, side: 'in' | 'out', out: Point): Point {
  const c = entry.compiled;
  const kx = keyX(scene, entry, i);
  const ky = keyY(scene, entry, i);
  const sign = side === 'in' ? -1 : 1;
  if (c.weighted) {
    const dt = (side === 'in' ? c.inDt[i] : c.outDt[i]) as number;
    const dv = (side === 'in' ? c.inDv[i] : c.outDv[i]) as number;
    const dx = dt * scene.view.sx;
    const dy = -dv * entry.scale * scene.view.sy;
    if (Math.hypot(dx, dy) > 1e-9) {
      out.x = kx + dx;
      out.y = ky + dy;
      return out;
    }
  }
  const slope = (side === 'in' ? c.inSlope[i] : c.outSlope[i]) as number;
  const dx = sign * scene.view.sx;
  const dy = -sign * slope * entry.scale * scene.view.sy;
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !Number.isFinite(length)) {
    // An infinite slope (vertical tangent) or a zero scale: point straight up or down.
    out.x = kx;
    out.y = ky - Math.sign(sign * slope || 1) * GRAPH_METRICS.handleLength;
    return out;
  }
  out.x = kx + (dx / length) * GRAPH_METRICS.handleLength;
  out.y = ky + (dy / length) * GRAPH_METRICS.handleLength;
  return out;
}

export function partsOf(scene: GraphScene, key: KeyId): KeyPartSelection | undefined {
  return scene.selection.get(key);
}
