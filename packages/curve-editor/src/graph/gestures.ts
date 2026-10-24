// Drag gestures of the Graph Editor (ADR 0007 §6: idle → pressed → dragKeys | dragHandle | marquee | pan | zoom →
// commit | cancel). Key and handle drags run as one key-edit gesture (`beginKeyEditGesture`, M2A-SPEC §4.5): pointer
// moves coalesce to one document preview update per animation frame (M-1 mechanism 1), the release commits one
// transaction and records one editor-history step; Esc cancels without a trace.
import type { Handle } from '@ekza-studio/anim-core';
import type { ChannelId, CurveId, KeyId, Tx } from '@ekza-studio/doc';
import {
  beginKeyEditGesture,
  type EditorApp,
  fromDisplayValue,
  type KeyEditGesture,
  type KeyPartSelection,
  moveKeys,
  type SelectMode,
  setKeyHandle,
  toDisplayValue,
} from '@ekza-studio/editor-core';
import type { OverlayState } from '../painters/overlay';
import { CURVE_POINTER_TOLERANCE, CURVE_TOLERANCE } from '../painters/theme';
import type { GraphViewState } from '../types';
import { panView, zoomView } from '../view/transform';
import type { CurveEntry } from './curveSet';
import type { GraphScene } from './scene';

/** Pointer position and modifiers a gesture reacts to. */
export interface GesturePointer {
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly mod: boolean;
  readonly ctrl: boolean;
}

export interface GestureHost {
  readonly app: EditorApp;
  readonly view: GraphViewState;
  readonly height: number;
  scene(): GraphScene;
  setView(view: GraphViewState): void;
  invalidateOverlay(): void;
  /** Reports a failed edit (toast) after the gesture has been rolled back. */
  report(label: string, error: unknown): void;
  selectKeys(items: readonly { readonly key: KeyId; readonly parts: KeyPartSelection }[], mode: SelectMode): void;
  /** Keys a committed drag deleted (collisions) leave the selection. */
  forgetKeys(keys: readonly KeyId[]): void;
}

export interface Gesture {
  readonly kind: 'keys' | 'handles' | 'scale' | 'marquee' | 'pan' | 'zoom';
  /** Curves whose drawing the gesture changes (the rest stays in the cached static layer, M-1 mechanism 5). */
  readonly dynamic?: ReadonlySet<CurveId>;
  update(p: GesturePointer): void;
  commit(p: GesturePointer): void;
  cancel(): void;
  overlay(): Partial<OverlayState>;
}

// ---------------------------------------------------------------------------------------------------------------
// Pure drag math (unit-tested without the kernel)

export type AxisLock = 'time' | 'value' | null;

/**
 * Pixels of motion before Shift picks the dominant axis (MVP-SPEC §4.11.3) and pointer travel below which a press is
 * a click (research 09 §6.2), for the mouse; the pointer in use's are `CURVE_TOLERANCE`'s (STUDIO-TOUCH-SPEC §5.4).
 */
export const AXIS_LOCK_PX = CURVE_POINTER_TOLERANCE.mouse.axisLockPx;
export const DRAG_THRESHOLD_PX = CURVE_POINTER_TOLERANCE.mouse.dragPx;
/** Smallest |dt| of a dragged handle, in frames: keeps it on its side of the key (vertical = ±90°). */
export const MIN_HANDLE_DT = 1e-6;

/** Shift held: keep the current lock, or pick the dominant axis once the pointer moved AXIS_LOCK_PX. */
export function resolveAxisLock(current: AxisLock, shift: boolean, dx: number, dy: number): AxisLock {
  if (!shift) return null;
  if (current !== null) return current;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < CURVE_TOLERANCE.axisLockPx) return null;
  return Math.abs(dx) >= Math.abs(dy) ? 'time' : 'value';
}

/** Pointer offset with the locked axis zeroed ('time' keeps the horizontal motion, 'value' the vertical). */
export function lockedOffset(axis: AxisLock, dx: number, dy: number): { readonly dx: number; readonly dy: number } {
  return { dx: axis === 'value' ? 0 : dx, dy: axis === 'time' ? 0 : dy };
}

/** Frame and display-value offsets of a key drag (dValue in display units, as `moveKeys` expects). */
export function keyDragDelta(
  view: GraphViewState,
  dx: number,
  dy: number,
  axis: AxisLock,
): { readonly dFrames: number; readonly dValue: number } {
  return { dFrames: axis === 'value' ? 0 : dx / view.sx, dValue: axis === 'time' ? 0 : -dy / view.sy };
}

/** A handle being dragged, captured at press time. */
export interface HandleTarget {
  readonly key: KeyId;
  readonly curve: CurveId;
  readonly side: 'in' | 'out';
  readonly keyX: number;
  readonly keyY: number;
  /** Handle end on screen at press time. */
  readonly handleX: number;
  readonly handleY: number;
  /** Display units per curve unit. */
  readonly scale: number;
  readonly weighted: boolean;
  readonly weightLocked: boolean;
  /** Resolved handle dt at press time (frames, signed: in ≤ 0, out ≥ 0). */
  readonly dt: number;
  /** Frames to the neighbour on the handle's side; null at the curve's end. */
  readonly span: number | null;
}

/**
 * The handle (frames, curve units) for a handle end dragged to (px, py) — MVP-SPEC §4.11.4: the handle stays on its
 * side of the key; non-weighted or weight-locked handles change angle only (length kept, so the resolved dt is
 * kept and the slope follows the pointer); weighted free handles take angle and length with dt clamped to the span.
 */
export function handleFromPointer(target: HandleTarget, view: GraphViewState, px: number, py: number): Handle {
  const sign = target.side === 'in' ? -1 : 1;
  let dt = (px - target.keyX) / view.sx;
  const dv = -(py - target.keyY) / (view.sy * target.scale);
  if (dt * sign < MIN_HANDLE_DT) dt = sign * MIN_HANDLE_DT;
  if (target.weighted && !target.weightLocked) {
    if (target.span !== null && target.span > 0 && dt * sign > target.span) dt = sign * target.span;
    return { dt, dv };
  }
  const base = Math.abs(target.dt) >= MIN_HANDLE_DT ? target.dt : sign * (target.span !== null ? target.span / 3 : 1);
  return { dt: base, dv: (dv / dt) * base };
}

// ---------------------------------------------------------------------------------------------------------------
// Gestures

/** Shared plumbing of key, handle and scale drags: one key-edit gesture per drag. */
export abstract class EditGesture implements Gesture {
  abstract readonly kind: 'keys' | 'handles' | 'scale';
  abstract readonly dynamic: ReadonlySet<CurveId>;
  private gesture: KeyEditGesture | null = null;
  private failed = false;
  private done = false;

  constructor(
    protected readonly host: GestureHost,
    protected readonly label: string,
    protected readonly start: GesturePointer,
  ) {}

  /** Writes the edit for pointer `p` into `tx` (one full re-application per update). */
  protected abstract edit(p: GesturePointer, final: boolean): (tx: Tx) => void;

  /** Keys deleted by the final update (collisions), forgotten from the selection after commit. */
  protected deleted: readonly KeyId[] = [];

  private open(): KeyEditGesture | null {
    if (this.gesture === null && !this.failed && !this.done) {
      try {
        this.gesture = beginKeyEditGesture(this.host.app, this.label);
      } catch (error) {
        this.fail(error);
      }
    }
    return this.gesture;
  }

  update(p: GesturePointer): void {
    const gesture = this.open();
    if (gesture === null || !gesture.active) return; // failed, or cancelled from outside (edit.escape)
    try {
      gesture.update(this.edit(p, false));
    } catch (error) {
      this.fail(error);
    }
    this.host.invalidateOverlay();
  }

  commit(p: GesturePointer): void {
    const gesture = this.open();
    this.done = true;
    if (gesture === null || !gesture.active) return;
    try {
      gesture.commit(this.edit(p, true), { label: this.label });
      if (this.deleted.length > 0) this.host.forgetKeys(this.deleted);
    } catch (error) {
      this.fail(error);
    }
  }

  cancel(): void {
    this.done = true;
    this.gesture?.cancel();
    this.gesture = null;
  }

  overlay(): Partial<OverlayState> {
    return {};
  }

  private fail(error: unknown): void {
    this.failed = true;
    this.cancel();
    this.host.report(this.label, error);
  }
}

/** How a dragged curve converts a drawn-value delta (M2A-SPEC §5.15.2): its mapping scale and channel. */
export interface DragCurve {
  readonly curve: CurveId;
  readonly keys: readonly KeyId[];
  readonly channel: ChannelId;
  /** Drawn units per curve unit (`CurveEntry.scale`). */
  readonly scale: number;
  /** True when the drawn units are the M1 display units `moveKeys` converts (degrees for rotations, else 1). */
  readonly m1Units: boolean;
  /**
   * The key times (index-aligned with `keys`) when every shown key of the curve is dragged and no two are closer than
   * `VALUE_ONLY_MIN_GAP`; null otherwise. Such a curve has no fixed neighbour to stop at and no keys to merge, so
   * when no key moves in time `moveKeys` changes only values on it (M-1 value-only path of `KeyMoveGesture`).
   */
  readonly wholeTimes: readonly number[] | null;
}

/**
 * Smallest time gap between the keys of a curve the value-only path takes: wider than `moveKeys`' drag margin
 * (1e-3 frames) and same-frame tolerance, so nothing it would clamp or merge is skipped.
 */
const VALUE_ONLY_MIN_GAP = 2e-3;

/** The dragged keys grouped by curve, with the curve's current drawn mapping (null when a key is not shown). */
export function dragCurves(scene: GraphScene, keys: readonly KeyId[]): DragCurve[] {
  const groups = new Map<CurveId, { entry: CurveEntry; keys: KeyId[] }>();
  for (const key of keys) {
    const found = scene.curves.byKey.get(key);
    if (found === undefined) continue;
    const group = groups.get(found.entry.id);
    if (group === undefined) groups.set(found.entry.id, { entry: found.entry, keys: [key] });
    else group.keys.push(key);
  }
  return [...groups.values()].map(({ entry, keys: ids }) => ({
    curve: entry.id,
    keys: ids,
    channel: entry.channel,
    scale: entry.scale,
    m1Units: entry.offset === 0 && entry.scale === toDisplayValue(entry.channel, 1),
    wholeTimes: wholeTimesOf(entry, ids),
  }));
}

/** `DragCurve.wholeTimes`: the times of `ids` when they are all of the entry's (distinct, well apart) keys. */
function wholeTimesOf(entry: CurveEntry, ids: readonly KeyId[]): readonly number[] | null {
  const t = entry.compiled.t;
  if (ids.length !== entry.keys.length || new Set(ids).size !== ids.length) return null;
  for (let i = 1; i < entry.compiled.keyCount; i++) {
    if (!((t[i] as number) - (t[i - 1] as number) >= VALUE_ONLY_MIN_GAP)) return null;
  }
  const times: number[] = [];
  for (const id of ids) {
    const index = entry.index.get(id);
    if (index === undefined) return null;
    times.push(t[index] as number);
  }
  return times;
}

export class KeyMoveGesture extends EditGesture {
  readonly kind = 'keys';
  readonly dynamic: ReadonlySet<CurveId>;
  private axis: AxisLock = null;
  private readout: OverlayState['readout'] = null;
  private readonly curves: readonly DragCurve[];
  private readonly sameUnits: boolean;

  constructor(
    host: GestureHost,
    start: GesturePointer,
    private readonly keys: readonly KeyId[],
  ) {
    super(host, 'Move Keys', start);
    this.curves = dragCurves(host.scene(), keys);
    // One drawn delta is one display delta on every curve (absolute view, M1 units): one `moveKeys` call (M1 path).
    this.sameUnits = this.curves.every((curve) => curve.m1Units);
    this.dynamic = new Set(this.curves.map((c) => c.curve));
  }

  protected edit(p: GesturePointer, final: boolean) {
    const dx = p.x - this.start.x;
    const dy = p.y - this.start.y;
    this.axis = resolveAxisLock(this.axis, p.shift, dx, dy);
    const { dFrames, dValue } = keyDragDelta(this.host.view, dx, dy, this.axis);
    const app = this.host.app;
    // Alt during an LMB key drag turns frame snapping off (MVP-SPEC §4.11.3).
    const snap = app.session.getState().time.snapToFrames && !(p.alt && this.start.button === 0);
    const shownFrames = snap ? Math.round(dFrames) : dFrames;
    this.readout = { text: `Δt ${formatDelta(shownFrames)}  Δv ${formatDelta(dValue)}`, x: p.x, y: p.y };
    const opts = { snap, resolveCollisions: final };
    // M-1 value-only path: curves whose keys are all dragged and that move no key in time get their values written
    // directly, the writes `moveKeys` makes for them then (no time placement, no key projection of the reverted
    // preview, no placement objects); the other curves take `moveKeys` as before.
    const target = (t: number): number => (snap ? Math.round(t + dFrames) : t + dFrames);
    const stays = (t: number): boolean => target(t) === t;
    const valueOnly = this.curves.filter((curve) => curve.wholeTimes?.every(stays) === true);
    const rest =
      valueOnly.length === 0
        ? this.keys
        : valueOnly.length === this.curves.length
          ? []
          : this.curves.filter((curve) => !valueOnly.includes(curve)).flatMap((curve) => curve.keys);
    return (tx: Tx) => {
      for (const curve of valueOnly) {
        if (tx.get('curves', curve.curve)?.locked !== false) continue;
        const dv = this.sameUnits
          ? fromDisplayValue(curve.channel, dValue)
          : curve.scale === 0
            ? 0
            : dValue / curve.scale;
        if (dv === 0) continue;
        for (const id of curve.keys) {
          const key = tx.get('keys', id);
          // `t` as `moveKeys` writes it: the key's own time, through its block shift of 0 (so a −0 becomes +0)
          if (key !== undefined) tx.put('keys', { ...key, t: key.t + 0, v: key.v + dv });
        }
      }
      if (rest.length === 0) {
        if (final) this.deleted = [];
        return;
      }
      if (this.sameUnits) {
        const result = moveKeys(app, tx, rest, dFrames, dValue, opts);
        if (final) this.deleted = result.deleted;
        return;
      }
      // Mapped views (§5.15.2) and attribute units: the drawn delta converts per curve (Δv = Δy' / scale) and is
      // applied in curve units after the time move, whatever units `moveKeys` reads its value delta in.
      const deleted = moveKeys(app, tx, rest, dFrames, 0, opts).deleted;
      const gone = new Set(deleted);
      for (const curve of this.curves) {
        if (valueOnly.includes(curve)) continue;
        const dv = curve.scale === 0 ? 0 : dValue / curve.scale;
        if (dv === 0) continue;
        for (const id of curve.keys) {
          const key = gone.has(id) ? undefined : tx.get('keys', id);
          if (key !== undefined) tx.put('keys', { ...key, v: key.v + dv });
        }
      }
      if (final) this.deleted = deleted;
    };
  }

  override overlay(): Partial<OverlayState> {
    return { readout: this.readout };
  }
}

export class HandleDragGesture extends EditGesture {
  readonly kind = 'handles';
  readonly dynamic: ReadonlySet<CurveId>;
  private axis: AxisLock = null;

  constructor(
    host: GestureHost,
    start: GesturePointer,
    private readonly targets: readonly HandleTarget[],
  ) {
    super(host, 'Edit Tangent', start);
    this.dynamic = new Set(targets.map((target) => target.curve));
  }

  protected edit(p: GesturePointer, _final: boolean) {
    // Shift constrains handle ends like keys (MVP-SPEC §4.11.3, ADR 0007 §6): the dominant axis after 4 px.
    this.axis = resolveAxisLock(this.axis, p.shift, p.x - this.start.x, p.y - this.start.y);
    const { dx, dy } = lockedOffset(this.axis, p.x - this.start.x, p.y - this.start.y);
    const view = this.host.view;
    const app = this.host.app;
    const handles = this.targets.map((target) =>
      handleFromPointer(target, view, target.handleX + dx, target.handleY + dy),
    );
    // Alt while dragging breaks the tangent temporarily; the commit writes broken: true (MVP-SPEC §4.11.4).
    const tempBreak = p.alt;
    return (tx: Tx) => {
      this.targets.forEach((target, i) => {
        setKeyHandle(app, tx, target.key, target.side, handles[i] as Handle, { tempBreak });
      });
    };
  }
}

export class MarqueeGesture implements Gesture {
  readonly kind = 'marquee';
  private rect: { x0: number; y0: number; x1: number; y1: number };

  constructor(
    private readonly host: GestureHost,
    start: GesturePointer,
    private readonly mode: SelectMode,
    private readonly query: (rect: {
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
    }) => readonly { readonly key: KeyId; readonly parts: KeyPartSelection }[],
  ) {
    this.rect = { x0: start.x, y0: start.y, x1: start.x, y1: start.y };
  }

  update(p: GesturePointer): void {
    this.rect = { ...this.rect, x1: p.x, y1: p.y };
    this.host.invalidateOverlay();
  }

  commit(p: GesturePointer): void {
    this.update(p);
    this.host.selectKeys(this.query(this.rect), this.mode);
  }

  cancel(): void {}

  overlay(): Partial<OverlayState> {
    return { marquee: this.rect };
  }
}

export class PanGesture implements Gesture {
  readonly kind = 'pan';
  private readonly origin: GraphViewState;

  constructor(
    private readonly host: GestureHost,
    private readonly start: GesturePointer,
  ) {
    this.origin = host.view;
  }

  update(p: GesturePointer): void {
    this.host.setView(panView(this.origin, p.x - this.start.x, p.y - this.start.y));
  }

  commit(p: GesturePointer): void {
    this.update(p);
  }

  cancel(): void {
    this.host.setView(this.origin);
  }

  overlay(): Partial<OverlayState> {
    return {};
  }
}

/** Alt+RMB drag zoom around the press point: right/up zooms in; Shift zooms the dominant axis only. */
export class ZoomGesture implements Gesture {
  readonly kind = 'zoom';
  static readonly RATE = 0.005;
  private readonly origin: GraphViewState;
  private axis: AxisLock = null;

  constructor(
    private readonly host: GestureHost,
    private readonly start: GesturePointer,
  ) {
    this.origin = host.view;
  }

  update(p: GesturePointer): void {
    const dx = p.x - this.start.x;
    const dy = p.y - this.start.y;
    this.axis = resolveAxisLock(this.axis, p.shift, dx, dy);
    const factor = Math.exp((dx - dy) * ZoomGesture.RATE);
    const fx = this.axis === 'value' ? 1 : this.axis === 'time' ? Math.exp(dx * ZoomGesture.RATE) : factor;
    const fy = this.axis === 'time' ? 1 : this.axis === 'value' ? Math.exp(-dy * ZoomGesture.RATE) : factor;
    this.host.setView(zoomView(this.origin, this.host.height, this.start.x, this.start.y, fx, fy));
  }

  commit(p: GesturePointer): void {
    this.update(p);
  }

  cancel(): void {
    this.host.setView(this.origin);
  }

  overlay(): Partial<OverlayState> {
    return {};
  }
}

function formatDelta(value: number): string {
  const rounded = Math.abs(value) < 5e-4 ? 0 : value;
  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(Number.isInteger(rounded) ? 0 : 2)}`;
}
