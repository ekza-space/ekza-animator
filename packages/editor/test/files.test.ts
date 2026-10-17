// The file pipeline (drag-and-drop, pickers, test API loadFile) and the browser services: importer resolution,
// the import dialog hand-off, confirmation before replacing a dirty project, asset verification, storage
// fallbacks, clipboard fallback and the toast queue.
import { EkzaError } from '@ekza-animator/anim-core';
import type { AssetId } from '@ekza-animator/doc';
import type { ImporterDef } from '@ekza-animator/editor-core';
import { DEFAULT_REDUCE } from '@ekza-animator/rig';
import { describe, expect, it } from 'vitest';
import { CHECK_ALL_CLIPS_MAX, defaultClipSelection, importOptions } from '../src/dialogs/ImportDialog';
import { createBrowserAssetStore, sha256Hex } from '../src/services/assets';
import { createBrowserClipboard } from '../src/services/clipboard';
import { createExportRecorder } from '../src/shell/exports';
import { createToastNotifier, MAX_TOASTS } from '../src/services/notify';
import { createLocalStorage, createMemoryStorage } from '../src/services/storage';
import { acceptAttribute, resolveImporter } from '../src/shell/importers';
import { clipSummaries, isRestricted, licenseLabel, type ModelSummary } from '../src/shell/summary';
import { createTestShell } from './shell-helpers';

const MODEL: ImporterDef = {
  id: 'gltf-model',
  label: 'glTF / VRM model',
  extensions: ['glb', 'vrm'],
  op: 'file.importModel',
};
const PROJECT: ImporterDef = {
  id: 'ekzanim',
  label: 'Project',
  extensions: ['ekzanim', 'ekzanim.json'],
  op: 'file.openProject',
};
const JSON_DOC: ImporterDef = { id: 'json', label: 'JSON', extensions: ['json'], op: 'acme.json' };
const ANIM_GLB: ImporterDef = {
  id: 'anim-glb',
  label: 'Animation-only GLB',
  extensions: ['glb'],
  op: 'file.importAnimation',
  sniff: (_name, bytes) => bytes[0] === 42,
};

const SUMMARY: ModelSummary = {
  format: 'vrm0',
  formatLabel: 'VRM 0.x',
  byteLength: 3,
  meshes: 1,
  nodes: 2,
  skins: 1,
  clips: [],
  license: null,
  licenseLabel: 'CC0-1.0',
  restricted: false,
  warnings: [],
};

function withImporters(...importers: ImporterDef[]) {
  const test = createTestShell({ summarize: async () => SUMMARY });
  for (const def of importers) test.app.contribute({ kind: 'importer', def });
  const runs: { id: string; args: unknown }[] = [];
  for (const id of ['file.importModel', 'file.openProject', 'file.importAnimation', 'acme.json']) {
    test.app.contribute({
      kind: 'operator',
      def: {
        id: id as `${string}.${string}`,
        label: id,
        category: 'file',
        scope: 'global',
        apply: (_ctx, args) => runs.push({ id, args }),
      },
    });
  }
  return { ...test, runs };
}

describe('importer resolution', () => {
  it('picks the longest extension match, then content sniffing', () => {
    const registry = createTestShell().app.importers;
    for (const def of [MODEL, PROJECT, JSON_DOC, ANIM_GLB]) registry.register(def);
    expect(resolveImporter(registry, 'Hero.VRM', new Uint8Array())?.id).toBe('gltf-model');
    expect(resolveImporter(registry, 'scene.ekzanim.json', new Uint8Array())?.id).toBe('ekzanim');
    expect(resolveImporter(registry, 'data.json', new Uint8Array())?.id).toBe('json');
    expect(resolveImporter(registry, 'walk.glb', new Uint8Array([42]))?.id).toBe('anim-glb');
    expect(resolveImporter(registry, 'hero.glb', new Uint8Array([1]))?.id).toBe('gltf-model');
    expect(resolveImporter(registry, 'notes.txt', new Uint8Array())).toBeNull();
    expect(acceptAttribute(registry)).toBe('.ekzanim,.ekzanim.json,.glb,.json,.vrm');
  });
});

describe('file pipeline', () => {
  it('opens the import dialog for models (summary first), then imports with the chosen options', async () => {
    const { shell, app, runs } = withImporters(MODEL);
    await shell.files.openFile('polybot.vrm', new Uint8Array([1, 2, 3]));
    expect(app.session.getState().dialog).toBe('import');
    expect(shell.ui.getState().pendingImport).toMatchObject({
      name: 'polybot.vrm',
      summary: SUMMARY,
      summaryError: null,
    });
    expect(runs).toEqual([]);
    const result = await shell.files.confirmImport({ clips: [3], secondaryControls: false });
    expect(result.status).toBe('finished');
    expect(app.session.getState().dialog).toBeNull();
    expect(shell.ui.getState().pendingImport).toBeNull();
    expect(runs).toEqual([
      {
        id: 'file.importModel',
        args: {
          name: 'polybot.vrm',
          bytes: new Uint8Array([1, 2, 3]),
          options: { clips: [3], secondaryControls: false },
        },
      },
    ]);
  });

  it('auto imports skip the dialog and pass the given options', async () => {
    const { shell, app, runs } = withImporters(MODEL);
    await shell.files.openFile('hero.glb', new Uint8Array([9]), { auto: true, importOptions: { clips: 'none' } });
    expect(app.session.getState().dialog).toBeNull();
    expect(runs).toEqual([
      { id: 'file.importModel', args: { name: 'hero.glb', bytes: new Uint8Array([9]), options: { clips: 'none' } } },
    ]);
  });

  it('keeps importing when the summary cannot be read', async () => {
    const test = createTestShell({
      summarize: async () => {
        throw new Error('io not ready');
      },
    });
    test.app.contribute({ kind: 'importer', def: MODEL });
    await test.shell.files.openFile('hero.glb', new Uint8Array([1]));
    expect(test.shell.ui.getState().pendingImport).toMatchObject({
      summary: null,
      summaryError: { code: null, message: 'io not ready' },
    });
    await test.shell.runFromUi('ui.close');
    const coded = createTestShell({
      summarize: async () => {
        throw new EkzaError('not-glb', 'Not a binary glTF file');
      },
    });
    coded.app.contribute({ kind: 'importer', def: MODEL });
    await coded.shell.files.openFile('hero.glb', new Uint8Array([1]));
    expect(coded.shell.ui.getState().pendingImport?.summaryError).toEqual({
      code: 'not-glb',
      message: 'Not a binary glTF file',
    });
  });

  it('asks before a project replaces unsaved work, and cancels on "no"', async () => {
    const { shell, app, runs } = withImporters(PROJECT);
    app.session.setState({ dirty: true });
    const opening = shell.files.openFile('old.ekzanim', new Uint8Array([5]));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = shell.ui.getState().confirm;
    expect(request?.confirmLabel).toBe('Discard and open');
    request?.resolve(false);
    await opening;
    expect(runs).toEqual([]);

    const again = shell.files.openFile('old.ekzanim', new Uint8Array([5]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    shell.ui.getState().confirm?.resolve(true);
    await again;
    expect(runs.map((r) => r.id)).toEqual(['file.openProject']);
  });

  it('reports failures once: unknown types reject, dropped files become toasts', async () => {
    const { shell, app, toasts } = createTestShell();
    app.contribute({ kind: 'importer', def: MODEL });
    await expect(shell.files.openFile('notes.txt', new Uint8Array())).rejects.toThrow('No importer');
    app.contribute({
      kind: 'operator',
      def: {
        id: 'file.importAnimation',
        label: 'Import Animation',
        category: 'file',
        scope: 'global',
        apply: () => {
          throw new Error('not a VRMA');
        },
      },
    });
    app.contribute({
      kind: 'importer',
      def: { id: 'vrma', label: 'VRMA', extensions: ['vrma'], op: 'file.importAnimation' },
    });
    await shell.files.openFiles([new File([new Uint8Array([1])], 'bad.vrma'), new File(['x'], 'notes.txt')]);
    expect(toasts.store.getState().toasts.map((t) => t.text)).toEqual([
      'Import Animation failed: not a VRMA',
      expect.stringContaining('notes.txt: No importer'),
    ]);
    // The test API's loadFile path still rejects with the operator's message.
    await expect(shell.files.openFile('bad.vrma', new Uint8Array([1]))).rejects.toThrow('not a VRMA');
  });
});

describe('import options', () => {
  it('maps the dialog state to ImportModelOptions, leaving untouched settings to the operator', () => {
    const all = importOptions({
      selected: new Set([0, 1]),
      clipCount: 2,
      fps: 'source',
      reduce: null,
      eulerFilter: true,
      secondaryControls: true,
    });
    expect(all).toEqual({ clips: 'all', clipFps: 'source', eulerFilter: true, secondaryControls: true });
    const some = importOptions({
      selected: new Set([7, 2]),
      clipCount: 46,
      fps: '24',
      reduce: false,
      eulerFilter: false,
      secondaryControls: false,
    });
    expect(some).toEqual({
      clips: [2, 7],
      clipFps: { num: 24, den: 1 },
      reduce: null,
      eulerFilter: false,
      secondaryControls: false,
    });
    const none = importOptions({
      selected: new Set(),
      clipCount: 3,
      fps: '30',
      reduce: true,
      eulerFilter: true,
      secondaryControls: true,
    });
    expect(none).toMatchObject({ clips: 'none', reduce: DEFAULT_REDUCE });
    expect(
      importOptions({
        selected: new Set(),
        clipCount: 0,
        fps: 'source',
        reduce: null,
        eulerFilter: true,
        secondaryControls: true,
      }),
    ).not.toHaveProperty('clips');
  });

  it('checks every embedded clip by default only when there are at most eight (§4.11.6)', () => {
    const clips = (count: number) => Array.from({ length: count }, (_, index) => ({ index }));
    expect([...defaultClipSelection(clips(3))]).toEqual([0, 1, 2]);
    expect(defaultClipSelection(clips(CHECK_ALL_CLIPS_MAX)).size).toBe(CHECK_ALL_CLIPS_MAX);
    expect(defaultClipSelection(clips(46)).size).toBe(0);
    expect(defaultClipSelection([]).size).toBe(0);
  });

  it('summarises embedded clips and licences from glTF JSON', () => {
    const clips = clipSummaries({
      asset: { version: '2.0' },
      accessors: [{ max: [1.5] }, { max: [2.25] }, {}],
      animations: [
        { name: 'Idle_Loop', channels: [{}, {}], samplers: [{ input: 0 }, { input: 1 }] },
        { channels: [{}], samplers: [{ input: 2 }] },
      ],
    });
    expect(clips).toEqual([
      { index: 0, name: 'Idle_Loop', channels: 2, duration: 2.25 },
      { index: 1, name: 'Animation 1', channels: 1, duration: null },
    ]);
    const license = {
      title: 'Bot',
      authors: ['PM'],
      licenseUrl: 'https://example.org/cc0',
      allowRedistribution: true,
      modification: 'allowModificationRedistribution' as const,
      commercialUsage: null,
      creditNotation: null,
      licenseName: 'CC0-1.0',
    };
    expect(licenseLabel(license, 'vrm0')).toBe('CC0-1.0');
    expect(licenseLabel(null, 'gltf')).toBe('No licence metadata');
    expect(isRestricted(license)).toBe(false);
    expect(isRestricted({ ...license, modification: 'prohibited' })).toBe(true);
    expect(isRestricted({ ...license, allowRedistribution: false })).toBe(true);
  });
});

describe('browser services', () => {
  it('stores assets by SHA-256 and verifies them on read', async () => {
    const store = createBrowserAssetStore();
    const bytes = new TextEncoder().encode('ekza');
    const record = await store.put(bytes, { name: 'a.glb', ext: 'glb', role: 'model' });
    expect(record).toMatchObject({ id: await sha256Hex(bytes), size: 4, mime: 'model/gltf-binary', role: 'model' });
    expect(await store.get(record.id)).toEqual(bytes);
    expect(await store.has(record.id)).toBe(true);
    expect(store.ids()).toEqual([record.id]);
    const resident = store.peek(record.id);
    if (resident !== undefined) resident[0] = 0; // corrupt the cached copy
    await expect(store.get(record.id)).rejects.toMatchObject({ code: 'asset-corrupt' });
    await expect(store.get('0'.repeat(64) as AssetId)).rejects.toMatchObject({ code: 'asset-missing' });
  });

  it('falls back to memory when storage throws, and namespaces keys', () => {
    const memory = createMemoryStorage();
    memory.setItem('k', 'v');
    expect(memory.getItem('k')).toBe('v');
    memory.removeItem('k');
    expect(memory.getItem('k')).toBeNull();
    const local = createLocalStorage('ekza-test:');
    local.setItem('x', '1');
    expect(localStorage.getItem('ekza-test:x')).toBe('1');
    expect(local.getItem('x')).toBe('1');
    localStorage.removeItem('ekza-test:x');
  });

  it('keeps an in-app clipboard copy when the system clipboard is unavailable', async () => {
    const clipboard = createBrowserClipboard();
    await clipboard.writeText('{"kind":"ekza.pose"}');
    expect(await clipboard.readText()).toBe('{"kind":"ekza.pose"}');
  });

  it('keeps at most three toasts with optional actions', () => {
    const notifier = createToastNotifier();
    for (let i = 0; i < 5; i++) notifier.toast({ kind: 'info', text: `t${i}` });
    notifier.toast({ kind: 'success', text: 'Deleted 9 keys', action: { label: 'Undo', op: 'edit.undo' } });
    const toasts = notifier.store.getState().toasts;
    expect(toasts).toHaveLength(MAX_TOASTS);
    expect(toasts.map((t) => t.text)).toEqual(['t3', 't4', 'Deleted 9 keys']);
    expect(toasts.at(-1)?.action).toEqual({ label: 'Undo', op: 'edit.undo' });
    notifier.dismiss(toasts[0]?.id ?? -1);
    expect(notifier.store.getState().toasts).toHaveLength(2);
  });

  it('records downloads for lastExport() only in e2e mode', async () => {
    const off = createExportRecorder(false);
    off.recordDownload({ fileName: 'a.vrma', bytes: new Uint8Array([1]), mime: 'model/gltf-binary' });
    expect(off.last()).toBeNull();
    const on = createExportRecorder(true);
    on.recordDownload({ fileName: 'a.vrma', bytes: new Uint8Array([1]), mime: 'model/gltf-binary' });
    expect(on.last()).toMatchObject({ fileName: 'a.vrma', lints: [], readBack: null });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(on.last()?.sha256).toBe(await sha256Hex(new Uint8Array([1])));
  });
});
