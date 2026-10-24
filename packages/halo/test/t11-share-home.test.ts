// T11's pure parts and services (STUDIO-TOUCH-SPEC §13.3, §17, §9 J10, §9.11, S9–S11; T11): the Share baker's two-step
// save (a ticket from `FileService.save`, the plain download without one, an export never touching the unsaved dot,
// the held toasts), the destination calls per subject and their Advanced options, Home's Continue cards and doors, the
// resume record, Bring a model's routing by sniffed kind, the storage card, the recipes and the OMOBA profile of a
// character made for a game.
import type { AutosaveSlotInfo, EditorApp, OperatorResult, SaveTicket } from '@ekza-studio/editor-core';
import { describe, expect, it, vi } from 'vitest';
import { agoText, continueCards, primaryDoor, sampleCall, startCall } from '../src/home/model';
import { readResume, resumable } from '../src/home/resume';
import { storageCardOf } from '../src/home/save';
import { routeOf } from '../src/intake/intake';
import { destinationOf } from '../src/path/destinations';
import { OMOBA_PACKAGE_PROFILE, profileFor } from '../src/path/readiness';
import { addAnimationsRecipe } from '../src/recipes/addAnimations';
import { loopItRecipe } from '../src/recipes/loopIt';
import { matchRecipes, type RecipeHost, runRecipe } from '../src/recipes/recipe';
import { SEARCH_RECIPES } from '../src/recipes';
import { WAVE_FRAMES, waveAims, waveRecipe } from '../src/recipes/wave';
import { createBaker, holdingFiles, lintsOf } from '../src/sheets/share/bake';
import {
  DEFAULT_OPTIONS,
  destinationChoice,
  moreFormatChoice,
  optionsFor,
  proFileExport,
  type ShareWords,
  shareSubject,
} from '../src/sheets/share/model';
import { everyOperator, polybotApp, runOk } from './support';

const WORDS: ShareWords = {
  noCharacter: 'no character',
  noScene: 'no scene',
  madeHere: 'made here',
  isVrm: (n) => `${n} is a VRM`,
  notVrm: (n) => `${n} is not a VRM`,
  notVrm0: 'not VRM 0.x',
  notBound: 'not bound',
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the Share baker: the two-step save (S9, ST-21, ST-33)', () => {
  /** A runner whose export downloads one file and toasts as the export operators do. */
  const exporter =
    (app: EditorApp, name: string, bytes: Uint8Array) =>
    async (op: string): Promise<OperatorResult<unknown>> => {
      app.services.files.download(name, bytes, 'model/gltf-binary');
      app.services.notify.toast({ kind: 'success', text: `Exported ${name}` });
      return {
        status: 'finished',
        value: [{ lints: [{ code: 'vrm.x', severity: 'warning', message: 'w' }] }],
        op,
      } as never;
    };

  it('holds the file in the page, then delivers it from the button through a SaveTicket', async () => {
    const app = await everyOperator();
    const downloads: string[] = [];
    const files: { download: (name: string, bytes: Uint8Array, mime: string) => void } = app.services.files;
    files.download = (name) => downloads.push(name);
    const deliver = vi.fn<() => Promise<'shared'>>(() => Promise.resolve('shared'));
    const saved: { name: string; bytes: Uint8Array }[] = [];
    (app.services.files as { save?: unknown }).save = (file: { name: string; bytes: Uint8Array }): SaveTicket => {
      saved.push(file);
      return { deliver } as unknown as SaveTicket;
    };
    const toasts: string[] = [];
    (app.services.notify as { toast: (t: { text: string }) => void }).toast = (t) => toasts.push(t.text);
    const baker = createBaker(app, exporter(app, 'Polybot.vrm', new Uint8Array([1, 2, 3])));
    baker.prepare({ op: 'file.exportCharacter', args: {}, format: 'VRM 1.0', profile: null }, 'k1');
    expect(baker.get().status).toBe('preparing');
    await settle();
    await settle();
    expect(baker.get()).toMatchObject({ status: 'ready', fileName: 'Polybot.vrm', bytes: 3, delivered: null });
    expect(baker.get().lints).toEqual([{ code: 'vrm.x', severity: 'warning', message: 'w' }]);
    // nothing left the page: no download, no "Exported" toast before the tap
    expect(downloads).toEqual([]);
    expect(toasts).toEqual([]);
    expect(saved.map((f) => f.name)).toEqual(['Polybot.vrm']);
    await expect(baker.deliver()).resolves.toBe('shared');
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(baker.get().delivered).toBe('shared');
    // the file service's download is the page's own again
    expect(files.download).toBeTypeOf('function');
  });

  it('downloads directly where the file service has no tickets (Node hosts, harnesses)', async () => {
    const app = await everyOperator();
    const baker = createBaker(app, exporter(app, 'a.glb', new Uint8Array([9])));
    baker.prepare({ op: 'autorig.export', args: {}, format: 'GLB', profile: null }, 'k');
    await settle();
    await settle();
    const downloads: string[] = [];
    (app.services.files as { download: (name: string) => void }).download = (name) => downloads.push(name);
    await expect(baker.deliver()).resolves.toBe('downloaded');
    expect(downloads).toEqual(['a.glb']);
  });

  it('a blocked export offers no file and says why; a refused one says its reason', async () => {
    const app = await everyOperator();
    const blocked = createBaker(app, () =>
      Promise.resolve({
        status: 'finished',
        value: { lints: [{ code: 'vrm.licence-unset', severity: 'error', message: 'Choose a licence' }] },
      } as never),
    );
    blocked.prepare({ op: 'target.exportPackage', args: {}, format: 'VRM', profile: null }, 'b');
    await settle();
    await settle();
    expect(blocked.get()).toMatchObject({ status: 'blocked', reason: 'Choose a licence', fileName: null });
    await expect(blocked.deliver()).resolves.toBeNull();
    const refused = createBaker(app, () => Promise.resolve({ status: 'cancelled', reason: 'No character' } as never));
    refused.prepare({ op: 'autorig.export', args: {}, format: 'GLB', profile: null }, 'r');
    await settle();
    expect(refused.get()).toMatchObject({ status: 'failed', reason: 'No character' });
  });

  it('an export never clears the unsaved dot (only a project save does)', async () => {
    const { app } = await polybotApp();
    expect(app.session.getState().dirty).toBe(true);
    const { result, files } = await holdingFiles(app, () =>
      app.runUntyped('autorig.export', {
        character: app.store.list('characters')[0]?.id,
        target: 'vrma',
        fileName: '',
      }),
    );
    // Polybot has no animation yet: the export is refused, nothing written, the dot stays
    expect(result.status).not.toBe('failed');
    expect(files.length).toBeLessThanOrEqual(1);
    expect(app.session.getState().dirty).toBe(true);
  });

  it('re-emits the toasts that are not about the export', async () => {
    const app = await everyOperator();
    const seen: string[] = [];
    (app.services.notify as { toast: (t: { text: string }) => void }).toast = (t) => seen.push(t.text);
    await holdingFiles(app, async () => {
      app.services.notify.toast({ kind: 'success', text: 'Exported x.vrm' });
      app.services.notify.toast({ kind: 'error', text: 'x.vrm was not saved: no' });
      app.services.notify.toast({ kind: 'info', text: 'Autosaved' });
      return { status: 'finished', value: null } as never;
    });
    expect(seen).toEqual(['Autosaved']);
  });

  it('reads the lints of every export result shape', () => {
    const lint = { code: 'a', severity: 'error', message: 'm' };
    expect(lintsOf([{ lints: [lint] }, { lints: [lint] }])).toEqual([lint]);
    expect(lintsOf({ lints: [lint, { code: 'b', severity: 'odd', message: 1 }] })).toEqual([
      lint,
      { code: 'b', severity: 'info', message: 'b' },
    ]);
    expect(lintsOf(null)).toEqual([]);
  });
});

describe('destination calls (§7.3, §13.3)', () => {
  it('nothing loaded: every character destination says so and sends to Rig; Just exploring has no call', async () => {
    const app = await everyOperator();
    expect(shareSubject(app)).toMatchObject({ character: null, kind: null });
    for (const id of ['omoba', 'engine', 'animations', 'original'] as const) {
      expect(destinationChoice(app, id, DEFAULT_OPTIONS, WORDS)).toMatchObject({
        call: null,
        problem: 'no character',
        go: { stage: 'rig' },
      });
    }
    expect(destinationChoice(app, 'prop', DEFAULT_OPTIONS, WORDS)).toMatchObject({ call: null, go: { stage: 'make' } });
    expect(destinationChoice(app, 'exploring', DEFAULT_OPTIONS, WORDS).call).toBeNull();
  });

  it('an imported VRM: OMOBA bakes through Auto-Rig ⑤, Game engine refuses, the original file is Pro’s bake', async () => {
    const { app, character } = await polybotApp();
    // Polybot ships as a VRM 0.x
    expect(shareSubject(app)).toMatchObject({ kind: 'vrm0', bound: false, name: 'Polybot' });
    expect(destinationChoice(app, 'omoba', DEFAULT_OPTIONS, WORDS).call).toMatchObject({
      op: 'autorig.export',
      args: { character, target: 'ekza-vrm', fileName: '' },
      profile: 'ekza/space-avatar-v1',
    });
    expect(destinationChoice(app, 'engine', DEFAULT_OPTIONS, WORDS)).toMatchObject({
      call: null,
      go: { destination: 'omoba' },
    });
    const original = destinationChoice(app, 'original', DEFAULT_OPTIONS, WORDS).call;
    expect(original?.op).toBe('file.export');
    expect(original?.args).toEqual(proFileExport(app, character, 'bake-into-model', DEFAULT_OPTIONS));
    expect(moreFormatChoice(app, 'vrm0', DEFAULT_OPTIONS, WORDS).call).toMatchObject({
      op: 'file.export',
      format: 'VRM 0.x',
    });
    expect(destinationChoice(app, 'omoba', DEFAULT_OPTIONS, WORDS).call?.format).toBe('VRM 0.x (kept)');
    expect(moreFormatChoice(app, 'kit', DEFAULT_OPTIONS, WORDS).call?.op).toBe('autorig.export');
  });

  it('Advanced changes only what Pro’s dialog offers for the call; its defaults are Pro’s', async () => {
    const { app, character } = await polybotApp();
    expect(app.prefs.getState().exportReduce.enabled).toBe(true);
    const pro = proFileExport(app, character, 'bake-into-model', DEFAULT_OPTIONS);
    expect(pro).toMatchObject({
      kind: 'bake-into-model',
      fileNamePattern: '{character}',
      includeConstantTracks: true,
      acknowledgeLicense: false,
      profile: null,
    });
    expect(pro['reduce']).not.toBeNull();
    const changed = proFileExport(app, character, 'bake-into-model', {
      ...DEFAULT_OPTIONS,
      reduce: false,
      closeLoop: false,
      constantTracks: false,
      acknowledge: true,
    });
    expect(changed).toMatchObject({
      reduce: null,
      closeLoop: false,
      includeConstantTracks: false,
      acknowledgeLicense: true,
    });
    expect(optionsFor(null)).toEqual([]);
    expect(optionsFor({ op: 'autorig.export', args: {}, format: '', profile: null })).toEqual([]);
    expect(optionsFor({ op: 'file.export', args: { kind: 'bake-into-model' }, format: '', profile: null })).toContain(
      'acknowledge',
    );
    expect(optionsFor({ op: 'file.exportModel', args: {}, format: '', profile: null })).toEqual([
      'colourOutput',
      'material',
    ]);
  });
});

describe('Home (§4.2 A, §17, J10)', () => {
  const slot = (id: string, savedAt: number, extra: Partial<AutosaveSlotInfo> = {}): AutosaveSlotInfo => ({
    id,
    projectName: 'Cube Lad',
    savedAt,
    characters: 1,
    clips: 3,
    bytes: 10,
    appVersion: '0',
    schemaVersion: 4,
    ...extra,
  });

  it('says when, in plain words', () => {
    const now = 10 * 24 * 3_600_000;
    expect(agoText(now - 10_000, now)).toBe('just now');
    expect(agoText(now - 2 * 60_000, now)).toBe('2 min ago');
    expect(agoText(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(agoText(now - 30 * 3_600_000, now)).toBe('yesterday');
    expect(agoText(now - 4 * 24 * 3_600_000, now)).toBe('4 days ago');
  });

  it('lists the orphaned slots newest first; Try a sample is the primary door only when there is nothing to continue', () => {
    const now = 1_000_000_000;
    const cards = continueCards([slot('as_a', now - 3_600_000), slot('as_b', now - 120_000, { projectName: '' })], now);
    expect(cards.map((c) => c.slot)).toEqual(['as_b', 'as_a']);
    expect(cards[0]).toMatchObject({ name: 'Untitled', detail: '2 min ago · 1 character · 3 animations' });
    expect(primaryDoor(cards)).toBe('continue');
    expect(primaryDoor([])).toBe('sample');
  });

  it('samples and starts run Pro’s and Auto-Rig’s own operators', () => {
    expect(sampleCall('polybot')).toEqual({ op: 'file.loadSample', args: { sample: 'polybot' } });
    expect(sampleCall('cube-lad')).toEqual({ op: 'autorig.sample', args: { sample: 'cube-lad' } });
    expect(startCall('smooth')).toEqual({
      op: 'mesh.create.template',
      args: { template: 'humanoidBody', style: 'smooth' },
    });
    expect(startCall('blocky')?.args).toEqual({ template: 'humanoidBody', style: 'segmented' });
    expect(startCall('cubeLad')).toBeNull();
  });

  it('the resume record names this tab’s slot; it restores only an orphaned one', () => {
    const storage = new Map<string, string>();
    const fake = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    };
    expect(readResume(fake)).toBeNull();
    storage.set(
      'ekza-studio:halo:resume:v1',
      JSON.stringify({ slot: 'as_x', savedAt: 5, projectName: 'P', frame: 12, selection: { controls: ['c'] } }),
    );
    const record = readResume(fake);
    expect(record).toEqual({
      slot: 'as_x',
      savedAt: 5,
      projectName: 'P',
      frame: 12,
      selection: { controls: ['c'], objects: [], joints: [] },
    });
    expect(resumable(record, [slot('as_y', 1)])).toBeNull();
    expect(resumable(record, [slot('as_x', 5)])?.id).toBe('as_x');
    storage.set('ekza-studio:halo:resume:v1', '{"slot": 3}');
    expect(readResume(fake)).toBeNull();
  });

  it('routes a picked file by its sniffed kind (S10)', () => {
    expect(routeOf('glb')).toBe('model');
    expect(routeOf('vrm')).toBe('model');
    expect(routeOf('project')).toBe('model');
    expect(routeOf('vrma')).toBe('animation');
    expect(routeOf('gltf')).toBe('host');
    expect(routeOf('projectJson')).toBe('host');
    expect(routeOf('zip')).toBe('unsupported');
    expect(routeOf('unknown')).toBe('unsupported');
  });

  it('the storage card: iOS only, after the first project save; keep, then Add to Home Screen', () => {
    const fresh = { backedUp: false, kept: null, dismissed: false };
    expect(storageCardOf(fresh, true, false)).toBe('hidden');
    expect(storageCardOf({ ...fresh, backedUp: true }, false, false)).toBe('hidden');
    expect(storageCardOf({ ...fresh, backedUp: true }, true, false)).toBe('keep');
    expect(storageCardOf({ ...fresh, backedUp: true, kept: true }, true, false)).toBe('homeScreen');
    expect(storageCardOf({ ...fresh, backedUp: true, kept: false }, true, true)).toBe('hidden');
    expect(storageCardOf({ ...fresh, backedUp: true, dismissed: true }, true, false)).toBe('hidden');
  });
});

describe('recipes (§9.11, §8)', () => {
  it('the wave phrases: once or twice, either hand; a weak query offers nothing silently', () => {
    expect(waveRecipe.match('wave')).toEqual({ times: 1, side: 'left' });
    expect(waveRecipe.match('make him wave twice')).toEqual({ times: 2, side: 'left' });
    expect(waveRecipe.match('wave with the right hand 3 times')).toEqual({ times: 3, side: 'right' });
    expect(waveRecipe.match('walk')).toBeNull();
    expect(matchRecipes(SEARCH_RECIPES, 'loop it').map((m) => m.id)).toEqual(['loopIt']);
    expect(matchRecipes(SEARCH_RECIPES, '')).toEqual([]);
    expect(matchRecipes(SEARCH_RECIPES, 'fix for omoba').map((m) => m.id)).toEqual(['fixForOmoba']);
  });

  it('the wave is the reference script: a two-second animation, then the aims every few frames, mirrored', async () => {
    const { app, character } = await polybotApp();
    const plan = waveRecipe.plan(app, { times: 2, side: 'right' });
    if ('problem' in plan) throw new Error(plan.problem);
    expect(plan.steps[0]).toEqual({
      op: 'clip.new',
      args: { character, name: 'Wave', fps: { num: 30, den: 1 }, range: { start: 0, end: WAVE_FRAMES } },
    });
    expect(plan.steps.slice(1).map((s) => s.op)).toEqual(Array(5).fill('pose.goals'));
    const third = plan.steps[3];
    if (third === undefined || !('argsFrom' in third)) throw new Error('the keys take the new animation');
    expect(third.argsFrom([{ clip: 'clp_1' }])).toMatchObject({ clip: 'clp_1', frame: 30, aims: waveAims('right', 2) });
    expect(waveAims('right', 1)[0]?.direction).toEqual([-0.8, 0.6, 0]);
    expect(waveAims('left', 1)[1]?.direction).toEqual([-0.25, 0.97, 0.1]);
    // runs headless on Polybot: one clip and the keys, each its own undo step; Undo all reverts exactly those
    const toasts: { text: string; action?: { run(): void } }[] = [];
    const host: RecipeHost = { app, run: (op, args) => app.runUntyped(op, args), toast: (t) => toasts.push(t) };
    const outcome = await runRecipe(host, waveRecipe, { times: 1, side: 'left' });
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    expect(outcome.steps.length).toBe(4);
    const wave = app.store.query.clipsOfCharacter(character).find((c) => c.name === 'Wave');
    expect(wave?.range).toEqual({ start: 0, end: WAVE_FRAMES });
    expect(toasts.at(-1)?.text).toContain('done');
    toasts.at(-1)?.action?.run();
    await vi.waitFor(() =>
      expect(app.store.query.clipsOfCharacter(character).some((c) => c.name === 'Wave')).toBe(false),
    );
  });

  it('Add animations is Auto-Rig ④’s starter set; Loop it needs an animation; a refusal stops and says why', async () => {
    const empty = await everyOperator();
    expect(addAnimationsRecipe.plan(empty, {})).toEqual({ problem: 'it needs a rigged character' });
    const { app, character } = await polybotApp();
    const plan = addAnimationsRecipe.plan(app, {});
    if ('problem' in plan) throw new Error(plan.problem);
    expect(plan.steps.map((step) => ('args' in step ? (step.args as { clip: string }).clip : null))).toEqual([
      'idle',
      'walk',
      'run',
    ]);
    expect(plan.steps[0]).toMatchObject({ op: 'autorig.clip.add', args: { character, clip: 'idle' } });
    expect((plan.steps[0] as { args: { params: unknown } }).args.params).toMatchObject({ speed: 1, mirror: false });
    expect(loopItRecipe.plan(empty, {})).toEqual({ problem: 'it needs an animation' });
    const toasts: string[] = [];
    const stopped = await runRecipe(
      {
        app,
        run: () => Promise.resolve({ status: 'cancelled', reason: 'Nope' } as never),
        toast: (t) => toasts.push(t.text),
      },
      addAnimationsRecipe,
      {},
    );
    expect(stopped).toMatchObject({ status: 'stopped', reason: 'Nope', steps: [] });
    expect(toasts.at(-1)).toContain('stopped: Nope');
    await runOk(app, 'edit.undo');
  });
});

describe('the OMOBA profile of a character made for a game (P-T6B-5)', () => {
  it('is C2’s hero package profile when the character is bound, the destination’s otherwise', async () => {
    const { app, character } = await polybotApp();
    const omoba = destinationOf('omoba');
    expect(profileFor(app, omoba, character)).toBe('ekza/space-avatar-v1');
    expect(profileFor(app, destinationOf('original'), character)).toBeNull();
    const get = app.store.get.bind(app.store) as (table: string, id: string) => unknown;
    const spy = vi
      .spyOn(app.store, 'get')
      .mockImplementation(((table: string, id: string) =>
        table === 'ekza.targets' ? { deleted: null } : get(table, id)) as never);
    expect(profileFor(app, omoba, character)).toBe(OMOBA_PACKAGE_PROFILE);
    expect(profileFor(app, destinationOf('engine'), character)).toBe('local/generic');
    spy.mockRestore();
  });
});
