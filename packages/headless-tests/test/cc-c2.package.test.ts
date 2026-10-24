// CHARACTER-CONTRACT-SPEC §8.16 (C2), headless in Node: rig a sample → bind Wildspark → fill two slots → export the
// OMOBA hero package → read back the manifest and the clips. The static Polybot is rigged by Auto-Rig's operators,
// bound to OMOBA's bundled contract (served from `apps/web/public/contracts/`), its run filled from the clip library
// and its Shockline release from the game default's library copy (`target.slot.create`, one step each, the contract's
// settings applied); any blocking rule is fixed with `target.fix`; `target.exportPackage` writes one VRM 1.0 whose
// `asset.extras.ekza_package_v1` lists every customizable slot of the offer once (two custom, seven default), whose
// two animations are named by their slots and carry their labels, and which passes the TypeScript rule set, glTF
// Validator and the VRM validator; the developer zip holds the staged VRM, one VRMA per custom slot and the slot map.
// The package is written to `test-results/cc-c2/` for the local OMOBA check (`tooling/omoba-validate.mjs`).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type CharacterId, type ClipId, type MeshId, seededIdSource } from '@ekza-studio/doc';
import {
  type AutoRigRigResult,
  createHeadlessEditorApp,
  type EditorApp,
  type IntakeReport,
} from '@ekza-studio/editor-core';
import { checkCharacterPackage, gateVerdict, parseGlb, readContractText, unzipFiles } from '@ekza-studio/io';
import Ajv2020 from 'ajv/dist/2020';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { vrmErrors } from './m6b.writer.support';
import { validate } from './ops.support';

const ROOT = new URL('../../../', import.meta.url);
const OUT = new URL('test-results/cc-c2/', ROOT);
const file = (path: string): Uint8Array => new Uint8Array(readFileSync(new URL(path, ROOT)));
const CONTRACT = readContractText(new TextDecoder().decode(file('fixtures/contracts/omoba.game-contract.json')));

let realFetch: typeof globalThis.fetch;
beforeAll(() => {
  realFetch = globalThis.fetch;
  // the clip library (`/library/`) and the bundled contracts (`/contracts/`): the web app's public folder
  globalThis.fetch = ((url: string | URL) => {
    const bytes = file(`apps/web/public${String(url)}`);
    const text = new TextDecoder().decode(bytes);
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(text),
      json: () => Promise.resolve(JSON.parse(text) as unknown),
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    } as unknown as Response);
  }) as typeof globalThis.fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

async function run<T = unknown>(app: EditorApp, id: string, args: unknown): Promise<T> {
  const result = await app.runUntyped(id, args);
  if (result.status !== 'finished') throw new Error(`${id}: ${JSON.stringify(result)}`);
  return result.value as T;
}

async function characterReady(app: EditorApp, character: CharacterId): Promise<void> {
  for (let i = 0; i < 500 && app.characters.get(character) === undefined; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (app.characters.get(character) === undefined) throw new Error('no character runtime');
}

interface Json {
  readonly asset: { readonly extras: Record<string, unknown> };
  readonly animations?: readonly { readonly name?: string }[];
}

describe('C2 headless: rig → bind → fill two slots → package → read back', () => {
  it('Polybot for Wildspark: run from the library, Shockline from the game default', async () => {
    const downloads: { fileName: string; bytes: Uint8Array }[] = [];
    const app = createHeadlessEditorApp({
      validate,
      idSource: seededIdSource(23),
      onDownload: (download) => downloads.push(download),
    });
    const intake = await run<IntakeReport>(app, 'autorig.intake', {
      bytes: file('fixtures/models/polybot-unskinned-tpose.glb'),
      name: 'polybot-unskinned-tpose.glb',
    });
    await app.rig.load();
    await run(app, 'skel.quickRig.start', { meshes: intake.meshes as MeshId[] });
    const { character } = await run<AutoRigRigResult>(app, 'autorig.rig', { straighten: false, rigidParts: false });
    await characterReady(app, character);
    await run(app, 'char.setVrmMeta', { character, patch: { authors: ['Ekza Studio tests'], licensePreset: 'cc0' } });
    await run(app, 'char.renderThumbnail', { character });

    await run(app, 'target.bind', { character, game: 'omoba', target: 'wildspark' });
    const runClip = await run<{ clip: ClipId }>(app, 'target.slot.create', {
      character,
      slot: 'base.run',
      from: 'library',
      libraryClip: 'run',
    });
    const zap = await run<{ clip: ClipId }>(app, 'target.slot.create', {
      character,
      slot: 'skill.wild_zap.release',
      from: 'default',
    });
    expect(app.store.get('clips', zap.clip)).toMatchObject({
      name: 'Shockline W - release',
      slot: 'skill.wild_zap.release',
      loop: false,
      rootMotion: 'in-place',
    });
    expect(app.store.get('clips', runClip.clip)).toMatchObject({ slot: 'base.run', loop: true });

    // every document issue the contract flags has a one-tap fix: apply them (the export gate stays the bytes)
    const kit = await import('@ekza-studio/editor-core').then((core) => core.loadTargetKit(app));
    for (let round = 0; round < 3; round++) {
      const rows = kit.targetValidationRows(app, character, 'ekza/omoba-humanoid-v2');
      const fix = rows.find((row) => row.severity === 'error' && row.fix !== null)?.fix;
      if (fix === undefined || fix === null) break;
      await run(app, fix.op, fix.args);
    }
    const offer = kit.slotStatuses(app, character)?.offers.find((entry) => entry.package === 'character');
    expect(offer?.counts).toMatchObject({ custom: 2, invalid: 0, default: 7 });

    const result = await run<{ saved: boolean; fileName: string; lints: { code: string; severity: string }[] }>(
      app,
      'target.exportPackage',
      { character },
    );
    expect(result.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    expect(result.saved).toBe(true);
    const vrm = downloads.at(-1);
    expect(vrm?.fileName).toMatch(/\.vrm$/);
    const bytes = vrm?.bytes ?? new Uint8Array(0);

    // the manifest, by Appendix C
    const json = (await parseGlb(bytes)).json as unknown as Json;
    const manifest = json.asset.extras['ekza_package_v1'] as {
      readonly slots: Readonly<Record<string, { mode: string; animation?: number; markers?: Record<string, number> }>>;
    };
    expect(manifest).toMatchObject({
      schema: 'ekza.package.v1',
      schemaVersion: '1.0',
      kind: 'character',
      contract: { schema: 'ekza.game-contract.v1', game: 'omoba', revision: CONTRACT.revision },
      target: { id: 'wildspark', requirementId: 'character.wildspark' },
      requires: [],
      provenance: { tool: 'ekza-studio' },
    });
    expect(Object.keys(manifest.slots)).toEqual(
      CONTRACT.targets.find((target) => target.id === 'wildspark')?.accepts[0]?.slots,
    );
    expect(manifest.slots['base.run']).toEqual({ mode: 'custom', animation: 0, markers: {} });
    expect(manifest.slots['skill.wild_zap.release']).toMatchObject({ mode: 'custom', animation: 1 });
    expect(manifest.slots['skill.wild_zap.release']?.markers?.['contact']).toBeGreaterThanOrEqual(0);
    expect(manifest.slots['base.idle']).toEqual({ mode: 'default' });
    // the clips: named by their slots, labelled, metadata contact = manifest contact
    expect(json.animations?.map((animation) => animation.name)).toEqual(['base.run', 'skill.wild_zap.release']);
    const meta = json.asset.extras['ekza_animation_v1'] as {
      readonly clips: readonly { name: string; label?: string; contactSeconds: number | null }[];
    };
    expect(meta.clips.map((clip) => [clip.name, clip.label])).toEqual([
      ['base.run', 'Run all movement'],
      ['skill.wild_zap.release', 'Shockline W - release'],
    ]);
    expect(meta.clips[1]?.contactSeconds).toBe(manifest.slots['skill.wild_zap.release']?.markers?.['contact']);

    // the rules, glTF Validator, the VRM validator
    const report = checkCharacterPackage(bytes, { contract: (r) => (r === CONTRACT.revision ? CONTRACT : undefined) });
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(report.slots['base.run']?.verdict).toBe('pass');
    expect(report.slots['skill.wild_zap.release']?.verdict).toBe('pass');
    expect((await validate(bytes)).issues.filter((issue) => issue.severity === 0)).toEqual([]);
    expect(await vrmErrors(bytes)).toEqual([]);

    // deterministic: the same document writes the same bytes
    await run(app, 'target.exportPackage', { character });
    expect(downloads.at(-1)?.bytes).toEqual(bytes);

    // the developer zip
    await run(app, 'target.exportPackage', { character, devZip: true });
    const zip = downloads.at(-1);
    expect(zip?.fileName).toMatch(/-omoba-dev\.zip$/);
    const files = unzipFiles(zip?.bytes ?? new Uint8Array(0));
    expect(Object.keys(files).filter((name) => name.startsWith('animations/'))).toEqual([
      'animations/base.run.vrma',
      'animations/skill.wild_zap.release.vrma',
    ]);
    expect(JSON.parse(new TextDecoder().decode(files['slot-map.json']))).toEqual(manifest);

    // the metadata round-trip (§8.14): a VRMA of the zip comes back with its slot, contact and root motion
    await run(app, 'target.slot.clear', { character, slot: 'skill.wild_zap.release' });
    const back = await run<{ clips: ClipId[] }>(app, 'file.importAnimation', {
      name: 'skill.wild_zap.release.vrma',
      bytes: files['animations/skill.wild_zap.release.vrma'],
      character,
    });
    const restored = app.store.get('clips', back.clips[0] as ClipId);
    const original = app.store.get('clips', zap.clip);
    expect(restored).toMatchObject({ slot: 'skill.wild_zap.release', rootMotion: 'in-place', loop: false });
    expect(restored?.contact).toBe(original?.contact);

    mkdirSync(OUT, { recursive: true });
    writeFileSync(new URL('polybot-wildspark.vrm', OUT), bytes);
    // the package fixture for OMOBA's gate (§5.3 item 4): `EKZA_WRITE_PACKAGE_FIXTURE=1` refreshes the committed copy
    if (process.env['EKZA_WRITE_PACKAGE_FIXTURE'] === '1') {
      writeFileSync(new URL('fixtures/contracts/omoba-package/polybot-wildspark.vrm', ROOT), bytes);
    }
    writeFileSync(new URL(zip?.fileName ?? 'dev.zip', OUT), zip?.bytes ?? new Uint8Array(0));
  });

  it('a full Wildspark fill: every slot custom, one reused clip; the manifest validates against ekza.package.v1', async () => {
    const downloads: { fileName: string; bytes: Uint8Array }[] = [];
    const app = createHeadlessEditorApp({
      validate,
      idSource: seededIdSource(29),
      onDownload: (download) => downloads.push(download),
    });
    const intake = await run<IntakeReport>(app, 'autorig.intake', {
      bytes: file('fixtures/models/polybot-unskinned-tpose.glb'),
      name: 'polybot-unskinned-tpose.glb',
    });
    await app.rig.load();
    await run(app, 'skel.quickRig.start', { meshes: intake.meshes as MeshId[] });
    const { character } = await run<AutoRigRigResult>(app, 'autorig.rig', { straighten: false, rigidParts: false });
    await characterReady(app, character);
    await run(app, 'char.setVrmMeta', { character, patch: { authors: ['Ekza Studio tests'], licensePreset: 'cc0' } });
    await run(app, 'char.renderThumbnail', { character });
    await run(app, 'target.bind', { character, game: 'omoba', target: 'wildspark' });
    const fills: readonly (readonly [string, string])[] = [
      ['base.idle', 'idle'],
      ['base.run', 'run'],
      ['base.death', 'death'],
      ['basic.wildspark.0', 'punch'],
      ['basic.wildspark.rockets.0', 'pistol-shoot'],
      ['skill.wild_switch.release', 'hit'],
      ['skill.wild_traps.release', 'punch'],
    ];
    for (const [slot, libraryClip] of fills) {
      await run(app, 'target.slot.create', { character, slot, from: 'library', libraryClip });
    }
    await run(app, 'target.slot.create', { character, slot: 'skill.wild_zap.release', from: 'default' });
    await run(app, 'target.slot.alias', {
      character,
      slot: 'skill.wild_rocket.release',
      to: 'basic.wildspark.rockets.0',
    });
    // the contract's one-tap fixes until no error is left (contacts at their targets)
    const kit = await import('@ekza-studio/editor-core').then((core) => core.loadTargetKit(app));
    for (let round = 0; round < 12; round++) {
      const fix = kit
        .targetValidationRows(app, character, 'ekza/omoba-humanoid-v2')
        .find((row) => row.severity === 'error' && row.fix !== null)?.fix;
      if (fix === undefined || fix === null) break;
      await run(app, fix.op, fix.args);
    }
    const offer = kit.slotStatuses(app, character)?.offers.find((entry) => entry.package === 'character');
    expect(offer?.counts).toMatchObject({ custom: 9, invalid: 0, default: 0 });

    const result = await run<{ saved: boolean; lints: { severity: string; code: string }[] }>(
      app,
      'target.exportPackage',
      { character },
    );
    expect(result.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    const bytes = downloads.at(-1)?.bytes ?? new Uint8Array(0);
    const json = (await parseGlb(bytes)).json as unknown as Json;
    const manifest = json.asset.extras['ekza_package_v1'];
    // the pinned JSON Schema of ekza.package.v1 (GAME-PROTOCOL-SPEC Appendix B, OMOBA's copy)
    const schema = JSON.parse(
      new TextDecoder().decode(file('fixtures/contracts/ekza.package.v1.schema.json')),
    ) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const valid = ajv.validate(schema, manifest);
    expect(ajv.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
    // OMOBA's gate verdict: the package passes and so does every slot
    const verdict = gateVerdict(
      checkCharacterPackage(bytes, { contract: (r) => (r === CONTRACT.revision ? CONTRACT : undefined) }),
    );
    expect(verdict.pack).toBe('ok');
    expect(Object.values(verdict.slots)).toEqual(Array.from({ length: 9 }, () => 'pass'));
    expect(json.animations).toHaveLength(8);
    const slots = (manifest as { slots: Record<string, { animation?: number }> }).slots;
    expect(slots['skill.wild_rocket.release']?.animation).toBe(slots['basic.wildspark.rockets.0']?.animation);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(new URL('polybot-wildspark-full.vrm', OUT), bytes);
  });
});
