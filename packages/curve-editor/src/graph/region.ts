// The scale tool's region box (M2A-SPEC §5.15.3): with keys selected it spans their time and drawn-value bounds.
// Dragging an edge scales that axis around the opposite edge, a corner both axes around the opposite corner, the
// inside moves, and outside the box the keys scale around the press point (horizontal = time, vertical = value;
// Shift locks the dominant axis after 4 px). Time scales through `scaleKeys` (factor ≥ 0.01, snapping, breakdown
// retiming), values through `scaleKeyValues` (fixed handles' dv scale too; a negative factor flips). One drag is one
// `Scale Keys` step.
import type { ChannelId, CurveId, KeyId, Tx } from '@ekza-animator/doc';
import { type ChannelUnit, channelUnit, scaleKeys, scaleKeyValues, toDisplayValue } from '@ekza-animator/editor-core';
import type { OverlayState } from '../painters/overlay';
import type { RegionHandle } from '../types';
import { frameToX, valueToY, xToFrame } from '../view/transform';
import { drawnOf } from './curveSet';
import { type AxisLock, EditGesture, type GestureHost, type GesturePointer, resolveAxisLock } from './gestures';
import type { GraphScene } from './scene';
import { selectedKeyParts } from './selection';

/** Hit distance of the box's edges and corners (CSS px). */
export const REGION_HIT_PX = 6;
/** Pointer travel (CSS px) that doubles (or halves) a factor when scaling around the press point. */
export const POINT_SCALE_PX = 100;
/** Smallest time factor (`scaleKeys`, MVP-SPEC §4.11.3). */
const MIN_TIME_FACTOR = 0.01;

/** The box in canvas CSS px (y down) and in data space: frames and drawn values (`vBottom` < `vTop`). */
export interface RegionBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly f0: number;
  readonly f1: number;
  readonly vBottom: number;
  readonly vTop: number;
  /** The selected keys on shown, unlocked curves. */
  readonly keys: readonly KeyId[];
}

/** The region of the selected keys (key parts on shown, unlocked curves); null without such keys. */
export function regionOf(scene: GraphScene): RegionBox | null {
  const keys: KeyId[] = [];
  let f0 = Number.POSITIVE_INFINITY;
  let f1 = Number.NEGATIVE_INFINITY;
  let vBottom = Number.POSITIVE_INFINITY;
  let vTop = Number.NEGATIVE_INFINITY;
  for (const key of selectedKeyParts(scene.selection)) {
    const found = scene.curves.byKey.get(key);
    if (found === undefined || found.entry.locked) continue;
    const t = found.entry.compiled.t[found.index] as number;
    const v = drawnOf(found.entry, found.entry.compiled.v[found.index] as number);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    keys.push(key);
    f0 = Math.min(f0, t);
    f1 = Math.max(f1, t);
    vBottom = Math.min(vBottom, v);
    vTop = Math.max(vTop, v);
  }
  if (keys.length === 0) return null;
  const { view, height } = scene;
  return {
    x0: frameToX(view, f0),
    x1: frameToX(view, f1),
    y0: valueToY(view, height, vTop),
    y1: valueToY(view, height, vBottom),
    f0,
    f1,
    vBottom,
    vTop,
    keys,
  };
}

/** Grab point of a handle (CSS px): edge midpoints, corners, the centre for 'inside'. */
export function regionHandlePointOf(box: RegionBox, handle: RegionHandle): { readonly x: number; readonly y: number } {
  const xm = (box.x0 + box.x1) / 2;
  const ym = (box.y0 + box.y1) / 2;
  switch (handle) {
    case 'left':
      return { x: box.x0, y: ym };
    case 'right':
      return { x: box.x1, y: ym };
    case 'top':
      return { x: xm, y: box.y0 };
    case 'bottom':
      return { x: xm, y: box.y1 };
    case 'tl':
      return { x: box.x0, y: box.y0 };
    case 'tr':
      return { x: box.x1, y: box.y0 };
    case 'bl':
      return { x: box.x0, y: box.y1 };
    case 'br':
      return { x: box.x1, y: box.y1 };
    case 'inside':
      return { x: xm, y: ym };
  }
}

/** The handle under (x, y): corners, then edges (along their extent), then the inside; null outside the box. */
export function regionHit(box: RegionBox, x: number, y: number): RegionHandle | null {
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= REGION_HIT_PX;
  const inX = x >= box.x0 - REGION_HIT_PX && x <= box.x1 + REGION_HIT_PX;
  const inY = y >= box.y0 - REGION_HIT_PX && y <= box.y1 + REGION_HIT_PX;
  if (!inX || !inY) return null;
  const left = near(x, box.x0);
  const right = near(x, box.x1) && !(left && Math.abs(x - box.x0) < Math.abs(x - box.x1));
  const top = near(y, box.y0);
  const bottom = near(y, box.y1) && !(top && Math.abs(y - box.y0) < Math.abs(y - box.y1));
  const l = left && !right;
  if (top && (l || right)) return l ? 'tl' : 'tr';
  if (bottom && (l || right)) return l ? 'bl' : 'br';
  if (l) return 'left';
  if (right) return 'right';
  if (top) return 'top';
  if (bottom) return 'bottom';
  return 'inside';
}

/** Which axes a handle scales and around which side (−1: the low side moves, +1: the high side moves). */
function axesOf(handle: RegionHandle): { readonly time: -1 | 0 | 1; readonly value: -1 | 0 | 1 } {
  switch (handle) {
    case 'left':
      return { time: -1, value: 0 };
    case 'right':
      return { time: 1, value: 0 };
    case 'top':
      return { time: 0, value: 1 };
    case 'bottom':
      return { time: 0, value: -1 };
    case 'tl':
      return { time: -1, value: 1 };
    case 'tr':
      return { time: 1, value: 1 };
    case 'bl':
      return { time: -1, value: -1 };
    case 'br':
      return { time: 1, value: -1 };
    case 'inside':
      return { time: 0, value: 0 };
  }
}

/** Per curve: the selected keys and the curve's drawn mapping (value pivots convert per curve). */
interface ScaleCurve {
  readonly keys: readonly KeyId[];
  readonly channel: ChannelId;
  readonly unit: ChannelUnit;
  readonly scale: number;
  readonly offset: number;
}

/** A scale of the selected keys: around the region's opposite edge/corner, or around the press point. */
export class ScaleKeysGesture extends EditGesture {
  readonly kind = 'scale';
  readonly dynamic: ReadonlySet<CurveId>;
  private axis: AxisLock = null;
  private readout: OverlayState['readout'] = null;
  private readonly curves: readonly ScaleCurve[];

  /**
   * `handle` null: scale around the press point (outside the box). Otherwise an edge or corner of `box` (an
   * 'inside' press is a key move, not a scale).
   */
  constructor(
    host: GestureHost,
    start: GesturePointer,
    private readonly box: RegionBox,
    private readonly handle: RegionHandle | null,
  ) {
    super(host, 'Scale Keys', start);
    const scene = host.scene();
    const groups = new Map<CurveId, ScaleCurve & { keys: KeyId[] }>();
    for (const key of box.keys) {
      const found = scene.curves.byKey.get(key);
      if (found === undefined) continue;
      const group = groups.get(found.entry.id);
      if (group === undefined) {
        const { entry } = found;
        const unit = channelUnit(host.app.store.get('controls', entry.record.control) ?? null, entry.channel);
        groups.set(entry.id, {
          keys: [key],
          channel: entry.channel,
          unit,
          scale: entry.scale,
          offset: entry.offset,
        });
      } else group.keys.push(key);
    }
    this.curves = [...groups.values()];
    this.dynamic = new Set(groups.keys());
  }

  /** Time pivot and factor, value pivot (drawn units) and factor for pointer `p`. */
  private factors(p: GesturePointer): {
    readonly timePivot: number;
    readonly time: number;
    readonly valuePivot: number;
    readonly value: number;
  } {
    const view = this.host.view;
    const dx = p.x - this.start.x;
    const dy = p.y - this.start.y;
    const df = dx / view.sx;
    const dv = -dy / view.sy;
    const box = this.box;
    if (this.handle === null) {
      this.axis = resolveAxisLock(this.axis, p.shift, dx, dy);
      const height = this.host.height;
      return {
        timePivot: xToFrame(view, this.start.x),
        time: this.axis === 'value' ? 1 : Math.max(MIN_TIME_FACTOR, 1 + dx / POINT_SCALE_PX),
        valuePivot: view.v0 + (height - this.start.y) / view.sy,
        value: this.axis === 'time' ? 1 : 1 - dy / POINT_SCALE_PX,
      };
    }
    const axes = axesOf(this.handle);
    // Corners lock the dominant axis with Shift like the outside drag.
    if (axes.time !== 0 && axes.value !== 0) this.axis = resolveAxisLock(this.axis, p.shift, dx, dy);
    const spanF = box.f1 - box.f0;
    const spanV = box.vTop - box.vBottom;
    let time = 1;
    let timePivot = box.f0;
    if (axes.time !== 0 && spanF > 1e-9 && this.axis !== 'value') {
      timePivot = axes.time > 0 ? box.f0 : box.f1;
      time = axes.time > 0 ? (box.f1 + df - box.f0) / spanF : (box.f1 - (box.f0 + df)) / spanF;
      time = Math.max(MIN_TIME_FACTOR, time);
    }
    let value = 1;
    let valuePivot = box.vBottom;
    if (axes.value !== 0 && spanV > 1e-12 && this.axis !== 'time') {
      valuePivot = axes.value > 0 ? box.vBottom : box.vTop;
      value = axes.value > 0 ? (box.vTop + dv - box.vBottom) / spanV : (box.vTop - (box.vBottom + dv)) / spanV;
    }
    return { timePivot, time, valuePivot, value };
  }

  protected edit(p: GesturePointer, final: boolean) {
    const app = this.host.app;
    const { timePivot, time, valuePivot, value } = this.factors(p);
    const snap = app.session.getState().time.snapToFrames && !(p.alt && this.start.button === 0);
    this.readout = { text: `×t ${time.toFixed(2)}  ×v ${value.toFixed(2)}`, x: p.x, y: p.y };
    return (tx: Tx) => {
      if (time !== 1) {
        const result = scaleKeys(app, tx, this.box.keys, timePivot, time, { snap, resolveCollisions: final });
        if (final) this.deleted = result.deleted;
      }
      if (value === 1) return;
      for (const curve of this.curves) {
        // The drawn pivot in the curve's display units: v = (drawn − offset)/scale, shown as toDisplayValue(v).
        if (curve.scale === 0) continue;
        const pivot = toDisplayValue(curve.channel, (valuePivot - curve.offset) / curve.scale, curve.unit);
        scaleKeyValues(app, tx, curve.keys, pivot, value);
      }
    };
  }

  override overlay(): Partial<OverlayState> {
    return { readout: this.readout };
  }
}
