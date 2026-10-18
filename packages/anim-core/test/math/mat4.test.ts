import fc from 'fast-check';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  mat4Compose,
  mat4Decompose,
  mat4Identity,
  mat4Invert,
  mat4Multiply,
  mat4TransformPoint,
  type Vec3,
  type Xf,
  xfIdentity,
  xfInvert,
  xfMultiply,
} from '../../src';
import { maxAbsDiff, quatDistance, unitQuat, vec3 } from './helpers';

const positiveScale = fc.double({ min: 0.05, max: 5, noNaN: true });
const uniformXf: fc.Arbitrary<Xf> = fc
  .tuple(vec3(10), unitQuat, positiveScale)
  .map(([t, q, s]) => ({ t, q, s: [s, s, s] as Vec3 }));
const anyXf: fc.Arbitrary<Xf> = fc
  .tuple(vec3(10), unitQuat, positiveScale, positiveScale, positiveScale)
  .map(([t, q, sx, sy, sz]) => ({ t, q, s: [sx, sy, sz] as Vec3 }));

const threeCompose = (xf: Xf): Matrix4 =>
  new Matrix4().compose(new Vector3(...xf.t), new Quaternion(...xf.q), new Vector3(...xf.s));

describe('4×4 matrices (column-major, cross-checked with three.js)', () => {
  it('identity', () => {
    expect([...mat4Identity()]).toEqual(new Matrix4().elements);
  });

  it('compose matches three.js Matrix4.compose', () => {
    fc.assert(
      fc.property(anyXf, (xf) => {
        expect(maxAbsDiff(mat4Compose(xf), threeCompose(xf).elements)).toBeLessThan(1e-12);
      }),
    );
  });

  it('decompose(compose(xf)) round-trips to 1e-12 (positive per-axis scale)', () => {
    fc.assert(
      fc.property(anyXf, (xf) => {
        const back = mat4Decompose(mat4Compose(xf));
        expect(maxAbsDiff(back.t, xf.t)).toBeLessThan(1e-12);
        expect(maxAbsDiff(back.s, xf.s)).toBeLessThan(1e-12);
        expect(quatDistance(back.q, xf.q)).toBeLessThan(1e-12);
      }),
      { numRuns: 1000 },
    );
  });

  it('decompose matches three.js for mirrored matrices (negative determinant flips X)', () => {
    fc.assert(
      fc.property(anyXf, (xf) => {
        const m = threeCompose({ ...xf, s: [-xf.s[0], xf.s[1], xf.s[2]] });
        const p = new Vector3();
        const q = new Quaternion();
        const s = new Vector3();
        m.decompose(p, q, s);
        const ours = mat4Decompose(Float64Array.from(m.elements));
        expect(maxAbsDiff(ours.s, s.toArray())).toBeLessThan(1e-12);
        expect(quatDistance(ours.q, [q.x, q.y, q.z, q.w])).toBeLessThan(1e-9);
      }),
    );
  });

  it('multiply matches three.js and tolerates aliasing', () => {
    fc.assert(
      fc.property(anyXf, anyXf, (a, b) => {
        const expected = new Matrix4().multiplyMatrices(threeCompose(a), threeCompose(b)).elements;
        expect(maxAbsDiff(mat4Multiply(mat4Compose(a), mat4Compose(b)), expected)).toBeLessThan(1e-11);
        const ma = mat4Compose(a);
        expect(maxAbsDiff(mat4Multiply(ma, mat4Compose(b), ma), expected)).toBeLessThan(1e-11);
        const mb = mat4Compose(b);
        expect(maxAbsDiff(mat4Multiply(mat4Compose(a), mb, mb), expected)).toBeLessThan(1e-11);
      }),
    );
  });

  it('invert gives m·m⁻¹ = I and null for singular matrices', () => {
    fc.assert(
      fc.property(anyXf, (xf) => {
        const m = mat4Compose(xf);
        const inv = mat4Invert(m);
        expect(inv).not.toBeNull();
        expect(maxAbsDiff(mat4Multiply(m, inv as Float64Array), mat4Identity())).toBeLessThan(1e-11);
      }),
    );
    expect(mat4Invert(mat4Compose({ t: [1, 2, 3], q: [0, 0, 0, 1], s: [1, 0, 1] }))).toBeNull();
  });

  it('transformPoint matches three.js applyMatrix4', () => {
    fc.assert(
      fc.property(anyXf, vec3(10), (xf, p) => {
        const expected = new Vector3(...p).applyMatrix4(threeCompose(xf)).toArray();
        expect(maxAbsDiff(mat4TransformPoint(mat4Compose(xf), p), expected)).toBeLessThan(1e-11);
      }),
    );
  });
});

describe('TRS transforms', () => {
  it('xfMultiply equals the matrix product for uniform scale', () => {
    fc.assert(
      fc.property(uniformXf, uniformXf, (a, b) => {
        const product = mat4Multiply(mat4Compose(a), mat4Compose(b));
        expect(maxAbsDiff(mat4Compose(xfMultiply(a, b)), product)).toBeLessThan(1e-11);
      }),
    );
  });

  it('xfMultiply keeps the exact translation with non-uniform scale', () => {
    fc.assert(
      fc.property(anyXf, anyXf, (a, b) => {
        const product = mat4Multiply(mat4Compose(a), mat4Compose(b));
        expect(
          maxAbsDiff(xfMultiply(a, b).t, [product[12] as number, product[13] as number, product[14] as number]),
        ).toBeLessThan(1e-11);
      }),
    );
  });

  it('xfInvert is the inverse for uniform scale, including in place', () => {
    fc.assert(
      fc.property(uniformXf, (a) => {
        const identity = mat4Compose(xfMultiply(a, xfInvert(a)));
        expect(maxAbsDiff(identity, mat4Identity())).toBeLessThan(1e-11);
        const copy: Xf = { t: [...a.t], q: [...a.q], s: [...a.s] };
        xfInvert(copy, copy);
        expect(maxAbsDiff(mat4Compose(copy), mat4Invert(mat4Compose(a)) as Float64Array)).toBeLessThan(1e-11);
      }),
    );
    expect(xfIdentity()).toEqual({ t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
  });
});
