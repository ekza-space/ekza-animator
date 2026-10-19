// M6A-SPEC §4.5 author writer, §5.19 colour outputs, §5.22 handheld profile and the §4.5 lint table (B8): authored
// GLBs validate with 0 errors, the palette round trip holds within 1/255, COLOR_0 is linear, bytes are deterministic,
// and each lint code fires on a fixture made for it.
import type { HandheldGrip } from '@ekza-animator/doc';
import { readFixture } from '@ekza-animator/doc/testing';
import { BUILTIN_LAYERS, EDGE_HARD, type MeshData, setKernelDebug } from '@ekza-animator/mesh-core';
import { buildMeshData, cubeData } from '@ekza-animator/mesh-core/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { exportStaticModel, readBackStatic } from '../src/export/author/artifact';
import { writeStaticGlb } from '../src/export/author';
import { parseGlb } from '../src/glb/parse';
import { GltfReader } from '../src/gltf/accessor';
import { lintExport } from '../src/lint/lintExport';
import { ruleSeverity } from '../src/lint/rules';
import { lintMeshes, type MeshLintInput, srgbEotf } from '../src/mesh';
import { BUILTIN_EXPORT_PROFILES, profilesForKind } from '../src/profiles/builtin';
import { BUDGET_PRESETS, resolveBudget } from '../src/profiles/budgets';
import { PROFILE_OMOBA_HANDHELD } from '../src/profiles/handheld';
import { manualModelProvenance } from '../src/provenance/model';
import { GltfBuilder, loadGltfInNode, makeGlb } from '../src/testing';
import type { EkzaModelV1, ExportProfileDef, StaticNode, StaticScene } from '../src/types';
import { validateGltf } from '../src/validate/validate';
import { readPngRgb } from './helpers/mesh';
import { READY } from './ready';

beforeAll(() => setKernelDebug(true));

type Json = Record<string, unknown>;

const DEFAULT_16 = [
  '#f4f4f4',
  '#c2c3c7',
  '#6e7179',
  '#2b2d33',
  '#e04646',
  '#f08a3c',
  '#f2c84b',
  '#8bc34a',
  '#3b9b5a',
  '#3fa7c9',
  '#3d6fd8',
  '#7b4fc9',
  '#e07bb5',
  '#c98b5b',
  '#8a5a3b',
  '#4a3426',
].map((hex, slot) => ({
  slot,
  srgb: [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number],
}));
const LOCAL = BUILTIN_EXPORT_PROFILES.find((p) => p.id === 'local/generic') as ExportProfileDef;
const MODEL: EkzaModelV1 = manualModelProvenance({ toolVersion: '0.3.0' });
const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;
const TOP = 1; // cubeData face [3, 2, 6, 7] at y = +0.5

/** A faceted cube painted slot 0, its top face `topSlot`. */
function paintedCube(topSlot = 4): MeshData {
  const cube = cubeData();
  const paint = new Uint16Array(cube.counts.faces);
  paint[TOP] = topSlot;
  const layers = new Map(cube.layers);
  layers.set('paint', { def: BUILTIN_LAYERS.paint, data: paint });
  return { ...cube, layers };
}

function meshNode(
  name: string,
  data: MeshData,
  opts: Partial<Pick<NonNullable<StaticNode['mesh']>, 'colourOutput' | 'materials'>> & {
    readonly placement?: StaticNode['placement'];
    readonly children?: readonly StaticNode[];
  } = {},
): StaticNode {
  return {
    id: `msh_${name}`,
    name,
    placement: opts.placement ?? IDENTITY,
    mesh: {
      data,
      materials: opts.materials ?? [{ preset: 'unlit', name: 'Palette' }],
      colourOutput: opts.colourOutput ?? 'palette-texture',
      paletteId: 'pal_default',
    },
    children: opts.children ?? [],
  };
}

function sceneOf(roots: readonly StaticNode[], handheld: HandheldGrip | null = null): StaticScene {
  return { roots, palettes: new Map([['pal_default', DEFAULT_16]]), handheld, model: MODEL };
}

const GRIP: HandheldGrip = { bone: 'rightHand', offset: [0, 0.05, 0], rotationDegrees: [0, 90, 0], scale: 1 };

describe('writeStaticGlb', () => {
  it('palette texture: 0 validator errors, one unlit material, one 64 × 64 PNG, exact cell UVs, deterministic', async () => {
    const scene = sceneOf([meshNode('Cube', paintedCube())]);
    const bytes = await writeStaticGlb(scene, { generator: 'Ekza Animator 0.3.0' });
    expect(
      Buffer.compare(
        Buffer.from(bytes),
        Buffer.from(await writeStaticGlb(scene, { generator: 'Ekza Animator 0.3.0' })),
      ),
    ).toBe(0);
    const report = await validateGltf(bytes);
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(0);
    const file = await parseGlb(bytes);
    const json = file.json as Json;
    expect(json['asset']).toMatchObject({ generator: 'Ekza Animator 0.3.0', version: '2.0' });
    expect((json['asset'] as Json)['extras']).toEqual({ ekza_model_v1: MODEL });
    expect(json['extensionsUsed']).toEqual(['KHR_materials_unlit']);
    expect(json['extensionsRequired']).toBeUndefined();
    const materials = json['materials'] as Json[];
    expect(materials).toHaveLength(1);
    expect(materials[0]).toMatchObject({
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 },
      extensions: { KHR_materials_unlit: {} },
    });
    // roughnessFactor 1 is the glTF default, which the writer leaves out.
    expect(((materials[0]?.['pbrMetallicRoughness'] ?? {}) as Json)['roughnessFactor'] ?? 1).toBe(1);
    expect(json['samplers']).toEqual([{ magFilter: 9728, minFilter: 9729, wrapS: 33071, wrapT: 33071 }]);
    expect(json['images']).toHaveLength(1);
    expect((json['images'] as Json[])[0]?.['mimeType']).toBe('image/png');
    const reader = new GltfReader(file.json, file.bin);
    const view = (json['bufferViews'] as Json[])[(json['images'] as Json[])[0]?.['bufferView'] as number] as Json;
    const png = readPngRgb(
      file.bin?.subarray(
        view['byteOffset'] as number,
        (view['byteOffset'] as number) + (view['byteLength'] as number),
      ) ?? new Uint8Array(0),
    );
    expect([png.width, png.height]).toEqual([64, 64]);
    // Round trip (E2E-MOD-11 gate at unit level): sample each triangle's UV in the PNG, compare with its face's swatch.
    const primitive = (json['meshes'] as { primitives: { attributes: Record<string, number>; indices: number }[] }[])[0]
      ?.primitives[0];
    if (primitive === undefined) throw new Error('no primitive');
    const uv = reader.readFloat(primitive.attributes['TEXCOORD_0'] as number);
    const indices = reader.readUint(primitive.indices);
    expect(indices.length / 3).toBe(12);
    for (let t = 0; t < 12; t++) {
      const face = Math.floor(t / 2);
      const expected = DEFAULT_16[face === TOP ? 4 : 0]?.srgb ?? [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const v = indices[3 * t + k] as number;
        const x = Math.floor((uv[2 * v] as number) * 64);
        const y = Math.floor((uv[2 * v + 1] as number) * 64);
        const o = 3 * (y * 64 + x);
        for (let c = 0; c < 3; c++)
          expect(Math.abs((png.rgb[o + c] as number) - expected[c]!) / 255).toBeLessThanOrEqual(1 / 255);
      }
    }
    expect(readBackStatic(bytes, scene)).toMatchObject({ ok: true, channels: 1, maxTranslationErrorM: 0 });
    // three.js reads it (the browser's GLTFLoader path, run in Node).
    const loaded = await loadGltfInNode(bytes);
    let meshes = 0;
    loaded.scene.traverse((object) => {
      if ((object as { isMesh?: boolean }).isMesh === true) meshes++;
    });
    expect(meshes).toBe(1);
  });

  it('vertex colour: COLOR_0 float32 VEC3 linear = EOTF(sRGB) within 1e-6, no image', async () => {
    const bytes = await writeStaticGlb(sceneOf([meshNode('Cube', paintedCube(), { colourOutput: 'vertex-colour' })]), {
      generator: 'test',
    });
    expect((await validateGltf(bytes)).errors).toBe(0);
    const file = await parseGlb(bytes);
    const json = file.json as Json;
    expect(json['images']).toBeUndefined();
    const primitive = (json['meshes'] as { primitives: { attributes: Record<string, number>; indices: number }[] }[])[0]
      ?.primitives[0];
    if (primitive === undefined) throw new Error('no primitive');
    const reader = new GltfReader(file.json, file.bin);
    const accessor = reader.accessor(primitive.attributes['COLOR_0'] as number);
    expect([accessor.componentType, accessor.type]).toEqual([5126, 'VEC3']);
    const colour = reader.readFloat(primitive.attributes['COLOR_0'] as number);
    const indices = reader.readUint(primitive.indices);
    for (let t = 0; t < 12; t++) {
      const srgb = DEFAULT_16[Math.floor(t / 2) === TOP ? 4 : 0]?.srgb ?? [0, 0, 0];
      const v = indices[3 * t] as number;
      for (let c = 0; c < 3; c++)
        expect(Math.abs((colour[3 * v + c] as number) - srgbEotf(srgb[c]! / 255))).toBeLessThan(1e-6);
    }
  });

  it('material per colour: one material per used swatch with its linear base colour; lit drops the unlit extension', async () => {
    const bytes = await writeStaticGlb(
      sceneOf([
        meshNode('Cube', paintedCube(), {
          colourOutput: 'material-per-colour',
          materials: [{ preset: 'lit', name: 'Body' }],
        }),
      ]),
      { generator: 'test' },
    );
    expect((await validateGltf(bytes)).errors).toBe(0);
    const json = (await parseGlb(bytes)).json as Json;
    expect(json['extensionsUsed']).toBeUndefined();
    const materials = json['materials'] as { name: string; pbrMetallicRoughness: { baseColorFactor: number[] } }[];
    expect(materials.map((m) => m.name)).toEqual(['Body swatch 0', 'Body swatch 4']);
    const red = materials[1]?.pbrMetallicRoughness.baseColorFactor ?? [];
    expect(red[0]).toBeCloseTo(srgbEotf(0xe0 / 255), 6);
    expect(red[3]).toBe(1);
  });

  it('writes the hierarchy as TRS nodes and the handheld grip block', async () => {
    const child = meshNode('Blade', paintedCube(), { placement: { t: [0, 0.5, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } });
    const group: StaticNode = { id: 'grp_root', name: 'Sword', placement: IDENTITY, mesh: null, children: [child] };
    const bytes = await writeStaticGlb(sceneOf([group], GRIP), { generator: 'test' });
    const json = (await parseGlb(bytes)).json as Json;
    expect(json['nodes']).toEqual([
      { name: 'Sword', children: [1] },
      { name: 'Blade', mesh: 0, translation: [0, 0.5, 0] },
    ]);
    expect(((json['asset'] as Json)['extras'] as Json)['ekza_handheld_v1']).toEqual({
      bone: 'rightHand',
      offset: [0, 0.05, 0],
      rotation_degrees: [0, 90, 0],
      scale: 1,
    });
  });
});

describe('the handheld profile and static lints', () => {
  it('is registered for static exports, with tex.size as an error', () => {
    expect(BUILTIN_EXPORT_PROFILES.map((p) => p.id)).toContain('ekza/omoba-handheld-v1');
    expect(profilesForKind('static-glb').map((p) => p.id)).toEqual(['ekza/omoba-handheld-v1', 'local/generic']);
    expect(PROFILE_OMOBA_HANDHELD.rules.find((r) => r.id === 'tex.size')?.severity).toBe('error');
  });

  it('a clean handheld prop passes with 0 errors and 0 warnings', async () => {
    const scene = sceneOf([meshNode('Blade', paintedCube())], GRIP);
    const artifact = await exportStaticModel(scene, {
      fileName: 'sword.glb',
      profile: PROFILE_OMOBA_HANDHELD,
      generator: 'Ekza Animator 0.3.0',
    });
    expect(artifact.lints).toEqual([]);
    expect(artifact.readBack?.ok).toBe(true);
    expect(artifact.kind).toBe('static-glb');
  });

  it('raises every handheld code on a file made to break it', async () => {
    const polybot = readFixture('polybot.vrm');
    const codes = new Set(
      (await lintExport('static-glb', polybot, PROFILE_OMOBA_HANDHELD)).map((l) => `${l.code}:${l.severity}`),
    );
    expect(codes).toEqual(
      new Set(['ekza.handheld.static:error', 'ekza.handheld.extensions:error', 'ekza.handheld.grip:error']),
    );
    // Limits: 65 nodes, 17 meshes, a non-float POSITION; a grip out of bounds.
    const b = new GltfBuilder();
    const json = b.json as Json;
    const position = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3', { minMax: true });
    const quantized = b.accessor(new Uint16Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]), 'VEC3');
    json['meshes'] = Array.from({ length: 17 }, (_, i) => ({
      primitives: [{ attributes: { POSITION: i === 0 ? quantized : position } }],
    }));
    json['nodes'] = Array.from({ length: 65 }, (_, i) => (i < 17 ? { mesh: i } : {}));
    json['scenes'] = [{ nodes: Array.from({ length: 65 }, (_, i) => i) }];
    (json['asset'] as Json)['extras'] = {
      ekza_handheld_v1: { bone: 'rightHand', offset: [0, 0, 0], rotation_degrees: [0, 0, 0], scale: 3 },
    };
    const lints = await lintExport('static-glb', b.build(), PROFILE_OMOBA_HANDHELD);
    const messages = lints.filter((l) => l.code === 'ekza.handheld.limits').map((l) => l.message);
    expect(messages.some((m) => /65 nodes/.test(m))).toBe(true);
    expect(messages.some((m) => /17 meshes/.test(m))).toBe(true);
    expect(messages.some((m) => /POSITION must be float VEC3/.test(m))).toBe(true);
    expect(lints.find((l) => l.code === 'ekza.handheld.grip')?.message).toMatch(/scale/);
    // Local exports never run the handheld rules.
    expect((await lintExport('static-glb', b.build(), LOCAL)).some((l) => l.code.startsWith('ekza.handheld'))).toBe(
      false,
    );
  });

  it('tex.size: a warning locally, an error for handheld props', async () => {
    const b = new GltfBuilder();
    const json = b.json as Json;
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 5000);
    new DataView(png.buffer).setUint32(20, 8);
    json['images'] = [{ bufferView: b.view(png), mimeType: 'image/png' }];
    json['scenes'] = [{ nodes: [] }];
    (json['asset'] as Json)['extras'] = {
      ekza_handheld_v1: { bone: 'leftHand', offset: [0, 0, 0], rotation_degrees: [0, 0, 0], scale: 1 },
    };
    const bytes = b.build();
    expect((await lintExport('static-glb', bytes, LOCAL)).find((l) => l.code === 'tex.size')?.severity).toBe('warning');
    expect(
      (await lintExport('static-glb', bytes, PROFILE_OMOBA_HANDHELD)).find((l) => l.code === 'tex.size')?.severity,
    ).toBe('error');
  });

  it('nodes: TRS only and positive uniform scales', async () => {
    const mirrored = meshNode('Mirrored', paintedCube(), {
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [-1, 1, 1] },
    });
    const artifact = await exportStaticModel(sceneOf([mirrored]), {
      fileName: 'm.glb',
      profile: LOCAL,
      generator: 'test',
    });
    expect(artifact.lints.find((l) => l.code === 'ekza.positive-uniform-scale')?.severity).toBe('error');
    const b = new GltfBuilder();
    (b.json as Json)['nodes'] = [{ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }];
    (b.json as Json)['scenes'] = [{ nodes: [0] }];
    expect((await lintExport('static-glb', b.build(), LOCAL)).map((l) => l.code)).toContain('ekza.no-matrix-node');
  });

  it('skins: bevy.max-joints, unweighted and unnormalized vertices, skinned node transforms', async () => {
    const b = new GltfBuilder();
    const json = b.json as Json;
    const position = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3', { minMax: true });
    const joints = b.accessor(new Uint16Array(12), 'VEC4');
    const weights = b.accessor(new Float32Array([1, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.2, 0, 0]), 'VEC4');
    json['meshes'] = [{ primitives: [{ attributes: { POSITION: position, JOINTS_0: joints, WEIGHTS_0: weights } }] }];
    json['nodes'] = [{ mesh: 0, skin: 0, translation: [1, 0, 0] }, ...Array.from({ length: 257 }, () => ({}))];
    json['skins'] = [{ joints: Array.from({ length: 257 }, (_, i) => i + 1) }];
    json['scenes'] = [{ nodes: [0] }];
    const codes = (await lintExport('static-glb', b.build(), LOCAL)).map((l) => `${l.code}:${l.severity}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'bevy.max-joints:error',
        'mesh.skinned-node-transform:warning',
        'mesh.unweighted-vertex:error',
        'mesh.weights-unnormalized:error',
      ]),
    );
  });

  it('provenance: attribution, territory clause and free tier', async () => {
    const ai: EkzaModelV1 = {
      ...MODEL,
      provenance: {
        ...MODEL.provenance,
        derivedFrom: [{ title: 'Scan', author: '', license: 'CC-BY-4.0', sourceSha256: null }],
        generator: {
          kind: 'ai',
          digitalSourceType: 'trainedAlgorithmicMedia',
          service: 'example',
          model: 'v1',
          op: 'image-to-3d',
          params: {},
          inputSha256: [],
          termsSnapshot: { territory: 'EU only' },
          rawSha256: '0'.repeat(64),
          postSteps: [],
          promptSha256: null,
          tier: 'free',
        },
      },
    };
    const bytes = await writeStaticGlb(
      { ...sceneOf([meshNode('A', paintedCube())]), model: ai },
      { generator: 'test' },
    );
    const local = (await lintExport('static-glb', bytes, LOCAL)).map((l) => `${l.code}:${l.severity}`);
    expect(local).toEqual(
      expect.arrayContaining([
        'ekza.provenance-attribution:warning',
        'ekza.provenance-territory:warning',
        'ekza.provenance-free-tier:warning',
      ]),
    );
    const ekza = (await lintExport('static-glb', bytes, PROFILE_OMOBA_HANDHELD)).map((l) => `${l.code}:${l.severity}`);
    expect(ekza).toEqual(
      expect.arrayContaining(['ekza.provenance-attribution:error', 'ekza.provenance-territory:error']),
    );
  });
});

describe('mesh lints and budgets', () => {
  const input = (data: MeshData, extra: Partial<MeshLintInput> = {}): MeshLintInput => ({
    id: 'msh_a',
    name: 'A',
    data,
    budget: null,
    swatchSlots: new Set(DEFAULT_16.map((s) => s.slot)),
    materials: 1,
    textureSide: 64,
    joints: 0,
    ...extra,
  });

  it('resolves the budget: the mesh, else the root, else the profile default', () => {
    expect(resolveBudget({ preset: 'npc' }, { preset: 'hero' }, null)?.tris).toBe(1000);
    expect(resolveBudget(null, { tris: 42 }, null)).toEqual({ label: '42 triangles', preset: null, tris: 42 });
    expect(resolveBudget(null, null, PROFILE_OMOBA_HANDHELD)?.label).toBe('handheld');
    expect(resolveBudget(null, null, LOCAL)).toBeNull();
    expect(BUDGET_PRESETS.handheld).toMatchObject({ tris: 600, warnTris: 1500 });
  });

  it('budget, palette, influence and AI-disclosure codes', () => {
    const grid: number[] = [];
    const faces: number[][] = [];
    for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) grid.push(i, 0, j);
    for (let j = 0; j < 20; j++)
      for (let i = 0; i < 20; i++) faces.push([j * 21 + i, (j + 1) * 21 + i, (j + 1) * 21 + i + 1, j * 21 + i + 1]);
    const big = buildMeshData({ positions: grid, faces }); // 800 triangles
    const budget = resolveBudget({ preset: 'handheld' }, null, null);
    const lints = lintMeshes(
      [
        input(big, { budget, materials: 2, textureSide: 256 }),
        input(paintedCube(99), { swatchSlots: new Set([0]), influences: 6, aiGenerated: true }),
      ],
      LOCAL,
      { generatorDisclosed: false },
    );
    expect(lints.map((l) => `${l.code}:${l.severity}`)).toEqual([
      'mesh.budget.tris:info',
      'mesh.budget.materials:info',
      'mesh.budget.textures:info',
      'mesh.influences:warning',
      'palette.missing-swatch:warning',
      'ekza.provenance-ai-undisclosed:error',
    ]);
    expect(lints[0]?.message).toMatch(/800 triangles.*handheld allows 600 \(warn above 1500\)/);
    expect(lintMeshes([input(big, { budget })], PROFILE_OMOBA_HANDHELD)[0]?.severity).toBe('warning');
  });

  it('every code of the §4.5 lint table has the table severities (local / Ekza profile)', () => {
    // Rows of M6A-SPEC §4.5 "Lint codes", one entry per code; null = the rule does not apply ("—").
    const table: readonly [string, string | null, string][] = [
      ['mesh.budget.tris', 'info', 'warning'],
      ['mesh.budget.materials', 'info', 'warning'],
      ['mesh.budget.textures', 'info', 'warning'],
      ['mesh.budget.joints', 'info', 'warning'],
      ['mesh.non-manifold', 'warning', 'warning'],
      ['mesh.zero-area-face', 'warning', 'warning'],
      ['mesh.loose-geometry', 'warning', 'warning'],
      ['mesh.inconsistent-winding', 'warning', 'warning'],
      ['mesh.nonplanar-faceted', 'info', 'warning'],
      ['mesh.ngon-concave', 'info', 'warning'],
      ['mesh.influences', 'warning', 'error'],
      ['mesh.weights-unnormalized', 'error', 'error'],
      ['mesh.unweighted-vertex', 'error', 'error'],
      ['mesh.skinned-node-transform', 'warning', 'warning'],
      ['mesh.tangents-dropped', 'info', 'warning'],
      ['palette.missing-swatch', 'warning', 'warning'],
      ['ekza.positive-uniform-scale', 'error', 'error'],
      ['ekza.no-matrix-node', 'error', 'error'],
      ['tex.size', 'warning', 'warning'],
      ['ekza.handheld.static', null, 'error'],
      ['ekza.handheld.extensions', null, 'error'],
      ['ekza.handheld.grip', null, 'error'],
      ['ekza.handheld.limits', null, 'error'],
      ['bevy.max-joints', 'error', 'error'],
      ['ekza.provenance-ai-undisclosed', 'error', 'error'],
      ['ekza.provenance-attribution', 'warning', 'error'],
      ['ekza.provenance-territory', 'warning', 'error'],
      ['ekza.provenance-free-tier', 'warning', 'warning'],
    ];
    const ekza = { ...LOCAL, ekza: true, rules: [] } as ExportProfileDef;
    const plain = { ...LOCAL, ekza: false, rules: [] } as ExportProfileDef;
    for (const [code, local, onEkza] of table) {
      expect([code, ruleSeverity(code, plain), ruleSeverity(code, ekza)]).toEqual([code, local, onEkza]);
    }
    // "error for the handheld profile" (§4.5 tex.size row) through the profile's override.
    expect(ruleSeverity('tex.size', PROFILE_OMOBA_HANDHELD)).toBe('error');
  });

  it('mesh.budget.joints: a skinned character over its preset joints', () => {
    const lints = lintMeshes(
      [input(paintedCube(), { budget: resolveBudget({ preset: 'hero' }, null, null), joints: 52 })],
      LOCAL,
    );
    expect(lints.map((l) => `${l.code}:${l.severity}`)).toEqual(['mesh.budget.joints:info']);
    expect(lints[0]?.message).toMatch(/52 joints; hero allows 33/);
  });

  describe.skipIf(!READY.b5)('Mesh Check lints, one fixture per code (READY.b5)', () => {
    const codesOf = (data: MeshData): string[] => lintMeshes([input(data)], LOCAL).map((l) => l.code);
    it('mesh.non-manifold: an edge with three faces', () => {
      const fin = buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1],
        faces: [
          [0, 1, 2],
          [1, 0, 3],
          [0, 1, 4],
        ],
      });
      expect(codesOf(fin)).toContain('mesh.non-manifold');
    });
    it('mesh.zero-area-face: three collinear points', () => {
      expect(codesOf(buildMeshData({ positions: [0, 0, 0, 1, 0, 0, 2, 0, 0], faces: [[0, 1, 2]] }))).toContain(
        'mesh.zero-area-face',
      );
    });
    it('mesh.loose-geometry: a vertex without edges', () => {
      expect(codesOf(buildMeshData({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5], faces: [[0, 1, 2]] }))).toContain(
        'mesh.loose-geometry',
      );
    });
    it('mesh.inconsistent-winding: neighbours traverse their shared edge the same way', () => {
      // Both triangles walk the diagonal from 2 to 0.
      const flipped = buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
        faces: [
          [0, 1, 2],
          [2, 0, 3],
        ],
      });
      expect(codesOf(flipped)).toContain('mesh.inconsistent-winding');
    });
    it('mesh.nonplanar-faceted: a warped pentagon with hard edges', () => {
      const warped = buildMeshData({
        positions: [0, 0, 0, 1, 0, 0.5, 1.5, 1, 0, 0.5, 1.6, 0.5, -0.5, 1, 0],
        faces: [[0, 1, 2, 3, 4]],
        edgeFlags: EDGE_HARD,
      });
      expect(codesOf(warped)).toContain('mesh.nonplanar-faceted');
    });
    it('mesh.ngon-concave: a pentagon with a reflex corner', () => {
      const concave = buildMeshData({
        positions: [0, 0, 0, 2, 0, 0, 2, 2, 0, 1, 0.5, 0, 0, 2, 0],
        faces: [[0, 1, 2, 3, 4]],
      });
      expect(codesOf(concave)).toContain('mesh.ngon-concave');
    });
  });
});

describe('static read-back', () => {
  it('fails on a file that does not reproduce the scene', async () => {
    const scene = sceneOf([meshNode('Cube', paintedCube())]);
    const other = await writeStaticGlb(sceneOf([meshNode('Cube', cubeData()), meshNode('Two', cubeData())]), {
      generator: 'test',
    });
    expect(readBackStatic(other, scene).ok).toBe(false);
    expect(readBackStatic(makeGlb({ asset: { version: '2.0' } }, null), scene).ok).toBe(false);
    expect(readBackStatic(new Uint8Array(4), scene).ok).toBe(false);
  });
});
