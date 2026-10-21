import { RAD2DEG } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import type { GraphViewState } from '../src';
import { frameStep, isMajor, MIN_FRAME_STEP_PX, MIN_VALUE_STEP_PX, stepDecimals, valueStep } from '../src/view/grid';
import {
  channelDisplayScale,
  fitView,
  frameToX,
  panView,
  sameView,
  VIEW_LIMITS,
  valueToY,
  xToFrame,
  yToValue,
  zoomView,
} from '../src/view/transform';

const VIEWS: readonly GraphViewState[] = [
  { f0: 0, v0: 0, sx: 10, sy: 2 },
  { f0: -12.5, v0: -180, sx: 0.37, sy: 0.9 },
  { f0: 1e5, v0: 3.25, sx: 1250, sy: 4e4 },
  { f0: -3e4, v0: -1e-3, sx: 1e-3, sy: 1e6 },
];

describe('view transform (MVP-SPEC §4.7)', () => {
  it('follows x = (frame − f0)·sx and y = H − (value − v0)·sy', () => {
    const view = { f0: 5, v0: -10, sx: 4, sy: 2 };
    expect(frameToX(view, 5)).toBe(0);
    expect(frameToX(view, 30)).toBe(100);
    expect(valueToY(view, 300, -10)).toBe(300);
    expect(valueToY(view, 300, 40)).toBe(200);
  });

  it('round-trips frames and values for many views and heights', () => {
    for (const view of VIEWS) {
      for (const height of [1, 240, 1081]) {
        for (const frame of [-1000, -1, 0, 0.25, 7.5, 1e4]) {
          expect(xToFrame(view, frameToX(view, frame))).toBeCloseTo(frame, 6);
        }
        for (const x of [0, 13.5, 600]) expect(frameToX(view, xToFrame(view, x))).toBeCloseTo(x, 6);
        for (const value of [-720, -0.5, 0, 33.3, 1e3]) {
          expect(yToValue(view, height, valueToY(view, height, value))).toBeCloseTo(value, 6);
        }
        for (const y of [0, 17.25, height]) expect(valueToY(view, height, yToValue(view, height, y))).toBeCloseTo(y, 6);
      }
    }
  });

  it('zooms around an anchor without moving the frame and value under it', () => {
    for (const view of VIEWS.slice(0, 3)) {
      const height = 300;
      const [ax, ay] = [137, 88];
      const frame = xToFrame(view, ax);
      const value = yToValue(view, height, ay);
      for (const [fx, fy] of [
        [2, 2],
        [0.5, 1],
        [1, 3.5],
      ] as const) {
        const zoomed = zoomView(view, height, ax, ay, fx, fy);
        expect(zoomed.sx).toBeCloseTo(view.sx * fx, 9);
        expect(zoomed.sy).toBeCloseTo(view.sy * fy, 9);
        expect(xToFrame(zoomed, ax)).toBeCloseTo(frame, 6);
        expect(yToValue(zoomed, height, ay)).toBeCloseTo(value, 6);
      }
    }
  });

  it('clamps zoom to the view limits and still keeps the anchor', () => {
    const view = VIEWS[3] as GraphViewState;
    const zoomed = zoomView(view, 300, 50, 50, 0.5, 20);
    expect(zoomed.sx).toBe(VIEW_LIMITS.minSx);
    expect(zoomed.sy).toBe(VIEW_LIMITS.maxSy);
    expect(xToFrame(zoomed, 50)).toBeCloseTo(xToFrame(view, 50), 3);
    expect(yToValue(zoomed, 300, 50)).toBeCloseTo(yToValue(view, 300, 50), 9);
  });

  it('pans so the content follows the pointer', () => {
    const view = { f0: 10, v0: 20, sx: 5, sy: 4 };
    const panned = panView(view, 50, -40);
    expect(frameToX(panned, 12)).toBeCloseTo(frameToX(view, 12) + 50, 9);
    expect(valueToY(panned, 200, 33)).toBeCloseTo(valueToY(view, 200, 33) - 40, 9);
  });

  it('fits bounds with 8 % padding and keeps the scale of a degenerate axis', () => {
    const view = { f0: 0, v0: 0, sx: 3, sy: 7 };
    const fitted = fitView(view, { f0: 0, f1: 30, v0: -30, v1: 30 }, 600, 300);
    expect(frameToX(fitted, 0)).toBeCloseTo((600 * 0.08) / 1.16, 9);
    expect(frameToX(fitted, 30)).toBeCloseTo(600 - (600 * 0.08) / 1.16, 9);
    expect(valueToY(fitted, 300, 30)).toBeCloseTo((300 * 0.08) / 1.16, 9);
    expect(valueToY(fitted, 300, -30)).toBeCloseTo(300 - (300 * 0.08) / 1.16, 9);

    const single = fitView(view, { f0: 15, f1: 15, v0: 45, v1: 45 }, 600, 300);
    expect(single.sx).toBe(3);
    expect(single.sy).toBe(7);
    expect(frameToX(single, 15)).toBeCloseTo(300, 9);
    expect(valueToY(single, 300, 45)).toBeCloseTo(150, 9);
  });

  it('compares views with a relative tolerance', () => {
    expect(sameView(VIEWS[0] as GraphViewState, { ...(VIEWS[0] as GraphViewState) })).toBe(true);
    expect(sameView(VIEWS[0] as GraphViewState, { ...(VIEWS[0] as GraphViewState), sx: 10.001 })).toBe(false);
  });

  it('shows rotations in degrees and everything else in curve units', () => {
    expect(channelDisplayScale('rx')).toBe(RAD2DEG);
    expect(channelDisplayScale('rz')).toBe(RAD2DEG);
    expect(channelDisplayScale('tx')).toBe(1);
    expect(channelDisplayScale('sy')).toBe(1);
    expect(channelDisplayScale('@blink')).toBe(1);
  });
});

describe('grid steps (research 09 §4.7)', () => {
  it('uses integer frame steps from {1, 2, 5}·10ⁿ at least 48 px apart, the smallest such', () => {
    for (const sx of [1e-3, 0.05, 0.3, 1, 4.7, 9.6, 10, 24, 48, 100, 1e4]) {
      const step = frameStep(sx);
      expect(Number.isInteger(step)).toBe(true);
      expect(step).toBeGreaterThanOrEqual(1);
      expect(step === 1 || step * sx >= MIN_FRAME_STEP_PX - 1e-9).toBe(true);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Math.round(mantissa));
      const smaller = [1, 2, 5]
        .flatMap((m) => [m, m * 10, m * 100, m * 1000, m * 1e4, m * 1e5])
        .filter((s) => s < step);
      for (const candidate of smaller) expect(candidate * sx).toBeLessThan(MIN_FRAME_STEP_PX);
    }
    expect(frameStep(100)).toBe(1);
    expect(frameStep(10)).toBe(5);
    expect(frameStep(4.8)).toBe(10);
  });

  it('uses nice value steps at least 32 px apart and prints them with enough decimals', () => {
    for (const sy of [1e-5, 0.01, 0.3, 1, 3.3, 64, 1e3, 1e6]) {
      const step = valueStep(sy);
      expect(step * sy).toBeGreaterThanOrEqual(MIN_VALUE_STEP_PX * (1 - 1e-9));
      expect(step * sy).toBeLessThan(MIN_VALUE_STEP_PX * 5 + 1e-9);
    }
    expect(valueStep(32)).toBe(1);
    expect(valueStep(320)).toBeCloseTo(0.1, 12);
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(0.5)).toBe(1);
    expect(stepDecimals(0.05)).toBe(2);
    expect(stepDecimals(0.001)).toBe(3);
    expect(isMajor(0)).toBe(true);
    expect(isMajor(5)).toBe(true);
    expect(isMajor(-10)).toBe(true);
    expect(isMajor(3)).toBe(false);
  });
});
