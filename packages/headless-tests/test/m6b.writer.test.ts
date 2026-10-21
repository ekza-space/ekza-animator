// M6B-SPEC §5.22, §0.4.6, §0.4.8, §9.0 C10 (headless, the production kernel with glTF-Validator): a model character
// made in the app (the generated body, `char.fromModel`, the Standard 33 truth joints, bound, rigged), shaded with a
// Blinn swatch (Assign New Material), VRM meta CC0, a rendered thumbnail and an idle slot clip —
// - exported with `ekza/space-avatar-v1`: VRM 1.0, glTF-Validator and vrm-validator 0 errors, every vrm.* lint clean,
//   KHR_materials_specular in extensionsUsed only, read-back equal on the joint subset, the idle clip read back;
// - P-W2: exporting twice, and again after `.ekzanim` save and reopen, gives byte-identical files (VRM and GLB);
// - `local/generic` + GLB: no VRMC_vrm, no vrm.* row;
// - the shipped asset bake keeps passing: the VRM 0.x Polybot bake with the Space profile has no vrm.* row.
import type { ClipId } from '@ekza-studio/doc';
import { loadMeshKernel } from '@ekza-studio/editor-core';
import { type CharacterReadBack, type ExportArtifact, type ExportRequest, parseGlb } from '@ekza-studio/io';
import { beforeAll, describe, expect, it } from 'vitest';
import { importFixture, realApp, runOk } from './ops.support';
import { exportCharacter, readyCharacter, settled, vrmErrors } from './m6b.writer.support';

type Json = Record<string, unknown>;
const SPACE = 'ekza/space-avatar-v1';

beforeAll(async () => {
  await loadMeshKernel();
});

describe('the character writer in the app (§5.22, P-W2)', { timeout: 180_000 }, () => {
  it('VRM 1.0 for Space and OMOBA: validators 0 errors, vrm.* clean, Blinn used-only, read-back equal', async () => {
    const { app } = realApp();
    const { character } = await readyCharacter(app);
    const artifact = await exportCharacter(app, { character, profile: SPACE, format: 'vrm', clips: 'slots' });
    expect(artifact.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    expect(artifact.lints.filter((lint) => lint.code.startsWith('vrm.'))).toEqual([]);
    expect(artifact.validation?.errors).toBe(0);
    expect(await vrmErrors(artifact.bytes)).toEqual([]);
    const json = (await parseGlb(artifact.bytes)).json as unknown as Json;
    expect(json['extensionsUsed']).toContain('KHR_materials_specular');
    expect(json['extensionsRequired']).toBeUndefined();
    const vrmc = (json['extensions'] as Json)['VRMC_vrm'] as Json;
    expect(vrmc['specVersion']).toBe('1.0');
    expect((vrmc['meta'] as Json)['authors']).toEqual(['Tester']);
    expect((json['animations'] as Json[]).map((a) => a['name'])).toEqual(['idle']);
    const readBack = artifact.readBack as CharacterReadBack;
    expect(readBack.problems).toEqual([]);
    expect(readBack).toMatchObject({ ok: true, animations: 1, joints: 34, humanoid: 33, humanoidEqual: true });
    expect(readBack.tris).toBe(readBack.expectedTris);
  });

  it('P-W2: twice and after .ekzanim save/reopen → byte-identical (VRM and GLB)', async () => {
    const { app, services } = realApp();
    const { character } = await readyCharacter(app);
    const vrm = await exportCharacter(app, { character });
    const glb = await exportCharacter(app, { character, profile: 'local/generic', format: 'glb' });
    expect((await exportCharacter(app, { character })).sha256).toBe(vrm.sha256);
    await runOk(app, 'file.save');
    const project = services.downloads.at(-1);
    const { app: other } = realApp({ seed: 99 });
    await runOk(other, 'file.openProject', { name: project?.fileName, bytes: project?.bytes });
    await settled(other);
    expect((await exportCharacter(other, { character })).sha256).toBe(vrm.sha256);
    expect((await exportCharacter(other, { character, profile: 'local/generic', format: 'glb' })).sha256).toBe(
      glb.sha256,
    );
  });

  it('local/generic + GLB: no VRMC_vrm, no vrm.* row, glTF-Validator 0 errors', async () => {
    const { app } = realApp();
    const { character } = await readyCharacter(app);
    const artifact = await exportCharacter(app, { character, profile: 'local/generic', format: 'glb' });
    expect(artifact.fileName).toBe('Body_Lad.glb');
    const json = (await parseGlb(artifact.bytes)).json as unknown as Json;
    expect(json['extensions']).toBeUndefined();
    expect(artifact.lints.filter((lint) => lint.code.startsWith('vrm.'))).toEqual([]);
    expect(artifact.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    expect(artifact.validation?.errors).toBe(0);
  });

  it('asset-sourced Space bakes keep passing: the VRM 0.x Polybot bake has no vrm.* row', async () => {
    const { app } = realApp();
    const bot = await importFixture(app, 'polybot.vrm');
    const { clip } = (await runOk(app, 'clip.new', {
      character: bot.character,
      name: 'wave',
      range: { start: 0, end: 30 },
    })) as {
      clip: ClipId;
    };
    await runOk(app, 'clip.setSettings', { clip, slot: 'wave' });
    const request: ExportRequest = {
      kind: 'bake-into-model',
      character: bot.character,
      clips: [clip],
      fileNamePattern: '{character}',
      closeLoop: false,
      includeConstantTracks: true,
      acknowledgeLicense: false,
      profile: SPACE,
    };
    const [artifact] = (await runOk(app, 'file.export', request)) as ExportArtifact[];
    expect(artifact?.lints.filter((lint) => lint.code.startsWith('vrm.'))).toEqual([]);
    expect(artifact?.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
  });
});
