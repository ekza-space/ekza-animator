// AUTORIG-SPEC §4.5, §5.6, FR-AR-12, AR-D16, AR-D24 (D6): `autorig.export {character, target, fileName}` headless.
// Every target's bytes equal Studio's export of the same request on the same document (SHA-256): the VRM and the
// GLB equal `file.exportCharacter`, each VRMA equals `file.export` kind `vrma`; the OMOBA kit runs headless and holds
// the VRM bytes unchanged, the stored thumbnail and `manifest-entry.json` in OMOBA's field names; an error lint saves
// nothing and toasts its message; no target records an undo step or changes the document.
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
import {
  type ExportArtifact,
  OMOBA_MANIFEST_FIELDS,
  parseGlb,
  stageVrmForOmoba,
  unzipFiles,
  vrmThumbnail,
} from '@ekza-studio/io';
import { type SkinWeights, withSkin } from '@ekza-studio/mesh-core';
import { describe, expect, it } from 'vitest';
import type { AutoRigExportResult, EditorApp } from '../../src';
import type { KernelCharacters } from '../../src/characters/registry';
import {
  availableTargets,
  characterRequest,
  exportBase,
  exportTargetProblem,
  fileExportRequest,
  omobaKitOf,
  RESTRICTED,
} from '../../src/operators/builtin/rig/wizard/export';
import type { FakeServices } from '../../src/testing/services';
import { type MeshTestApp, meshTestApp } from '../mesh/support';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../fixtures/models/${name}`, import.meta.url)));
const TRUTH = JSON.parse(new TextDecoder().decode(fixture('cube-lad-truth.json'))) as {
  readonly joints: Readonly<
    Record<string, { readonly position: readonly [number, number, number]; readonly parent: string | null }>
  >;
};
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

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

const docHash = (app: EditorApp): string => sha(new TextEncoder().encode(JSON.stringify(app.store.snapshot().tables)));

/** The Cube Lad as a model character: the truth Standard 33 joints, bound to the nearest joint, with its control rig
 *  (as the C10 tests build it). */
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

/** A ready lad: CC0 meta with an author, a rendered thumbnail, and two slot clips (idle, walk). */
async function readyLad() {
  const lad = await riggedLad();
  const { app } = lad.t;
  await ok(app, 'char.setVrmMeta', { character: lad.character, patch: { authors: ['Tester'], licensePreset: 'cc0' } });
  await ok(app, 'char.renderThumbnail', { character: lad.character });
  const clips: string[] = [];
  for (const [name, slot] of [
    ['Idle', 'idle'],
    ['Walk', 'walk'],
  ] as const) {
    const { clip } = await ok<{ clip: string }>(app, 'clip.new', { character: lad.character, name });
    await ok(app, 'clip.setSettings', { clip, slot, loop: true, range: { start: 0, end: 30 } });
    await ok(app, 'key.set', { target: 'character' });
    clips.push(clip);
  }
  await (app.characters as KernelCharacters).settled();
  return { ...lad, clips };
}

const downloadsOf = (t: MeshTestApp): FakeServices['downloads'] => t.services.downloads;

describe('autorig.export: same bytes as Studio (FR-AR-12)', () => {
  it('ekza-vrm equals file.exportCharacter with the §5.6.1 request; saved as <slug>.vrm; no step, no change', async () => {
    const { t, character } = await readyLad();
    const steps = t.app.history.peekUndo()?.id;
    const before = docHash(t.app);
    const result = await ok<AutoRigExportResult>(t.app, 'autorig.export', {
      character,
      target: 'ekza-vrm',
      fileName: '',
    });
    expect(result.target).toBe('ekza-vrm');
    expect(result.fileName).toBe('cube-lad.vrm');
    expect(result.artifacts).toHaveLength(1);
    expect(result.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    const saved = downloadsOf(t);
    expect(saved.map((d) => d.fileName)).toEqual(['cube-lad.vrm']);
    expect(sha(saved[0]?.bytes as Uint8Array)).toBe(result.artifacts[0]?.sha256);
    expect(t.app.history.peekUndo()?.id).toBe(steps);
    expect(docHash(t.app)).toBe(before);
    expect(t.app.session.getState().busy).toBeNull();

    const request = characterRequest(t.app, t.app.store.get('characters', character)!, 'ekza-vrm', '');
    expect(request).toEqual({
      character,
      fileName: 'cube-lad',
      format: 'vrm',
      profile: 'ekza/space-avatar-v1',
      clips: 'slots',
      includeProps: null,
      material: null,
      thumbnail: 'stored',
      validate: true,
    });
    const [studio] = await ok<ExportArtifact[]>(t.app, 'file.exportCharacter', request);
    expect(studio?.sha256).toBe(result.artifacts[0]?.sha256);
    expect(studio?.fileName).toBe('cube-lad.vrm');
    const json = (await parseGlb(saved[0]?.bytes as Uint8Array)).json as Record<string, unknown>;
    expect((json['animations'] as { name: string }[]).map((a) => a.name)).toEqual(['idle', 'walk']);
  });

  it('glb equals file.exportCharacter through local/generic with every non-test clip in order', async () => {
    const { t, character, clips } = await readyLad();
    const result = await ok<AutoRigExportResult>(t.app, 'autorig.export', {
      character,
      target: 'glb',
      fileName: 'My Lad',
    });
    expect(result.fileName).toBe('My_Lad.glb');
    const request = characterRequest(t.app, t.app.store.get('characters', character)!, 'glb', 'My Lad');
    expect(request).toMatchObject({ format: 'glb', profile: 'local/generic', clips, thumbnail: 'none' });
    const [studio] = await ok<ExportArtifact[]>(t.app, 'file.exportCharacter', request);
    expect(studio?.sha256).toBe(result.artifacts[0]?.sha256);
    const json = (await parseGlb(result.artifacts[0]?.bytes as Uint8Array)).json as Record<string, unknown>;
    expect(json['extensions']).toBeUndefined();
    expect((json['animations'] as unknown[]).length).toBe(2);
  });

  it('vrma: one VRMA per clip equal to file.export kind vrma; several are zipped as <slug>-animations.zip', async () => {
    const { t, character } = await readyLad();
    // verified on a model-sourced character (§5.6.1): the exporter accepts it, so the target is offered
    expect(exportTargetProblem(t.app, character, 'vrma')).toBeNull();
    expect(availableTargets(t.app, character)).toEqual(['ekza-vrm', 'glb', 'vrma', 'omoba-kit']);
    const result = await ok<AutoRigExportResult>(t.app, 'autorig.export', { character, target: 'vrma', fileName: '' });
    expect(result.fileName).toBe('cube-lad-animations.zip');
    expect(result.artifacts.map((a) => a.fileName)).toEqual(['cube-lad-idle.vrma', 'cube-lad-walk.vrma']);
    const saved = downloadsOf(t);
    expect(saved.map((d) => [d.fileName, d.mime])).toEqual([['cube-lad-animations.zip', 'application/zip']]);
    const files = unzipFiles(saved[0]?.bytes as Uint8Array);
    expect(Object.keys(files)).toEqual(['cube-lad-idle.vrma', 'cube-lad-walk.vrma']);
    const request = fileExportRequest(t.app, t.app.store.get('characters', character)!, 'vrma', null, '');
    const studio = await ok<ExportArtifact[]>(t.app, 'file.export', request);
    expect(studio.map((a) => a.sha256)).toEqual(result.artifacts.map((a) => a.sha256));
    expect(studio.map((a) => sha(files[a.fileName] as Uint8Array))).toEqual(studio.map((a) => a.sha256));
  });

  it('vrma with one clip saves the .vrma itself; without clips the target is not available', async () => {
    const { t, character, clips } = await readyLad();
    await ok(t.app, 'clip.delete', { clip: clips[1] });
    const result = await ok<AutoRigExportResult>(t.app, 'autorig.export', { character, target: 'vrma', fileName: '' });
    expect(result.fileName).toBe('cube-lad-idle.vrma');
    expect(downloadsOf(t).map((d) => d.fileName)).toEqual(['cube-lad-idle.vrma']);
    await ok(t.app, 'clip.delete', { clip: clips[0] });
    expect(exportTargetProblem(t.app, character, 'vrma')).toMatch(/Add an animation first/);
    expect(availableTargets(t.app, character)).toEqual(['ekza-vrm', 'glb', 'omoba-kit']);
    expect(await refused(t.app, 'autorig.export', { character, target: 'vrma', fileName: '' })).toMatch(
      /Add an animation first/,
    );
  });
});

describe('autorig.export: the OMOBA local test kit (§5.6.4)', () => {
  it('runs headless: <slug>.glb = the VRM staged for OMOBA, <slug>.png = the stored thumbnail, OMOBA manifest fields, README', async () => {
    const { t, character } = await readyLad();
    const result = await ok<AutoRigExportResult>(t.app, 'autorig.export', {
      character,
      target: 'omoba-kit',
      fileName: '',
    });
    expect(result.fileName).toBe('cube-lad-omoba-kit.zip');
    const saved = downloadsOf(t);
    expect(saved.map((d) => [d.fileName, d.mime])).toEqual([['cube-lad-omoba-kit.zip', 'application/zip']]);
    const files = unzipFiles(saved[0]?.bytes as Uint8Array);
    expect(Object.keys(files)).toEqual(['cube-lad.glb', 'cube-lad.png', 'manifest-entry.json', 'README.txt']);
    // the VRM target's bytes as OMOBA's local import stages them (CHARACTER-CONTRACT-SPEC P-4: VRM 1.0 turned to −Z)
    const vrm = await ok<AutoRigExportResult>(t.app, 'autorig.export', { character, target: 'ekza-vrm', fileName: '' });
    const staged = stageVrmForOmoba(vrm.artifacts[0]?.bytes as Uint8Array);
    expect(staged.turned).toBe(true);
    expect(sha(files['cube-lad.glb'] as Uint8Array)).toBe(sha(staged.bytes));
    expect(result.artifacts[0]?.sha256).toBe(vrm.artifacts[0]?.sha256);
    const thumb = t.app.store.get('characters', character)?.vrm?.thumbnail;
    expect(files['cube-lad.png']).toEqual(await t.app.services.assets.get(thumb as never));
    const entry = JSON.parse(new TextDecoder().decode(files['manifest-entry.json'])) as Record<string, unknown>;
    expect(Object.keys(entry)).toEqual([...OMOBA_MANIFEST_FIELDS]);
    expect(entry).toEqual({
      author: 'Tester',
      collection: 'Ekza Studio',
      display_name: 'Cube Lad',
      license: 'CC0',
      slug: 'cube-lad',
      source_url: '',
      thumbnail: 'cube-lad.png',
    });
    expect(new TextDecoder().decode(files['README.txt'])).toContain('validate-runtime-vrm');
  });
});

describe('autorig.export: OMOBA slugs (§5.6.4)', () => {
  it('an "Ekza …" avatar never gets OMOBA’s protected ekza- slug (its roster would skip the entry)', async () => {
    const { t, character } = await readyLad();
    await ok(t.app, 'char.setVrmMeta', { character, patch: { name: 'Ekza Bot' } });
    const kit = await ok<AutoRigExportResult>(t.app, 'autorig.export', {
      character,
      target: 'omoba-kit',
      fileName: '',
    });
    expect(kit.fileName).toBe('studio-ekza-bot-omoba-kit.zip');
    const files = unzipFiles(downloadsOf(t)[0]?.bytes as Uint8Array);
    expect(Object.keys(files)).toEqual([
      'studio-ekza-bot.glb',
      'studio-ekza-bot.png',
      'manifest-entry.json',
      'README.txt',
    ]);
    const entry = JSON.parse(new TextDecoder().decode(files['manifest-entry.json'])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      display_name: 'Ekza Bot',
      slug: 'studio-ekza-bot',
      thumbnail: 'studio-ekza-bot.png',
    });
    // a given ekza- file name is rewritten for the kit as well
    const named = await ok<AutoRigExportResult>(t.app, 'autorig.export', {
      character,
      target: 'omoba-kit',
      fileName: 'ekza-hero.zip',
    });
    expect(named.fileName).toBe('studio-ekza-hero-omoba-kit.zip');
    // the VRM is named by the same slug
    const vrm = await ok<AutoRigExportResult>(t.app, 'autorig.export', { character, target: 'ekza-vrm', fileName: '' });
    expect(vrm.fileName).toBe('studio-ekza-bot.vrm');
  });
});

describe('autorig.export: gates (§5.6.2)', () => {
  it('an error lint saves nothing, toasts its message and returns the lints (VRM and kit alike)', async () => {
    const { t, character } = await riggedLad();
    for (const target of ['ekza-vrm', 'omoba-kit'] as const) {
      const result = await ok<AutoRigExportResult>(t.app, 'autorig.export', { character, target, fileName: '' });
      expect(result.lints.filter((l) => l.severity === 'error').map((l) => l.code)).toEqual([
        'vrm.meta-required',
        'vrm.licence-unset',
      ]);
      expect(result.lints[0]?.severity).toBe('error');
    }
    expect(downloadsOf(t)).toEqual([]);
    const toasts = t.services.toasts.filter((toast) => toast.kind === 'error').map((toast) => toast.text);
    expect(toasts).toEqual([
      expect.stringMatching(/^cube-lad\.vrm was not saved: Set the VRM meta/),
      expect.stringMatching(/^cube-lad-omoba-kit\.zip was not saved: Set the VRM meta/),
    ]);
    // local/generic has no meta rows: the GLB saves
    await ok(t.app, 'autorig.export', { character, target: 'glb', fileName: '' });
    expect(downloadsOf(t).map((d) => d.fileName)).toEqual(['cube-lad.glb']);
  });

  it('a blocking byte lint of the written file (vrm.translation-range) saves nothing and toasts it (kit alike)', async () => {
    const { t, character, skeleton } = await readyLad();
    // a hand 2,000 km out: no document row covers it; the written file's node translation breaks OMOBA's ±1e6 rule
    const hand = t.app.store.query.jointsOfSkeleton(skeleton).find((joint) => joint.key === 'leftHand') as JointRecord;
    t.app.store.transact({ label: 'far hand (test)' }, (tx) =>
      tx.patch('joints', hand.id, { restPosition: [2e6, 0, 0] }),
    );
    await (t.app.characters as KernelCharacters).settled();
    const before = docHash(t.app);
    for (const target of ['ekza-vrm', 'omoba-kit'] as const) {
      const result = await ok<AutoRigExportResult>(t.app, 'autorig.export', { character, target, fileName: '' });
      const errors = result.lints.filter((lint) => lint.severity === 'error');
      expect(errors.map((lint) => lint.code)).toContain('vrm.translation-range');
      expect(result.lints[0]?.severity).toBe('error');
      // the bytes were written and measured: the artifact is there, only the download is refused
      expect(result.artifacts[0]?.bytes.byteLength).toBeGreaterThan(0);
    }
    expect(downloadsOf(t)).toEqual([]);
    const toasts = t.services.toasts.filter((toast) => toast.kind === 'error').map((toast) => toast.text);
    expect(toasts).toEqual([
      expect.stringMatching(/^cube-lad\.vrm was not saved: /),
      expect.stringMatching(/^cube-lad-omoba-kit\.zip was not saved: /),
    ]);
    expect(toasts.join('\n')).toMatch(/translation/);
    expect(docHash(t.app)).toBe(before);
  });

  it('polls: shape, targets, missing characters, characters without a skeleton', async () => {
    const { t, character } = await riggedLad();
    expect(await refused(t.app, 'autorig.export', { character, target: 'fbx', fileName: '' })).toMatch(/expects/);
    expect(await refused(t.app, 'autorig.export', { target: 'glb', fileName: '' })).toMatch(/expects/);
    expect(await refused(t.app, 'autorig.export', { character, target: 'glb', fileName: 3 })).toBe(
      'fileName must be a string',
    );
    expect(await refused(t.app, 'autorig.export', { character: 'chr_x', target: 'glb', fileName: '' })).toBe(
      'Character chr_x does not exist',
    );
    const u = await meshTestApp();
    const { mesh } = await ok<{ mesh: MeshId }>(u.app, 'mesh.create.cube', {});
    const made = await ok<{ character: CharacterId }>(u.app, 'char.fromModel', { objects: [mesh] });
    expect(
      await refused(u.app, 'autorig.export', { character: made.character, target: 'ekza-vrm', fileName: '' }),
    ).toBe('Create the skeleton first (Rig & Skin › Quick Rig)');
  });

  it('file names: the given base without its extension, else the slug of the VRM name', async () => {
    const { t, character } = await riggedLad();
    const record = () => t.app.store.get('characters', character)!;
    expect(exportBase(record(), '')).toBe('cube-lad');
    expect(exportBase(record(), 'hero.vrm')).toBe('hero');
    await ok(t.app, 'char.setVrmMeta', { character, patch: { name: 'Sir Cube' } });
    expect(exportBase(record(), '  ')).toBe('sir-cube');
  });
});

describe('autorig.export: imported avatars (§5.6.1, AS-AR-4)', () => {
  it('a VRM sample offers the Space bake, VRMA and the kit once it has a clip; bytes equal file.export', async () => {
    const t = await meshTestApp();
    const { character } = await ok<{ character: CharacterId }>(t.app, 'file.importModel', {
      name: 'seed-san.vrm',
      bytes: fixture('seed-san.vrm'),
    });
    await (t.app.characters as KernelCharacters).settled();
    expect(exportTargetProblem(t.app, character, 'glb')).toMatch(/is a VRM/);
    expect(exportTargetProblem(t.app, character, 'ekza-vrm')).toMatch(/add an animation first/);
    expect(availableTargets(t.app, character)).toEqual([]);
    const { clip } = await ok<{ clip: string }>(t.app, 'clip.new', { character, name: 'Idle' });
    await ok(t.app, 'clip.setSettings', { clip, slot: 'idle', loop: true, range: { start: 0, end: 30 } });
    await ok(t.app, 'key.set', { target: 'character' });
    expect(availableTargets(t.app, character)).toEqual(['ekza-vrm', 'vrma', 'omoba-kit']);
    const result = await ok<AutoRigExportResult>(t.app, 'autorig.export', {
      character,
      target: 'ekza-vrm',
      fileName: '',
    });
    const record = t.app.store.get('characters', character)!;
    const request = fileExportRequest(t.app, record, 'bake-into-model', 'ekza/space-avatar-v1', '');
    const studio = await ok<ExportArtifact[]>(t.app, 'file.export', request);
    expect(studio.map((a) => a.sha256)).toEqual(result.artifacts.map((a) => a.sha256));
    expect(result.fileName.endsWith('.vrm')).toBe(true);
    const kit = await ok<AutoRigExportResult>(t.app, 'autorig.export', {
      character,
      target: 'omoba-kit',
      fileName: '',
    });
    expect(kit.artifacts[0]?.sha256).toBe(result.artifacts[0]?.sha256);
    // Seed-san's own nodes have non-uniform scales: OMOBA's vrm.uniform-scale byte rule blocks the download
    expect(kit.lints.filter((lint) => lint.severity === 'error').map((lint) => lint.code)).toContain(
      'vrm.uniform-scale',
    );
    // the kit of those bytes carries the VRM's own thumbnail (the image inside its .glb) and its licence text
    const baked = kit.artifacts[0]?.bytes as Uint8Array;
    const packed = await omobaKitOf(t.app, record, exportBase(record, ''), baked);
    expect(packed.name).toBe(kit.fileName);
    const files = unzipFiles(packed.bytes);
    const slug = kit.fileName.replace(/-omoba-kit\.zip$/, '');
    expect(Object.keys(files)).toEqual([`${slug}.glb`, `${slug}.png`, 'manifest-entry.json', 'README.txt']);
    expect(sha(files[`${slug}.glb`] as Uint8Array)).toBe(sha(stageVrmForOmoba(baked).bytes));
    expect(sha(files[`${slug}.png`] as Uint8Array)).toBe(sha(vrmThumbnail(baked)?.bytes as Uint8Array));
    expect(Array.from((files[`${slug}.png`] as Uint8Array).subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const entry = JSON.parse(new TextDecoder().decode(files['manifest-entry.json'])) as Record<string, unknown>;
    expect(entry).toMatchObject({ display_name: 'Seed-san', author: 'VirtualCast, Inc.', thumbnail: `${slug}.png` });
    expect(entry['license']).not.toBe('');
  });

  it('a clip without an Ekza name stays out of the VRM bake instead of removing the target (AR-D8-2)', async () => {
    const t = await meshTestApp();
    const { character } = await ok<{ character: CharacterId }>(t.app, 'file.importModel', {
      name: 'seed-san.vrm',
      bytes: fixture('seed-san.vrm'),
    });
    await (t.app.characters as KernelCharacters).settled();
    const { clip: punch } = await ok<{ clip: string }>(t.app, 'clip.new', { character, name: 'Punch' });
    await ok(t.app, 'clip.setSettings', { clip: punch, loop: false, range: { start: 0, end: 30 } });
    await ok(t.app, 'key.set', { target: 'character' });
    // only the slotless Punch: the VRM waits for a slot, with that reason; VRMA carries it
    expect(exportTargetProblem(t.app, character, 'ekza-vrm')).toMatch(/give an animation an OMOBA slot first/);
    expect(availableTargets(t.app, character)).toEqual(['vrma']);
    const { clip: idle } = await ok<{ clip: string }>(t.app, 'clip.new', { character, name: 'Idle' });
    await ok(t.app, 'clip.setSettings', { clip: idle, slot: 'idle', loop: true, range: { start: 0, end: 30 } });
    await ok(t.app, 'key.set', { target: 'character' });
    // Idle has a slot: the VRM is back, and the bake carries Idle alone (Punch stays out, VRMA keeps both)
    expect(availableTargets(t.app, character)).toEqual(['ekza-vrm', 'vrma', 'omoba-kit']);
    const record = t.app.store.get('characters', character)!;
    expect(fileExportRequest(t.app, record, 'bake-into-model', 'ekza/space-avatar-v1', '').clips).toEqual([idle]);
    expect(fileExportRequest(t.app, record, 'vrma', null, '').clips).toEqual([punch, idle]);
    const result = await ok<AutoRigExportResult>(t.app, 'autorig.export', {
      character,
      target: 'ekza-vrm',
      fileName: '',
    });
    const json = (await parseGlb(result.artifacts[0]?.bytes as Uint8Array)).json as {
      animations?: { name?: string }[];
    };
    expect((json.animations ?? []).map((animation) => animation.name)).toEqual(['idle']);
  });

  it('a restricted licence: no VRM or kit target, with the reason; VRMA stays (AR-D6-19)', async () => {
    const t = await meshTestApp();
    const { character } = await ok<{ character: CharacterId }>(t.app, 'file.importModel', {
      name: 'locked-san.vrm',
      bytes: withJson(fixture('seed-san.vrm'), (json) =>
        json.replace(
          '"modification":"allowModificationRedistribution"',
          `"modification":"prohibited"${' '.repeat(21)}`,
        ),
      ),
    });
    await (t.app.characters as KernelCharacters).settled();
    const { clip } = await ok<{ clip: string }>(t.app, 'clip.new', { character, name: 'Idle' });
    await ok(t.app, 'clip.setSettings', { clip, slot: 'idle', loop: true, range: { start: 0, end: 30 } });
    await ok(t.app, 'key.set', { target: 'character' });
    expect(availableTargets(t.app, character)).toEqual(['vrma']);
    expect(exportTargetProblem(t.app, character, 'ekza-vrm')).toBe(RESTRICTED);
    expect(exportTargetProblem(t.app, character, 'omoba-kit')).toBe(RESTRICTED);
    expect(await refused(t.app, 'autorig.export', { character, target: 'omoba-kit', fileName: '' })).toBe(RESTRICTED);
  });
});

/** GLB bytes with their JSON chunk edited in place (the edit must keep the chunk's length). */
function withJson(bytes: Uint8Array, edit: (json: string) => string): Uint8Array {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  const length = view.getUint32(12, true);
  const before = new TextDecoder().decode(out.subarray(20, 20 + length));
  const after = new TextEncoder().encode(edit(before));
  if (after.byteLength !== length || before === edit(before)) throw new Error('the JSON edit must keep its length');
  out.set(after, 20);
  return out;
}
