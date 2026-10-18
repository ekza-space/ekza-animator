// Dialogs with the fake app: import summary (format and licence badges, clip checklist, reduce, options), export
// (kinds from the exporter registry, clips, profiles filtered by kind, poll reasons, results and lints), the
// shortcut sheet and preferences; plus the frame gate that keeps demand rendering alive.
import { type EditorApp, GLOBAL_SCOPE, type ExporterDef } from '@ekza-animator/editor-core';
import type { CharacterId, ClipId } from '@ekza-animator/doc';
import {
  DEFAULT_EXPORT_REDUCE,
  type ExportArtifact,
  type ExportProfileDef,
  type ExportRequest,
} from '@ekza-animator/io';
import { NumberField } from '@ekza-animator/ui';
import { type JSX, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DialogHost } from '../src/dialogs/DialogHost';
import { count, defaultExportClips, exportWarnings, statsLine } from '../src/dialogs/ExportDialog';
import { shortcutRows } from '../src/dialogs/ShortcutsDialog';
import { createFrameGate } from '../src/gl/frameGate';
import type { ModelSummary } from '../src/shell/summary';
import { byTestId, render, update } from './render';
import { createTestShell, ShellFrame, settle, waitFor, waveFixtures } from './shell-helpers';

const SUMMARY: ModelSummary = {
  format: 'gltf',
  formatLabel: 'glTF 2.0',
  byteLength: 1024,
  meshes: 1,
  nodes: 70,
  skins: 1,
  clips: [
    { index: 0, name: 'Idle_Loop', channels: 60, duration: 2.5 },
    { index: 1, name: 'Walk_Loop', channels: 60, duration: 1 },
    { index: 2, name: 'Jump', channels: 60, duration: null },
  ],
  license: null,
  licenseLabel: 'No licence metadata',
  restricted: false,
  warnings: ['Compressed meshes are decoded for display; compressed animation data cannot be edited.'],
};

const body = (id: string): HTMLElement => byTestId(document.body, id);
const checkbox = (id: string): HTMLInputElement => body(id) as HTMLInputElement;

describe('import dialog', () => {
  it('shows the summary and imports only the checked clips with the chosen fps and reduction', async () => {
    const test = createTestShell({ summarize: async () => SUMMARY });
    const received: unknown[] = [];
    test.app.contribute({
      kind: 'operator',
      def: {
        id: 'file.importModel',
        label: 'Import',
        category: 'file',
        scope: GLOBAL_SCOPE,
        apply: (_c, a) => received.push(a),
      },
    });
    test.app.contribute({
      kind: 'importer',
      def: { id: 'gltf-model', label: 'Model', extensions: ['glb', 'vrm'], op: 'file.importModel' },
    });
    const view = await render(
      <ShellFrame shell={test.shell}>
        <DialogHost />
      </ShellFrame>,
    );
    await update(() => test.shell.files.openFile('ual.glb', new Uint8Array(1024)));
    await waitFor(() => document.querySelector('[data-testid="import-dialog"]') !== null);
    expect(body('import-format-badge').textContent).toBe('glTF 2.0');
    expect(body('import-license-badge').textContent).toBe('No licence metadata');
    expect(body('import-dialog').textContent).toContain('Compressed meshes');
    expect([0, 1, 2].map((i) => checkbox(`import-clip-${i}`).checked)).toEqual([true, true, true]);

    expect(body('import-confirm').textContent).toBe('Import');
    await update(() => body('import-clips-none').click());
    // Acceptance round 1: with nothing checked the model imports with an empty clip; the dialog says so.
    expect(body('import-confirm').textContent).toBe('Import without clips');
    expect(body('import-clips-count').textContent).toContain('0 of 3 selected');
    expect(body('import-clips-count').textContent).toContain('empty clip');
    await update(() => checkbox('import-clip-0').click());
    expect(body('import-confirm').textContent).toBe('Import');
    expect([0, 1, 2].map((i) => checkbox(`import-clip-${i}`).checked)).toEqual([true, false, false]);
    expect(checkbox('import-reduce').checked).toBe(true); // prefs.reduceOnImport 'auto'
    await update(() => checkbox('import-reduce').click());
    expect(checkbox('import-euler-filter').checked).toBe(true);
    await update(() => checkbox('import-euler-filter').click());
    const fps = body('import-fps') as HTMLSelectElement;
    await update(() => {
      fps.value = '24';
      fps.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await update(() => body('import-confirm').click());
    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual({
      name: 'ual.glb',
      bytes: new Uint8Array(1024),
      options: {
        clips: [0],
        clipFps: { num: 24, den: 1 },
        reduce: null,
        eulerFilter: false,
        secondaryControls: true,
      },
    });
    expect(test.app.session.getState().dialog).toBeNull();
    await view.unmount();
  });

  it('without a pending file it offers the file picker and samples', async () => {
    const test = createTestShell();
    const view = await render(
      <ShellFrame shell={test.shell}>
        <DialogHost />
      </ShellFrame>,
    );
    await update(() => test.shell.runFromUi('ui.open', { dialog: 'import' }));
    await waitFor(() => document.querySelector('[data-testid="import-picker"]') !== null);
    expect(document.querySelector('[data-testid="import-dialog"]')).toBeNull();
    expect(body('import-choose')).toBeTruthy();
    expect((body('import-sample-polybot') as HTMLButtonElement).disabled).toBe(true); // no file.loadSample here
    await view.unmount();
  });
});

describe('export dialog', () => {
  it('builds the export request from the registries and shows lints after exporting', async () => {
    const { snapshot, skeleton } = await waveFixtures();
    const test = createTestShell({ snapshot, skeleton });
    const requests: ExportRequest[] = [];
    const artifact: ExportArtifact = {
      kind: 'vrma',
      fileName: 'Synthetic_wave.vrma',
      mime: 'model/gltf-binary',
      bytes: new Uint8Array([1]),
      sha256: 'f00',
      lints: [{ code: 'vrma.non-hips-translation', severity: 'warning', message: 'Dropped translation' }],
      readBack: { ok: true, animations: 1, channels: 3, maxRotationErrorRad: 0, maxTranslationErrorM: 0 },
      validation: null,
      stats: { clips: 1, channels: 3, keys: 3 },
    };
    const exporter = (id: string, label: string, poll: ExporterDef['poll']): ExporterDef => ({
      id,
      label,
      extension: () => 'glb',
      poll,
      run: async () => [artifact],
    });
    test.app.contribute({ kind: 'exporter', def: exporter('bake-into-model', 'Bake into model', () => true) });
    test.app.contribute({
      kind: 'exporter',
      def: exporter('vrma', 'VRMA', () => ({ ok: false, reason: 'Not humanoid' })),
    });
    const profile = (id: string, kind: string): ExportProfileDef => ({
      id,
      label: id,
      platform: 'universal',
      profile: id,
      kind,
      maxBytes: 1,
      jsonMaxBytes: 1,
      ekza: true,
      rules: [],
    });
    test.app.contribute({ kind: 'exportProfile', def: profile('ekza/space-avatar-v1', 'bake-into-model') });
    test.app.contribute({ kind: 'exportProfile', def: profile('ekza/vrma-humanoid-v1', 'vrma') });
    test.app.contribute({
      kind: 'operator',
      def: {
        id: 'file.export',
        label: 'Export',
        category: 'file',
        scope: GLOBAL_SCOPE,
        apply: (_ctx, args) => {
          requests.push(args as ExportRequest);
          return [artifact];
        },
      },
    });
    const view = await render(
      <ShellFrame shell={test.shell}>
        <DialogHost />
      </ShellFrame>,
    );
    await update(() => test.shell.runFromUi('ui.open', { dialog: 'export' }));
    await waitFor(() => document.querySelector('[data-testid="export-dialog"]') !== null);
    expect(body('export-kind-bake-into-model').getAttribute('aria-checked')).toBe('true');
    expect(checkbox('export-clip-clp_SyntheticWave001').checked).toBe(true);
    expect(checkbox('export-close-loop').checked).toBe(true);
    const profiles = [...(body('export-profile') as HTMLSelectElement).options].map((o) => o.value);
    expect(profiles).toEqual(['', 'ekza/space-avatar-v1']);

    await update(() => body('export-kind-vrma').click());
    expect(body('export-dialog').textContent).toContain('Not humanoid');
    expect((body('export-confirm') as HTMLButtonElement).disabled).toBe(true);

    await update(() => body('export-kind-bake-into-model').click());
    const select = body('export-profile') as HTMLSelectElement;
    await update(() => {
      select.value = 'ekza/space-avatar-v1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await update(() => body('export-confirm').click());
    await waitFor(() => requests.length === 1);
    expect(requests[0]).toEqual({
      kind: 'bake-into-model',
      character: 'chr_SyntheticWave001',
      clips: ['clp_SyntheticWave001'],
      fileNamePattern: '{character}',
      closeLoop: true, // the wave clip loops (§4.11.10 default)
      includeConstantTracks: true,
      acknowledgeLicense: false,
      profile: 'ekza/space-avatar-v1',
      // M2A-SPEC §5.16: "Reduce keys" is checked by default (prefs.exportReduce) with the R02 tolerances.
      reduce: DEFAULT_EXPORT_REDUCE,
    });
    await waitFor(() => (body('export-lints').textContent ?? '').includes('vrma.non-hips-translation'));
    expect(body('export-lints').textContent).toContain('Read-back OK');
    expect(body('export-stats').textContent).toBe('1 clip · 3 channels · 3 keys'); // acceptance: not "1 clips"
    await view.unmount();
  });

  it('puts every count of the results in the right number (acceptance: "1 clips")', () => {
    expect([count(0, 'clip'), count(1, 'clip'), count(2, 'clip')]).toEqual(['0 clips', '1 clip', '2 clips']);
    expect(statsLine({ clips: 1, channels: 1, keys: 1 })).toBe('1 clip · 1 channel · 1 key');
    expect(statsLine({ clips: 2, channels: 0, keys: 12 })).toBe('2 clips · 0 channels · 12 keys');
    // The node-constraint warning agrees with its count too.
    const appWith = (constraints: number): EditorApp =>
      ({
        store: { get: () => ({ format: 'vrm' }) },
        characters: {
          get: () => ({
            skeleton: { nodeConstraints: Array.from({ length: constraints }, () => ({})), springJoints: [] },
          }),
        },
      }) as unknown as EditorApp;
    const character = 'chr_x' as CharacterId;
    expect(exportWarnings(appWith(1), character, 'bake-into-model')).toEqual([
      '1 VRMC_node_constraint target follows its source in the preview; it is not baked (VRM apps evaluate it).',
    ]);
    expect(exportWarnings(appWith(2), character, 'animation-glb')).toEqual([
      '2 constrained nodes follow their sources only in the preview and are not exported.',
    ]);
    expect(exportWarnings(appWith(1), character, 'animation-glb')).toEqual([
      '1 constrained node follows its source only in the preview and is not exported.',
    ]);
  });
});

describe('export clip defaults (acceptance round 1)', () => {
  it('checks every clip for the multi-clip containers and the active clip for VRMA', () => {
    const clips = [{ id: 'clp_a' }, { id: 'clp_b' }] as unknown as readonly { readonly id: ClipId }[];
    const active = 'clp_b' as ClipId;
    expect([...defaultExportClips('bake-into-model', clips, active)]).toEqual(['clp_a', 'clp_b']);
    expect([...defaultExportClips('animation-glb', clips, active)]).toEqual(['clp_a', 'clp_b']);
    expect([...defaultExportClips('vrma', clips, active)]).toEqual(['clp_b']);
    expect([...defaultExportClips('vrma', clips, undefined)]).toEqual([]);
  });

  it('leaves clips without keys unchecked for the multi-clip containers unless every clip is empty (acceptance round 2)', () => {
    const clips = [
      { id: 'clp_take', animated: false },
      { id: 'clp_idle', animated: true },
      { id: 'clp_walk', animated: true },
    ] as unknown as readonly { readonly id: ClipId; readonly animated: boolean }[];
    expect([...defaultExportClips('bake-into-model', clips, 'clp_take' as ClipId)]).toEqual(['clp_idle', 'clp_walk']);
    expect([...defaultExportClips('animation-glb', clips, undefined)]).toEqual(['clp_idle', 'clp_walk']);
    // VRMA keeps the active clip; a character with only empty clips keeps them all checked.
    expect([...defaultExportClips('vrma', clips, 'clp_take' as ClipId)]).toEqual(['clp_take']);
    const empty = clips.map((clip) => ({ ...clip, animated: false }));
    expect([...defaultExportClips('bake-into-model', empty, undefined)]).toEqual(['clp_take', 'clp_idle', 'clp_walk']);
  });
});

describe('shortcuts and preferences', () => {
  it('lists bindings with platform labels and marks operators that are not available', () => {
    const { app } = createTestShell({ platform: 'mac' });
    app.contribute({
      kind: 'keymap',
      bindings: [
        { chord: { code: 'Slash', shift: true }, op: 'ui.open', args: { dialog: 'shortcuts' }, scope: GLOBAL_SCOPE },
        { chord: { code: 'KeyJ', alt: true }, op: 'acme.notThere', args: { mode: 'all' }, scope: 'viewport' },
        { chord: { code: 'Space' }, op: 'view.toggleMaximize', scope: GLOBAL_SCOPE, trigger: 'tap' },
      ],
    });
    // The preset (MAYA_KEYMAP, once WP-7a/7b land) adds its own rows around these; key names are the keymap's.
    const label = (chord: Parameters<typeof app.keymap.label>[0]): string => app.keymap.label(chord);
    expect(label({ code: 'KeyJ', alt: true })).toContain('⌥');
    expect(shortcutRows(app)).toEqual(
      expect.arrayContaining([
        {
          scope: GLOBAL_SCOPE,
          keys: label({ code: 'Slash', shift: true }),
          label: 'Open Dialog (shortcuts)',
          available: true,
        },
        { scope: 'viewport', keys: label({ code: 'KeyJ', alt: true }), label: 'acme.notThere (all)', available: false },
        { scope: GLOBAL_SCOPE, keys: `${label({ code: 'Space' })} tap`, label: 'Maximize Panel', available: true },
      ]),
    );
  });

  it('writes preferences through prefs.set', async () => {
    const test = createTestShell();
    const view = await render(
      <ShellFrame shell={test.shell}>
        <DialogHost />
      </ShellFrame>,
    );
    await update(() => test.shell.runFromUi('ui.open', { dialog: 'preferences' }));
    await waitFor(() => document.querySelector('[data-testid="preferences-dialog"]') !== null);
    const space = body('prefs-space') as HTMLSelectElement;
    await update(() => {
      space.value = 'play';
      space.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => test.app.prefs.getState().spaceBehaviour === 'play');
    expect(space.value).toBe('play');
    const nav = body('prefs-nav') as HTMLSelectElement;
    await update(() => {
      nav.value = 'mayaOneButton';
      nav.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => test.app.prefs.getState().navProfile === 'mayaOneButton');
    expect(nav.value).toBe('mayaOneButton');
    await view.unmount();
  });
});

describe('NumberField (ui)', () => {
  function Harness(props: { readonly onCommit: (value: number) => void }): JSX.Element {
    const [value, setValue] = useState<number | null>(10);
    return (
      <>
        <NumberField
          value={value}
          step={1}
          data-testid="field"
          onCommit={(next) => {
            props.onCommit(next);
            setValue(next);
          }}
        />
        <button type="button" data-testid="mixed" onClick={() => setValue(null)}>
          mixed
        </button>
      </>
    );
  }

  const type = async (input: HTMLInputElement, text: string): Promise<void> => {
    await update(() => {
      input.focus();
      // React tracks the value property: set it through the prototype so the input event carries the change.
      Reflect.set(HTMLInputElement.prototype, 'value', text, input);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const press = (input: HTMLInputElement, key: string, init: KeyboardEventInit = {}) =>
    update(() => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })));

  it('commits absolute and relative expressions, reverts on Esc, steps with arrows and flags bad input', async () => {
    const commits: number[] = [];
    const view = await render(<Harness onCommit={(v) => commits.push(v)} />);
    const input = byTestId(view.container, 'field') as HTMLInputElement;
    expect(input.value).toBe('10.000');
    await type(input, '45');
    await press(input, 'Enter');
    await type(input, '+=10');
    await press(input, 'Enter');
    expect(input.value).toBe('55.000');
    await press(input, 'ArrowUp', { shiftKey: true });
    await type(input, 'abc');
    await press(input, 'Enter');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await press(input, 'Escape');
    expect(input.value).toBe('65.000');
    expect(commits).toEqual([45, 55, 65]);
    await update(() => byTestId(view.container, 'mixed').click());
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('—');
    await view.unmount();
  });
});

describe('frame gate (R3F demand loop)', () => {
  it('turns requests during a frame into continuation, and after-frame requests into a new frame', async () => {
    const gate = createFrameGate();
    let invalidations = 0;
    gate.request(); // no canvas yet: ignored
    gate.bind(() => {
      invalidations++;
    });
    gate.request();
    expect(invalidations).toBe(1);
    gate.enter('before');
    gate.request();
    expect(invalidations).toBe(1);
    gate.enter('render');
    expect(gate.takeContinuation()).toBe(true);
    expect(gate.takeContinuation()).toBe(false);
    gate.enter('after');
    gate.request();
    gate.request();
    expect(invalidations).toBe(1);
    await settle(0);
    expect(invalidations).toBe(2);
  });
});

describe('export dialog: key reduction (M2A-SPEC §5.16)', () => {
  it('"Reduce keys" follows prefs.exportReduce, unchecks to reduce: null and shows N → M samples', async () => {
    const { snapshot, skeleton } = await waveFixtures();
    const test = createTestShell({ snapshot, skeleton });
    const requests: ExportRequest[] = [];
    const artifact: ExportArtifact = {
      kind: 'vrma',
      fileName: 'Synthetic_wave.vrma',
      mime: 'model/gltf-binary',
      bytes: new Uint8Array([1]),
      sha256: 'f00',
      lints: [],
      readBack: { ok: true, animations: 1, channels: 3, maxRotationErrorRad: 0, maxTranslationErrorM: 0 },
      validation: null,
      stats: {
        clips: 1,
        channels: 3,
        keys: 40,
        reduction: { samplesBefore: 120, samplesAfter: 40, maxRotationErrorRad: 1e-4, maxTranslationErrorM: 0 },
      },
    };
    test.app.contribute({
      kind: 'exporter',
      def: { id: 'vrma', label: 'VRMA', extension: () => 'vrma', poll: () => true, run: async () => [artifact] },
    });
    test.app.contribute({
      kind: 'operator',
      def: {
        id: 'file.export',
        label: 'Export',
        category: 'file',
        scope: GLOBAL_SCOPE,
        apply: (_ctx, args) => {
          requests.push(args as ExportRequest);
          return [artifact];
        },
      },
    });
    test.app.prefs.setState({ exportReduce: { ...test.app.prefs.getState().exportReduce, positionM: 0.0005 } });
    const view = await render(
      <ShellFrame shell={test.shell}>
        <DialogHost />
      </ShellFrame>,
    );
    await update(() => test.shell.runFromUi('ui.open', { dialog: 'export' }));
    await waitFor(() => document.querySelector('[data-testid="export-dialog"]') !== null);
    expect(checkbox('export-reduce').checked).toBe(true);
    await update(() => body('export-confirm').click());
    await waitFor(() => requests.length === 1);
    expect(requests[0]?.reduce).toEqual({ ...DEFAULT_EXPORT_REDUCE, positionM: 0.0005 });
    await waitFor(() => (body('export-stats').textContent ?? '').includes('samples'));
    expect(body('export-stats').textContent).toBe('1 clip · 3 channels · 40 keys · 120 → 40 samples');
    await update(() => checkbox('export-reduce').click());
    expect(checkbox('export-reduce').checked).toBe(false);
    await update(() => body('export-confirm').click());
    await waitFor(() => requests.length === 2);
    expect(requests[1]?.reduce).toBeNull();
    await view.unmount();
    // the preference decides the default
    test.app.prefs.setState({ exportReduce: { ...test.app.prefs.getState().exportReduce, enabled: false } });
    const again = await render(
      <ShellFrame shell={test.shell}>
        <DialogHost />
      </ShellFrame>,
    );
    await update(() => test.shell.runFromUi('ui.open', { dialog: 'export' }));
    await waitFor(() => document.querySelector('[data-testid="export-reduce"]') !== null);
    expect(checkbox('export-reduce').checked).toBe(false);
    await again.unmount();
  });
});
