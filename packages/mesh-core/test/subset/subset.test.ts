// M6A-SPEC §4.3 `copySubset` / `appendMesh` (B4): the stored subset of a face set with its remap and layers (all or
// named), canonical order; appending with transform, material slots by identity key, morph layers united in the
// target's order, the joint palette united and remapped, reversed winding and inverse-transpose custom normals for a
// negative determinant; the result always validates.
import { describe, expect, it } from 'vitest';
import {
  appendMesh,
  BitSet,
  BUILTIN_LAYERS,
  copySubset,
  editMeshFrom,
  morphLayer,
  primitive,
  topologyStats,
  validateMesh,
} from '../../src';
import { cubeData, signedVolume, vef } from '../../src/testing';

const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;

describe('copySubset', () => {
  it('one face of a cube: 4/4/1 with the remap, layers kept, edge order and flags kept', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const faces = new BitSet(m.counts.faces);
    faces.add(1);
    const { data, remap } = copySubset(m, faces);
    expect(vef(data)).toBe('4/4/1');
    expect(validateMesh(data)).toEqual([]);
    expect([...data.layers.keys()]).toEqual(['paint', 'uv0']);
    // Vertices keep their relative order; the remap is old → new or −1.
    const kept = Array.from(remap.points)
      .map((n, old) => [old, n] as const)
      .filter(([, n]) => n >= 0);
    expect(kept.map(([, n]) => n)).toEqual([0, 1, 2, 3]);
    for (const [old, n] of kept) {
      expect(Array.from(data.position.subarray(3 * n, 3 * n + 3))).toEqual(
        Array.from(m.position.subarray(3 * old, 3 * old + 3)),
      );
    }
    expect(remap.faces[1]).toBe(0);
    expect(Array.from(remap.faces).filter((n) => n >= 0)).toHaveLength(1);
    for (let e = 0; e < data.counts.edges; e++) expect(data.edgeFlags[e]).toBe(1);
    // Corner values travel: the copied corners hold the source corners' uvs.
    const uv = m.layer('uv0');
    for (let c = 0; c < m.counts.corners; c++) {
      const n = remap.corners[c] as number;
      if (n < 0) continue;
      expect(data.layers.get('uv0')?.data[2 * n]).toBe(uv?.get(c, 0));
    }
  });

  it('named layers only; every face reproduces the mesh', () => {
    const m = editMeshFrom(primitive('cylinder', {}));
    const all = new BitSet(m.counts.faces);
    for (let f = 0; f < m.counts.faces; f++) all.add(f);
    const { data } = copySubset(m, all, { layers: ['uv0'] });
    expect([...data.layers.keys()]).toEqual(['uv0']);
    const full = copySubset(m, all).data;
    expect(full).toEqual(m.snapshot());
  });
});

describe('appendMesh', () => {
  it('appends a moved cube: 16/24/12, two shells, flags and layers copied', () => {
    const a = editMeshFrom(primitive('cube', {}));
    const b = primitive('cube', {});
    a.begin('append');
    const result = appendMesh(a, b, { ...IDENTITY, t: [3, 0, 0] }, { materials: [['preset:unlit'], ['preset:unlit']] });
    a.end();
    expect(vef(a)).toBe('16/24/12');
    expect(topologyStats(a).shells).toBe(2);
    expect(validateMesh(a)).toEqual([]);
    expect(Array.from(result.materialSlots)).toEqual([0]);
    expect(result.paintSlots).not.toBeNull();
    expect(a.position[3 * 8]).toBe((b.position[0] as number) + 3);
    for (let e = 0; e < a.counts.edges; e++) expect(a.edgeFlags(e)).toBe(1);
  });

  it('material slots by identity key; morph layers united in a’s order; joint palettes united and remapped', () => {
    const a = editMeshFrom(cubeData());
    a.begin('layers');
    a.addLayer(morphLayer('smile'));
    const aj = a.addLayer({ ...BUILTIN_LAYERS.skinJoints, meta: { joints: [{ id: 'hips', parent: null }] } });
    a.addLayer(BUILTIN_LAYERS.skinWeights);
    aj.set(0, 0, 0);
    a.end();
    const bm = editMeshFrom(cubeData());
    bm.begin('layers');
    bm.setFaceMaterial(0, 1);
    const blink = bm.addLayer(morphLayer('blink'));
    blink.set(2, 0, 0.25);
    const bj = bm.addLayer({
      ...BUILTIN_LAYERS.skinJoints,
      meta: {
        joints: [
          { id: 'spine', parent: null },
          { id: 'hips', parent: null },
        ],
      },
    });
    bm.addLayer(BUILTIN_LAYERS.skinWeights);
    bj.set(3, 0, 0);
    bj.set(4, 0, 1);
    bm.end();
    a.begin('append');
    const result = appendMesh(a, bm.snapshot(), IDENTITY, {
      materials: [['preset:unlit'], ['preset:unlit', 'preset:lit']],
    });
    a.end();
    expect(Array.from(result.materialSlots)).toEqual([0, 1]);
    expect(a.faceMaterial(6)).toBe(1);
    expect(result.morphLayers).toEqual(['morph:smile', 'morph:blink']);
    expect(a.layer('morph:blink')?.get(8 + 2, 0)).toBe(0.25);
    expect(a.layer('morph:blink')?.get(2, 0)).toBe(0);
    expect(result.jointPalette).toEqual(['hips', 'spine']);
    const joints = a.layer('skin.joints');
    expect(joints?.get(8 + 3, 0)).toBe(1); // spine → 1 in the union
    expect(joints?.get(8 + 4, 0)).toBe(0); // hips → 0
    expect(joints?.get(0, 0)).toBe(0);
    expect(validateMesh(a)).toEqual([]);
  });

  it('det < 0: reversed winding (outward) and custom normals through the inverse transpose', () => {
    const a = editMeshFrom(cubeData());
    const bm = editMeshFrom(cubeData());
    bm.begin('normal');
    const n = bm.addLayer(BUILTIN_LAYERS.normalCustom);
    const c = bm.faceCorner(4); // face [1 5 6 2] (+X)
    n.set(c, 0, 1);
    bm.end();
    a.begin('append');
    appendMesh(a, bm.snapshot(), { t: [3, 0, 0], q: [0, 0, 0, 1], s: [-1, 1, 1] }, { materials: [[], []] });
    a.end();
    expect(signedVolume(a)).toBeCloseTo(2, 12);
    expect(validateMesh(a)).toEqual([]);
    // The corner at the copied vertex 1 + 8 in the copy of face 4 has its normal mirrored to −X.
    const layer = a.layer('normal.custom');
    let found = 0;
    for (let k = a.faceCorner(10), s = k, first = true; first || k !== s; k = a.cornerNext(k), first = false) {
      if (a.cornerVert(k) === 9) found = layer?.get(k, 0) as number;
    }
    expect(found).toBe(-1);
  });
});
