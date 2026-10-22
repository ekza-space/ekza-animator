// AUTORIG-SPEC §5.2, §6.1 (D3): ①'s pure rules — the order the one-click fixes run in (stand up, size, freeze, centre,
// face: AS-AR-5's order, the footer names the first), and the parts of a multi-mesh model (every mesh ticked except
// one that touches neither the body — the tallest mesh — nor a part touching it: "Looks separate"; AR-D10-1).
import { readFileSync } from 'node:fs';
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

interface StandIn {
  readonly positions: number[];
  readonly t?: [number, number, number];
  readonly s?: number;
  /** Triangles (point indices); without them the data has no faces (the bounds decide). */
  readonly triangles?: number[];
}

/** A stand-in app: scene mesh records with placements and resident data (positions, and triangles as faces). */
function app(meshes: Record<string, StandIn>) {
  const records = new Map<string, unknown>();
  const data = new Map<string, unknown>();
  for (const [id, mesh] of Object.entries(meshes)) {
    const k = mesh.s ?? 1;
    records.set(id, { placement: { t: mesh.t ?? [0, 0, 0], q: [0, 0, 0, 1], s: [k, k, k] } });
    const tris = mesh.triangles ?? null;
    data.set(
      id,
      tris === null
        ? { position: new Float32Array(mesh.positions) }
        : {
            position: new Float32Array(mesh.positions),
            faceCorner: Uint32Array.from({ length: tris.length / 3 }, (_, f) => 3 * f),
            cornerNext: Uint32Array.from(tris, (_, c) => (c % 3 === 2 ? c - 2 : c + 1)),
            cornerVert: Uint32Array.from(tris),
          },
    );
  }
  return {
    store: { get: (_table: string, id: string) => records.get(id) },
    meshes: { get: (id: string) => ({ data: () => data.get(id) ?? null }) },
  } as never;
}

/** An axis-aligned box as positions and triangles. */
function box(lo: readonly number[], hi: readonly number[]): StandIn {
  const positions: number[] = [];
  for (let i = 0; i < 8; i++) {
    positions.push(
      (i & 1 ? hi[0] : lo[0]) as number,
      (i & 2 ? hi[1] : lo[1]) as number,
      (i & 4 ? hi[2] : lo[2]) as number,
    );
  }
  const quads = [
    [0, 1, 3, 2],
    [4, 6, 7, 5],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 5, 7, 3],
  ];
  return { positions, triangles: quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d] as number[]) };
}

/** The Cube Lad fixture as its 16 boxes, each its own mesh (a low-poly character made of separate parts). */
function splitCubeLad(scale = 1): Record<string, StandIn> {
  const bytes = readFileSync(new URL('../../../../../fixtures/models/cube-lad.glb', import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const bin = bytes.subarray(20 + jsonLength + 8);
  // 384 points (24 per box) interleaved with normals (stride 24 bytes), 576 uint16 indices (36 per box)
  const floats = new Float32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + 384 * 24));
  const indices = new Uint16Array(bin.buffer.slice(bin.byteOffset + 384 * 24, bin.byteOffset + 384 * 24 + 576 * 2));
  const out: Record<string, StandIn> = {};
  for (let b = 0; b < 16; b++) {
    const positions: number[] = [];
    for (let v = 24 * b; v < 24 * b + 24; v++) positions.push(...floats.subarray(6 * v, 6 * v + 3));
    const triangles = Array.from(indices.subarray(36 * b, 36 * b + 36), (i) => i - 24 * b);
    out[`pCube${b}`] = { positions, triangles, s: scale };
  }
  return out;
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

  it('a character of 16 separate boxes is one character: forearms, hands, shins and feet touch the body through parts (AR-D10-1)', () => {
    for (const scale of [1, 3.4]) {
      const parts = splitCubeLad(scale);
      const ids = Object.keys(parts);
      const a = app(parts);
      expect(separateMeshes(a, ids as never)).toEqual([]);
      expect(defaultParts(a, ids as never)).toEqual(ids);
      // a box on the floor beside the feet, inside the body's bounds (under the arms), touches nothing
      const sword = box([0.3 * scale, 0, -0.03 * scale], [0.7 * scale, 0.05 * scale, 0.03 * scale]);
      const b = app({ ...parts, sword });
      expect(separateMeshes(b, [...ids, 'sword'] as never)).toEqual(['sword']);
      // a hand held 5 cm away from its forearm looks separate, and so does nothing else
      const hand = parts['pCube8'] as StandIn;
      const c = app({ ...parts, pCube8: { ...hand, t: [-0.05 * scale, 0, 0] } });
      expect(separateMeshes(c, ids as never)).toEqual(['pCube8']);
    }
  });

  it('the surfaces decide, not the bounds: a sword under the arms of a one-mesh body looks separate', () => {
    const positions: number[] = [];
    const triangles: number[] = [];
    for (const part of Object.values(splitCubeLad())) {
      const base = positions.length / 3;
      positions.push(...part.positions);
      triangles.push(...(part.triangles ?? []).map((i) => i + base));
    }
    // inside the body's bounds (x up to 0.88 at the hands), lying on the floor 0.15 m from the feet
    const sword = box([0.3, 0, -0.03], [0.7, 0.05, 0.03]);
    const a = app({ body: { positions, triangles }, sword });
    expect(separateMeshes(a, ['body', 'sword'] as never)).toEqual(['sword']);
    // without faces the bounds decide (they overlap)
    const b = app({ body: { positions }, sword: { positions: sword.positions } });
    expect(separateMeshes(b, ['body', 'sword'] as never)).toEqual([]);
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
