// What one Graph Editor frame shows: view, size, curves, selection and time context. Painters and hit-testing read
// the same scene, so what is hit is what is drawn.
import type { CompiledAnimCurve } from '@ekza-studio/anim-core';
import type { CurveId, KeyId } from '@ekza-studio/doc';
import type { KeyPartSelection } from '@ekza-studio/editor-core';
import { GRAPH_METRICS } from '../painters/theme';
import type { GraphViewMode, GraphViewState } from '../types';
import { frameToX, valueToY } from '../view/transform';
import { type CurveEntry, type CurveSet, drawnOf } from './curveSet';
import type { RegionBox } from './region';

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
  /** M2a §5.15.2: how values are drawn (the entries carry the per-curve mapping). */
  readonly mode: GraphViewMode;
  /** M2a §5.15.1: compiled buffer curves of the shown curves that have one. */
  readonly buffers: ReadonlyMap<CurveId, CompiledAnimCurve>;
  /** M2a §5.15.2: stacked lanes in entry order (null in the other modes). */
  readonly lanes: readonly { readonly curve: CurveId; readonly label: string; readonly color: string }[] | null;
  /** M2a §5.15.3: the scale tool's region box (null without the tool or without selected keys). */
  readonly region: RegionBox | null;
  /** T10: false leaves the frame numbers to the shell's own time axis (absent: drawn). */
  readonly frameLabels?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export function keyX(scene: GraphScene, entry: CurveEntry, i: number): number {
  return frameToX(scene.view, entry.compiled.t[i] as number);
}

export function keyY(scene: GraphScene, entry: CurveEntry, i: number): number {
  return valueToY(scene.view, scene.height, drawnOf(entry, entry.compiled.v[i] as number));
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
  return handlePositionAt(scene, entry, i, side, keyX(scene, entry, i), keyY(scene, entry, i), out);
}

/** `handlePosition` for a key already at screen point (kx, ky) (painters: the key's point is computed once). */
export function handlePositionAt(
  scene: GraphScene,
  entry: CurveEntry,
  i: number,
  side: 'in' | 'out',
  kx: number,
  ky: number,
  out: Point,
): Point {
  const c = entry.compiled;
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
