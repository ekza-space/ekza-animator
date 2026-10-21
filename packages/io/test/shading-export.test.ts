// SHADING-SPEC §4: swatch shaders in the static GLB — Lambert metallic 0 / roughness 1, Blinn roughness 1 − glossiness
// with KHR_materials_specular (used, never required), one material per shader group per colour output, Lambert-only
// bytes unchanged, unlit meshes unchanged, and a re-import (glTF Transform and three.js) reading the factors back.
import { WebIO } from '@gltf-transform/core';
import { KHRMaterialsSpecular, KHRMaterialsUnlit, type Specular } from '@gltf-transform/extensions';
import { BUILTIN_LAYERS, type MeshData, setKernelDebug } from '@ekza-animator/mesh-core';
import { cubeData } from '@ekza-animator/mesh-core/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { readBackStatic } from '../src/export/author/artifact';
import { writeStaticGlb } from '../src/export/author';
import { shaderFactors, shaderKey, shaderLabel } from '../src/export/author/shading';
import { parseGlb } from '../src/glb/parse';
import { srgbEotf } from '../src/mesh';
import { manualModelProvenance } from '../src/provenance/model';
import { loadGltfInNode } from '../src/testing';
import type { ColourOutput } from '@ekza-animator/doc';
import type { StaticMaterial, StaticScene, StaticSwatch, SwatchShading } from '../src/types';
import { validateGltf } from '../src/validate/validate';
import { READY } from './ready';

beforeAll(() => setKernelDebug(true));

type Json = Record<string, unknown>;

const TOP = 1; // cubeData face [3, 2, 6, 7] at y = +0.5
const BLINN: SwatchShading = { shader: 'blinn', glossiness: 0.7, specular: [255, 255, 255] };
const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;

/** A cube painted slot 0, its top face slot 4. */
function paintedCube(): MeshData {
  const cube = cubeData();
  const paint = new Uint16Array(cube.counts.faces);
  paint[TOP] = 4;
  const layers = new Map(cube.layers);
  layers.set('paint', { def: BUILTIN_LAYERS.paint, data: paint });
  return { ...cube, layers };
}

function swatches(shader4: SwatchShading | undefined, shader0?: SwatchShading): StaticSwatch[] {
  return [
    { slot: 0, srgb: [244, 244, 244], ...(shader0 === undefined ? {} : { shader: shader0 }) },
    { slot: 4, srgb: [224, 70, 70], ...(shader4 === undefined ? {} : { shader: shader4 }) },
    { slot: 5, srgb: [240, 138, 60] },
  ];
}

function scene(
  palette: StaticSwatch[],
  colourOutput: ColourOutput = 'palette-texture',
  preset: StaticMaterial['preset'] = 'lit',
): StaticScene {
  return {
    roots: [
      {
        id: 'msh_cube',
        name: 'Cube',
        placement: IDENTITY,
        mesh: { data: paintedCube(), materials: [{ preset, name: 'Palette' }], colourOutput, paletteId: 'pal_default' },
        children: [],
      },
    ],
    palettes: new Map([['pal_default', palette]]),
    handheld: null,
    model: manualModelProvenance({ toolVersion: '0.3.0' }),
  };
}

async function write(s: StaticScene): Promise<Uint8Array> {
  return writeStaticGlb(s, { generator: 'test' });
}

async function jsonOf(bytes: Uint8Array): Promise<Json> {
  return (await parseGlb(bytes)).json;
}

const pbr = (material: Json | undefined): Json => (material?.['pbrMetallicRoughness'] ?? {}) as Json;
/** roughnessFactor / metallicFactor with the glTF defaults (1) the writer leaves out. */
const roughness = (material: Json | undefined): number => (pbr(material)['roughnessFactor'] as number | undefined) ?? 1;
const metallic = (material: Json | undefined): number => (pbr(material)['metallicFactor'] as number | undefined) ?? 1;

describe('shaderFactors (SHADING-SPEC §4 mapping)', () => {
  it('Lambert: metallic 0, roughness 1, no specular; Blinn: roughness 1 − glossiness, specular split', () => {
    expect(shaderFactors(undefined)).toEqual({ metallic: 0, roughness: 1, specular: null });
    expect(shaderFactors({ ...BLINN, shader: 'lambert' })).toEqual({ metallic: 0, roughness: 1, specular: null });
    const blinn = shaderFactors(BLINN);
    expect(blinn.metallic).toBe(0);
    expect(blinn.roughness).toBeCloseTo(0.3, 12);
    expect(blinn.specular).toEqual({ factor: 1, colour: [1, 1, 1] });
    expect(shaderFactors({ ...BLINN, glossiness: 0 }).roughness).toBe(1);
    expect(shaderFactors({ ...BLINN, glossiness: 1 }).roughness).toBe(0);
    // Grey: the strength; a hue: the tint (largest channel 1).
    const grey = shaderFactors({ ...BLINN, specular: [128, 128, 128] }).specular;
    expect(grey?.factor).toBeCloseTo(srgbEotf(128 / 255), 12);
    expect(grey?.colour).toEqual([1, 1, 1]);
    const tint = shaderFactors({ ...BLINN, specular: [255, 128, 0] }).specular;
    expect(tint?.factor).toBe(1);
    expect(tint?.colour[1]).toBeCloseTo(srgbEotf(128 / 255), 12);
    expect(tint?.colour[2]).toBe(0);
    expect(shaderFactors({ ...BLINN, specular: [0, 0, 0] }).specular).toEqual({ factor: 0, colour: [1, 1, 1] });
  });

  it('groups equal shaders and names them', () => {
    expect(shaderKey(undefined)).toBe('');
    expect(shaderKey({ ...BLINN, shader: 'lambert' })).toBe('');
    expect(shaderKey(BLINN)).toBe(shaderKey({ ...BLINN, specular: [255, 255, 255] }));
    expect(shaderKey(BLINN)).not.toBe(shaderKey({ ...BLINN, glossiness: 0.6 }));
    expect(shaderLabel(BLINN)).toBe('blinn g70');
    expect(shaderLabel({ ...BLINN, specular: [128, 128, 128] })).toBe('blinn g70 #808080');
  });
});

describe.skipIf(!READY)('static GLB with swatch shaders', () => {
  it('Lambert-only and unlit exports write the bytes they wrote before shaders', async () => {
    const plain = await write(scene(swatches(undefined)));
    const lambert = await write(scene(swatches({ ...BLINN, shader: 'lambert' })));
    expect(Buffer.compare(Buffer.from(plain), Buffer.from(lambert))).toBe(0);
    // Unlit ignores shaders: same bytes with or without a Blinn swatch.
    const unlit = await write(scene(swatches(undefined), 'palette-texture', 'unlit'));
    const unlitBlinn = await write(scene(swatches(BLINN), 'palette-texture', 'unlit'));
    expect(Buffer.compare(Buffer.from(unlit), Buffer.from(unlitBlinn))).toBe(0);
    expect((await jsonOf(unlitBlinn))['extensionsUsed']).toEqual(['KHR_materials_unlit']);
    const json = await jsonOf(plain);
    expect(json['extensionsUsed']).toBeUndefined();
    expect(json['materials']).toHaveLength(1);
  });

  it('palette texture: one material per shader sharing the PNG; Blinn has roughness 0.3 and KHR_materials_specular', async () => {
    const s = scene(swatches(BLINN));
    const bytes = await write(s);
    const report = await validateGltf(bytes);
    expect(report.errors).toBe(0);
    const json = await jsonOf(bytes);
    expect(json['extensionsUsed']).toEqual(['KHR_materials_specular']);
    expect(json['extensionsRequired']).toBeUndefined();
    expect(json['images']).toHaveLength(1);
    expect(json['textures']).toHaveLength(1);
    const materials = json['materials'] as Json[];
    expect(materials.map((m) => m['name'])).toEqual(['Palette', 'Palette blinn g70']);
    const [lambert, blinn] = materials;
    for (const material of materials) {
      expect(pbr(material)['baseColorTexture']).toEqual({ index: 0 });
      expect(metallic(material)).toBe(0);
    }
    expect(roughness(lambert)).toBe(1);
    expect(lambert?.['extensions']).toBeUndefined();
    expect(roughness(blinn)).toBeCloseTo(0.3, 6);
    expect(blinn?.['extensions']).toHaveProperty('KHR_materials_specular');
    // Faces: the top face (2 triangles) is the Blinn primitive.
    const primitives = (json['meshes'] as { primitives: { material: number }[] }[])[0]?.primitives ?? [];
    expect(primitives.map((p) => p.material)).toEqual([0, 1]);
    const back = readBackStatic(bytes, s);
    expect(back).toMatchObject({ ok: true, primitives: 2, triangles: 12, deadCellVertices: 0 });

    // Re-import (glTF Transform): the factors and the extension read back.
    const doc = await new WebIO().registerExtensions([KHRMaterialsSpecular, KHRMaterialsUnlit]).readBinary(bytes);
    const read = doc.getRoot().listMaterials();
    expect(read.map((m) => [m.getMetallicFactor(), Number(m.getRoughnessFactor().toFixed(6))])).toEqual([
      [0, 1],
      [0, 0.3],
    ]);
    const specular = read[1]?.getExtension<Specular>('KHR_materials_specular');
    expect(specular?.getSpecularFactor()).toBe(1);
    expect(specular?.getSpecularColorFactor()).toEqual([1, 1, 1]);
    expect(read[0]?.getExtension('KHR_materials_specular')).toBeNull();

    // Re-import (three.js GLTFLoader, as the browser reads it).
    const loaded = await loadGltfInNode(bytes);
    const found: { roughness: number; metalness: number; specularIntensity?: number }[] = [];
    loaded.scene.traverse((object) => {
      const material = (object as { material?: { roughness: number; metalness: number; specularIntensity?: number } })
        .material;
      if (material !== undefined) found.push(material);
    });
    expect(found).toHaveLength(2);
    const shiny = found.find((m) => m.roughness < 0.5);
    expect(shiny?.metalness).toBe(0);
    expect(shiny?.roughness).toBeCloseTo(0.3, 6);
    expect(shiny?.specularIntensity).toBe(1);
  });

  it('a grey specular writes its strength; equal Blinn swatches share one material', async () => {
    const grey: SwatchShading = { ...BLINN, specular: [128, 128, 128] };
    const bytes = await write(scene(swatches(grey, grey)));
    const json = await jsonOf(bytes);
    const materials = json['materials'] as Json[];
    // Slot 0 and slot 4 share the shader: one material (the faces of slot 5 none: unused).
    expect(materials).toHaveLength(1);
    const extensions = (materials[0]?.['extensions'] ?? {}) as Json;
    const ext = extensions['KHR_materials_specular'] as Json;
    expect(ext['specularFactor']).toBeCloseTo(srgbEotf(128 / 255), 6);
    expect(ext['specularColorFactor'] ?? [1, 1, 1]).toEqual([1, 1, 1]);
    expect((await validateGltf(bytes)).errors).toBe(0);
  });

  it('vertex colour and material per colour carry the shader factors too', async () => {
    const vertex = await jsonOf(await write(scene(swatches(BLINN), 'vertex-colour')));
    const vm = vertex['materials'] as Json[];
    expect(vm).toHaveLength(2);
    expect(vm.map(roughness).map((r) => Number(r.toFixed(6)))).toEqual([1, 0.3]);
    expect(vertex['images']).toBeUndefined();

    const perColourBytes = await write(scene(swatches(BLINN), 'material-per-colour'));
    expect((await validateGltf(perColourBytes)).errors).toBe(0);
    const perColour = await jsonOf(perColourBytes);
    const pm = perColour['materials'] as Json[];
    expect(pm.map((m) => m['name'])).toEqual(['Palette swatch 0', 'Palette swatch 4']);
    expect(roughness(pm[0])).toBe(1);
    expect(roughness(pm[1])).toBeCloseTo(0.3, 6);
    expect((pbr(pm[1])['baseColorFactor'] as number[])[0]).toBeCloseTo(srgbEotf(224 / 255), 6);
    expect(perColour['extensionsUsed']).toEqual(['KHR_materials_specular']);
  });
});
