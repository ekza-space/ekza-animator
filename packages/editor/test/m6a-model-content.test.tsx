// M6A-SPEC §8.8, §5.16, §5.19, §5.21, §5.26 (B13): the editor half of the content package — the Model Outliner's tree
// and rows (badges, Make editable, selection, hilite, rename, drag to reparent, planes), the Palette panel, the
// Attributes panel's Model sections, the Model start card and Getting started, the reference image import dialog,
// the Export dialog's Static model section and the first-run start question.
import type { CharacterId, DocSnapshot, MeshId } from '@ekza-animator/doc';
import {
  DEFAULT_PALETTE_ID,
  type EditorApp,
  loadMeshKernel,
  registerBuiltins,
  swatchIdFor,
} from '@ekza-animator/editor-core';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ExportDialog } from '../src/dialogs/ExportDialog';
import { FirstRunDialog } from '../src/dialogs/FirstRunDialog';
import { ImagePlaneImportDialog } from '../src/dialogs/ImagePlaneImport';
import { EditorAppProvider } from '../src/hooks';
import ModelSections, { parseOffset } from '../src/panels/attributes/ModelSections';
import ModelOutliner from '../src/panels/outliner/ModelOutliner';
import { buildModelOutlinerRows, containerMeshes, readModelOutlinerDoc } from '../src/panels/outliner/modelTree';
import { selectedPlane, setSelectedPlane } from '../src/panels/outliner/planeSelection';
import { nextObjectSelection } from '../src/panels/outliner/sceneSelection';
import { pushRecent, shownPalette, usageLine } from '../src/panels/palette/model';
import PaletteView from '../src/panels/palette/PaletteView';
import GettingStarted from '../src/panels/viewport/GettingStarted';
import ModelEmptyState from '../src/panels/viewport/ModelEmptyState';
import {
  GETTING_STARTED_KEY,
  gettingStartedDismissed,
  isEmptyModelScene,
  overlayPane,
  setGettingStartedDismissed,
} from '../src/panels/viewport/modelOverlays';
import { by, cleanup, maybe, mount, mountPlain } from './panels/helpers';
import { update } from './render';
import { createTestShell, ShellFrame, waveFixtures } from './shell-helpers';

let snapshot: DocSnapshot;
let skeleton: SkeletonDesc;
beforeAll(async () => {
  await loadMeshKernel();
  ({ snapshot, skeleton } = await waveFixtures());
});
afterEach(async () => {
  await cleanup();
});

const CHARACTER = 'chr_SyntheticWave001' as CharacterId;

/** A shell over the wave document with the built-in operators, in the Model workspace. */
function modelShell() {
  const test = createTestShell({ snapshot, skeleton });
  registerBuiltins(test.app);
  test.app.session.setState({ workspace: 'model' });
  return test;
}

async function run(app: EditorApp, op: string, args?: unknown): Promise<unknown> {
  let value: unknown;
  await act(async () => {
    const result = await app.runUntyped(op, args);
    if (result.status !== 'finished') throw new Error(`${op}: ${JSON.stringify(result)}`);
    value = result.value;
  });
  return value;
}

async function cube(app: EditorApp): Promise<MeshId> {
  return ((await run(app, 'mesh.create.cube')) as { mesh: MeshId }).mesh;
}

async function waitUntil(predicate: () => boolean, ms = 3000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > ms) throw new Error('condition not met in time');
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

async function setInput(element: HTMLInputElement, value: string): Promise<void> {
  await update(() => userEvent.fill(element, value));
}

function key(element: HTMLElement, key: string): Promise<void> {
  return update(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function click(element: HTMLElement, init: MouseEventInit = {}): Promise<void> {
  return update(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  });
}

// ---------- pure models ----------

describe('Model Outliner tree (§8.8)', () => {
  it('lists glTF meshes with triangle counts and skins; made-editable ones become records in glTF order', async () => {
    const json = {
      meshes: [
        { name: 'Body', primitives: [{ indices: 0, attributes: { POSITION: 1 } }] },
        { primitives: [{ attributes: { POSITION: 1 } }, { mode: 1, attributes: { POSITION: 1 } }] },
      ],
      accessors: [{ count: 300 }, { count: 90 }],
      nodes: [{ mesh: 0, skin: 0 }, { mesh: 1 }],
    };
    expect(containerMeshes(json)).toEqual({ names: ['Body', 'Mesh 1'], tris: [100, 30], skinned: [true, false] });

    const { app } = modelShell();
    const id = await cube(app);
    await run(app, 'scene.group', { ids: [id] });
    await run(app, 'imagePlane.import', { camera: 'front', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] });
    const doc = readModelOutlinerDoc(app.store);
    const containers = new Map([[CHARACTER, containerMeshes(json)]]);
    const rows = buildModelOutlinerRows(doc, { filter: '', expanded: new Map(), containers });
    expect(rows.map((row) => [row.kind, row.depth])).toEqual([
      ['section', 0],
      ['object', 1],
      ['object', 2],
      ['character', 0],
      ['meshes', 1],
      ['asset', 3],
      ['asset', 3],
      ['section', 0],
      ['plane', 1],
    ]);
    // A filter keeps matching rows with their ancestors; collapsing a section hides its rows.
    const filtered = buildModelOutlinerRows(doc, { filter: 'cube', expanded: new Map(), containers });
    expect(filtered.map((row) => row.kind)).toEqual(['section', 'object', 'object']);
    const collapsed = buildModelOutlinerRows(doc, {
      filter: '',
      expanded: new Map([['section:scene', false]]),
      containers,
    });
    expect(collapsed.filter((row) => row.kind === 'object')).toEqual([]);
  });

  it('object selection rules and palette helpers', () => {
    const a = 'msh_A' as never;
    const b = 'msh_B' as never;
    expect(nextObjectSelection([a], [b], 'replace')).toEqual([b]);
    expect(nextObjectSelection([a], [b], 'add')).toEqual([a, b]);
    expect(nextObjectSelection([a, b], [a], 'toggle')).toEqual([b]);
    expect(nextObjectSelection([a, b], [a], 'remove')).toEqual([b]);
    expect(pushRecent(['x', 'y'], 'y')).toEqual(['y', 'x']);
    expect(
      pushRecent(
        Array.from({ length: 8 }, (_, i) => `s${i}`),
        'n',
      ),
    ).toHaveLength(8);
    expect(usageLine(new Set([0, 4]), [{ slot: 0 }, { slot: 4 }, { slot: 5 }] as never)).toBe('Used on mesh: 2 of 3');
    expect(shownPalette([], null, null)).toBeNull();
    expect(parseOffset('0, 0.9')).toEqual([0, 0.9]);
    expect(parseOffset('1 2')).toEqual([1, 2]);
    expect(parseOffset('1')).toBeNull();
    expect(overlayPane({ maximizedPane: null, viewportLayout: 'quad' })).toBe('pane-persp');
    expect(overlayPane({ maximizedPane: 'pane-front', viewportLayout: 'quad' })).toBe('pane-front');
  });
});

// ---------- the Model Outliner ----------

describe('Model Outliner (§8.8)', () => {
  it('shows scene meshes with badges, selects on click, renames with F2 and reparents by drag', async () => {
    const { app } = modelShell();
    const id = await cube(app);
    const group = ((await run(app, 'scene.group', { ids: [] })) as { group: string }).group;
    await mount(app, <ModelOutliner app={app} instanceId="t" />);
    expect(by(`outliner-badge-${id}`).textContent).toMatch(/12 tris.*prim/);
    // Click: B10's select.objects is not registered as a real operator here, so the panel writes the selection.
    await click(by(`outliner-row-${id}`));
    expect(app.session.getState().selection.objects).toEqual([id]);
    await click(by(`outliner-row-${group}`), { shiftKey: true });
    expect(app.session.getState().selection.objects).toEqual([id, group]);

    await click(by(`outliner-row-${id}`));
    await key(by('outliner-tree'), 'F2');
    const rename = by('outliner-rename') as HTMLInputElement;
    await setInput(rename, 'Crate');
    await key(rename, 'Enter');
    await waitUntil(() => app.store.get('meshes', id)?.name === 'Crate');

    // Drag the mesh onto the group: scene.parent with the dragged ids.
    const data = new DataTransfer();
    await update(() =>
      by(`outliner-row-${id}`).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data })),
    );
    await update(() =>
      by(`outliner-row-${group}`).dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }),
      ),
    );
    await update(() =>
      by(`outliner-row-${group}`).dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
      ),
    );
    await waitUntil(() => app.store.get('meshes', id)?.parent === group);
    // …and back onto Scene: scene.unparent.
    await update(() =>
      by(`outliner-row-${id}`).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data })),
    );
    await update(() =>
      by('outliner-section-scene').dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
      ),
    );
    await waitUntil(() => app.store.get('meshes', id)?.parent === null);
  });

  it("lists a character's glTF meshes as ⊘ asset rows whose button runs Make editable", async () => {
    const { app } = modelShell();
    vi.spyOn(app.characters, 'list').mockReturnValue([
      { id: CHARACTER, container: { json: { meshes: [{ name: 'Body' }] } } } as never,
    ]);
    const runs: unknown[] = [];
    const spy = vi.spyOn(app, 'runUntyped').mockImplementation(async (id, args) => {
      runs.push([id, args]);
      return { status: 'cancelled', reason: 'test' };
    });
    await mount(app, <ModelOutliner app={app} instanceId="t" />);
    const button = document.querySelector<HTMLElement>('[data-testid^="outliner-make-editable-"]');
    if (button === null) throw new Error('no Make editable button');
    const meshId = button.dataset['testid']?.replace('outliner-make-editable-', '') ?? '';
    expect(maybe(`outliner-row-${meshId}`)).not.toBeNull();
    expect(by(`outliner-badge-${meshId}`).textContent).toContain('⊘ asset');
    await click(button);
    expect(runs).toContainEqual(['mesh.makeEditable', { character: CHARACTER, meshIndex: 0 }]);
    spy.mockRestore();
  });

  it('a licence refusal toasts the reason with a link to the licence badge instead of running', async () => {
    const test = modelShell();
    const { app } = test;
    vi.spyOn(app.characters, 'list').mockReturnValue([
      { id: CHARACTER, container: { json: { meshes: [{ name: 'Body' }] } } } as never,
    ]);
    const reason = "This avatar's licence does not allow modification; its meshes stay read-only";
    const poll = app.operators.poll.bind(app.operators);
    vi.spyOn(app.operators, 'poll').mockImplementation((id, ctx, args) =>
      id === 'mesh.makeEditable' ? { ok: false, reason } : poll(id, ctx, args),
    );
    const toasts: unknown[] = [];
    vi.spyOn(app.services.notify, 'toast').mockImplementation((toast) => {
      toasts.push(toast);
    });
    await mount(app, <ModelOutliner app={app} instanceId="t" />);
    const button = document.querySelector<HTMLElement>('[data-testid^="outliner-make-editable-"]');
    if (button === null) throw new Error('no Make editable button');
    await click(button);
    expect(toasts).toContainEqual({
      kind: 'warning',
      text: reason,
      action: { label: 'Show licence', op: 'workspace.showPanel', args: { panel: 'attributes' } },
    });
    expect(app.store.list('meshes')).toHaveLength(0);
  });

  it('a click on a mesh row in a component mode adds it to the hilite set', async () => {
    const { app } = modelShell();
    const id = await cube(app);
    await update(() => app.session.setState({ model: { ...app.session.getState().model, componentMode: 'face' } }));
    const runs: unknown[] = [];
    vi.spyOn(app, 'runUntyped').mockImplementation(async (op, args) => {
      runs.push([op, args]);
      return { status: 'finished', value: undefined };
    });
    await mount(app, <ModelOutliner app={app} instanceId="t" />);
    await click(by(`outliner-row-${id}`));
    expect(runs).toContainEqual(['model.hilite', { meshes: [id], mode: 'add' }]);
  });

  it('a plane row selects the plane (clearing objects); Delete removes it', async () => {
    const { app } = modelShell();
    const id = await cube(app);
    const plane = (
      (await run(app, 'imagePlane.import', {
        camera: 'side',
        bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      })) as { id: string }
    ).id;
    app.session.setState({ selection: { ...app.session.getState().selection, objects: [id] } });
    await mount(app, <ModelOutliner app={app} instanceId="t" />);
    await click(by(`outliner-row-${plane}`));
    expect(selectedPlane(app)).toBe(plane);
    expect(app.session.getState().selection.objects).toEqual([]);
    await key(by('outliner-tree'), 'Delete');
    await waitUntil(() => app.store.get('imagePlanes', plane as never) === undefined);
  });
});

// ---------- the Palette panel ----------

describe('Palette panel (§8.8, §5.19)', () => {
  it('offers the default palette when there is none', async () => {
    const { app } = modelShell();
    await mount(app, <PaletteView app={app} />);
    await click(by('palette-use-default'));
    await waitUntil(() => maybe('palette-swatch-15') !== null);
    expect(app.store.list('swatches')).toHaveLength(16);
  });

  it('activates swatches, edits the hex, adds a slot, duplicates a variant, sets the export colours', async () => {
    const { app } = modelShell();
    const id = await cube(app);
    await mount(app, <PaletteView app={app} />);
    expect(by('palette-usage').textContent).toContain('Used on mesh: 1 of 16');
    await click(by('palette-swatch-4'));
    await waitUntil(() => app.session.getState().model.activeSwatch === swatchIdFor(DEFAULT_PALETTE_ID, 4));
    expect(by('palette-swatch-4').dataset['active']).toBe('true');
    expect(app.prefs.getState().modeling.paletteRecents[0]).toBe(swatchIdFor(DEFAULT_PALETTE_ID, 4));

    const hex = by('palette-hex') as HTMLInputElement;
    expect(hex.value).toBe('#e04646');
    await setInput(hex, '#ff0000');
    await key(hex, 'Enter');
    await waitUntil(() => app.store.get('swatches', swatchIdFor(DEFAULT_PALETTE_ID, 4))?.srgb[1] === 0);
    expect(app.store.get('swatches', swatchIdFor(DEFAULT_PALETTE_ID, 4))?.srgb).toEqual([255, 0, 0]);

    await click(by('palette-add'));
    await waitUntil(() => maybe('palette-swatch-16') !== null);

    await click(by('palette-output-vertex-colour'));
    await waitUntil(() => app.store.get('meshes', id)?.colourOutput === 'vertex-colour');

    await click(by('palette-duplicate'));
    await waitUntil(() => app.store.list('palettes').length === 2);
    const variant = app.store.list('palettes').find((p) => p.id !== DEFAULT_PALETTE_ID);
    expect((by('palette-select') as HTMLSelectElement).value).toBe(variant?.id);
    // The cube still paints with the default palette: Assign offers the variant.
    await click(by('palette-assign'));
    await waitUntil(() => app.store.get('meshes', id)?.palette === variant?.id);
  });

  it('Apply is disabled until a swatch and a selection exist; it runs mesh.paint on the selected faces', async () => {
    const { app } = modelShell();
    const id = await cube(app);
    await mount(app, <PaletteView app={app} />);
    expect((by('palette-apply') as HTMLButtonElement).disabled).toBe(true);
    await click(by('palette-swatch-2'));
    const model = app.session.getState().model;
    await update(() => app.session.setState({ model: { ...model, componentMode: 'face', hilite: [id] } }));
    expect((by('palette-apply') as HTMLButtonElement).disabled).toBe(false);
    const runs: unknown[] = [];
    vi.spyOn(app, 'runUntyped').mockImplementation(async (op, args) => {
      runs.push([op, args]);
      return { status: 'finished', value: undefined };
    });
    await click(by('palette-apply'));
    expect(runs).toContainEqual(['mesh.paint', { kind: 'face', slot: 2 }]);
  });
});

// ---------- Attributes ----------

describe('Attributes › Model sections (§8.8)', () => {
  it('renames, edits live primitive parameters and freezes nothing on attribute edits', async () => {
    const { app } = modelShell();
    const id = ((await run(app, 'mesh.create.cylinder')) as { mesh: MeshId }).mesh;
    await mount(app, <ModelSections app={app} />);
    const name = by('attr-mesh-name') as HTMLInputElement;
    await setInput(name, 'Barrel');
    await key(name, 'Enter');
    await waitUntil(() => app.store.get('meshes', id)?.name === 'Barrel');
    const rev = app.store.get('meshes', id)?.data?.rev ?? 0;
    const axis = by('attr-prim-subdivisionsHeight') as HTMLInputElement;
    await update(() => axis.focus());
    await setInput(axis, '2');
    await key(axis, 'Enter');
    await waitUntil(() => app.store.get('meshes', id)?.generator?.params['subdivisionsHeight'] === 2);
    expect(app.store.get('meshes', id)?.data?.rev).toBe(rev + 1);
    await click(by('attr-mesh-faceted'));
    await waitUntil(() => app.store.get('meshes', id)?.faceted === false);
    expect(app.store.get('meshes', id)?.generator).not.toBeNull();
  });

  it('a handheld root shows its grip; a selected plane shows the Image plane fields (locked keeps them)', async () => {
    const { app } = modelShell();
    const root = ((await run(app, 'mesh.create.template', { template: 'handheld' })) as { root: string }).root;
    await mount(app, <ModelSections app={app} />);
    expect((by('attr-grip-bone') as HTMLSelectElement).value).toBe('rightHand');
    const scale = by('attr-grip-scale') as HTMLInputElement;
    await update(() => scale.focus());
    await setInput(scale, '1.5');
    await key(scale, 'Enter');
    await waitUntil(() => app.store.get('groups', root as never)?.handheld?.scale === 1.5);

    const plane = (
      (await run(app, 'imagePlane.import', {
        camera: 'front',
        bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      })) as { id: string }
    ).id;
    await update(() => setSelectedPlane(app, plane as never));
    const size = by('attr-plane-size') as HTMLInputElement;
    await update(() => size.focus());
    await setInput(size, '1.8');
    await key(size, 'Enter');
    const offset = by('attr-plane-offset') as HTMLInputElement;
    await setInput(offset, '0.1, 0.9');
    await key(offset, 'Enter');
    await waitUntil(() => app.store.get('imagePlanes', plane as never)?.offset[1] === 0.9);
    expect(app.store.get('imagePlanes', plane as never)).toMatchObject({ size: 1.8, offset: [0.1, 0.9] });
    await click(by('attr-plane-locked'));
    await waitUntil(() => app.store.get('imagePlanes', plane as never)?.locked === true);
    expect((by('attr-plane-camera') as HTMLSelectElement).disabled).toBe(true);
  });
});

// ---------- start card, Getting started ----------

describe('Model start card and Getting started (§8.8)', () => {
  it('the start card creates primitives and templates; the scene is no longer empty', async () => {
    const { app } = modelShell();
    app.store.load({ ...snapshot, tables: { ...snapshot.tables, characters: {} } });
    expect(isEmptyModelScene(app.store)).toBe(true);
    await mount(app, <ModelEmptyState app={app} paneId="pane-persp" />);
    for (const kind of ['cube', 'cylinder', 'sphere', 'plane', 'cone', 'torus'])
      expect(maybe(`model-start-${kind}`)).not.toBeNull();
    expect((by('model-start-generate') as HTMLButtonElement).disabled).toBe(true);
    expect(by('model-start-hints').textContent).toMatch(/3 face mode/);
    await click(by('model-start-cube'));
    await waitUntil(() => app.store.list('meshes').length === 1);
    expect(isEmptyModelScene(app.store)).toBe(false);
    await click(by('model-start-template-humanoid'));
    await waitUntil(() => app.store.list('groups').some((g) => g.template?.kind === 'humanoid'));
  });

  it('Getting started ticks steps, labels keys through the keymap and stays dismissed', async () => {
    const { app } = modelShell();
    globalThis.localStorage.removeItem(GETTING_STARTED_KEY);
    setGettingStartedDismissed(false);
    await mount(app, <GettingStarted app={app} paneId="pane-persp" />);
    expect(by('getting-started-step-3').textContent).toMatch(/Ctrl\+E/);
    expect(by('getting-started-step-1').dataset['done']).toBeUndefined();
    await cube(app);
    await waitUntil(() => by('getting-started-step-1').dataset['done'] === 'true');
    await click(by('getting-started-dismiss'));
    expect(gettingStartedDismissed()).toBe(true);
    expect(globalThis.localStorage.getItem(GETTING_STARTED_KEY)).toBe('dismissed');
    setGettingStartedDismissed(false);
  });
});

// ---------- dialogs ----------

describe('B13 dialogs', () => {
  it('imports a reference image for the chosen view and selects the new plane', async () => {
    const test = modelShell();
    const { app } = test;
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <ImagePlaneImportDialog />
      </ShellFrame>,
    );
    const file = by('image-plane-file') as HTMLInputElement;
    const png = await (
      await fetch(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      )
    ).arrayBuffer();
    const data = new DataTransfer();
    data.items.add(new File([png], 'side-ref.png', { type: 'image/png' }));
    await update(() => {
      file.files = data.files;
      file.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(by('image-plane-camera-side'));
    await waitUntil(() => !(by('image-plane-confirm') as HTMLButtonElement).disabled);
    await click(by('image-plane-confirm'));
    await waitUntil(() => app.store.list('imagePlanes').length === 1);
    const plane = app.store.list('imagePlanes')[0];
    expect(plane).toMatchObject({ camera: 'side', name: 'side-ref' });
    expect(selectedPlane(app)).toBe(plane?.id);
  });

  it('the Export dialog defaults to the Static model section in Model and exports a cube', async () => {
    const test = modelShell();
    const { app } = test;
    await cube(app);
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <ExportDialog />
      </ShellFrame>,
    );
    expect(maybe('export-static-body')).not.toBeNull();
    expect((by('export-static-profile') as HTMLSelectElement).value).toBe('local/generic');
    expect(maybe('export-static-drop-tangents')).toBeNull();
    await click(by('export-static-confirm'));
    await waitUntil(() => maybe('export-static-size') !== null, 10_000);
    expect(by('export-static-size').textContent).toMatch(/KB|B/);
    // The Animation side stays one click away.
    await click(by('export-animation'));
    await waitUntil(() => maybe('export-confirm') !== null);
  });

  it('the first-run dialog asks Animate or Model and starts in the chosen workspace', async () => {
    const test = createTestShell({ snapshot, skeleton });
    registerBuiltins(test.app);
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <EditorAppProvider app={test.app}>
          <FirstRunDialog />
        </EditorAppProvider>
      </ShellFrame>,
    );
    await click(by('firstrun-start-model'));
    await click(by('firstrun-done'));
    await waitUntil(() => test.app.session.getState().workspace === 'model');
    expect(test.app.prefs.getState()).toMatchObject({ lastWorkspace: 'model', firstRunDone: true });
  });
});
