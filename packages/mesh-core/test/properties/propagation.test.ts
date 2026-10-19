// P7 (M6A-SPEC §5.2, §5.29) through the Euler operators: split values lie between their endpoints, skin influences
// stay ≤ 4 and normalized over the union of joints, bits or; corner attributes that were continuous across an edge
// stay continuous (seams kept); P7-hard — an all-hard mesh stays all-hard through every operator that has a flag
// rule (H1, H3, H4; makeEdge/makeFace are raw creations whose flags the ops set).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BUILTIN_LAYERS, type EditMesh, editMeshFrom, groupLayer, morphLayer, primitive } from '../../src';
import { isAllHard } from '../../src/normals/hard';
import { arbEulerStep, arbPrimitive, type EulerStep, resolveEulerStep } from '../../src/testing';

/** Edges with two faces whose corners at a shared endpoint disagree on `name` (a seam the ops created). */
function discontinuities(m: EditMesh, name: string): number[] {
  const layer = m.layer(name);
  if (layer === undefined) return [];
  const out: number[] = [];
  const value = (c: number): string =>
    Array.from({ length: layer.def.comps }, (_, k) => (Object.is(layer.get(c, k), -0) ? 0 : layer.get(c, k))).join(',');
  for (let e = 0; e < m.counts.edges; e++) {
    if (m.edgeFaceCount(e) !== 2) continue;
    const c = m.edgeCorner(e);
    const d = m.cornerRadialNext(c);
    for (const v of [m.edgeVert(e, 0), m.edgeVert(e, 1)]) {
      const at = (x: number): number => (m.cornerVert(x) === v ? x : m.cornerNext(x));
      if (value(at(c)) !== value(at(d))) out.push(e);
    }
  }
  return out;
}

function runSteps(m: EditMesh, steps: readonly EulerStep[]): void {
  for (const step of steps) {
    const resolved = resolveEulerStep(m, step);
    if (resolved === null) continue;
    m.begin(resolved.label);
    try {
      resolved.run();
      m.end();
    } catch (error) {
      m.abort();
      if ((error as { code?: string }).code !== 'mesh-euler') throw error;
    }
  }
}

describe('P7 propagation', () => {
  it('split edges interpolate morphs between their endpoints, blend skin (≤ 4, normalized) and or bits', () => {
    fc.assert(
      fc.property(
        arbPrimitive(),
        fc.array(fc.record({ e: fc.nat(), t: fc.double({ min: 0.01, max: 0.99, noNaN: true }) }), {
          minLength: 1,
          maxLength: 12,
        }),
        fc.integer({ min: 1, max: 1000 }),
        ({ kind, params }, splits, salt) => {
          const m = editMeshFrom(primitive(kind, params));
          m.begin('layers');
          const morph = m.addLayer(morphLayer('M'));
          const bits = m.addLayer(groupLayer('B', 'point', 'bit'));
          const joints = m.addLayer(BUILTIN_LAYERS.skinJoints);
          const weights = m.addLayer(BUILTIN_LAYERS.skinWeights);
          for (let v = 0; v < m.counts.points; v++) {
            const h = (v * 7919 + salt) % 97;
            morph.set(v, 0, h / 10);
            bits.set(v, 0, 1 << (h % 8));
            for (let k = 0; k < 4; k++) joints.set(v, k, (h + 3 * k) % 9);
            const raw = [h % 5, (h % 3) + 1, h % 2, 1];
            const sum = raw.reduce((s, x) => s + x, 0);
            raw.forEach((w, k) => weights.set(v, k, w / sum));
            weights.set(v, 0, 1 - (raw[1] as number) / sum - (raw[2] as number) / sum - (raw[3] as number) / sum);
          }
          m.end();
          for (const { e, t } of splits) {
            const edge = e % m.counts.edges;
            const [a, b] = [m.edgeVert(edge, 0), m.edgeVert(edge, 1)];
            m.begin('split');
            const v = m.splitEdgeMakeVert(edge, t);
            m.end(); // debug validation: skin sums within 1e-6
            const [ma, mb, mv] = [morph.get(a), morph.get(b), morph.get(v)];
            expect(mv).toBeGreaterThanOrEqual(Math.min(ma, mb) - 1e-6);
            expect(mv).toBeLessThanOrEqual(Math.max(ma, mb) + 1e-6);
            expect(bits.get(v)).toBe(bits.get(a) | bits.get(b));
            const union = new Set([0, 1, 2, 3].flatMap((k) => [joints.get(a, k), joints.get(b, k)]));
            const foreign = [0, 1, 2, 3].filter((k) => weights.get(v, k) > 0 && !union.has(joints.get(v, k)));
            expect(foreign).toEqual([]);
            const sum = [0, 1, 2, 3].reduce((s, k) => s + weights.get(v, k), 0);
            expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-6);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it('continuous corner attributes stay continuous through splits and cuts (seams kept)', () => {
    const topology = arbEulerStep().filter((s) => s.op === 'splitEdge' || s.op === 'splitFace' || s.op === 'joinFace');
    fc.assert(
      fc.property(fc.array(topology, { minLength: 1, maxLength: 60 }), (steps) => {
        const m = editMeshFrom(primitive('plane', { subdivisionsWidth: 4, subdivisionsHeight: 3 }));
        expect(discontinuities(m, 'uv0')).toEqual([]);
        runSteps(m, steps);
        expect(discontinuities(m, 'uv0')).toEqual([]);
      }),
      { numRuns: 80 },
    );
  });

  it('existing seams survive splits (the two sides keep their own values)', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const uv = m.layer('uv0') as NonNullable<ReturnType<EditMesh['layer']>>;
    /** Whether the two faces of edge e disagree at its endpoint `vertex`. */
    const disagrees = (e: number, vertex: number): boolean => {
      const c = m.edgeCorner(e);
      const d = m.cornerRadialNext(c);
      const at = (x: number): number => (m.cornerVert(x) === vertex ? x : m.cornerNext(x));
      return uv.get(at(c), 0) !== uv.get(at(d), 0) || uv.get(at(c), 1) !== uv.get(at(d), 1);
    };
    const seams: [number, number, boolean, boolean][] = [];
    for (let e = 0; e < 12; e++) {
      const [a, b] = [m.edgeVert(e, 0), m.edgeVert(e, 1)];
      seams.push([a, b, disagrees(e, a), disagrees(e, b)]);
    }
    expect(seams.filter(([, , x, y]) => x || y)).toHaveLength(12); // per-side squares: every cube edge is a seam
    m.begin('split all');
    const mids = seams.map((_, e) => m.splitEdgeMakeVert(e, 0.5));
    m.end();
    seams.forEach(([a, b, atA, atB], e) => {
      const v = mids[e] as number;
      expect(disagrees(m.findEdge(a, v), a)).toBe(atA);
      expect(disagrees(m.findEdge(v, b), b)).toBe(atB);
    });
  });

  it('P7-hard: an all-hard mesh stays all-hard through the flag-rule operators', () => {
    const ruled = arbEulerStep().filter((s) =>
      [
        'splitEdge',
        'splitFace',
        'joinEdge',
        'joinFace',
        'reverseFace',
        'killFace',
        'killEdge',
        'killVert',
        'setPosition',
      ].includes(s.op),
    );
    fc.assert(
      fc.property(arbPrimitive(), fc.array(ruled, { minLength: 1, maxLength: 120 }), ({ kind, params }, steps) => {
        const m = editMeshFrom(primitive(kind, params));
        expect(isAllHard(m)).toBe(true);
        runSteps(m, steps);
        expect(isAllHard(m)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });
});
