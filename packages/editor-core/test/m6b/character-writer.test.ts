// M6B-SPEC §5.22, §0.4.6, §6.1, §6.4 (C10, editor-core): `char.setVrmMeta` (one step, licence presets, edits make the
// licence custom, refusals), `char.renderThumbnail` (one step, a square 1024 PNG thumbnail asset by hash),
// `file.exportCharacter` (defaults, profile routing, the VRM meta rows gate the Space profile, slot clips through the
// kernel, read-back, download only without errors, no document change, determinism, keys hash unchanged).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  type CharacterId,
  fractionalIndex,
  type HumanBoneName,
  type JointId,
  type JointRecord,
  type MeshId,
  type SkeletonId,
} from '@ekza-studio/doc';
import { type CharacterReadBack, type ExportArtifact, parseGlb, pngSize } from '@ekza-studio/io';
import { type SkinWeights, withSkin } from '@ekza-studio/mesh-core';
import { describe, expect, it } from 'vitest';
import type { EditorApp } from '../../src';
import type { KernelCharacters } from '../../src/characters/registry';
import { characterExportRows, normalizeCharacterRequest } from '../../src/workflows/exportCharacter';
import { type MeshTestApp, meshTestApp } from '../mesh/support';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../fixtures/models/${name}`, import.meta.url)));
const TRUTH = JSON.parse(new TextDecoder().decode(fixture('cube-lad-truth.json'))) as {
  readonly joints: Readonly<
    Record<string, { readonly position: readonly [number, number, number]; readonly parent: string | null }>
  >;
};

async function ok<T = unknown>(app: EditorApp, id: string, args?: unknown): Promise<T> {
  const result = await app.runUntyped(id, args);
  if (result.status !== 'finished') throw new Error(`${id}: ${JSON.stringify(result)}`);
  return result.value as T;
}

async function refused(app: EditorApp, id: string, args?: unknown): Promise<string> {
  const result = await app.runUntyped(id, args);
  if (result.status === 'finished') throw new Error(`${id} finished`);
  return result.status === 'cancelled' ? result.reason : result.error.message;
}

const keysHash = (app: EditorApp) => {
  const tables = app.store.snapshot().tables;
  return createHash('sha256')
    .update(JSON.stringify([tables['curves'], tables['keys']]))
    .digest('hex');
};

/** The Cube Lad as a model character: the truth Standard 33 joints, bound to the nearest joint, with its control rig. */
async function riggedLad(): Promise<{ t: MeshTestApp; character: CharacterId; skeleton: SkeletonId; mesh: MeshId }> {
  const t = await meshTestApp();
  const { meshes } = await ok<{ meshes: MeshId[] }>(t.app, 'mesh.importStatic', {
    bytes: fixture('cube-lad.glb'),
    name: 'lad.glb',
  });
  const made = await ok<{ character: CharacterId; skeleton: SkeletonId }>(t.app, 'char.fromModel', {
    objects: meshes,
    name: 'Cube Lad',
  });
  t.app.store.transact({ label: 'joints (test)' }, (tx) => {
    let order: string | null = null;
    for (const [key, joint] of Object.entries(TRUTH.joints)) {
      order = fractionalIndex(order, null);
      const record: JointRecord = {
        id: `jnt_${key}` as JointId,
        skeleton: made.skeleton,
        parent: joint.parent === null ? null : (`jnt_${joint.parent}` as JointId),
        order,
        name: key,
        humanBone: key === 'root' ? null : (key as HumanBoneName),
        restPosition: [...joint.position],
        restRotation: [0, 0, 0, 1],
        tail: null,
        side: key.startsWith('left') ? 'L' : key.startsWith('right') ? 'R' : 'C',
        mirror: null,
        deleted: null,
        role: key === 'root' ? 'helper' : 'bone',
        key,
      };
      tx.put('joints', record);
    }
  });
  const mesh = t.app.store.query.meshesOfOwner(made.character)[0]?.id as MeshId;
  const data = t.app.meshes.get(mesh)?.data();
  if (data === null || data === undefined) throw new Error('mesh not ready');
  const joints = t.app.store.query.jointsOfSkeleton(made.skeleton).filter((joint) => joint.role === 'bone');
  const P = data.counts.points;
  const ji = new Uint16Array(4 * P);
  const w = new Float32Array(4 * P);
  for (let p = 0; p < P; p++) {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    joints.forEach((joint, j) => {
      const d = Math.hypot(...joint.restPosition.map((v, k) => v - (data.position[3 * p + k] as number)));
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    ji[4 * p] = best;
    w[4 * p] = 1;
  }
  const skin: SkinWeights = {
    points: P,
    palette: joints.map((joint) => ({ key: joint.id, parent: joint.parent, mirror: null })),
    joints: ji,
    weights: w,
  };
  t.app.store.transact({ label: 'bind (test)' }, (tx) => {
    t.meshes.writeData(tx, mesh, withSkin(data, skin));
    tx.patch('meshes', mesh, { skin: { skeleton: made.skeleton, bind: null } });
  });
  await ok(t.app, 'rig.autoRig.update', { character: made.character });
  await (t.app.characters as KernelCharacters).settled();
  return { t, character: made.character, skeleton: made.skeleton, mesh };
}

/** A ready-to-export lad: CC0 meta with an author and a rendered thumbnail. */
async function readyLad() {
  const lad = await riggedLad();
  await ok(lad.t.app, 'char.setVrmMeta', {
    character: lad.character,
    patch: { authors: ['Tester'], licensePreset: 'cc0' },
  });
  await ok(lad.t.app, 'char.renderThumbnail', { character: lad.character });
  return lad;
}

/** An idle clip with the slot 'idle', keyed at frames 0 and 30 on every control. */
async function idleClip(app: EditorApp, character: CharacterId): Promise<string> {
  const { clip } = await ok<{ clip: string }>(app, 'clip.new', { character, name: 'Idle' });
  await ok(app, 'clip.setSettings', { clip, slot: 'idle', loop: true, range: { start: 0, end: 30 } });
  await ok(app, 'key.set', { target: 'character' });
  return clip;
}

describe('char.setVrmMeta (§5.22, §6.1)', () => {
  it('one undo step; the CC0 preset sets its fields; a preset field edit makes the licence custom', async () => {
    const { t, character } = await riggedLad();
    expect(t.app.store.get('characters', character)?.vrm).toBeNull();
    const steps = t.app.history.peekUndo()?.id;
    await ok(t.app, 'char.setVrmMeta', { character, patch: { authors: ['Tester'], licensePreset: 'cc0' } });
    expect(t.app.history.peekUndo()?.label).toBe('VRM Meta');
    expect(t.app.store.get('characters', character)?.vrm).toMatchObject({
      name: 'Cube Lad',
      authors: ['Tester'],
      licensePreset: 'cc0',
      avatarPermission: 'everyone',
      commercialUsage: 'corporation',
      modification: 'allowModificationRedistribution',
      allowRedistribution: true,
      creditNotation: 'unnecessary',
      otherLicenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      allowExcessivelyViolentUsage: false,
    });
    await ok(t.app, 'char.setVrmMeta', { character, patch: { creditNotation: 'required' } });
    expect(t.app.store.get('characters', character)?.vrm?.licensePreset).toBe('custom');
    await ok(t.app, 'edit.undo');
    await ok(t.app, 'edit.undo');
    expect(t.app.history.peekUndo()?.id).toBe(steps);
    expect(t.app.store.get('characters', character)?.vrm).toBeNull();
  });

  it('refuses unknown fields, bad values and imported avatars; without a patch it opens the dialog (no step)', async () => {
    const { t, character } = await riggedLad();
    expect(await refused(t.app, 'char.setVrmMeta', { character, patch: { colour: 'red' } })).toBe(
      'Unknown VRM meta field colour',
    );
    expect(await refused(t.app, 'char.setVrmMeta', { character, patch: { avatarPermission: 'anyone' } })).toBe(
      'Invalid value for avatarPermission',
    );
    const steps = t.app.history.peekUndo()?.id;
    await ok(t.app, 'char.setVrmMeta', { character });
    expect(t.app.session.getState().dialog).toBe('vrmMeta');
    expect(t.app.history.peekUndo()?.id).toBe(steps);
  });
});

describe('char.renderThumbnail (§5.22)', () => {
  it('stores a square 1024 PNG thumbnail asset by hash in one step; a re-render of the same records is the same asset', async () => {
    const { t, character } = await riggedLad();
    const { asset } = await ok<{ asset: string }>(t.app, 'char.renderThumbnail', { character });
    expect(t.app.history.peekUndo()?.label).toBe('Render Thumbnail');
    expect(t.app.store.get('assets', asset as never)).toMatchObject({
      role: 'thumbnail',
      ext: 'png',
      mime: 'image/png',
    });
    expect(t.app.store.get('characters', character)?.vrm?.thumbnail).toBe(asset);
    expect(pngSize(await t.app.services.assets.get(asset as never))).toEqual({ width: 1024, height: 1024 });
    const again = await ok<{ asset: string }>(t.app, 'char.renderThumbnail', { character });
    expect(again.asset).toBe(asset);
    await ok(t.app, 'edit.undo');
    await ok(t.app, 'edit.undo');
    expect(t.app.store.get('characters', character)?.vrm).toBeNull();
  });
});

describe('file.exportCharacter (§6.4)', () => {
  it('defaults: the Space profile, VRM 1.0, slot clips, the stored thumbnail, the character name', async () => {
    const { t, character } = await riggedLad();
    expect(normalizeCharacterRequest(t.app, {})).toEqual({
      character,
      fileName: 'Cube Lad',
      format: 'vrm',
      profile: 'ekza/space-avatar-v1',
      clips: 'slots',
      includeProps: null,
      material: null,
      thumbnail: 'stored',
      validate: true,
    });
  });

  it('a ready character exports a clean VRM 1.0: no error row, read-back ok, downloaded; no step; keys unchanged', async () => {
    const { t, character } = await readyLad();
    const clip = await idleClip(t.app, character);
    const keys = keysHash(t.app);
    const steps = t.app.history.peekUndo()?.id;
    const [artifact] = await ok<ExportArtifact[]>(t.app, 'file.exportCharacter', {});
    expect(artifact?.fileName).toBe('Cube_Lad.vrm');
    expect(artifact?.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    expect(artifact?.lints.filter((lint) => lint.code.startsWith('vrm.'))).toEqual([]);
    const readBack = artifact?.readBack as CharacterReadBack;
    expect(readBack).toMatchObject({
      kind: 'character',
      ok: true,
      jointsEqual: true,
      humanoidEqual: true,
      fingerprintEqual: true,
    });
    expect(readBack.joints).toBe(34);
    expect(readBack.humanoid).toBe(33);
    expect(readBack.animations).toBe(1);
    const json = (await parseGlb(artifact?.bytes as Uint8Array)).json as Record<string, unknown>;
    expect((json['animations'] as { name: string }[]).map((a) => a.name)).toEqual(['idle']);
    const meta = (json['extensions'] as Record<string, { meta: Record<string, unknown> }>)['VRMC_vrm']?.meta;
    expect(meta).toMatchObject({ name: 'Cube Lad', authors: ['Tester'], licenseUrl: 'https://vrm.dev/licenses/1.0/' });
    // The thumbnail image is the stored thumbnail asset's bytes.
    const images = json['images'] as { name?: string }[];
    expect(images[meta?.['thumbnailImage'] as number]?.name).toBe('thumbnail');
    const downloads = (t.app.services as unknown as { downloads: { fileName: string }[] }).downloads;
    expect(downloads.map((d) => d.fileName)).toEqual(['Cube_Lad.vrm']);
    expect(t.app.history.peekUndo()?.id).toBe(steps);
    expect(keysHash(t.app)).toBe(keys);
    // Determinism (P-W2): a second export is byte-identical.
    const [second] = await ok<ExportArtifact[]>(t.app, 'file.exportCharacter', {});
    expect(second?.sha256).toBe(artifact?.sha256);
    // An explicit list exports that clip; a test clip is never exported.
    const [listed] = await ok<ExportArtifact[]>(t.app, 'file.exportCharacter', { clips: [clip] });
    expect(listed?.sha256).toBe(artifact?.sha256);
  });

  it('the VRM meta rows gate the Space profile: errors block the download; local/generic exports', async () => {
    const { t, character } = await riggedLad();
    // INT: with C6 merged the Validation rows add `skin.joint-without-weights` (info: joints the automatic bind left
    // without weights); info rows never gate, so the gate is the error and warning rows.
    const gating = (profile: string) =>
      characterExportRows(t.app, character, profile, 'vrm')
        .filter((r) => r.severity !== 'info')
        .map((r) => [r.code, r.severity]);
    expect(gating('ekza/space-avatar-v1')).toEqual([
      ['vrm.meta-required', 'error'],
      ['vrm.licence-unset', 'error'],
      ['vrm.thumbnail-square', 'warning'],
    ]);
    expect(gating('local/generic')).toEqual([]);
    expect(characterExportRows(t.app, character, 'local/generic', 'vrm').every((r) => r.code.startsWith('skin.'))).toBe(
      true,
    );
    const [blocked] = await ok<ExportArtifact[]>(t.app, 'file.exportCharacter', {});
    expect(blocked?.lints.filter((l) => l.severity === 'error').map((l) => l.code)).toEqual([
      'vrm.meta-required',
      'vrm.licence-unset',
    ]);
    const downloads = (t.app.services as unknown as { downloads: unknown[] }).downloads;
    expect(downloads).toHaveLength(0);
    const [local] = await ok<ExportArtifact[]>(t.app, 'file.exportCharacter', {
      profile: 'local/generic',
      format: 'glb',
    });
    expect(local?.fileName).toBe('Cube_Lad.glb');
    expect(local?.lints.filter((l) => l.severity === 'error')).toEqual([]);
    expect(local?.lints.filter((l) => l.code.startsWith('vrm.'))).toEqual([]);
    const json = (await parseGlb(local?.bytes as Uint8Array)).json as Record<string, unknown>;
    expect(json['extensions']).toBeUndefined();
    expect(downloads).toHaveLength(1);
  });

  it('profile routing: OMOBA five-clip GLB not offered, the Space profile writes VRM only; imported avatars use the bake', async () => {
    const { t } = await riggedLad();
    expect(await refused(t.app, 'file.exportCharacter', { profile: 'ekza/omoba-humanoid-v1' })).toMatch(
      /OMOBA plays its own motion library/,
    );
    expect(await refused(t.app, 'file.exportCharacter', { format: 'glb' })).toMatch(/plain GLB goes through/);
    expect(await refused(t.app, 'file.exportCharacter', { profile: 'nope' })).toBe("Unknown export profile 'nope'");
    expect(await refused(t.app, 'file.exportCharacter', { clips: ['clp_missing'] })).toMatch(/is not a clip of/);
  });

  it('a character without joints is refused with the next step', async () => {
    const t = await meshTestApp();
    const { mesh } = await ok<{ mesh: MeshId }>(t.app, 'mesh.create.cube', {});
    await ok(t.app, 'char.fromModel', { objects: [mesh] });
    expect(await refused(t.app, 'file.exportCharacter', {})).toBe('Create the skeleton first (Rig & Skin › Quick Rig)');
  });
});
