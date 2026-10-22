// AUTORIG-SPEC §5.2, §6.1 (D3): ①'s pure rules — the order the one-click fixes run in (stand up, size, freeze, centre,
// face: AS-AR-5's order, the footer names the first), and the parts of a multi-mesh model (every mesh ticked except
// one whose world bounds lie outside the body's, the tallest mesh: "Looks separate").
import type { IntakeReport } from '@ekza-studio/editor-core';
import { describe, expect, it } from 'vitest';
import { FIX_LABEL, firstFix } from '../../../src/steps/model/checks';
import { defaultParts, meshBounds, separateMeshes } from '../../../src/steps/model/parts';

const report = (checks: Partial<IntakeReport['checks']>): IntakeReport => ({
  kind: 'static',
  fileName: 'x.glb',
  bytes: 1,
  meshes: [],
  triangles: 12,
  textured: false,
  height: 1.7,
  checks: { centred: true, grounded: true, facing: true, upright: true, scale: 'ok', ...checks },
  weight: 'light',
  pose: null,
});

describe('① fixes (§5.2)', () => {
  it('names the first failing check’s fix, in AS-AR-5’s order', () => {
    expect(firstFix(report({}), true)).toBeNull();
    expect(firstFix(report({ upright: false, scale: 'huge', centred: false }), true)).toBe('standUp');
    expect(firstFix(report({ scale: 'tiny', centred: false }), true)).toBe('scale');
    expect(firstFix(report({ centred: false }), false)).toBe('freeze');
    expect(firstFix(report({ grounded: false, facing: false }), true)).toBe('center');
    expect(firstFix(report({ facing: false }), true)).toBe('face');
    expect(FIX_LABEL.standUp()).toBe('Stand up');
    expect(FIX_LABEL.center()).toBe('Center and ground');
  });
});

/** A stand-in app: scene mesh records with placements and resident data (positions only). */
function app(meshes: Record<string, { readonly positions: number[]; readonly t?: [number, number, number] }>) {
  return {
    store: {
      get: (_table: string, id: string) =>
        id in meshes ? { placement: { t: meshes[id]?.t ?? [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } } : undefined,
    },
    meshes: {
      get: (id: string) => ({
        data: () => (id in meshes ? { position: new Float32Array(meshes[id]?.positions ?? []) } : null),
      }),
    },
  } as never;
}

describe('① parts (§6.1)', () => {
  const body = { positions: [-0.5, 0, -0.1, 0.5, 1.7, 0.1] };
  it('a sword on the floor beside the body looks separate; hair on the head does not', () => {
    const a = app({
      body,
      sword: { positions: [0.9, 0, -0.05, 1.6, 0.06, 0.05] },
      hair: { positions: [-0.1, 1.5, -0.1, 0.1, 1.8, 0.1] },
    });
    expect(separateMeshes(a, ['body', 'sword', 'hair'] as never)).toEqual(['sword']);
    expect(defaultParts(a, ['body', 'sword', 'hair'] as never)).toEqual(['body', 'hair']);
  });

  it('placements move the bounds; one mesh, or data not resident yet, ticks everything', () => {
    const a = app({ body, prop: { positions: [-0.1, 0, -0.1, 0.1, 0.2, 0.1], t: [3, 0, 0] } });
    const bounds = meshBounds(a, 'prop' as never);
    expect(bounds?.[0][0]).toBeCloseTo(2.9, 6);
    expect(bounds?.[1][0]).toBeCloseTo(3.1, 6);
    expect(bounds?.[1][1]).toBeCloseTo(0.2, 6);
    expect(separateMeshes(a, ['body', 'prop'] as never)).toEqual(['prop']);
    expect(separateMeshes(a, ['body'] as never)).toEqual([]);
    const none = app({});
    expect(defaultParts(none, ['x', 'y'] as never)).toEqual(['x', 'y']);
  });
});
