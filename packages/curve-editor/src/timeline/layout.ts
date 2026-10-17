// Time-slider geometry: the frame ↔ x mapping, the vertical bands and the ruler steps (research 09 §4.9).
import type { Frame } from '@ekza-animator/anim-core';
import type { FrameRange } from './band';

/** Height of the label strip at the top; key ticks fill the rest of the slider (CSS px). */
export const LABEL_STRIP = 12;
/** Ruler labels keep at least this distance (CSS px). */
export const MIN_LABEL_SPACING = 40;
/** Minor ruler ticks appear when they are at least this far apart (CSS px). */
export const MIN_MINOR_SPACING = 6;
const MIN_PAD = 12;
const MAX_PAD = 48;

export interface SliderLayout {
  readonly width: number;
  readonly height: number;
  /** First and last visible frame (their cells stay inside the canvas). */
  readonly start: Frame;
  readonly end: Frame;
  /** x of `start` (CSS px). */
  readonly left: number;
  /** CSS px per frame, > 0. */
  readonly scale: number;
}

/**
 * Lays `range` out across `width`: a side padding of half a frame cell (12–48 px) keeps the first and last cells
 * and the band ends visible.
 */
export function sliderLayout(width: number, height: number, range: FrameRange): SliderLayout {
  const span = Math.max(range.end - range.start, 1e-6);
  const rough = Math.max(width - 2 * MIN_PAD, 1) / span;
  const pad = Math.min(Math.max(rough / 2, MIN_PAD), MAX_PAD);
  const scale = Math.max(width - 2 * pad, 1) / span;
  return { width, height, start: range.start, end: range.end, left: pad, scale };
}

export function layoutFrameToX(layout: SliderLayout, frame: Frame): number {
  return layout.left + (frame - layout.start) * layout.scale;
}

export function layoutXToFrame(layout: SliderLayout, x: number): Frame {
  return layout.start + (x - layout.left) / layout.scale;
}

/** Vertical centre of the key-tick strip (CSS px). */
export function tickCentreY(layout: SliderLayout): number {
  return (Math.min(LABEL_STRIP, layout.height) + layout.height) / 2;
}

export interface RulerSteps {
  /** Frames between labelled (major) ticks. */
  readonly label: number;
  /** Frames between minor ticks, or null when they would be closer than MIN_MINOR_SPACING. */
  readonly minor: number | null;
}

/** Steps 1, 2, 5, 10, 20, 50, … */
function niceStep(index: number): number {
  const decade = 10 ** Math.floor(index / 3);
  return [1, 2, 5][index % 3]! * decade;
}

/** The smallest 1-2-5 step whose labels are ≥ 40 px apart; minor ticks every frame when frames are ≥ 6 px apart. */
export function rulerSteps(scale: number): RulerSteps {
  let index = 0;
  while (niceStep(index) * scale < MIN_LABEL_SPACING && index < 60) index++;
  const label = niceStep(index);
  let minor: number | null = null;
  for (let i = 0; i < index; i++) {
    const step = niceStep(i);
    if (step * scale >= MIN_MINOR_SPACING && label % step === 0) {
      minor = step;
      break;
    }
  }
  return { label, minor };
}
