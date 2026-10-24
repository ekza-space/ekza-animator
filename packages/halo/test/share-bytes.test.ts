// AS-ST-5 for Share (STUDIO-TOUCH-SPEC §13.3, §20.7 headless integration, §22; T11 exit test): every destination and
// every More formats row writes the same bytes as Studio Pro's or Auto-Rig's export of the same document, on the
// production kernel. Halo's side is built by Halo's own code (`destinationChoice`, `moreFormatChoice` with the default
// options) and run through Share's own capture (`holdingFiles`: the file service's `download` held, as the sheet does
// before the export button delivers). The references are written here independently: Studio Pro's requests as its
// Export dialog builds them (`ExportDialog`, `ExportCharacterSection`, `ExportStaticSection` defaults) and Auto-Rig ⑤'s
// `autorig.export` targets. Subjects: a model character (the Cube Lad rigged through Auto-Rig's operators, with Walk),
// the same character made for OMOBA's Wildspark (C2's hero package and developer zip), an imported VRM (Polybot) and
// an imported rigged glTF, and the scene's static meshes (a hand-held prop).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { type CharacterId, type ClipId, type MeshId, seededIdSource } from '@ekza-studio/doc';
import {
  type AutoRigRigResult,
  createHeadlessEditorApp,
  type EditorApp,
  type IntakeReport,
  loadModelOperators,
  loadTargetKit,
  loadUiWrappers,
  type SampleDef,
} from '@ekza-studio/editor-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { holdingFiles } from '../src/sheets/share/bake';
import {
  DEFAULT_OPTIONS,
  destinationChoice,
  type MoreFormatId,
  moreFormatChoice,
  type ShareCall,
  type ShareWords,
} from '../src/sheets/share/model';
import type { DestinationId } from '../src/path/destinations';

const ROOT = new URL('../../../', import.meta.url);
const file = (path: string): Uint8Array => new Uint8Array(readFileSync(new URL(path, ROOT)));

const WORDS: ShareWords = {
  noCharacter: 'no character',
  noScene: 'no scene',
  madeHere: 'made here',
  isVrm: (n) => `${n} is a VRM`,
  notVrm: (n) => `${n} is not a VRM`,
  notVrm0: 'not VRM 0.x',
  notBound: 'not bound',
};

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

async function freshApp(seed: number): Promise<EditorApp> {
  const app = createHeadlessEditorApp({
    idSource: seededIdSource(seed),
    readSample: (sample: SampleDef) =>
      Promise.resolve(
        file(
          sample.file === 'quaternius-ual.glb'
            ? 'fixtures/animations/quaternius-ual.glb'
            : `fixtures/models/${sample.file}`,
        ),
      ),
  });
  await Promise.all([app.rig.load(), app.library.load(), loadModelOperators(), loadUiWrappers(app)]);
  return app;
}

async function run<T = unknown>(app: EditorApp, op: string, args?: unknown): Promise<T> {
  const result = await app.runUntyped(op, args);
  if (result.status !== 'finished') throw new Error(`${op}: ${JSON.stringify(result)}`);
  return result.value as T;
}

async function characterReady(app: EditorApp, character: CharacterId): Promise<void> {
  for (let i = 0; i < 500 && app.characters.get(character) === undefined; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (app.characters.get(character) === undefined) throw new Error('no character runtime');
}

interface Written {
  readonly name: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** Runs one export with the file service's download held (as Share does) and returns the one file it wrote. */
async function written(app: EditorApp, op: string, args: unknown): Promise<Written> {
  const { result, files } = await holdingFiles(app, () => app.runUntyped(op, args));
  if (result.status !== 'finished') throw new Error(`${op}: ${JSON.stringify(result)}`);
  const last = files.at(-1);
  if (last === undefined) throw new Error(`${op} wrote no file: ${JSON.stringify(result.value).slice(0, 400)}`);
  return {
    name: last.name,
    sha256: createHash('sha256').update(last.bytes).digest('hex'),
    bytes: last.bytes.byteLength,
  };
}

function halo(app: EditorApp, id: DestinationId | MoreFormatId, kind: 'destination' | 'format'): ShareCall {
  const choice =
    kind === 'destination'
      ? destinationChoice(app, id as DestinationId, DEFAULT_OPTIONS, WORDS)
      : moreFormatChoice(app, id as MoreFormatId, DEFAULT_OPTIONS, WORDS);
  if (choice.call === null) throw new Error(`${id}: ${choice.problem}`);
  return choice.call;
}

/** Studio Pro's Export dialog request (`ExportDialog` defaults: the animated clips, loops closed when all loop). */
function proFileExport(
  app: EditorApp,
  character: CharacterId,
  kind: 'bake-into-model' | 'animation-glb' | 'vrma',
  profile: string | null,
  clips: readonly ClipId[],
) {
  const reduce = app.prefs.getState().exportReduce;
  return {
    kind,
    character,
    clips,
    fileNamePattern: kind === 'bake-into-model' ? '{character}' : '{character}_{clip}',
    closeLoop: clips.length > 0 && clips.every((clip) => app.store.get('clips', clip)?.loop === true),
    includeConstantTracks: true,
    acknowledgeLicense: false,
    profile,
    reduce: reduce.enabled
      ? {
          positionM: reduce.positionM,
          rotationCapRad: reduce.rotationCapRad,
          minLeverM: reduce.minLeverM,
          scaleRel: reduce.scaleRel,
        }
      : null,
  };
}

/** Studio Pro's Character section request (`ExportCharacterSection` defaults for a profile and a format). */
function proCharacter(
  name: string,
  character: CharacterId,
  profile: string,
  format: 'vrm' | 'glb',
  clips: 'slots' | 'target' | readonly ClipId[],
) {
  return {
    character,
    fileName: name,
    format,
    profile,
    clips,
    includeProps: null,
    material: null,
    thumbnail: format === 'vrm' ? 'stored' : 'none',
    validate: true,
  };
}

const evidence: Record<string, Record<string, Written>> = {};
function record(subject: string, row: string, value: Written): Written {
  const rows = evidence[subject] ?? {};
  rows[row] = value;
  evidence[subject] = rows;
  return value;
}

describe('Share writes Studio Pro’s and Auto-Rig’s bytes (AS-ST-5)', { timeout: 600_000 }, () => {
  afterAll(() => {
    // the per-destination evidence (name, size, SHA-256) for the wp-note: `EKZA_SHARE_BYTES=<file>` writes it
    const out = process.env['EKZA_SHARE_BYTES'];
    if (out !== undefined && out !== '') writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
  });

  it('a model character (the Cube Lad rigged by Auto-Rig, with Walk), then made for OMOBA’s Wildspark', async () => {
    const app = await freshApp(31);
    const intake = await run<IntakeReport>(app, 'autorig.intake', {
      bytes: file('fixtures/models/cube-lad.glb'),
      name: 'cube-lad.glb',
    });
    await run(app, 'skel.quickRig.start', { meshes: intake.meshes as MeshId[] });
    const { character } = await run<AutoRigRigResult>(app, 'autorig.rig', { straighten: false, rigidParts: false });
    await characterReady(app, character);
    await run(app, 'char.setVrmMeta', { character, patch: { authors: ['Tester'], licensePreset: 'cc0' } });
    await run(app, 'char.renderThumbnail', { character });
    const { clip: walk } = await run<{ clip: ClipId }>(app, 'autorig.clip.add', {
      character,
      clip: 'walk',
      params: { speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 },
    });
    const name = app.store.get('characters', character)?.name ?? '';

    // OMOBA & Ekza Space: Pro's Character section default == Auto-Rig ⑤ `ekza-vrm`
    const omoba = halo(app, 'omoba', 'destination');
    expect(omoba.op).toBe('file.exportCharacter');
    const omobaHalo = record('model', 'omoba (Halo)', await written(app, omoba.op, omoba.args));
    const omobaPro = record(
      'model',
      'omoba (Pro)',
      await written(app, 'file.exportCharacter', proCharacter(name, character, 'ekza/space-avatar-v1', 'vrm', 'slots')),
    );
    const omobaAutoRig = record(
      'model',
      'omoba (Auto-Rig)',
      await written(app, 'autorig.export', { character, target: 'ekza-vrm', fileName: '' }),
    );
    expect(omobaHalo.sha256).toBe(omobaPro.sha256);
    expect(omobaHalo.sha256).toBe(omobaAutoRig.sha256);

    // Game engine: Auto-Rig ⑤ `glb` == Pro's Character section, `local/generic`, GLB, every animation ticked
    const engine = halo(app, 'engine', 'destination');
    expect(engine).toMatchObject({ op: 'autorig.export', args: { target: 'glb' } });
    const engineHalo = record('model', 'engine (Halo)', await written(app, engine.op, engine.args));
    const enginePro = record(
      'model',
      'engine (Pro)',
      await written(app, 'file.exportCharacter', proCharacter(name, character, 'local/generic', 'glb', [walk])),
    );
    expect(engineHalo.sha256).toBe(enginePro.sha256);

    // Just the animations: Auto-Rig ⑤ `vrma` == Pro's VRMA export of the animation
    const animations = halo(app, 'animations', 'destination');
    const animationsHalo = record('model', 'animations (Halo)', await written(app, animations.op, animations.args));
    const animationsPro = record(
      'model',
      'animations (Pro)',
      await written(app, 'file.export', proFileExport(app, character, 'vrma', null, [walk])),
    );
    expect(animationsHalo.sha256).toBe(animationsPro.sha256);

    // More formats: rigged GLB (Pro's Character section, GLB) == Auto-Rig `glb`; animations only (Pro's dialog);
    // the OMOBA test kit (Auto-Rig ⑤ `omoba-kit`, Auto-Rig only)
    const rigged = halo(app, 'rigged', 'format');
    const riggedHalo = record('model', 'rigged GLB (Halo)', await written(app, rigged.op, rigged.args));
    expect(riggedHalo.sha256).toBe(engineHalo.sha256);
    const animGlb = halo(app, 'animationGlb', 'format');
    const animGlbHalo = record('model', 'animation-only GLB (Halo)', await written(app, animGlb.op, animGlb.args));
    const animGlbPro = record(
      'model',
      'animation-only GLB (Pro)',
      await written(app, 'file.export', proFileExport(app, character, 'animation-glb', null, [walk])),
    );
    expect(animGlbHalo.sha256).toBe(animGlbPro.sha256);
    const kit = halo(app, 'kit', 'format');
    const kitHalo = record('model', 'OMOBA kit (Halo)', await written(app, kit.op, kit.args));
    const kitAutoRig = record(
      'model',
      'OMOBA kit (Auto-Rig)',
      await written(app, 'autorig.export', { character, target: 'omoba-kit', fileName: '' }),
    );
    expect(kitHalo.sha256).toBe(kitAutoRig.sha256);

    // Into the original file: a character made in Ekza Studio has none (the card says so)
    expect(destinationChoice(app, 'original', DEFAULT_OPTIONS, WORDS)).toMatchObject({
      call: null,
      problem: 'made here',
    });

    // Made for OMOBA's Wildspark (C2): the OMOBA card is the hero package — Pro's *OMOBA character* profile ==
    // Auto-Rig ⑤ `omoba-hero` == `target.exportPackage`; More formats' kit is the developer zip
    await run(app, 'target.bind', { character, game: 'omoba', target: 'wildspark' });
    await run(app, 'target.slot.create', { character, slot: 'base.run', from: 'library', libraryClip: 'run' });
    const targets = await loadTargetKit(app);
    for (let round = 0; round < 3; round++) {
      const fix = targets
        .targetValidationRows(app, character, 'ekza/omoba-humanoid-v2')
        .find((row) => row.severity === 'error' && row.fix !== null)?.fix;
      if (fix === undefined || fix === null) break;
      await run(app, fix.op, fix.args);
    }
    const bound = halo(app, 'omoba', 'destination');
    expect(bound).toMatchObject({ op: 'target.exportPackage', profile: 'ekza/omoba-humanoid-v2' });
    const packageHalo = record('bound', 'OMOBA package (Halo)', await written(app, bound.op, bound.args));
    const packagePro = record(
      'bound',
      'OMOBA package (Pro)',
      await written(
        app,
        'file.exportCharacter',
        proCharacter(name, character, 'ekza/omoba-humanoid-v2', 'vrm', 'target'),
      ),
    );
    const packageAutoRig = record(
      'bound',
      'OMOBA package (Auto-Rig)',
      await written(app, 'autorig.export', { character, target: 'omoba-hero', fileName: '' }),
    );
    expect(packageHalo.sha256).toBe(packagePro.sha256);
    expect(packageHalo.sha256).toBe(packageAutoRig.sha256);
    const devZip = halo(app, 'kit', 'format');
    expect(devZip).toMatchObject({ op: 'target.exportPackage', args: { devZip: true } });
    const devHalo = record('bound', 'developer zip (Halo)', await written(app, devZip.op, devZip.args));
    const devPro = record(
      'bound',
      'developer zip (Pro)',
      await written(app, 'target.exportPackage', { character, devZip: true, fileName: name }),
    );
    const devAutoRig = record(
      'bound',
      'developer zip (Auto-Rig)',
      await written(app, 'autorig.export', { character, target: 'omoba-kit', fileName: '' }),
    );
    expect(devHalo.sha256).toBe(devAutoRig.sha256);
    expect(devHalo.bytes).toBeGreaterThan(0);
    expect(devPro.bytes).toBeGreaterThan(0);
  });

  it('an imported VRM (Polybot): OMOBA, the original file, the animations', async () => {
    const app = await freshApp(37);
    const { character } = await run<{ character: CharacterId }>(app, 'file.loadSample', { sample: 'polybot' });
    await characterReady(app, character);
    const { clip: walk } = await run<{ clip: ClipId }>(app, 'autorig.clip.add', {
      character,
      clip: 'walk',
      params: { speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 },
    });
    // OMOBA & Ekza Space: Auto-Rig ⑤ `ekza-vrm` == Pro's bake through `ekza/space-avatar-v1`
    const omoba = halo(app, 'omoba', 'destination');
    expect(omoba).toMatchObject({ op: 'autorig.export', args: { target: 'ekza-vrm' } });
    const omobaHalo = record('vrm', 'omoba (Halo)', await written(app, omoba.op, omoba.args));
    const omobaPro = record(
      'vrm',
      'omoba (Pro)',
      await written(
        app,
        'file.export',
        proFileExport(app, character, 'bake-into-model', 'ekza/space-avatar-v1', [walk]),
      ),
    );
    expect(omobaHalo.sha256).toBe(omobaPro.sha256);
    // Into the original file: Pro's Export dialog defaults (generic checks)
    const original = halo(app, 'original', 'destination');
    const originalHalo = record('vrm', 'original (Halo)', await written(app, original.op, original.args));
    const originalPro = record(
      'vrm',
      'original (Pro)',
      await written(app, 'file.export', proFileExport(app, character, 'bake-into-model', null, [walk])),
    );
    expect(originalHalo.sha256).toBe(originalPro.sha256);
    // Just the animations: Auto-Rig ⑤ `vrma` == Pro's VRMA
    const animations = halo(app, 'animations', 'destination');
    const animationsHalo = record('vrm', 'animations (Halo)', await written(app, animations.op, animations.args));
    const animationsPro = record(
      'vrm',
      'animations (Pro)',
      await written(app, 'file.export', proFileExport(app, character, 'vrma', null, [walk])),
    );
    expect(animationsHalo.sha256).toBe(animationsPro.sha256);
    // Game engine needs a GLB model: a VRM avatar is shared for OMOBA or into its own file
    expect(destinationChoice(app, 'engine', DEFAULT_OPTIONS, WORDS)).toMatchObject({ call: null });
  });

  it('an imported rigged glTF: Game engine and the original file', async () => {
    const app = await freshApp(41);
    const { character } = await run<{ character: CharacterId }>(app, 'file.loadSample', { sample: 'quaternius-ual' });
    await characterReady(app, character);
    const clips = app.store.query.clipsOfCharacter(character).map((clip) => clip.id);
    expect(clips.length).toBeGreaterThan(0);
    // Game engine: Auto-Rig ⑤ `glb` == Pro's bake through `local/generic`
    const engine = halo(app, 'engine', 'destination');
    const engineHalo = record('gltf', 'engine (Halo)', await written(app, engine.op, engine.args));
    const enginePro = record(
      'gltf',
      'engine (Pro)',
      await written(app, 'file.export', proFileExport(app, character, 'bake-into-model', 'local/generic', clips)),
    );
    expect(engineHalo.sha256).toBe(enginePro.sha256);
    const original = halo(app, 'original', 'destination');
    const originalHalo = record('gltf', 'original (Halo)', await written(app, original.op, original.args));
    const originalPro = record(
      'gltf',
      'original (Pro)',
      await written(app, 'file.export', proFileExport(app, character, 'bake-into-model', null, clips)),
    );
    expect(originalHalo.sha256).toBe(originalPro.sha256);
  });

  it('the scene’s static meshes: Prop for OMOBA and the static model', async () => {
    const app = await freshApp(43);
    await run(app, 'mesh.create.template', { template: 'handheld' });
    const roots = app.store.query.childrenOf(null, 'scene');
    expect(roots.length).toBe(1);
    const root = roots[0] as { id: string; name: string };
    const proStatic = (profile: string) => ({
      objects: [root.id],
      fileName: `${root.name.replace(/[^\w.-]+/g, '_') || 'model'}.glb`,
      profile,
    });
    const prop = halo(app, 'prop', 'destination');
    const propHalo = record('static', 'prop (Halo)', await written(app, prop.op, prop.args));
    const propPro = record(
      'static',
      'prop (Pro)',
      await written(app, 'file.exportModel', proStatic('ekza/omoba-handheld-v1')),
    );
    expect(propHalo.sha256).toBe(propPro.sha256);
    const plain = halo(app, 'static', 'format');
    const plainHalo = record('static', 'static GLB (Halo)', await written(app, plain.op, plain.args));
    const plainPro = record(
      'static',
      'static GLB (Pro)',
      await written(app, 'file.exportModel', proStatic('local/generic')),
    );
    expect(plainHalo.sha256).toBe(plainPro.sha256);
  });
});
