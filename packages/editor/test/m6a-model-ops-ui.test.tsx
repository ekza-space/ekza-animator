// M6A-SPEC §8.4–§8.6, §5.7, §5.10 (B11) in the browser: the Last-op card (pane choice, pill and expansion, typed
// values with the §5.10 grammar adjusting in place, Reset, ✕ and `T`, the closed reason, label virtual sliders with
// the capture window armed on the dragged field), the option box (defaults for the next run, Apply), B11's marking
// menus, the capture bridge (pointer slop, "Entry discarded"), the Modeling Toolkit (poll reasons, ⋯, sections,
// narrow, empty state) and the Channel Box of a mesh (TRS rows, the INPUTS primitive and last-op entries, the selected
// INPUTS field), plus the B11 test-API group.
import type { ParamDef } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import {
  type EditorApp,
  type KernelMeshRuntimes,
  lastOpCardState,
  loadMeshKernel,
  loadOpsRuntime,
  type OperatorDef,
  registerBuiltins,
  selectedInputsField,
  switchWorkspace,
} from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorAppProvider } from '../src/hooks';
import { bridgeCapture, ModelOpsShellOverlay, openOptionBox, optionBoxStore } from '../src/overlays/menus/optionBox';
import { MODEL_OPS_MARKING_MENUS, registerModelOpsMenus } from '../src/overlays/menus/tools';
import { ChannelBoxPanel } from '../src/panels/channel-box/ChannelBoxPanel';
import { CLOSED_CARD_MS } from '../src/panels/toolkit/LastOpCardView';
import { ModelOpsSlot } from '../src/panels/toolkit/ModelOpsSlot';
import ToolkitView from '../src/panels/toolkit/ToolkitView';
import { cardPane, LastOpCard } from '../src/panels/viewport/LastOpCard';
import { createTestApi } from '../src/test-api/createTestApi';
import { by, cleanup, input, maybe, mount } from './panels/helpers';
import { createTestShell, settle, waitFor } from './shell-helpers';

afterEach(cleanup);

const WEIGHT: ParamDef = {
  name: 'weight',
  label: 'Weight',
  kind: 'fraction',
  bound: 'value',
  default: 0.5,
  min: 0,
  max: 1,
  primary: true,
};
const OFFSET: ParamDef = { name: 'offset', label: 'Offset', kind: 'distance', bound: 'value', default: 0, step: 0.01 };
const MODE: ParamDef = {
  name: 'mode',
  label: 'Mode',
  kind: 'enum',
  bound: 'value',
  default: 'a',
  options: [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ],
};

/** `test.weight {weight, offset, mode}`: renames the mesh (one doc step) and reports it as the target. */
function weightOperator(mesh: MeshId): OperatorDef<unknown, unknown, unknown> {
  return {
    id: 'test.weight',
    label: 'Weight',
    category: 'test',
    scope: 'global',
    flags: { undo: true, adjustable: true, repeatable: true },
    params: [WEIGHT, OFFSET, MODE],
    apply(ctx, raw) {
      const args = raw as { weight?: number; offset?: number; mode?: string };
      ctx.tx?.patch('meshes', mesh, { name: `w ${args.weight ?? 0.5} ${args.offset ?? 0} ${args.mode ?? 'a'}` });
      return { mesh };
    },
  };
}

interface Model {
  readonly app: FakeEditorApp;
  readonly cube: MeshId;
}

/** A Model app with the built-ins, the kernel loaded, a cube created from the menu in `pane-persp`. */
async function modelApp(): Promise<Model> {
  const app = createFakeEditorApp();
  registerBuiltins(app);
  await loadMeshKernel();
  (app.meshes as KernelMeshRuntimes).attach(app);
  // Entering Model loads the B11 runtime chunk (§5.27); the editor's first keystroke there comes after it.
  switchWorkspace(app, 'model');
  await loadOpsRuntime();
  const created = await app.run('mesh.create.cube', {}, { source: 'menu', paneId: 'pane-persp' });
  if (created.status !== 'finished') throw new Error(JSON.stringify(created));
  const cube = (created.value as { mesh: MeshId }).mesh;
  app.operators.register(weightOperator(cube));
  return { app, cube };
}

const undoLength = (app: EditorApp): number =>
  (app.history as unknown as { labels(): { undo: readonly string[] } }).labels().undo.length;

async function type(id: string, text: string): Promise<void> {
  const element = input(id);
  await act(async () => {
    element.focus();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(element, text);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await settle(30);
}

async function click(id: string): Promise<void> {
  await act(async () => by(id).click());
  await settle(20);
}

const card = (app: EditorApp, paneId = 'pane-persp') =>
  mount(app, <LastOpCard app={app} paneId={paneId} state={null} />, { width: 400, height: 300 });

describe('the Last-op card (§8.6)', () => {
  it('shows a pill in the pane where the run happened; expands on click; a typed value adjusts in place', async () => {
    const { app, cube } = await modelApp();
    await card(app);
    await waitFor(() => maybe('lastop-pill') !== null);
    expect(by('lastop-card-pane-persp').dataset['state']).toBe('collapsed');
    expect(by('lastop-title').textContent).toBe('Cube');
    await click('lastop-pill');
    await waitFor(() => maybe('lastop-field-subdivisionsWidth') !== null);
    expect(by('lastop-card-pane-persp').dataset['state']).toBe('expanded');
    const steps = undoLength(app);
    await type('lastop-field-subdivisionsWidth', '2');
    await waitFor(() => app.session.getState().lastRun?.args['subdivisionsWidth'] === 2);
    expect(undoLength(app)).toBe(steps);
    expect(app.history.peekUndo()?.label).toBe('Cube (adjusted)');
    const counts = app.meshes.get(cube)?.data()?.counts;
    expect(`${counts?.points}/${counts?.edges}/${counts?.faces}`).toBe('12/20/10');
    expect(input('lastop-field-subdivisionsWidth').value).toBe('2');
    expect(by('lastop-card-pane-persp').dataset['state']).toBe('expanded');
  });

  it('only in its pane (a pane that is not drawn falls back to the maximized one); not for paramless runs', async () => {
    const { app } = await modelApp();
    expect(cardPane(lastOpCardState(app), 'pane-front', { maximized: 'pane-persp' })).toBe('pane-persp');
    expect(cardPane(lastOpCardState(app), 'pane-front', { maximized: null })).toBe('pane-front');
    expect(cardPane(lastOpCardState(app), null, { maximized: null })).toBe('pane-persp');
    await card(app, 'pane-top');
    await settle(50);
    expect(maybe('lastop-card-pane-top')).toBeNull();
  });

  it('fractions take 30% and show 0.300; enums are segmented; Reset restores the defaults', async () => {
    const { app } = await modelApp();
    await app.run('test.weight' as never, { weight: 0.5 } as never, { source: 'menu', paneId: 'pane-persp' });
    await card(app);
    await waitFor(() => maybe('lastop-pill') !== null);
    expect(by('lastop-pill').textContent).toContain('Weight · 0.500');
    await click('lastop-pill');
    await type('lastop-field-weight', '30%');
    await waitFor(() => app.session.getState().lastRun?.args['weight'] === 0.3);
    expect(input('lastop-field-weight').value).toBe('0.300');
    await type('lastop-field-offset', '50cm');
    await waitFor(() => app.session.getState().lastRun?.args['offset'] === 0.5);
    expect(input('lastop-field-offset').value).toBe('0.500 m');
    await click('lastop-field-mode-b');
    await waitFor(() => app.session.getState().lastRun?.args['mode'] === 'b');
    await click('lastop-reset');
    await waitFor(() => app.session.getState().lastRun?.args['weight'] === 0.5);
    expect(app.session.getState().lastRun?.args).toMatchObject({ weight: 0.5, offset: 0, mode: 'a' });
  });

  it('✕ hides the card and keeps the operation for G; T brings it back expanded with the primary focused', async () => {
    const { app } = await modelApp();
    await app.run('test.weight' as never, {} as never, { source: 'menu', paneId: 'pane-persp' });
    await card(app);
    await waitFor(() => maybe('lastop-pill') !== null);
    await click('lastop-pill');
    await click('lastop-close');
    await waitFor(() => maybe('lastop-card-pane-persp') === null);
    expect(app.operators.poll('edit.repeatLast')).toBe(true);
    await act(async () => {
      await app.run('view.lastOpCard', { expand: true, focusPrimary: true });
    });
    await waitFor(() => maybe('lastop-field-weight') !== null);
    await waitFor(() => document.activeElement === by('lastop-field-weight'));
  });

  it('a closed card shows its reason in the pill for 3 s, then disappears', async () => {
    const { app } = await modelApp();
    await app.run('test.weight' as never, {} as never, { source: 'menu', paneId: 'pane-persp' });
    await card(app);
    await waitFor(() => maybe('lastop-pill') !== null);
    await act(async () => {
      await app.run('mesh.create.plane', {}, { source: 'api' });
    });
    // The plane's own card replaced the closed one (a new operation); close it through another write.
    await act(async () => {
      app.store.transact({ label: 'Rename' }, (tx) =>
        tx.patch('meshes', app.session.getState().selection.objects[0] as MeshId, { name: 'x' }),
      );
    });
    await waitFor(() => by('lastop-card-pane-persp').dataset['state'] === 'closed');
    expect(by('lastop-pill').title).toBe('Another operation ran');
    await settle(CLOSED_CARD_MS + 200);
    expect(maybe('lastop-card-pane-persp')).toBeNull();
  });

  it('a label drag previews and adjusts once on release; the capture window is armed on the dragged field', async () => {
    const { app } = await modelApp();
    await app.run('test.weight' as never, {} as never, { source: 'menu', paneId: 'pane-persp' });
    await card(app);
    await waitFor(() => maybe('lastop-pill') !== null);
    await click('lastop-pill');
    const label = by('lastop-name-offset');
    const steps = undoLength(app);
    await act(async () => {
      label.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7, clientX: 100 }));
      label.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 110, movementX: 10 }),
      );
    });
    expect(app.capture.state).toMatchObject({ armed: 'drag', field: 'offset' });
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 150, movementX: 40 }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 150 }));
    });
    await waitFor(() => Math.abs(Number(app.session.getState().lastRun?.args['offset']) - 0.5) < 1e-9);
    expect(undoLength(app)).toBe(steps);
    expect(app.capture.state.armed).toBeNull();
  });
});

describe('the option box (§8.5)', () => {
  it('stores defaults for the next run as fields change; Apply runs with them; Reset forgets them', async () => {
    const { app } = await modelApp();
    await mount(app, <ModelOpsShellOverlay app={app} />);
    await act(async () => openOptionBox(app, 'test.weight'));
    await waitFor(() => maybe('optbox-test.weight') !== null);
    await type('optbox-field-weight', '0.7');
    expect(app.prefs.getState().modeling.optionDefaults['test.weight']).toEqual({ weight: 0.7 });
    await click('optbox-apply');
    await waitFor(() => app.session.getState().lastRun?.args['weight'] === 0.7);
    expect(app.session.getState().lastRun?.source).toBe('toolkit');
    expect(optionBoxStore(app).getState().op).toBeNull();
    await act(async () => openOptionBox(app, 'test.weight'));
    await waitFor(() => maybe('optbox-reset') !== null);
    await click('optbox-reset');
    expect(app.prefs.getState().modeling.optionDefaults['test.weight']).toBeUndefined();
  });
});

describe('marking menus and the capture bridge', () => {
  it('registers the tools, primitives and merge menus; every item names an operator or says why not', async () => {
    // The shell's operators (ui.open, workspace.showPanel) are items too.
    const { app } = createTestShell();
    registerBuiltins(app);
    const dispose = registerModelOpsMenus(app);
    const ids = MODEL_OPS_MARKING_MENUS.map((def) => def.id);
    expect(ids).toEqual([
      'model.primitives',
      'model.tools.object',
      'model.tools.vertex',
      'model.tools.edge',
      'model.tools.face',
      'model.merge',
    ]);
    for (const id of ids) expect(app.markingMenus.get(id)).toBeDefined();
    const items = MODEL_OPS_MARKING_MENUS.flatMap((def) => [
      ...Object.values(def.slots),
      ...def.list,
      ...[...Object.values(def.slots), ...def.list].flatMap((item) => item?.submenu ?? []),
    ]);
    const broken = items.filter(
      (item) =>
        item !== undefined &&
        item.submenu === undefined &&
        item.disabledReason === undefined &&
        (item.op === undefined || app.operators.get(item.op) === undefined),
    );
    expect(broken).toEqual([]);
    // The S / W / SW family of the component menus (§8.4).
    for (const id of ['model.tools.edge', 'model.tools.face']) {
      const slots = app.markingMenus.get(id)?.slots;
      expect([slots?.S?.op, slots?.W?.args, slots?.SW?.op]).toEqual([
        'mesh.extrude',
        { panel: 'viewport', tool: 'multiCut' },
        'mesh.delete',
      ]);
    }
    dispose();
    expect(app.markingMenus.get('model.merge')).toBeUndefined();
  });

  it('the shell slot mounts the overlay (a lazy chunk) on the first Model entry and keeps it (§5.27)', async () => {
    const { app } = createTestShell();
    registerBuiltins(app);
    await mount(app, <ModelOpsSlot app={app} />);
    await settle();
    expect(app.session.getState().workspace).not.toBe('model');
    expect(app.markingMenus.get('model.tools.object')).toBeUndefined();
    await act(async () => switchWorkspace(app, 'model'));
    await waitFor(() => app.markingMenus.get('model.tools.object') !== undefined);
    await act(async () => switchWorkspace(app, 'animate'));
    await settle();
    expect(app.markingMenus.get('model.tools.object')).toBeDefined();
  });

  it('a keyboard-op window disarms after 3 px of pointer travel or a click; an unfinished entry is discarded', async () => {
    const { app } = await modelApp();
    const help = vi.fn<(text: string, tone?: 'info' | 'warning' | 'error') => void>();
    const off = bridgeCapture(app, { help });
    await app.run('test.weight' as never, {} as never, { source: 'keyboard', paneId: 'pane-persp' });
    expect(app.capture.state.armed).toBe('keyboard-op');
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 12, clientY: 11 }));
    expect(app.capture.state.armed).toBe('keyboard-op');
    app.capture.key({ code: 'Digit3', key: '3', shift: false, mod: false, alt: false });
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 16, clientY: 10 }));
    expect(app.capture.state.armed).toBeNull();
    expect(help).toHaveBeenCalledWith('Entry discarded', 'warning');
    await app.run('test.weight' as never, { weight: 0.6 } as never, { source: 'keyboard' });
    expect(app.capture.state.armed).toBe('keyboard-op');
    window.dispatchEvent(new PointerEvent('pointerdown', { clientX: 16, clientY: 10 }));
    expect(app.capture.state.armed).toBeNull();
    off();
  });
});

describe('the Modeling Toolkit (§8.5)', () => {
  it('buttons run with source toolkit; disabled ones show their poll reason; ⋯ opens the option box', async () => {
    const { app } = await modelApp();
    await mount(app, <ToolkitView app={app} instanceId="toolkit" />, { width: 300, height: 900 });
    await waitFor(() => maybe('mtk-panel') !== null);
    expect(by('mtk-panel').dataset['narrow']).toBe('false');
    // Object mode: Extrude needs components (its own poll reason as the tooltip).
    const extrude = by('mtk-btn-mesh.extrude');
    expect(extrude.getAttribute('aria-disabled')).toBe('true');
    expect(extrude.title.length).toBeGreaterThan(0);
    // Combine is object-level and needs two meshes.
    expect(by('mtk-btn-mesh.combine').title).toBe('Combine needs at least two meshes');
    await click('mtk-opt-mesh.insertLoop');
    expect(optionBoxStore(app).getState().op).toBe('mesh.insertLoop');
    expect(by('mtk-mode-object').dataset['disabled']).toBeDefined();
    expect(by('mtk-tris').textContent).toBe('12 tris');
  });

  it('sections collapse and remember it; narrow packs the buttons; the empty state creates primitives', async () => {
    const app = createFakeEditorApp();
    registerBuiltins(app);
    await loadMeshKernel();
    (app.meshes as KernelMeshRuntimes).attach(app);
    switchWorkspace(app, 'model');
    await mount(app, <ToolkitView app={app} instanceId="toolkit" />, { width: 240, height: 900 });
    await waitFor(() => maybe('mtk-empty') !== null);
    await waitFor(() => by('mtk-panel').dataset['narrow'] === 'true');
    await click('mtk-toggle-components');
    expect(app.prefs.getState().modeling.toolkitCollapsed).toContain('components');
    expect(maybe('mtk-btn-mesh.bevel')).toBeNull();
    await click('mtk-btn-mesh.create.cube');
    await waitFor(() => app.store.list('meshes').length === 1);
    expect(app.session.getState().lastRun).toMatchObject({ id: 'mesh.create.cube', source: 'toolkit' });
  });
});

describe('the Channel Box of a mesh (§8.6)', () => {
  it('TRS rows edit placement through scene.object.transform; INPUTS shows the primitive entry', async () => {
    const { app, cube } = await modelApp();
    await mount(app, <ChannelBoxPanel app={app} instanceId="cb" />);
    await waitFor(() => maybe('cb-field-ty') !== null);
    expect(input('cb-field-ty').value).toBe('0.000');
    expect(input('cb-field-sx').value).toBe('1.000');
    expect(by('cb-prim-title').textContent).toBe('cube (primitive)');
    // An edit right after the creation run adjusts it: same mesh, same step count.
    const steps = undoLength(app);
    await type('cb-prim-field-subdivisionsWidth', '3');
    await waitFor(() => app.store.get('meshes', cube)?.generator?.params['subdivisionsWidth'] === 3);
    expect(undoLength(app)).toBe(steps);
    expect(app.session.getState().selection.objects).toEqual([cube]);
    // Translate Y: `+=1` goes to scene.object.transform (B12a's operator) with the placement.
    await type('cb-field-ty', '+=1');
    const calls = app.calls.filter((call) => call.id === 'scene.object.transform');
    expect(calls.at(-1)?.args).toMatchObject({ ids: [cube], placements: [{ t: [0, 1, 0] }] });
  });

  it('the last-op entry follows a live operation on this mesh; its names select the INPUTS field', async () => {
    const { app, cube } = await modelApp();
    await app.run('test.weight' as never, { weight: 0.25 } as never, { source: 'menu' });
    await mount(app, <ChannelBoxPanel app={app} instanceId="cb" />);
    await waitFor(() => maybe('cb-inputs-field-weight') !== null);
    expect(by('cb-lastop-title').textContent).toBe('weight (last operation)');
    expect(input('cb-inputs-field-weight').value).toBe('0.250');
    await act(async () => {
      by('cb-inputs-name-weight').dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 3 }),
      );
      by('cb-inputs-name-weight').dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 3 }),
      );
    });
    expect(selectedInputsField(app)).toEqual({ entry: 'lastop', mesh: cube, param: 'weight' });
    await type('cb-inputs-field-weight', '0.75');
    await waitFor(() => app.session.getState().lastRun?.args['weight'] === 0.75);
  });
});

describe('the B11 test API (§4.8)', () => {
  it('lastOp, lastOpCard and history', async () => {
    const { app, shell } = createTestShell();
    registerBuiltins(app);
    await loadMeshKernel();
    (app.meshes as KernelMeshRuntimes).attach(app);
    switchWorkspace(app, 'model');
    const api = createTestApi(shell).api;
    expect(api.lastOp()).toBeNull();
    await app.run('mesh.create.cube', {}, { source: 'keyboard', paneId: 'pane-persp' });
    expect(api.lastOp()).toMatchObject({
      id: 'mesh.create.cube',
      label: 'Cube',
      adjustable: true,
      repeatable: true,
      closed: null,
      source: 'keyboard',
      kind: null,
      warnings: [],
    });
    expect(api.lastOpCard('pane-persp')).toBeNull(); // nothing drawn yet
    await mount(
      app,
      <EditorAppProvider app={app}>
        <LastOpCard app={app} paneId="pane-persp" state={null} />
      </EditorAppProvider>,
    );
    await waitFor(() => maybe('lastop-card-pane-persp') !== null);
    const read = api.lastOpCard('pane-persp');
    expect(read?.title).toBe('Cube');
    expect(read?.expanded).toBe(false);
    expect(read?.fields[0]).toMatchObject({ name: 'subdivisionsWidth', text: '1', value: 1 });
    expect(api.history().undo.at(-1)).toBe(app.history.peekUndo()?.label);
    expect(api.history().undo.length).toBeGreaterThan(0);
  });
});
