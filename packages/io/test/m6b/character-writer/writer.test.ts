// M6B-SPEC §5.22, §0.4.6, §0.4.8 (C10, io): the VRM 1.0 / GLB character writer —
// - VRMC_vrm 1.0 with the humanoid map, the meta from the record (licence presets, licenseUrl, thirdPartyLicenses
//   from provenance) and the thumbnail image; glTF-Validator and vrm-validator 0 errors; every vrm.* lint clean;
// - plain GLB: no VRMC_vrm; the Space profile refuses it (vrm.spec-version), local/generic has no vrm.* row;
// - swatch shaders: Blinn → KHR_materials_specular in extensionsUsed only (used-only), Lambert-only writes none;
// - clips: one animation per slot clip with ekza_animation_v1, read back within tolerance;
// - P-W1 read-back (joint subset, humanoid, fingerprint, tris) on the generated body, the Cube Lad, Polybot
//   (unskinned, T-pose) and a records copy of Seed-san; P-W2 determinism (VRM and GLB);
// - the thumbnail renderer: square 1024 PNG, deterministic, the character drawn.
import { makeVrmMeta } from '@ekza-studio/doc';
import { makeTestSkeleton } from '@ekza-studio/doc/testing';
import { humanoidBody } from '@ekza-studio/mesh-core';
import { describe, expect, it } from 'vitest';
import {
  CC0_DEED_URL,
  CC_BY_DEED_URL,
  characterVertices,
  exportCharacterArtifact,
  lintExport,
  parseGlb,
  patchVrmMeta,
  pngSize,
  readBackCharacter,
  renderCharacterThumbnail,
  skeletonFromDoc,
  skeletonFromGltf,
  VRM_LICENSE_URL,
  writeCharacter,
} from '../../../src';
import { BUILTIN_EXPORT_PROFILES } from '../../../src/profiles/builtin';
import { readBackCheckSync } from '../../../src/validate/readBack';
import type { ExportProfileDef } from '../../../src/types';
import { docCopyOf } from '../character-runtime/support';
import {
  animationMeta,
  bakedTurn,
  character,
  fixture,
  gltfErrors,
  meshOf,
  polybotJoints,
  testMeta,
  vrmErrors,
} from './support';

type Json = Record<string, unknown>;
const SPACE = BUILTIN_EXPORT_PROFILES.find((p) => p.id === 'ekza/space-avatar-v1') as ExportProfileDef;
const LOCAL = BUILTIN_EXPORT_PROFILES.find((p) => p.id === 'local/generic') as ExportProfileDef;
const THUMB = renderCharacterThumbnail([], new Map(), 64);
const body = () => humanoidBody({ style: 'smooth', height: 1.7 });

async function jsonOf(bytes: Uint8Array): Promise<Json> {
  return (await parseGlb(bytes)).json;
}

describe('VRM 1.0 (format vrm)', () => {
  it('writes VRMC_vrm 1.0: humanoid, CC0 meta, thumbnail; validators and vrm.* lints clean', async () => {
    const { write } = await character([{ name: 'Body', data: body(), bound: true }], { thumbnailPng: THUMB });
    const bytes = await writeCharacter(write, { generator: 'Ekza Studio test', format: 'vrm' });
    const json = await jsonOf(bytes);
    const vrmc = (json['extensions'] as Json)['VRMC_vrm'] as Json;
    expect(vrmc['specVersion']).toBe('1.0');
    expect(Object.keys((vrmc['humanoid'] as Json)['humanBones'] as Json)).toHaveLength(33);
    expect(vrmc['meta']).toEqual({
      name: 'Lad',
      authors: ['Tester'],
      thumbnailImage: 1,
      licenseUrl: VRM_LICENSE_URL,
      avatarPermission: 'everyone',
      allowExcessivelyViolentUsage: false,
      allowExcessivelySexualUsage: false,
      commercialUsage: 'corporation',
      allowPoliticalOrReligiousUsage: false,
      allowAntisocialOrHateUsage: false,
      creditNotation: 'unnecessary',
      allowRedistribution: true,
      modification: 'allowModificationRedistribution',
      otherLicenseUrl: CC0_DEED_URL,
    });
    const images = json['images'] as Json[];
    expect(images[1]).toMatchObject({ name: 'thumbnail', mimeType: 'image/png' });
    expect(json['extensionsRequired']).toBeUndefined();
    expect(json['extensionsUsed']).toEqual(['KHR_materials_unlit', 'VRMC_vrm']);
    expect(JSON.stringify(json)).not.toMatch(/"uri"/i);
    expect(await gltfErrors(bytes)).toEqual([]);
    expect(await vrmErrors(bytes)).toEqual([]);
    const lints = await lintExport('bake-into-model', bytes, SPACE);
    expect(lints.filter((lint) => lint.code.startsWith('vrm.'))).toEqual([]);
    expect(lints.filter((lint) => lint.severity === 'error')).toEqual([]);
  });

  it('vrm-validator is live: it reports a VRM 1.0 meta without authors (the 0-errors gates above mean something)', async () => {
    const { write } = await character([{ name: 'Body', data: body(), bound: true }], {
      vrm: { ...testMeta(), authors: [] },
    });
    const errors = await vrmErrors(await writeCharacter(write, { generator: 't', format: 'vrm' }));
    expect(errors.some((error) => error.includes('/authors'))).toBe(true);
  });

  it('without a thumbnail: vrm.thumbnail-square warns; without meta: the meta rows block the Space profile', async () => {
    const noThumb = await character([{ name: 'Body', data: body(), bound: true }]);
    const a = await lintExport(
      'bake-into-model',
      await writeCharacter(noThumb.write, { generator: 't', format: 'vrm' }),
      SPACE,
    );
    expect(a.filter((l) => l.code.startsWith('vrm.')).map((l) => [l.code, l.severity])).toEqual([
      ['vrm.thumbnail-square', 'warning'],
    ]);
    const noMeta = await character([{ name: 'Body', data: body(), bound: true }], { vrm: null });
    const b = await lintExport(
      'bake-into-model',
      await writeCharacter(noMeta.write, { generator: 't', format: 'vrm' }),
      SPACE,
    );
    expect(b.filter((l) => l.severity === 'error').map((l) => l.code)).toEqual([
      'vrm.meta-required',
      'vrm.licence-unset',
    ]);
  });

  it('licence presets: CC BY 4.0, Personal (the schema defaults), Custom keeps edits; editing a preset field makes it Custom', () => {
    const base = makeVrmMeta('Lad', { authors: ['A'] });
    expect(patchVrmMeta(base, { licensePreset: 'cc-by-4.0' })).toMatchObject({
      avatarPermission: 'everyone',
      commercialUsage: 'corporation',
      modification: 'allowModificationRedistribution',
      allowRedistribution: true,
      creditNotation: 'required',
      otherLicenseUrl: CC_BY_DEED_URL,
      allowExcessivelyViolentUsage: false,
    });
    const personal = patchVrmMeta(patchVrmMeta(base, { licensePreset: 'cc0' }), { licensePreset: 'personal' });
    expect(personal).toMatchObject({
      avatarPermission: 'onlyAuthor',
      commercialUsage: 'personalNonProfit',
      modification: 'prohibited',
      allowRedistribution: false,
      creditNotation: 'required',
      otherLicenseUrl: '',
    });
    const custom = patchVrmMeta(patchVrmMeta(base, { licensePreset: 'cc0' }), { licensePreset: 'custom' });
    expect(custom.avatarPermission).toBe('everyone');
    const edited = patchVrmMeta(patchVrmMeta(base, { licensePreset: 'cc0' }), { commercialUsage: 'personalProfit' });
    expect(edited.licensePreset).toBe('custom');
    // A violence flag is not a preset field: the preset stays.
    expect(patchVrmMeta(personal, { allowExcessivelyViolentUsage: true }).licensePreset).toBe('personal');
  });

  it('fills thirdPartyLicenses from the clips provenance when the meta leaves it empty', async () => {
    const clip = bakedTurn('walk', 2);
    const { write } = await character([{ name: 'Body', data: body(), bound: true }]);
    const artifact = await exportCharacterArtifact({
      write: { ...write, clips: [{ name: 'walk', fps: 30, loop: true, tracks: clip.tracks }] },
      baked: [clip],
      format: 'vrm',
      fileName: 'lad.vrm',
      profile: SPACE,
      generator: 't',
      animationMeta: animationMeta([clip]),
    });
    const meta = ((await jsonOf(artifact.bytes))['extensions'] as Json)['VRMC_vrm'] as Json;
    expect((meta['meta'] as Json)['thirdPartyLicenses']).toBe('Universal Animation Library by Quaternius (CC0-1.0)');
  });
});

describe('plain GLB (format glb) and the profiles', () => {
  it('writes no VRMC_vrm; local/generic has no vrm.* row; the Space profile fails vrm.spec-version', async () => {
    const { write } = await character([{ name: 'Body', data: body(), bound: true }]);
    const bytes = await writeCharacter(write, { generator: 't', format: 'glb' });
    const json = await jsonOf(bytes);
    expect(json['extensions']).toBeUndefined();
    expect(json['extensionsUsed']).toEqual(['KHR_materials_unlit']);
    expect(await gltfErrors(bytes)).toEqual([]);
    expect((await lintExport('bake-into-model', bytes, LOCAL)).filter((l) => l.code.startsWith('vrm.'))).toEqual([]);
    expect(
      (await lintExport('bake-into-model', bytes, SPACE)).filter((l) => l.code.startsWith('vrm.')).map((l) => l.code),
    ).toEqual(['vrm.spec-version']);
  });
});

describe('swatch shaders (SHADING-SPEC §4, §0.4.8)', () => {
  it('a Blinn swatch on a lit mesh writes KHR_materials_specular, used only; Lambert-only lit meshes write none', async () => {
    const blinn = await character([{ name: 'Body', data: body(), bound: true }], {
      preset: 'lit',
      swatches: [
        { slot: 0, srgb: [200, 120, 80], shader: { shader: 'blinn', glossiness: 0.6, specular: [255, 255, 255] } },
      ],
    });
    const bytes = await writeCharacter(blinn.write, { generator: 't', format: 'vrm' });
    const json = await jsonOf(bytes);
    expect(json['extensionsUsed']).toEqual(['KHR_materials_specular', 'VRMC_vrm']);
    expect(json['extensionsRequired']).toBeUndefined();
    const material = (json['materials'] as Json[])[0] as Json;
    expect(material['name']).toBe('Palette blinn g60');
    expect((material['pbrMetallicRoughness'] as Json)['roughnessFactor']).toBeCloseTo(0.4, 6);
    expect(await gltfErrors(bytes)).toEqual([]);
    expect(await vrmErrors(bytes)).toEqual([]);
    const lambert = await character([{ name: 'Body', data: body(), bound: true }], { preset: 'lit' });
    const plain = await jsonOf(await writeCharacter(lambert.write, { generator: 't', format: 'vrm' }));
    expect(plain['extensionsUsed']).toEqual(['VRMC_vrm']);
  });

  it('VRM forces the palette texture (MToon ignores vertex colours); GLB keeps the mesh output', async () => {
    const { write } = await character([{ name: 'Body', data: body(), bound: true }], { colourOutput: 'vertex-colour' });
    const vrm = await jsonOf(await writeCharacter(write, { generator: 't', format: 'vrm' }));
    const glb = await jsonOf(await writeCharacter(write, { generator: 't', format: 'glb' }));
    const attributes = (json: Json) =>
      Object.keys(((((json['meshes'] as Json[])[0] as Json)['primitives'] as Json[])[0] as Json)['attributes'] as Json);
    expect(attributes(vrm)).toContain('TEXCOORD_0');
    expect(attributes(vrm)).not.toContain('COLOR_0');
    expect(attributes(glb)).toContain('COLOR_0');
  });
});

describe('clips', () => {
  it('one animation per clip on the joint nodes, ekza_animation_v1, read back within tolerance', async () => {
    const walk = bakedTurn('walk', 3, 30, { slot: 'walk' });
    const idle = bakedTurn('idle', 5, 10, { slot: 'idle' });
    const { write } = await character([{ name: 'Body', data: body(), bound: true }]);
    const artifact = await exportCharacterArtifact({
      write: {
        ...write,
        clips: [walk, idle].map((clip) => ({ name: clip.name, fps: 30, loop: true, tracks: clip.tracks })),
      },
      baked: [walk, idle],
      format: 'vrm',
      fileName: 'lad.vrm',
      profile: SPACE,
      generator: 't',
      animationMeta: animationMeta([walk, idle]),
    });
    const json = await jsonOf(artifact.bytes);
    const animations = json['animations'] as Json[];
    expect(animations.map((a) => a['name'])).toEqual(['walk', 'idle']);
    expect(((animations[0] as Json)['channels'] as Json[])[0]).toMatchObject({ target: { node: 3, path: 'rotation' } });
    const meta = ((json['asset'] as Json)['extras'] as Json)['ekza_animation_v1'] as Json;
    expect((meta['clips'] as Json[]).map((c) => [c['index'], c['name'], c['slot']])).toEqual([
      [0, 'walk', 'walk'],
      [1, 'idle', 'idle'],
    ]);
    expect(artifact.readBack).toMatchObject({ ok: true, animations: 2, channels: 2, kind: 'character' });
    expect(artifact.lints.filter((l) => l.severity === 'error')).toEqual([]);
    expect(artifact.stats).toEqual({ clips: 2, channels: 2, keys: 42 });
    expect(await gltfErrors(artifact.bytes)).toEqual([]);
    expect(await vrmErrors(artifact.bytes)).toEqual([]);
    expect(readBackCheckSync('bake-into-model', artifact.bytes, [walk, idle], write.skeleton).ok).toBe(true);
  });
});

describe('P-W1 read-back on the joint subset', () => {
  it.each([
    ['the generated body (smooth)', async () => body(), undefined],
    ['the generated body (segmented)', async () => humanoidBody({ style: 'segmented', height: 1.7 }), undefined],
    ['the Cube Lad', () => meshOf('cube-lad.glb'), undefined],
    ['Polybot (unskinned, T-pose)', () => meshOf('polybot-unskinned-tpose.glb'), polybotJoints],
  ] as const)('%s', async (_, make, joints) => {
    const data = await make();
    const { write } = await character(
      [
        { name: 'Body', data, bound: true },
        { name: 'Hat', data: humanoidBody({ style: 'segmented', height: 0.2 }), bound: false },
      ],
      joints === undefined ? { thumbnailPng: THUMB } : { thumbnailPng: THUMB, joints: joints() },
    );
    for (const format of ['vrm', 'glb'] as const) {
      const bytes = await writeCharacter(write, { generator: 't', format });
      const back = readBackCharacter(bytes, write.skeleton, write.meshes, []);
      expect(back.problems).toEqual([]);
      expect(back).toMatchObject({
        ok: true,
        jointsEqual: true,
        humanoidEqual: format === 'vrm' ? true : null,
        fingerprintEqual: true,
        joints: write.skeleton.nodes.length,
        vrm: format === 'vrm' ? '1.0' : null,
      });
      expect(back.tris).toBe(back.expectedTris);
      expect(back.humanoid).toBe(format === 'vrm' ? Object.keys(write.skeleton.humanoid ?? {}).length : 0);
      expect(await gltfErrors(bytes)).toEqual([]);
      // VRM: vrm-validator and the vrm.* rows of the Space profile; a plain GLB through local/generic has none.
      expect(format === 'vrm' ? await vrmErrors(bytes) : []).toEqual([]);
      const lints = await lintExport('bake-into-model', bytes, format === 'vrm' ? SPACE : LOCAL);
      expect(lints.filter((l) => l.code.startsWith('vrm.'))).toEqual([]);
    }
  });

  it('a records copy of Seed-san reads back equal on the joint subset', async () => {
    const container = await parseGlb(fixture('seed-san.vrm'));
    const copy = await docCopyOf(container, skeletonFromGltf(container));
    const meshes = copy.input.meshes.map((mesh, i) => ({
      id: mesh.id,
      name: `Mesh ${i}`,
      data: mesh.data,
      skin: mesh.skin,
      materials: [{ preset: 'unlit' as const, name: 'Palette' }],
      colourOutput: 'palette-texture' as const,
      paletteId: null,
      prop: false,
    }));
    // The radii are measured on the writer's vertex layout (M6B-C1-2).
    const vertices = characterVertices(await import('../../../src/mesh'), meshes, new Map());
    const desc = skeletonFromDoc(copy.input, { vertices });
    const write = {
      skeleton: desc,
      joints: copy.input.joints,
      meshes,
      palettes: new Map(),
      clips: [],
      vrm: testMeta(),
      thumbnailPng: THUMB,
      model: {
        schema: 1 as const,
        rig: 'vrm-humanoid' as const,
        skeletonTemplate: null,
        provenance: {
          tool: 'ekza-animator' as const,
          toolVersion: 't',
          projectSha256: null,
          derivedFrom: [],
          generator: { kind: 'manual' as const },
        },
      },
      heightScale: null,
    };
    const bytes = await writeCharacter(write, { generator: 't', format: 'vrm' });
    const back = readBackCharacter(bytes, desc, meshes, []);
    expect(back.problems).toEqual([]);
    expect(back.ok).toBe(true);
    expect(await gltfErrors(bytes)).toEqual([]);
  });
});

describe('P-W2 determinism', () => {
  it('the same records give the same bytes (VRM and GLB, with clips and a thumbnail)', async () => {
    const walk = bakedTurn('walk', 3);
    const make = async () =>
      (
        await character([{ name: 'Body', data: body(), bound: true }], {
          thumbnailPng: THUMB,
          clips: [{ name: 'walk', fps: 30, loop: true, tracks: walk.tracks }],
        })
      ).write;
    for (const format of ['vrm', 'glb'] as const) {
      const a = await writeCharacter(await make(), { generator: 't', format });
      const b = await writeCharacter(await make(), { generator: 't', format });
      expect(b).toEqual(a);
    }
  });
});

describe('the thumbnail renderer', () => {
  it('renders a square PNG, deterministically, with the character over the background', async () => {
    const { write } = await character([{ name: 'Body', data: await meshOf('cube-lad.glb'), bound: true }]);
    const t0 = performance.now();
    const png = renderCharacterThumbnail(write.meshes, write.palettes);
    const ms = performance.now() - t0;
    expect(pngSize(png)).toEqual({ width: 1024, height: 1024 });
    expect(renderCharacterThumbnail(write.meshes, write.palettes)).toEqual(png);
    // The empty scene compresses to almost nothing; the character adds detail.
    expect(png.length).toBeGreaterThan(THUMB.length * 4);
    expect(ms).toBeLessThan(20_000);
    // An empty skeleton still renders (the background only).
    const empty = renderCharacterThumbnail([], new Map(), 32);
    expect(pngSize(empty)).toEqual({ width: 32, height: 32 });
    expect(makeTestSkeleton('skl', 'chr').id).toBe('skl');
  });
});
