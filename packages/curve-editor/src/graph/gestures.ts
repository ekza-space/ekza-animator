// Drag gestures of the Graph Editor (ADR 0007 §6: idle → pressed → dragKeys | dragHandle | marquee | pan | zoom →
// commit | cancel). Key and handle drags run in ONE document preview through the edit kernel (moveKeys,
// setKeyHandle), commit as one transaction and record one editor-history step; Esc cancels without a trace.
import type { Handle } from '@ekza-animator/anim-core';
import type { CurveId, KeyId, PreviewSession, Tx } from '@ekza-animator/doc';
import {
  type EditorApp,
  type KeyPartSelection,
  moveKeys,
  type SelectMode,
  selectionSnapshot,
  setKeyHandle,
} from '@ekza-animator/editor-core';
import type { OverlayState } from '../painters/overlay';
import type { GraphViewState } from '../types';
import { panView, zoomView } from '../view/transform';
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
  readonly kind: 'keys' | 'handles' | 'marquee' | 'pan' | 'zoom';
  update(p: GesturePointer): void;
  commit(p: GesturePointer): void;
  cancel(): void;
  overlay(): Partial<OverlayState>;
}

// ---------------------------------------------------------------------------------------------------------------
// Pure drag math (unit-tested without the kernel)

export type AxisLock = 'time' | 'value' | null;

/** Pixels of motion before Shift picks the dominant axis (MVP-SPEC §4.11.3). */
export const AXIS_LOCK_PX = 4;
/** Pointer travel below which a press is a click (research 09 §6.2). */
export const DRAG_THRESHOLD_PX = 3;
/** Smallest |dt| of a dragged handle, in frames: keeps it on its side of the key (vertical = ±90°). */
export const MIN_HANDLE_DT = 1e-6;

/** Shift held: keep the current lock, or pick the dominant axis once the pointer moved AXIS_LOCK_PX. */
export function resolveAxisLock(current: AxisLock, shift: boolean, dx: number, dy: number): AxisLock {
  if (!shift) return null;
  if (current !== null) return current;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_PX) return null;
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

/** Shared preview plumbing for key and handle drags. */
abstract class PreviewGesture implements Gesture {
  abstract readonly kind: 'keys' | 'handles';
  protected preview: PreviewSession | null = null;
  private failed = false;

  constructor(
    protected readonly host: GestureHost,
    protected readonly label: string,
    protected readonly start: GesturePointer,
  ) {}

  /** Writes the edit for pointer `p` into `tx` (one full re-application per update). */
  protected abstract edit(p: GesturePointer, final: boolean): (tx: Tx) => void;

  /** Keys deleted by the final update (collisions), forgotten from the selection after commit. */
  protected deleted: readonly KeyId[] = [];

  update(p: GesturePointer): void {
    if (this.failed) return;
    if (this.preview === null) {
      try {
        this.preview = this.host.app.store.beginPreview(this.label);
      } catch (error) {
        this.fail(error);
        return;
      }
    }
    if (!this.preview.active) return; // cancelled from outside (edit.escape)
    try {
      this.preview.update(this.edit(p, false));
    } catch (error) {
      this.fail(error);
    }
    this.host.invalidateOverlay();
  }

  commit(p: GesturePointer): void {
    if (this.failed) return;
    if (this.preview === null) this.update(p);
    const preview = this.preview;
    if (this.failed || preview === null || !preview.active) return;
    try {
      preview.update(this.edit(p, true));
      const app = this.host.app;
      const snapshot = selectionSnapshot(app.session.getState().selection);
      const batch = preview.commit({ label: this.label, selectionBefore: snapshot, selectionAfter: snapshot });
      if (batch !== null) app.history.record({ label: this.label, docTxId: batch.txId, overrides: null });
      if (this.deleted.length > 0) this.host.forgetKeys(this.deleted);
    } catch (error) {
      this.fail(error);
    }
  }

  cancel(): void {
    this.preview?.cancel();
    this.preview = null;
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

export class KeyMoveGesture extends PreviewGesture {
  readonly kind = 'keys';
  private axis: AxisLock = null;
  private readout: OverlayState['readout'] = null;

  constructor(
    host: GestureHost,
    start: GesturePointer,
    private readonly keys: readonly KeyId[],
  ) {
    super(host, 'Move Keys', start);
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
    return (tx: Tx) => {
      const result = moveKeys(app, tx, this.keys, dFrames, dValue, { snap, resolveCollisions: final });
      if (final) this.deleted = result.deleted;
    };
  }

  override overlay(): Partial<OverlayState> {
    return { readout: this.readout };
  }
}

export class HandleDragGesture extends PreviewGesture {
  readonly kind = 'handles';
  private axis: AxisLock = null;

  constructor(
    host: GestureHost,
    start: GesturePointer,
    private readonly targets: readonly HandleTarget[],
  ) {
    super(host, 'Edit Tangent', start);
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
