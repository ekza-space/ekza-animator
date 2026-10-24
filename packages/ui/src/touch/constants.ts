// The touch kit's numbers (STUDIO-TOUCH-SPEC §4.1, §5.4, §5.6, §6.1, §18). The CSS sizes mirror tokens.json
// (`size-touch-*`, `space-*`, `type-touch-*`); a ui test keeps the two in step. Interaction constants (long-press,
// slop, scrub distances, the Halo geometry) live only here.
import type { CSSProperties } from 'react';

export const TOUCH = {
  /** Minimum hit target, CSS px (= pt on iPad): every interactive element of a touch scope. */
  hit: 44,
  /** The Thumb key (§5.5). */
  thumbKey: 56,
  /** The top bar (§4.1). */
  topBar: 52,
  /** A docked sheet on a wide container (§4.1). */
  sheetWidth: 360,
  /** Gutter between chrome and the container edge. */
  gutter: 16,
  /** Nothing interactive closer to a side edge than this (§4.1, S14). */
  edgeSide: 12,
  /** Nothing interactive closer to the bottom edge than this: the home indicator (§4.1, S14). */
  edgeBottom: 20,
  /** Gap between neighbouring targets. */
  gap: 8,
  /** Input text (iOS zooms on focus below this). */
  inputText: 16,
  /** Long-press (§5.2): held this long … */
  longPressMs: 450,
  /** … moving no more than this (CSS px) for a finger … */
  touchSlop: 10,
  /** … or a pen (§5.4). */
  penSlop: 4,
  /** … or a mouse. */
  mouseSlop: 3,
  /** Taps closer together than this (ms) and `doubleTapPx` count as a double tap (§5.4, touch). */
  doubleTapMs: 450,
  doubleTapPx: 24,
  /** Distance scrub (§5.6): ×0.1 when the finger is this far (CSS px) above or below the chip … */
  scrubFineAt: 80,
  /** … and ×0.01 this far. */
  scrubFinerAt: 160,
  /** Halo (§6.1): at most this many petals plus ⋯ More. */
  maxPetals: 6,
  /** Vertical pitch of the Halo's arc (a 44 px petal plus the gap). */
  petalPitch: 52,
  /** The arc turns into a row when the room beside the selection is narrower than this (§4.3). */
  arcMinRoom: 240,
  /** Flick ring (§5.2, the marking-menu geometry): slots measured at this radius … */
  ringRadius: 80,
  /** … with the drawn centre kept this far inside the container. */
  ringEdgeMargin: 144,
  /** A flick: released within this time (ms) … */
  flickMs: 250,
  /** … having moved further than this (CSS px). Also the ring's dead zone. */
  flickPx: 20,
  /** Toasts (§5.3 C9): an undo toast stays this long (ms). */
  toastMs: 4000,
} as const;

/** Text & touch size (§18): the range the touch layout reads; Pro's stored `uiScale` may be wider (0.5–3). */
export const UI_SCALE_MIN = 0.85;
export const UI_SCALE_MAX = 1.5;

export function clampUiScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value));
}

/** The attributes that make an element a touch scope (styles.css `[data-density="touch"]`), with its scale. */
export interface TouchScopeProps {
  readonly 'data-density': 'touch';
  readonly style: CSSProperties;
}

/** Spread on a touch scope's root (the shell frame, a portalled sheet): `<div {...touchScopeProps(prefs.uiScale)}>`. */
export function touchScopeProps(uiScale?: number): TouchScopeProps {
  return { 'data-density': 'touch', style: { '--ui-scale': String(clampUiScale(uiScale)) } as CSSProperties };
}

/** The drag slop for a pointer type (§5.4). */
export function slopFor(pointerType: string): number {
  if (pointerType === 'pen') return TOUCH.penSlop;
  if (pointerType === 'mouse') return TOUCH.mouseSlop;
  return TOUCH.touchSlop;
}

/** True when the user asked for reduced motion (or the page has no `matchMedia`). JS animations read it. */
export function prefersReducedMotion(win: Pick<Window, 'matchMedia'> | undefined = globalThis.window): boolean {
  if (win?.matchMedia === undefined) return true;
  return win.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
