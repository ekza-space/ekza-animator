// M6A-SPEC §5.2 (B1 helpers, used by every op package): duplicating, merging, filling, clearing and mirroring layer
// values by their rules; joint-palette mirror pairs and side names.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  type EditMesh,
  editMeshFrom,
  groupLayer,
  type LayerDef,
  morphLayer,
  primitive,
} from '../../src';
import {
  averageCornerAttributes,
  clearCornerAttributes,
  copyCornerAttributes,
  copyEdgeAttributes,
  copyFaceAttributes,
  copyPointAttributes,
  defaultAttributes,
  jointMirrorMap,
  mergePointAttributes,
  mirrorCornerAttributes,
  mirrorName,
  mirrorPointAttributes,
} from '../../src/layers/propagate';

function mesh(layers: readonly LayerDef[]): EditMesh {
  const m = editMeshFrom(primitive('cube', {}));
  m.begin('layers');
  for (const def of layers) m.addLayer(def);
  m.end();
  return m;
}

const read = (m: EditMesh, name: string, i: number): number[] => {
  const layer = m.layer(name);
  return Array.from({ length: layer?.def.comps ?? 0 }, (_, k) => layer?.get(i, k) as number);
};

describe('points', () => {
  const skinMeta = {
    ...BUILTIN_LAYERS.skinJoints,
    meta: { joints: [{ id: 'hips' }, { id: 'leftArm' }, { id: 'rightArm' }, { id: 'Hand.L' }, { id: 'Hand.R' }] },
  };
  const layers = [
    skinMeta,
    BUILTIN_LAYERS.skinWeights,
    morphLayer('Blink_L'),
    morphLayer('Blink_R'),
    groupLayer('Arm.L', 'point', 'bit'),
    groupLayer('Arm.R', 'point', 'bit'),
    groupLayer('Soft', 'point', 'weight'),
  ];

  function seeded(): EditMesh {
    const m = mesh(layers);
    m.begin('seed');
    const set = (name: string, i: number, values: number[]): void => {
      values.forEach((value, k) => m.layer(name)?.set(i, k, value));
    };
    set('skin.joints', 0, [1, 0, 0, 0]);
    set('skin.weights', 0, [1, 0, 0, 0]);
    set('skin.joints', 1, [2, 3, 0, 0]);
    set('skin.weights', 1, [0.5, 0.5, 0, 0]);
    set('skin.joints', 2, [0, 0, 0, 0]);
    set('skin.weights', 2, [1, 0, 0, 0]);
    set('morph:Blink_L', 0, [0.1, 0.2, 0.3]);
    set('morph:Blink_L', 1, [0.3, 0.2, 0.1]);
    set('group:Arm.L', 0, [1]);
    set('group:Arm.L', 1, [4]);
    set('group:Soft', 0, [0.2]);
    set('group:Soft', 1, [0.7]);
    m.end();
    return m;
  }

  it('copy duplicates every point layer', () => {
    const m = seeded();
    m.begin('copy');
    copyPointAttributes(m, 1, 5);
    m.end();
    for (const def of layers) expect(read(m, def.name, 5)).toEqual(read(m, def.name, 1));
  });

  it('merge "average": linear average, skin blend renormalized, bits or, group weights max', () => {
    const m = seeded();
    m.begin('merge');
    mergePointAttributes(m, [0, 1], 6, 'average');
    m.end();
    expect(read(m, 'morph:Blink_L', 6).map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0.2, 0.2, 0.2]);
    expect(read(m, 'group:Arm.L', 6)).toEqual([5]);
    expect(read(m, 'group:Soft', 6)).toEqual([Math.fround(0.7)]);
    expect(read(m, 'skin.joints', 6)).toEqual([1, 2, 3, 0]);
    const weights = read(m, 'skin.weights', 6);
    expect(weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 6);
    expect(weights[0]).toBeCloseTo(0.5, 6);
  });

  it('merge "target": the target vertex wins', () => {
    const m = seeded();
    m.begin('weld');
    mergePointAttributes(m, [0, 1], 7, 'target', 1);
    m.end();
    for (const def of layers) expect(read(m, def.name, 7)).toEqual(read(m, def.name, 1));
  });

  it('mirroring negates morph axes into the partner target, maps joints by name and swaps side groups', () => {
    const m = seeded();
    m.begin('mirror');
    mirrorPointAttributes(m, 1, 3, 'x');
    m.end();
    expect(read(m, 'morph:Blink_R', 3)).toEqual([Math.fround(-0.3), Math.fround(0.2), Math.fround(0.1)]);
    expect(read(m, 'skin.joints', 3)).toEqual([1, 4, 0, 0]); // rightArm → leftArm (1), Hand.L → Hand.R (4)
    expect(read(m, 'skin.weights', 3)).toEqual([0.5, 0.5, 0, 0]);
    expect(read(m, 'group:Arm.R', 3)).toEqual([4]);
  });

  it('side names and joint pairs', () => {
    expect(mirrorName('morph:Blink_L')).toBe('morph:Blink_R');
    expect(mirrorName('group:Arm.R')).toBe('group:Arm.L');
    expect(mirrorName('leftUpperArm')).toBe('rightUpperArm');
    expect(mirrorName('RightHand')).toBe('LeftHand');
    expect(mirrorName('spine')).toBeNull();
    expect([...jointMirrorMap(['hips', 'leftArm', 'rightArm', 'Hand.L'])]).toEqual([0, 2, 1, 3]);
  });
});

describe('corners, faces, edges', () => {
  it('copy clears the clear-rule layers; average fills; clear touches only normal.custom', () => {
    const m = mesh([BUILTIN_LAYERS.normalCustom, BUILTIN_LAYERS.color0]);
    m.begin('seed');
    m.layer('normal.custom')?.set(0, 2, 1);
    m.layer('color0')?.set(1, 0, 0);
    m.end();
    m.begin('copy');
    copyCornerAttributes(m, 0, 2);
    averageCornerAttributes(m, [0, 1], 3);
    clearCornerAttributes(m, [0]);
    m.end();
    expect(read(m, 'normal.custom', 2)).toEqual([0, 0, 0]);
    expect(read(m, 'uv0', 2)).toEqual(read(m, 'uv0', 0));
    expect(read(m, 'color0', 3)).toEqual([0.5, 1, 1, 1]);
    expect(read(m, 'normal.custom', 0)).toEqual([0, 0, 0]);
    expect(read(m, 'color0', 1)).toEqual([0, 1, 1, 1]);
  });

  it('mirrored corners flip U when asked and negate custom normals', () => {
    const m = mesh([BUILTIN_LAYERS.normalCustom]);
    m.begin('seed');
    m.layer('normal.custom')?.set(0, 0, 0.5);
    m.end();
    const uv = read(m, 'uv0', 0);
    m.begin('mirror');
    mirrorCornerAttributes(m, 0, 4, 'x', { flipUVs: true });
    mirrorCornerAttributes(m, 0, 5, 'x');
    m.end();
    expect(read(m, 'uv0', 4)).toEqual([Math.fround(1 - (uv[0] as number)), uv[1]]);
    expect(read(m, 'uv0', 5)).toEqual(uv);
    expect(read(m, 'normal.custom', 4)).toEqual([-0.5, 0, 0]);
  });

  it('faces copy layers and material; edges copy layers; defaults reset', () => {
    const m = mesh([BUILTIN_LAYERS.crease]);
    m.begin('seed');
    m.setFaceMaterial(0, 4);
    m.layer('paint')?.set(0, 0, 3);
    m.layer('crease')?.set(0, 0, 0.5);
    copyFaceAttributes(m, 0, 2);
    copyEdgeAttributes(m, 0, 7);
    m.end();
    expect(m.faceMaterial(2)).toBe(4);
    expect(read(m, 'paint', 2)).toEqual([3]);
    expect(read(m, 'crease', 7)).toEqual([0.5]);
    m.begin('reset');
    defaultAttributes(m, 'face', 2);
    m.end();
    expect(read(m, 'paint', 2)).toEqual([0]);
  });
});
