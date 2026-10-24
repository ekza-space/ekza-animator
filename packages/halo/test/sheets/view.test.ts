// The View sheet's model (STUDIO-TOUCH-SPEC §4.7, §15 rows 1.3–1.12, 1.16, 5.12, 5.13, 5.17, §16.4; T6b) over a
// headless app: the operator call of every control (Look, Show, joint display, Panes, Cameras, Pick only…, the
// manipulator, Full screen), flags read from the pane's display (a toggle) or not readable (an action), and the
// parity contract: every operator the Disclosure Manifest places in a View section is reachable from that section.
import { readFileSync } from 'node:fs';
import {
  createHeadlessEditorApp,
  type DisplayFlags,
  type EditorApp,
  loadModelOperators,
  type OperatorResult,
  providePaneDisplay,
} from '@ekza-studio/editor-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { entryFor } from '../../src/manifest/check';
import { DISCLOSURE } from '../../src/manifest/disclosure';
import { SHEET_SECTIONS } from '../../src/manifest/sheets';
import { entriesOf, isSurfaceEntry } from '../../src/manifest/types';
import { MANIPULATOR_STEP, type ViewModel, viewCalls, viewModel } from '../../src/sheets/view/model';

const fixture = (path: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../fixtures/${path}`, import.meta.url)));

async function ok<T = unknown>(app: EditorApp, op: string, args?: unknown): Promise<T> {
  const result: OperatorResult<unknown> = await app.runUntyped(op, args);
  if (result.status !== 'finished') throw new Error(`${op}: ${JSON.stringify(result)}`);
  return result.value as T;
}

/** A pane display (Model's defaults, as the viewport keeps them for a pane). */
const DISPLAY: DisplayFlags = {
  mesh: true,
  skeleton: false,
  controls: true,
  grid: true,
  xray: false,
  hud: true,
  springBones: false,
  shading: 'colours',
  wireOnShaded: true,
  flat: true,
  cull: false,
  components: true,
  normals: 'off',
  faceOrientation: false,
  triangulation: false,
  hardEdges: true,
  polyCount: true,
  meshCheck: false,
  symmetryPlane: true,
  dimUnhilited: false,
  imagePlanes: true,
  joints: true,
  xrayJoints: true,
  jointAxes: 'selected',
  jointLabels: 'hover',
  weights: 'off',
  weightNumbers: false,
  lockRelative: false,
  constraintLines: true,
  shapeCvs: false,
};

let app: EditorApp;
let camera: string;

beforeAll(async () => {
  app = createHeadlessEditorApp({ readSample: (sample) => Promise.resolve(fixture(`models/${sample.file}`)) });
  await Promise.all([app.rig.load(), loadModelOperators()]);
  await ok(app, 'file.loadSample', { sample: 'polybot' });
  await ok(app, 'workspace.set', { workspace: 'model' });
  camera = app.store.list('cameras')[0]?.id as string;
}, 60_000);

const wide = (input: Partial<Parameters<typeof viewModel>[1]> = {}): ViewModel =>
  viewModel(app, { wide: true, hideUi: true, ...input });

describe('View sheet controls (§15.1)', () => {
  it('runs Look and Show on the canvas pane: view.shading, view.display.toggle and view.display.set', () => {
    const model = wide();
    expect(model.paneId).toBe('pane-single');
    expect(model.look.options.map((o) => [o.label, o.call])).toEqual([
      ['Wire', { op: 'view.shading', args: { mode: 'wire', paneId: 'pane-single' } }],
      ['Shaded', { op: 'view.shading', args: { mode: 'shaded', paneId: 'pane-single' } }],
      ['Colours', { op: 'view.shading', args: { mode: 'colours', paneId: 'pane-single' } }],
      ['Lit', { op: 'view.shading', args: { mode: 'lit', paneId: 'pane-single' } }],
    ]);
    expect(model.show.essentials.map((t) => [t.label, t.call])).toEqual(
      [
        ['X-ray', 'xray'],
        ['Skeleton', 'skeleton'],
        ['Controls', 'controls'],
        ['Grid', 'grid'],
        ['Joints', 'joints'],
      ].map(([label, flag]) => [label, { op: 'view.display.toggle', args: { flag, paneId: 'pane-single' } }]),
    );
    expect(model.show.more.length).toBe(18);
    expect(model.show.joints.labels.options.map((o) => [o.label, o.call])).toEqual([
      ['None', { op: 'view.display.set', args: { patch: { jointLabels: 'none' }, paneId: 'pane-single' } }],
      ['On hover', { op: 'view.display.set', args: { patch: { jointLabels: 'hover' }, paneId: 'pane-single' } }],
      ['All', { op: 'view.display.set', args: { patch: { jointLabels: 'all' }, paneId: 'pane-single' } }],
    ]);
    expect(model.show.joints.axes.options.map((o) => o.value)).toEqual(['none', 'selected', 'all']);
    expect(model.show.joints.throughMesh.call).toEqual({
      op: 'view.display.toggle',
      args: { flag: 'xrayJoints', paneId: 'pane-single' },
    });
    expect(model.show.joints.size.write(1.5)).toEqual({ op: 'rig.jointSize.set', args: { size: 1.5 } });
    expect(model.show.secondary.call).toEqual({ op: 'rig.toggleSecondary' });
    expect([model.show.rigControls.hide.call, model.show.rigControls.show.call]).toEqual([
      { op: 'autorig.controls', args: { hidden: true } },
      { op: 'autorig.controls', args: { hidden: false } },
    ]);
  });

  it('shows a flag as an action when the pane display cannot be read, and as a toggle when it can', async () => {
    const unread = wide();
    expect(unread.look.value).toBeNull();
    expect(unread.show.essentials.every((t) => t.on === null)).toBe(true);
    expect(unread.look.reason).not.toBeNull(); // no viewport pane yet: the run would refuse

    let display = DISPLAY;
    const off = providePaneDisplay(app, {
      panes: () => ['pane-single'],
      activePane: () => 'pane-single',
      display: (paneId) => (paneId === 'pane-single' ? display : null),
      setDisplay: (_paneId, next) => {
        display = next;
      },
    });
    try {
      const read = wide();
      expect(read.look).toMatchObject({ value: 'colours', reason: null });
      expect(read.show.essentials.map((t) => [t.id, t.on])).toEqual([
        ['xray', false],
        ['skeleton', false],
        ['controls', true],
        ['grid', true],
        ['joints', true],
      ]);
      expect(read.show.joints.labels.value).toBe('hover');
      expect(read.show.normals.value).toBe('off');
      // Look and Show write the pane's own display (the only Halo controls that do, §16.4)
      const lit = read.look.options.find((o) => o.value === 'lit');
      await ok(app, lit?.call.op as string, lit?.call.args);
      expect(display.shading).toBe('lit');
      const all = read.show.joints.labels.options.find((o) => o.value === 'all');
      await ok(app, all?.call.op as string, all?.call.args);
      expect(display.jointLabels).toBe('all');
      expect(wide().look.value).toBe('lit');
      // the pane state from the viewport wins over the port
      expect(
        wide({ pane: { display: { ...DISPLAY, xray: true }, cameraKind: 'view', preset: 'front', shotCameraId: null } })
          .show.essentials[0]?.on,
      ).toBe(true);
    } finally {
      off();
    }
  });

  it('offers Panes 1 · 2 · 4 on wide containers and Maximize in the 2- and 4-pane layouts', () => {
    const model = wide();
    expect(model.panes.shown).toBe(true);
    expect(model.panes.layout.options.map((o) => [o.label, o.call])).toEqual([
      ['1', { op: 'view.layout', args: { layout: 'single' } }],
      ['2', { op: 'view.layout', args: { layout: 'split' } }],
      ['4', { op: 'view.layout', args: { layout: 'quad' } }],
    ]);
    expect(model.panes.layout.value).toBe(app.session.getState().viewportLayout);
    expect(model.panes.maximize?.call.op).toBe('view.toggleMaximize');
    expect(model.panes.maximize?.call.args).toHaveProperty('paneId');
    expect(viewModel(app, { wide: false, hideUi: false }).panes.shown).toBe(false);
    const layout = app.session.getState().viewportLayout;
    app.session.setState({ viewportLayout: 'single' });
    expect(wide().panes.maximize).toBeNull();
    app.session.setState({ viewportLayout: 'rig-markers' });
    expect(wide().panes).toMatchObject({ other: 'rig-markers', layout: { value: null } });
    app.session.setState({ viewportLayout: layout });
  });

  it('looks through the view presets and every shot camera; copies the view, locks it, sets its lens', () => {
    const model = wide({ pane: { display: null, cameraKind: 'shot', preset: null, shotCameraId: camera } });
    expect(model.cameras.views.options.map((o) => [o.label, o.call])).toEqual(
      [
        ['Front', 'front'],
        ['Side', 'side'],
        ['Top', 'top'],
        ['Perspective', 'persp'],
      ].map(([label, preset]) => [
        label,
        { op: 'view.lookThrough', args: { paneId: 'pane-single', camera: { kind: 'view', preset } } },
      ]),
    );
    expect(model.cameras.views.value).toBeNull();
    const [shot] = model.cameras.shots;
    expect(shot).toMatchObject({ id: camera, looking: true });
    expect(shot?.lookThrough.call).toEqual({
      op: 'view.lookThrough',
      args: { paneId: 'pane-single', camera: { kind: 'shot', cameraId: camera } },
    });
    expect(shot?.copyView.call).toEqual({
      op: 'view.copyViewToShot',
      args: { paneId: 'pane-single', cameraId: camera },
    });
    expect(shot?.lock).toMatchObject({
      on: app.store.list('cameras')[0]?.locked,
      call: { op: 'view.toggleCameraLock', args: { cameraId: camera } },
    });
    expect(shot?.lens?.write(40)).toEqual({
      op: 'view.camera.setSettings',
      args: { camera, fovY: (40 * Math.PI) / 180 },
    });
    expect(model.cameras.add).toBeNull();
    const front = wide({ pane: { display: null, cameraKind: 'view', preset: 'front', shotCameraId: null } });
    expect(front.cameras.views.value).toBe('front');
    expect(front.cameras.shots[0]?.looking).toBe(false);
  });

  it('sets Pick only… with view.selectionMask from the session mask', () => {
    const mask = app.session.getState().tools.selectionMask;
    expect(wide().selection.map((t) => [t.id, t.on, t.call])).toEqual(
      (['controls', 'joints', 'meshes', 'groups'] as const).map((key) => [
        key,
        mask[key],
        { op: 'view.selectionMask', args: { mask: { [key]: !mask[key] } } },
      ]),
    );
  });

  it('resizes the manipulator in steps and sets the move and turn space', async () => {
    const before = app.session.getState().tools.manipulatorSize;
    const model = wide();
    expect(model.manipulator.size).toBe(before);
    expect(model.manipulator.larger.call).toEqual({ op: 'view.manipulatorSize', args: { delta: MANIPULATOR_STEP } });
    expect(model.manipulator.smaller.call).toEqual({ op: 'view.manipulatorSize', args: { delta: -MANIPULATOR_STEP } });
    await ok(app, model.manipulator.larger.call.op, model.manipulator.larger.call.args);
    expect(wide().manipulator.size).toBe(before + MANIPULATOR_STEP);
    await ok(app, model.manipulator.smaller.call.op, model.manipulator.smaller.call.args);
    expect(model.manipulator.move.options.map((o) => o.call)).toEqual([
      { op: 'view.setManipSpace', args: { tool: 'move', space: 'object' } },
      { op: 'view.setManipSpace', args: { tool: 'move', space: 'world' } },
    ]);
    expect(model.manipulator.turn.options.map((o) => o.value)).toEqual(['object', 'world', 'gimbal']);
    const world = model.manipulator.turn.options.find((o) => o.value === 'world');
    await ok(app, world?.call.op as string, world?.call.args);
    expect(wide().manipulator.turn.value).toBe('world');
    app.session.setState({ tools: { ...app.session.getState().tools, manipulatorSize: 40 } });
    expect(wide().manipulator.smaller.reason).toBe('Already the smallest');
    app.session.setState({ tools: { ...app.session.getState().tools, manipulatorSize: before } });
  });

  it('switches secondary controls from the session state', async () => {
    const on = app.session.getState().showSecondary;
    expect(wide().show.secondary.on).toBe(on);
    await ok(app, 'rig.toggleSecondary');
    expect(wide().show.secondary.on).toBe(!on);
    await ok(app, 'rig.toggleSecondary');
  });

  it('offers Hide UI only where the frame has it, and Full screen', () => {
    expect(wide().hideUi).toBe(true);
    expect(viewModel(app, { wide: true, hideUi: false }).hideUi).toBe(false);
    expect(wide().fullScreen.call).toEqual({ op: 'view.toggleFullscreen' });
  });
});

describe('parity with the Disclosure Manifest (§20.5)', () => {
  it('reaches every operator the manifest places in a View section from that section', () => {
    const calls = viewCalls(wide());
    const sections = SHEET_SECTIONS.view ?? [];
    let checked = 0;
    for (const [op, value] of Object.entries(DISCLOSURE)) {
      for (const entry of entriesOf(value)) {
        if (!isSurfaceEntry(entry)) continue;
        for (const surface of entry.surfaces) {
          if (!('sheet' in surface) || surface.sheet !== 'view' || surface.section === undefined) continue;
          expect([op, sections.includes(surface.section)]).toEqual([op, true]);
          const reached = calls.some(
            (c) =>
              c.section === surface.section &&
              c.call.op === op &&
              entryFor(entriesOf(value), c.call.args)?.entry === entry,
          );
          expect([op, surface.section, reached]).toEqual([op, surface.section, true]);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(14);
  });

  it('runs only operators the manifest discloses, with arguments an entry covers', () => {
    for (const { call } of viewCalls(wide())) {
      const value = DISCLOSURE[call.op];
      expect([call.op, value !== undefined]).toEqual([call.op, true]);
      const found = entryFor(entriesOf(value ?? []), call.args);
      expect([call.op, found !== null && isSurfaceEntry(found.entry)]).toEqual([call.op, true]);
    }
  });
});
