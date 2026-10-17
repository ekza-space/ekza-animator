// Pure time-slider arithmetic: band cells, move deltas, scale factors (§4.11.3), layout and ruler steps.
import { describe, expect, it } from 'vitest';
import {
  BAND_HALF_CELL,
  bandContains,
  bandHasSpan,
  bandMoveDelta,
  bandScale,
  makeBand,
  MIN_SCALE_FACTOR,
  shiftBand,
} from '../../src/timeline/band';
import {
  layoutFrameToX,
  layoutXToFrame,
  MIN_LABEL_SPACING,
  MIN_MINOR_SPACING,
  rulerSteps,
  sliderLayout,
} from '../../src/timeline/layout';

describe('band', () => {
  it('normalizes its ends and covers each frame cell [f − ½, f + ½)', () => {
    expect(makeBand(20, 5)).toEqual({ start: 5, end: 20 });
    const one = makeBand(10, 10);
    expect(bandHasSpan(one)).toBe(false);
    expect(bandContains(one, 10)).toBe(true);
    expect(bandContains(one, 10 - BAND_HALF_CELL)).toBe(true);
    expect(bandContains(one, 10.49)).toBe(true);
    expect(bandContains(one, 10.5)).toBe(false);
    expect(bandContains(one, 9.49)).toBe(false);
    expect(bandContains(makeBand(5, 20), 20)).toBe(true);
    expect(bandContains(makeBand(5, 20), 21)).toBe(false);
  });

  it('moves by whole frames when snapping and by the exact offset otherwise', () => {
    expect(bandMoveDelta(10.2, 14.4, true)).toBe(4);
    expect(bandMoveDelta(10.2, 10.6, true)).toBe(0);
    expect(Object.is(bandMoveDelta(10.6, 10.2, true), 0)).toBe(true); // never −0
    expect(bandMoveDelta(10.2, 14.4, false)).toBeCloseTo(4.2, 12);
    expect(shiftBand(makeBand(10, 12), -3)).toEqual({ start: 7, end: 9 });
  });

  it('scales around the opposite end; the dragged end follows the pointer', () => {
    expect(bandScale(makeBand(0, 20), 'end', 30, true)).toEqual({ pivot: 0, factor: 1.5, band: { start: 0, end: 30 } });
    expect(bandScale(makeBand(0, 20), 'end', 10.4, true)).toEqual({
      pivot: 0,
      factor: 0.5,
      band: { start: 0, end: 10 },
    });
    expect(bandScale(makeBand(10, 20), 'start', 0, true)).toEqual({
      pivot: 20,
      factor: 2,
      band: { start: 0, end: 20 },
    });
    const free = bandScale(makeBand(0, 20), 'end', 25, false);
    expect(free?.factor).toBeCloseTo(1.25, 12);
  });

  it('keeps the dragged end at least one frame past the pivot (and the factor ≥ 0.01)', () => {
    expect(bandScale(makeBand(0, 20), 'end', -50, true)).toEqual({
      pivot: 0,
      factor: 0.05,
      band: { start: 0, end: 1 },
    });
    expect(bandScale(makeBand(10, 20), 'start', 40, true)?.band).toEqual({ start: 19, end: 20 });
    const long = bandScale(makeBand(0, 250), 'end', 0, true);
    expect(long?.band).toEqual({ start: 0, end: 3 });
    expect(long?.factor).toBeGreaterThanOrEqual(MIN_SCALE_FACTOR);
    expect(bandScale(makeBand(0, 20), 'end', -50, false)?.factor).toBeCloseTo(MIN_SCALE_FACTOR, 12);
  });

  it('cannot scale a 1-frame band', () => {
    expect(bandScale(makeBand(10, 10), 'end', 20, true)).toBeNull();
  });
});

describe('slider layout', () => {
  it('maps frames to x linearly and back, keeping half a cell (≥ 12 px) at both sides', () => {
    for (const [width, start, end] of [
      [620, 0, 30],
      [1400, 0, 600],
      [300, -10, 10],
      [80, 0, 1000],
    ] as const) {
      const layout = sliderLayout(width, 30, { start, end });
      expect(layoutFrameToX(layout, start)).toBeGreaterThanOrEqual(12);
      expect(layoutFrameToX(layout, start)).toBeGreaterThanOrEqual(layout.scale / 2 - 1e-9);
      expect(layoutFrameToX(layout, end)).toBeCloseTo(width - layoutFrameToX(layout, start), 9);
      for (let f = start; f <= end; f += (end - start) / 7) {
        expect(layoutXToFrame(layout, layoutFrameToX(layout, f))).toBeCloseTo(f, 9);
      }
    }
  });

  it('labels the ruler on the smallest 1-2-5 step that is ≥ 40 px, with per-frame minor ticks when ≥ 6 px', () => {
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    for (const scale of [0.05, 0.3, 1, 2.5, 6, 8, 19.9, 20, 45, 120]) {
      const { label, minor } = rulerSteps(scale);
      expect(label * scale).toBeGreaterThanOrEqual(MIN_LABEL_SPACING);
      for (const step of steps.filter((s) => s < label)) expect(step * scale).toBeLessThan(MIN_LABEL_SPACING);
      // The minor step: the smallest step below the label step that divides it and is ≥ 6 px, if any.
      const expectedMinor = steps.find((s) => s < label && label % s === 0 && s * scale >= MIN_MINOR_SPACING) ?? null;
      expect(minor).toBe(expectedMinor);
    }
    expect(rulerSteps(6)).toEqual({ label: 10, minor: 1 });
    expect(rulerSteps(32)).toEqual({ label: 2, minor: 1 });
    expect(rulerSteps(0.5)).toEqual({ label: 100, minor: 20 });
  });
});
