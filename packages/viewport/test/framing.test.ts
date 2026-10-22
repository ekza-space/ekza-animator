// Orthographic framing (M6b acceptance fix): Frame All in a front or side pane fits the bounds as that view sees them
// (projected on its right and up axes), so a character fills the pane for joint fitting instead of a third of it.
import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME_PADDING, fitOrthoViewHeight } from '../src/framing/fit';

// A T-posed character: 1.7 m tall, 1.0 m arm span, 0.3 m deep, standing on the ground.
const BOUNDS = { minX: -0.5, maxX: 0.5, minY: 0, maxY: 1.7, minZ: -0.15, maxZ: 0.15 };
const X: [number, number, number] = [1, 0, 0];
const Y: [number, number, number] = [0, 1, 0];
const Z: [number, number, number] = [0, 0, 1];

describe('fitOrthoViewHeight', () => {
  it('front view: the taller of the height and the span over the aspect, padded', () => {
    expect(fitOrthoViewHeight(BOUNDS, X, Y, 1)).toBeCloseTo(1.7 * DEFAULT_FRAME_PADDING, 12);
    // A wide pane keeps the height; a narrow one fits the 1 m span.
    expect(fitOrthoViewHeight(BOUNDS, X, Y, 2)).toBeCloseTo(1.7 * DEFAULT_FRAME_PADDING, 12);
    expect(fitOrthoViewHeight(BOUNDS, X, Y, 0.5)).toBeCloseTo(2 * DEFAULT_FRAME_PADDING, 12);
  });

  it('side view (right = −Z or +Z): the depth, not the arm span, so a narrow pane still shows the full height', () => {
    const side = fitOrthoViewHeight(BOUNDS, [0, 0, -1], Y, 0.6);
    expect(side).toBeCloseTo(1.7 * DEFAULT_FRAME_PADDING, 12);
    // The bounding sphere (diagonal ≈ 2.0 m over the 0.6 aspect) would show the character at about half the height.
    const sphere = (Math.hypot(1, 1.7, 0.3) * DEFAULT_FRAME_PADDING) / 0.6;
    expect(side / sphere).toBeLessThan(0.55);
  });

  it('top view uses x and z; degenerate bounds keep a minimum height', () => {
    expect(fitOrthoViewHeight(BOUNDS, X, Z, 1)).toBeCloseTo(1 * DEFAULT_FRAME_PADDING, 12);
    const point = { minX: 1, maxX: 1, minY: 1, maxY: 1, minZ: 1, maxZ: 1 };
    expect(fitOrthoViewHeight(point, X, Y, 1)).toBeCloseTo(0.1 * DEFAULT_FRAME_PADDING, 12);
  });
});
