// Swatch shaders (SHADING-SPEC §5): the shader args of palette.addSwatch / palette.setSwatch and Assign New Material
// (`palette.assignMaterial`) on faces and objects, in one undo step.
import type { MeshId, PaletteId, SwatchId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE_ID, defaultSwatchId } from '../../../src';
import { faceSlots, meshTestApp, paintFaces, pollReason, runValue, selectObjects } from './support';

type T = Awaited<ReturnType<typeof meshTestApp>>;

async function cube(t: T): Promise<MeshId> {
  return (await runValue<{ mesh: MeshId }>(t, 'mesh.create.cube')).mesh;
}

const presetOf = (t: T, id: MeshId): string | undefined => {
  const material = t.app.store.get('meshes', id)?.material;
  return material !== undefined && 'preset' in material ? material.preset : undefined;
};

describe('swatch shader args (SHADING-SPEC §5)', () => {
  it('new swatches are Lambert by default; addSwatch takes a shader', async () => {
    const t = await meshTestApp();
    await runValue(t, 'palette.ensureDefault');
    expect(t.app.store.get('swatches', defaultSwatchId(4))).toMatchObject({
      shader: 'lambert',
      glossiness: 0.5,
      specular: [255, 255, 255],
    });
    const { swatch } = await runValue<{ swatch: SwatchId }>(t, 'palette.addSwatch', {
      palette: DEFAULT_PALETTE_ID,
      srgb: [10, 20, 30],
      shader: 'blinn',
      glossiness: 0.75,
      specular: [100, 110.4, 120],
    });
    expect(t.app.store.get('swatches', swatch)).toMatchObject({
      shader: 'blinn',
      glossiness: 0.75,
      specular: [100, 110, 120],
    });
    expect(pollReason(t, 'palette.addSwatch', { palette: DEFAULT_PALETTE_ID, srgb: [0, 0, 0], shader: 'phong' })).toBe(
      "shader must be 'lambert' or 'blinn'",
    );
  });

  it('setSwatch changes the shader in one undoable step; bad values fail the poll', async () => {
    const t = await meshTestApp();
    await runValue(t, 'palette.ensureDefault');
    const swatch = defaultSwatchId(4);
    await runValue(t, 'palette.setSwatch', { swatch, shader: 'blinn' });
    await runValue(t, 'palette.setSwatch', { swatch, glossiness: 0.9, specular: [200, 200, 255] });
    expect(t.app.store.get('swatches', swatch)).toMatchObject({
      shader: 'blinn',
      glossiness: 0.9,
      specular: [200, 200, 255],
      srgb: [0xe0, 0x46, 0x46],
    });
    t.app.history.undo();
    expect(t.app.store.get('swatches', swatch)).toMatchObject({ shader: 'blinn', glossiness: 0.5 });
    t.app.history.undo();
    expect(t.app.store.get('swatches', swatch)?.shader).toBe('lambert');
    expect(pollReason(t, 'palette.setSwatch', { swatch, glossiness: 1.2 })).toBe('glossiness must be a number in 0…1');
    expect(pollReason(t, 'palette.setSwatch', { swatch, specular: [1, 2] })).toMatch(/specular/);
    expect(pollReason(t, 'palette.setSwatch', { swatch, shader: 'lambert' })).toBeNull();
  });
});

describe('palette.assignMaterial (Assign New Material)', () => {
  it('on selected faces: a new Blinn swatch with their colour, painted, the mesh lit, one undo step', async () => {
    const t = await meshTestApp();
    const id = await cube(t);
    paintFaces(t, id, [1, 3], 6);
    // Select faces 1 and 3 (face mode, the cube hilited).
    t.app.session.setState({ workspace: 'model' });
    await runValue(t, 'palette.setActive', { swatch: defaultSwatchId(6) });
    selectObjects(t, [id]);
    await runValue(t, 'select.mesh.bySwatch');
    expect(presetOf(t, id)).toBe('unlit');
    const steps = t.app.history.peekUndo()?.id;

    const result = await runValue<{ swatch: SwatchId; slot: number; meshes: MeshId[] }>(t, 'palette.assignMaterial', {
      shader: 'blinn',
    });
    expect(result).toMatchObject({ slot: 16, meshes: [id] });
    expect(t.app.store.get('swatches', result.swatch)).toMatchObject({
      name: 'Blinn 1',
      shader: 'blinn',
      glossiness: 0.5,
      specular: [255, 255, 255],
      // the colour of the faces it replaces (default swatch 6)
      srgb: t.app.store.get('swatches', defaultSwatchId(6))?.srgb,
    });
    expect(faceSlots(t, id)).toEqual([0, 16, 0, 16, 0, 0]);
    expect(presetOf(t, id)).toBe('lit');
    expect(t.app.session.getState().model.activeSwatch).toBe(result.swatch);
    expect(t.app.history.peekUndo()?.label).toBe('Assign New Material');

    // One step: undo restores the paint, the palette and the preset.
    t.app.history.undo();
    expect(faceSlots(t, id)).toEqual([0, 6, 0, 6, 0, 0]);
    expect(t.app.store.get('swatches', result.swatch)).toBeUndefined();
    expect(presetOf(t, id)).toBe('unlit');
    expect(t.app.history.peekUndo()?.id).toBe(steps);
    t.app.history.redo();
    expect(faceSlots(t, id)).toEqual([0, 16, 0, 16, 0, 0]);
    expect(t.app.store.get('swatches', result.swatch)?.shader).toBe('blinn');
  });

  it('on objects: every face of each selected mesh; names count up; an explicit colour wins', async () => {
    const t = await meshTestApp();
    const a = await cube(t);
    const b = await cube(t);
    selectObjects(t, [a, b]);
    const first = await runValue<{ swatch: SwatchId; slot: number }>(t, 'palette.assignMaterial', {
      shader: 'lambert',
    });
    expect(faceSlots(t, a)).toEqual(Array(6).fill(first.slot));
    expect(faceSlots(t, b)).toEqual(Array(6).fill(first.slot));
    expect(t.app.store.get('swatches', first.swatch)).toMatchObject({
      name: 'Lambert 1',
      shader: 'lambert',
      srgb: [0xf4, 0xf4, 0xf4],
    });
    expect([presetOf(t, a), presetOf(t, b)]).toEqual(['lit', 'lit']);
    selectObjects(t, [b]);
    const second = await runValue<{ swatch: SwatchId }>(t, 'palette.assignMaterial', {
      shader: 'lambert',
      srgb: [1, 2, 3],
    });
    expect(t.app.store.get('swatches', second.swatch)).toMatchObject({ name: 'Lambert 2', srgb: [1, 2, 3] });
  });

  it('polls: shader, a selection, authored meshes of one palette', async () => {
    const t = await meshTestApp();
    expect(pollReason(t, 'palette.assignMaterial', { shader: 'phong' })).toBe("shader must be 'lambert' or 'blinn'");
    expect(pollReason(t, 'palette.assignMaterial', { shader: 'blinn' })).toBe('Select faces or a mesh first');
    const a = await cube(t);
    const b = await cube(t);
    const { palette: variant } = await runValue<{ palette: PaletteId }>(t, 'palette.duplicate', {
      palette: DEFAULT_PALETTE_ID,
    });
    selectObjects(t, [b]);
    await runValue(t, 'palette.assign', { palette: variant });
    selectObjects(t, [a, b]);
    expect(pollReason(t, 'palette.assignMaterial', { shader: 'blinn' })).toBe(
      'The selected meshes paint with different palettes',
    );
    selectObjects(t, [a]);
    expect(pollReason(t, 'palette.assignMaterial', { shader: 'blinn' })).toBeNull();
    expect(pollReason(t, 'palette.assignMaterial', { shader: 'blinn', meshes: [b] })).toBeNull();
  });
});

describe('file.exportModel with swatch shaders (SHADING-SPEC §4)', () => {
  /** The JSON chunk of a GLB. */
  const jsonOf = (glb: Uint8Array): Record<string, unknown> => {
    const length = new DataView(glb.buffer, glb.byteOffset + 12, 4).getUint32(0, true);
    return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length))) as Record<string, unknown>;
  };
  type Artifact = { readonly bytes: Uint8Array; readonly lints: readonly { code: string; severity: string }[] };
  const exportCube = async (t: T, cubeId: MeshId): Promise<Artifact> => {
    const artifacts = await runValue<readonly Artifact[]>(t, 'file.exportModel', {
      objects: [cubeId],
      fileName: 'cube.glb',
      profile: 'local/generic',
      validate: false,
    });
    const artifact = artifacts[0];
    if (artifact === undefined) throw new Error('no artifact');
    return artifact;
  };

  it('a Blinn top face exports as its own material: metallic 0, roughness 1 − glossiness, KHR_materials_specular', async () => {
    const t = await meshTestApp();
    const id = await cube(t);
    paintFaces(t, id, [1], 6);
    t.app.session.setState({ workspace: 'model' });
    await runValue(t, 'palette.setActive', { swatch: defaultSwatchId(6) });
    selectObjects(t, [id]);
    await runValue(t, 'select.mesh.bySwatch');
    const { swatch } = await runValue<{ swatch: SwatchId }>(t, 'palette.assignMaterial', { shader: 'blinn' });
    await runValue(t, 'palette.setSwatch', { swatch, glossiness: 0.7 });

    const artifact = await exportCube(t, id);
    expect(artifact.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    const json = jsonOf(artifact.bytes);
    expect(json['extensionsUsed']).toEqual(['KHR_materials_specular']);
    expect(json['extensionsRequired']).toBeUndefined();
    const materials = json['materials'] as { name: string; pbrMetallicRoughness: Record<string, number> }[];
    expect(materials.map((m) => m.name)).toEqual(['Ekza Default 16', 'Ekza Default 16 blinn g70']);
    expect(materials.map((m) => m.pbrMetallicRoughness['metallicFactor'])).toEqual([0, 0]);
    expect(materials[0]?.pbrMetallicRoughness['roughnessFactor'] ?? 1).toBe(1);
    expect(materials[1]?.pbrMetallicRoughness['roughnessFactor']).toBeCloseTo(0.3, 6);
    expect(json['images']).toHaveLength(1);
  });

  it('an unlit mesh with a Blinn swatch exports flat with the material.unlit-shader warning', async () => {
    const t = await meshTestApp();
    const id = await cube(t);
    selectObjects(t, [id]);
    await runValue(t, 'palette.assignMaterial', { shader: 'blinn' });
    expect(presetOf(t, id)).toBe('lit');
    expect((await exportCube(t, id)).lints.map((lint) => lint.code)).not.toContain('material.unlit-shader');
    await runValue(t, 'mesh.setAttributes', { mesh: id, patch: { material: { preset: 'unlit' } } });
    const artifact = await exportCube(t, id);
    expect(artifact.lints).toContainEqual(
      expect.objectContaining({ code: 'material.unlit-shader', severity: 'warning' }),
    );
    const json = jsonOf(artifact.bytes);
    expect(json['extensionsUsed']).toEqual(['KHR_materials_unlit']);
    expect(json['materials']).toHaveLength(1);
  });
});
