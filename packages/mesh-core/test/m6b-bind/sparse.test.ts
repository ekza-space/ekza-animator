// C4 sparse kit (M6B-SPEC §4.2, §9 C4 tests): the PSD cotangent Laplacian convention (symmetric, diagonal ≥ 0, row
// sums 0, off-diagonals ≤ 0 when clamped, xᵀLx ≥ 0), its values on hand-computed triangles, the lumped mass, CSR
// assembly and Jacobi PCG against a dense solve.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type CsrMatrix,
  cotLaplacian,
  csrDiagonal,
  csrFromTriples,
  csrMultiply,
  csrSubmatrix,
  lumpedMass,
  type SkinGeometry,
  skinGeometryOf,
  solvePcg,
} from '../../src';
import { body } from './fixtures';

function geometry(positions: number[], tris: number[]): SkinGeometry {
  const n = positions.length / 3;
  return {
    positions: Float64Array.from(positions),
    tris: Uint32Array.from(tris),
    normals: new Float64Array(3 * n),
    partner: new Int32Array(n).fill(-1),
    paired: 0,
  };
}

function dense(a: CsrMatrix): number[][] {
  const out = Array.from({ length: a.n }, () => Array.from({ length: a.n }, () => 0));
  for (let i = 0; i < a.n; i++) {
    for (let k = a.rowPtr[i] as number; k < (a.rowPtr[i + 1] as number); k++) {
      (out[i] as number[])[a.col[k] as number] = a.val[k] as number;
    }
  }
  return out;
}

/** Gaussian elimination with partial pivoting (small systems only). */
function denseSolve(m: number[][], b: number[]): number[] {
  const n = b.length;
  const a = m.map((row, i) => [...row, b[i] as number]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs((a[r] as number[])[c] as number) > Math.abs((a[p] as number[])[c] as number)) p = r;
    [a[c], a[p]] = [a[p] as number[], a[c] as number[]];
    const pivot = (a[c] as number[])[c] as number;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = ((a[r] as number[])[c] as number) / pivot;
      for (let k = c; k <= n; k++)
        (a[r] as number[])[k] = ((a[r] as number[])[k] as number) - f * ((a[c] as number[])[k] as number);
    }
  }
  return a.map((row, i) => (row[n] as number) / (row[i] as number));
}

describe('cotLaplacian (Lpsd = −Δ)', () => {
  it('an equilateral triangle: off-diagonals −½·cot 60° each, diagonal the negated row sum', () => {
    const h = Math.sqrt(3) / 2;
    const L = dense(cotLaplacian(geometry([0, 0, 0, 1, 0, 0, 0.5, h, 0], [0, 1, 2]), { clamp: true }));
    const w = 0.5 / Math.tan(Math.PI / 3);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect((L[i] as number[])[j]).toBeCloseTo(i === j ? 2 * w : -w, 14);
      }
    }
  });

  it('a right triangle: the edge opposite the right angle gets cot 90° = 0; an obtuse angle clamps to 0', () => {
    const right = dense(cotLaplacian(geometry([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]), { clamp: true }));
    expect((right[1] as number[])[2]).toBeCloseTo(0, 14);
    expect((right[0] as number[])[1]).toBeCloseTo(-0.5, 14); // cot 45° = 1
    // Obtuse at vertex 2: cot < 0 → clamped (0) or kept (negative off-diagonal → positive entry).
    const obtuse = geometry([0, 0, 0, 1, 0, 0, 0.5, 0.1, 0], [0, 1, 2]);
    const clamped = dense(cotLaplacian(obtuse, { clamp: true }));
    const raw = dense(cotLaplacian(obtuse, { clamp: false }));
    expect((clamped[0] as number[])[1]).toBe(0);
    expect((raw[0] as number[])[1]).toBeGreaterThan(0);
  });

  it('on the generated bodies: symmetric, diagonal ≥ 0, off-diagonals ≤ 0, zero row sums, xᵀLx ≥ 0', () => {
    for (const style of ['smooth', 'segmented'] as const) {
      const geom = skinGeometryOf(body(style), 1.6);
      const L = cotLaplacian(geom, { clamp: true });
      const at = new Map<string, number>();
      const wrongSign: string[] = [];
      for (let i = 0; i < L.n; i++) {
        let sum = 0;
        let scale = 0;
        for (let k = L.rowPtr[i] as number; k < (L.rowPtr[i + 1] as number); k++) {
          const j = L.col[k] as number;
          const v = L.val[k] as number;
          at.set(`${i},${j}`, v);
          if ((i === j && v < 0) || (i !== j && v > 0)) wrongSign.push(`${i},${j}`);
          sum += v;
          scale += Math.abs(v);
        }
        expect(Math.abs(sum)).toBeLessThanOrEqual(1e-12 * Math.max(1, scale));
      }
      expect(wrongSign).toEqual([]);
      const asymmetric = [...at].filter(([key, v]) => {
        const [i, j] = key.split(',');
        return at.get(`${j},${i}`) !== v;
      });
      expect(asymmetric).toEqual([]);
      fc.assert(
        fc.property(fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: L.n, maxLength: L.n }), (xs) => {
          const x = Float64Array.from(xs);
          const y = new Float64Array(L.n);
          csrMultiply(L, x, y);
          let q = 0;
          for (let i = 0; i < L.n; i++) q += (x[i] as number) * (y[i] as number);
          return q >= -1e-9;
        }),
        { numRuns: 50 },
      );
    }
  });
});

describe('lumpedMass', () => {
  it('sums to the surface area (mixed Voronoi areas partition every triangle)', () => {
    const geom = skinGeometryOf(body('smooth'), 1.6);
    const mass = lumpedMass(geom);
    let area = 0;
    const p = geom.positions;
    for (let t = 0; t < geom.tris.length / 3; t++) {
      const [a, b, c] = [0, 1, 2].map((k) => geom.tris[3 * t + k] as number) as [number, number, number];
      const u = [0, 1, 2].map((d) => (p[3 * b + d] as number) - (p[3 * a + d] as number));
      const v = [0, 1, 2].map((d) => (p[3 * c + d] as number) - (p[3 * a + d] as number));
      const cx = (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number);
      const cy = (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number);
      const cz = (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number);
      area += Math.hypot(cx, cy, cz) / 2;
    }
    let sum = 0;
    for (const m of mass) {
      expect(m).toBeGreaterThan(0);
      sum += m;
    }
    expect(sum).toBeCloseTo(area, 10);
  });
});

describe('CSR and PCG', () => {
  it('csrFromTriples sums duplicates in input order, sorts columns and always stores the diagonal', () => {
    const a = csrFromTriples(3, [2, 0, 2, 0], [0, 2, 0, 1], [1, 5, 2, 3]);
    expect(Array.from(a.rowPtr)).toEqual([0, 3, 4, 6]);
    expect(Array.from(a.col)).toEqual([0, 1, 2, 1, 0, 2]);
    expect(Array.from(a.val)).toEqual([0, 3, 5, 0, 3, 0]);
    expect(Array.from(csrDiagonal(a))).toEqual([0, 0, 0]);
    const sub = csrSubmatrix(a, [0, 2], new Int32Array(3).fill(-1));
    expect(dense(sub)).toEqual([
      [0, 5],
      [3, 0],
    ]);
  });

  it('Jacobi PCG matches a dense solve of (L + H)x = b on random SPD systems; columns are independent', () => {
    const geom = skinGeometryOf(body('segmented'), 1.6);
    const L = csrSubmatrix(
      cotLaplacian(geom, { clamp: true }),
      Array.from({ length: 30 }, (_, i) => i),
      new Int32Array(geom.positions.length / 3).fill(-1),
    );
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.5, max: 50, noNaN: true }), { minLength: 30, maxLength: 30 }),
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 60, maxLength: 60 }),
        (h, bs) => {
          const add = Float64Array.from(h);
          const b = Float64Array.from(bs); // two columns, interleaved
          const x = new Float64Array(60);
          solvePcg(L, add, b, x, 2, { tolerance: 1e-12, maxIterations: 500 });
          const m = dense(L).map((row, i) => row.map((v, j) => (i === j ? v + (add[i] as number) : v)));
          for (let c = 0; c < 2; c++) {
            const ref = denseSolve(
              m,
              Array.from({ length: 30 }, (_, i) => b[2 * i + c] as number),
            );
            for (let i = 0; i < 30; i++) expect(x[2 * i + c]).toBeCloseTo(ref[i] as number, 8);
            // The same column alone gives bit-identical values.
            const single = new Float64Array(30);
            solvePcg(
              L,
              add,
              Float64Array.from({ length: 30 }, (_, i) => b[2 * i + c] as number),
              single,
              1,
              {
                tolerance: 1e-12,
                maxIterations: 500,
              },
            );
            for (let i = 0; i < 30; i++) expect(single[i]).toBe(x[2 * i + c]);
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it('a zero right-hand side gives zero without iterating; the cap bounds the iterations', () => {
    const L = csrFromTriples(2, [0, 0, 1, 1], [0, 1, 0, 1], [1, -1, -1, 1]);
    const x = Float64Array.from([3, 4]);
    expect(Array.from(solvePcg(L, Float64Array.from([1, 1]), new Float64Array(2), x, 1))).toEqual([0]);
    expect(Array.from(x)).toEqual([0, 0]);
    const y = new Float64Array(2);
    const it = solvePcg(L, Float64Array.from([1e-9, 1]), Float64Array.from([1, 0]), y, 1, {
      tolerance: 0,
      maxIterations: 1,
    });
    expect(it[0]).toBe(1);
  });
});
