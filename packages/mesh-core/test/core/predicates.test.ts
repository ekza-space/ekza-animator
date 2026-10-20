// M6A-SPEC §2 (B1): the robust-predicates wrapper in the kernel's convention (right-handed, y up) — signs, exact
// zero on collinear and coplanar input where the naive formula is off, and proper segment crossings.
import { describe, expect, it } from 'vitest';
import { incircle, orient2d, orient3d, segmentsCross2d } from '../../src/predicates';

describe('predicates', () => {
  it('orient2d: positive counterclockwise, negative clockwise, zero collinear', () => {
    expect(orient2d(0, 0, 1, 0, 0, 1)).toBeGreaterThan(0);
    expect(orient2d(0, 0, 0, 1, 1, 0)).toBeLessThan(0);
    expect(orient2d(0, 0, 1, 1, 2, 2)).toBe(0);
  });

  it('orient2d is exact where the naive determinant is not', () => {
    // Points on the line y = x at awkward binary fractions: the naive formula gives a tiny non-zero value.
    const ax = 0.1;
    const bx = 0.3;
    const cx = 0.2;
    const naive = (bx - ax) * (cx - ax) - (bx - ax) * (cx - ax) + (0.1 + 0.2 - 0.3);
    expect(naive).not.toBe(0);
    expect(orient2d(ax, ax, bx, bx, cx, cx)).toBe(0);
    // A point a hair left of a long edge is still left.
    expect(orient2d(0, 0, 1e9, 1e9, 1, 1 + 1e-7)).toBeGreaterThan(0);
  });

  it('orient3d: positive on the side the right-handed normal points to', () => {
    expect(orient3d(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1)).toBeGreaterThan(0);
    expect(orient3d(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, -1)).toBeLessThan(0);
    expect(orient3d(0, 0, 0, 1, 0, 0, 0, 1, 0, 3, 7, 0)).toBe(0);
  });

  it('incircle: positive inside the circle through counterclockwise points', () => {
    expect(incircle(0, 0, 1, 0, 0, 1, 0.2, 0.2)).toBeGreaterThan(0);
    expect(incircle(0, 0, 1, 0, 0, 1, 2, 2)).toBeLessThan(0);
    expect(incircle(0, 0, 1, 0, 0, 1, 1, 1)).toBe(0);
  });

  it('segmentsCross2d: proper crossings only', () => {
    expect(segmentsCross2d(0, 0, 2, 2, 0, 2, 2, 0)).toBe(true);
    expect(segmentsCross2d(0, 0, 1, 1, 1, 1, 2, 0)).toBe(false); // touching at an endpoint
    expect(segmentsCross2d(0, 0, 2, 0, 1, 0, 3, 0)).toBe(false); // collinear overlap
    expect(segmentsCross2d(0, 0, 1, 0, 0, 1, 1, 1)).toBe(false); // parallel
  });
});
