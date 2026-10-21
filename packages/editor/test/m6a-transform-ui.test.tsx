// B12a (M6A-SPEC §8.7, §8.4, §5.10, §4.8): the modal readout chip (the dragged value next to the pointer, flipped at
// the pane edges; the capture entry with its keys, mirrored on the help line; the snap candidate and the soft-select
// radius ring), the `model.options` and space marking menus (registered on the first Model entry, their checked
// states and runs) and the B12a test API group (`symmetry`, `softWeights`) on the whole shell.
import type { DocSnapshot, MeshId, MeshRecord, MeshRef } from '@ekza-studio/doc';
import {
  BUILTIN_MENU_ITEMS,
  type EditorApp,
  loadMeshKernel,
  loadOpsRuntime,
  type NumericTarget,
  registerBuiltinOperators,
  registerBuiltinWorkspaces,
  setComponentSpace,
} from '@ekza-studio/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-studio/editor-core/testing';
import { type MeshData, primitive, writeRevision } from '@ekza-studio/mesh-core';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { setTransformReadout, transformReadout } from '@ekza-studio/viewport';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MOVE_SPACE_MENU, OPTIONS_MENU, OPTIONS_MENU_LMB, ROTATE_SPACE_MENU } from '../src/overlays/menus/options';
import { EditorRoot } from '../src/shell/EditorRoot';
import type { Shell } from '../src/shell/types';
import { createSyntheticModelLoader } from '../src/testing/syntheticModels';
import { DEFAULT_PARAMS } from '../src/test-api/params';
import { liveEnvironment, mountLive, waitFor, waveFixtures } from './shell-helpers';

let snapshot: DocSnapshot;
let skeleton: SkeletonDesc;
let style: HTMLStyleElement;
let restoreAct: () => void = () => {};
beforeAll(async () => {
  await loadMeshKernel();
  restoreAct = liveEnvironment();
  ({ snapshot, skeleton } = await waveFixtures());
  style = document.createElement('style');
  style.textContent =
    '.ekza-editor{position:relative;width:1440px;height:900px;display:block}' +
    '[data-testid="gl-host"]{position:fixed;inset:0;pointer-events:none}' +
    '[data-testid="editor-shell"]{display:flex;flex-direction:column;height:100%}' +
    '[data-testid="editor-shell"]>main{flex:1;min-height:0}';
  document.head.append(style);
});
afterAll(() => {
  style.remove();
  restoreAct();
});

type Rendered = ReturnType<typeof mountLive>;
let mounted: Rendered | null = null;
afterEach(async () => {
  if (mounted !== null && document.body.contains(mounted.container)) await mounted.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

const query = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);

async function mount(): Promise<{ app: FakeEditorApp; shell: Shell }> {
  let app: FakeEditorApp | null = null;
  let shell: Shell | null = null;
  mounted = mountLive(
    <EditorRoot
      params={{ ...DEFAULT_PARAMS, e2e: true, ws: 'model' }}
      onShell={(s) => {
        shell = s;
        return undefined;
      }}
      createApp={({ services, platform }) => {
        app = createFakeEditorApp({
          snapshot,
          skeleton,
          services: { ...services, models: createSyntheticModelLoader() },
          platform,
        });
        registerBuiltinOperators(app);
        registerBuiltinWorkspaces(app);
        for (const def of BUILTIN_MENU_ITEMS)
          if (app.menus.get(def.id) === undefined) app.contribute({ kind: 'menu', def });
        return app;
      }}
    />,
  );
  await waitFor(() => app !== null && shell !== null && query('editor-shell') !== null);
  await waitFor(() => window.__EKZA_ANIMATOR_TEST__ !== undefined);
  await window.__EKZA_ANIMATOR_TEST__?.ready;
  if (app === null || shell === null) throw new Error('the editor did not start');
  await waitFor(() => (app as FakeEditorApp).session.getState().workspace === 'model');
  return { app, shell };
}

function createMesh(app: EditorApp, id: string, data: MeshData, fields: Partial<MeshRecord> = {}): MeshId {
  const out = writeRevision(data);
  for (const [, chunk] of out.newChunks) app.blobs.put(chunk);
  app.blobs.put(out.manifestBytes);
  const ref: MeshRef = { manifest: out.manifestId, rev: 1, base: null, joints: [] };
  app.store.transact({ label: 'Create' }, (tx) =>
    tx.put('meshes', {
      id: id as MeshId,
      name: id,
      owner: { scene: true },
      parent: null,
      order: 'a0',
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      pivot: [0, 0, 0],
      source: null,
      data: ref,
      faceted: true,
      generator: null,
      palette: null,
      material: { preset: 'unlit' },
      colourOutput: 'palette-texture',
      skin: null,
      budget: null,
      handheld: null,
      deleted: null,
      ...fields,
    }),
  );
  return id as MeshId;
}

async function run(app: EditorApp, op: string, args?: unknown): Promise<void> {
  const result = await app.runUntyped(op, args);
  expect([op, result.status, result.status === 'cancelled' ? result.reason : '']).toEqual([op, 'finished', '']);
}

describe('the modal readout chip (§8.7)', () => {
  it('draws the dragged value 16 px right of and below the pointer and flips at the pane’s right edge', async () => {
    const { app } = await mount();
    await waitFor(() => query('pane-pane-persp') !== null);
    const pane = query('pane-pane-persp') as HTMLElement;
    setTransformReadout(app, {
      paneId: 'pane-persp',
      x: 100,
      y: 80,
      label: 'Translate Y',
      value: '0.250 m',
      snap: { x: 140, y: 60, label: '→ vertex 3 · msh_A' },
      ring: null,
    });
    await waitFor(() => query('modal-readout') !== null);
    const chip = query('modal-readout') as HTMLElement;
    expect(chip.textContent).toBe('Translate Y 0.250 m');
    // The layer covers the pane (the slot's box; pane CSS px, as the viewport's readout state).
    const box = (query('modal-readout-layer') as HTMLElement).getBoundingClientRect();
    expect(chip.getBoundingClientRect().left - box.left).toBeCloseTo(116, 0);
    expect(chip.getBoundingClientRect().top - box.top).toBeCloseTo(96, 0);
    void pane;
    expect(query('snap-candidate')).not.toBeNull();
    expect(document.body.textContent).toContain('→ vertex 3 · msh_A');
    // At the right edge the chip flips to the left of the pointer.
    setTransformReadout(app, {
      paneId: 'pane-persp',
      x: box.width - 4,
      y: 80,
      label: 'Translate Y',
      value: '0.250 m',
      snap: null,
      ring: { x: 50, y: 50, r: 30, label: 'Radius 0.50 m' },
    });
    await waitFor(() => {
      const c = query('modal-readout');
      return c !== null && c.getBoundingClientRect().right - box.left <= box.width - 4 - 16 + 0.5;
    });
    expect(query('soft-radius-ring')?.getAttribute('r')).toBe('30');
    setTransformReadout(app, null);
    await waitFor(() => query('modal-readout') === null);
  });

  it('shows a capture entry with its field and keys from the first typed digit; the help line mirrors it', async () => {
    const { app } = await mount();
    await loadOpsRuntime();
    let applied: number | null = null;
    const target: NumericTarget = {
      fields: [{ name: 'translateY', label: 'Translate Y', kind: 'distance', bound: 'value', default: 0 }],
      active: 'translateY',
      value: () => 0,
      set: (_field, value) => {
        applied = value;
      },
      confirm: () => {},
      cancel: () => {},
    };
    setTransformReadout(app, {
      paneId: 'pane-persp',
      x: 100,
      y: 80,
      label: 'Translate Y',
      value: '0.120 m',
      snap: null,
      ring: null,
    });
    app.capture.arm('drag', target);
    await waitFor(() => app.capture.state.armed === 'drag');
    for (const key of ['0', '.', '5']) {
      expect(
        app.capture.key({ code: key === '.' ? 'Period' : `Digit${key}`, key, shift: false, mod: false, alt: false }),
      ).toBe(true);
    }
    await waitFor(() => query('modal-readout')?.textContent?.includes('0.5_') === true);
    expect(query('modal-readout')?.textContent).toContain('Enter ✓ · Esc ✕ · Tab next');
    await waitFor(() => query('helpline-text')?.textContent?.includes('Translate Y 0.5_') === true);
    app.capture.key({ code: 'Enter', key: 'Enter', shift: false, mod: false, alt: false });
    await waitFor(() => applied === 0.5);
    // Enter applied the entry: the committed value replaces the prompt (B11's engine says it at once).
    await waitFor(() => query('helpline-text')?.textContent === 'Translate Y 0.500 m');
    // The drag commits: the transform runtime's announcement goes to the help line of its pane (once).
    setTransformReadout(app, null);
    const said = { paneId: 'pane-persp', x: 0, y: 0, label: null, value: null, snap: null, ring: null };
    setTransformReadout(app, { ...said, said: 'Move Translate Y 0.500 m' });
    await waitFor(() => query('helpline-text')?.textContent === 'Move Translate Y 0.500 m');
    await waitFor(() => transformReadout(app) === null);
    expect(query('modal-readout')).toBeNull();
    expect(query('helpline-text')?.textContent).toBe('Move Translate Y 0.500 m');
  });

  it('clears the entry prompt when the entry ends without a committed value (Esc, the drag released)', async () => {
    const { app } = await mount();
    await loadOpsRuntime();
    let cancelled = false;
    const target: NumericTarget = {
      fields: [{ name: 'translateY', label: 'Translate Y', kind: 'distance', bound: 'value', default: 0 }],
      active: 'translateY',
      value: () => 0,
      set: () => {},
      confirm: () => {},
      cancel: () => {
        cancelled = true;
        setTransformReadout(app, null);
      },
    };
    const readout = {
      paneId: 'pane-persp',
      x: 100,
      y: 80,
      label: 'Translate Y',
      value: '0.120 m',
      snap: null,
      ring: null,
    } as const;
    // Esc cancels the drag: the prompt leaves the help line.
    setTransformReadout(app, readout);
    app.capture.arm('drag', target);
    await waitFor(() => app.capture.state.armed === 'drag');
    for (const key of ['0', '.', '2']) {
      app.capture.key({ code: key === '.' ? 'Period' : `Digit${key}`, key, shift: false, mod: false, alt: false });
    }
    await waitFor(() => query('helpline-text')?.textContent?.includes('Translate Y 0.2_') === true);
    app.capture.key({ code: 'Escape', key: 'Escape', shift: false, mod: false, alt: false });
    expect(cancelled).toBe(true);
    await waitFor(() => query('helpline-text')?.textContent?.includes('0.2_') === false);
    // A drag released with an entry neither applied nor confirmed (the runtime disarms): the same.
    setTransformReadout(app, readout);
    app.capture.arm('drag', target);
    await waitFor(() => app.capture.state.armed === 'drag');
    app.capture.key({ code: 'Digit7', key: '7', shift: false, mod: false, alt: false });
    await waitFor(() => query('helpline-text')?.textContent?.includes('Translate Y 7_') === true);
    app.capture.disarm();
    setTransformReadout(app, null);
    await waitFor(() => query('helpline-text')?.textContent?.includes('7_') === false);
  });
});

describe('the options and space marking menus (§8.4, §7)', () => {
  it('registers model.options (Ctrl+Shift+RMB and Q+LMB) and the W/E space menus on the first Model entry', async () => {
    const { app } = await mount();
    await waitFor(() => app.markingMenus.get('model.options') !== undefined);
    expect(app.markingMenus.get('model.options.lmb')?.trigger).toEqual({
      button: 'lmb',
      mods: 'none',
      holdKey: 'KeyQ',
    });
    expect(app.markingMenus.get('model.space.move')).toBeDefined();
    expect(app.markingMenus.get('model.space.rotate')).toBeDefined();
    expect(OPTIONS_MENU.trigger).toEqual({ button: 'rmb', mods: 'ctrl+shift' });
    expect(Object.keys(OPTIONS_MENU.slots).sort()).toEqual(['E', 'N', 'NE', 'NW', 'S', 'SE', 'SW', 'W']);
    expect(OPTIONS_MENU_LMB.slots).toBe(OPTIONS_MENU.slots);
  });

  it('runs its items: symmetry modes per target mesh, soft select, camera-based, back faces, styles, Preserve Seam', async () => {
    const { app } = await mount();
    const cube = createMesh(app, 'msh_Cube', primitive('cube', {}));
    app.session.setState({ selection: { ...app.session.getState().selection, objects: [cube] } });
    const slots = OPTIONS_MENU.slots;
    const runItem = async (item: { op?: string; args?: unknown } | undefined): Promise<void> => {
      if (item?.op === undefined) throw new Error('no op');
      await run(app, item.op, item.args);
    };
    expect(slots.N?.checked?.(app)).toBe(false);
    await runItem(slots.N);
    expect(slots.N?.checked?.(app)).toBe(true);
    expect(slots.NE?.checked?.(app)).toBe(false);
    await runItem(slots.NW?.submenu?.[0]);
    expect(app.session.getState().model.symmetry.get(cube)?.mode).toBe('world-x');
    await runItem(slots.E);
    expect(slots.E?.checked?.(app)).toBe(true);
    await runItem(slots.SE);
    expect(app.session.getState().model.cameraBased).toBe('off');
    await runItem(slots.SE);
    expect(app.session.getState().model.cameraBased).toBe('on');
    await runItem(slots.SW);
    expect(slots.SW?.checked?.(app)).toBe(true);
    await runItem(slots.W?.submenu?.[1]);
    expect(app.session.getState().model.selectionStyle).toBe('tweak');
    expect(slots.W?.submenu?.[2]?.disabledReason).toBe('Drag selection arrives later');
    const seam = OPTIONS_MENU.list[1];
    expect(seam?.checked?.(app)).toBe(true);
    await runItem(seam);
    expect(seam?.checked?.(app)).toBe(false);
    // The space menus: Component is the Move/Rotate orientation next to World/Object.
    const component = MOVE_SPACE_MENU.slots.S;
    expect(component?.checked?.(app)).toBe(false);
    await runItem(component);
    expect(component?.checked?.(app)).toBe(true);
    setComponentSpace(app, 'move', false);
    expect(MOVE_SPACE_MENU.slots.N?.checked?.(app)).toBe(true);
    await runItem(ROTATE_SPACE_MENU.slots.W);
    expect(app.prefs.getState().rotateSpace).toBe('gimbal');
  });
});

describe('the B12a test API group (§4.8)', () => {
  it('symmetry(): settings and the runtime’s partner map; softWeights(): seeds 1 and the falloff', async () => {
    const { app } = await mount();
    const plane = createMesh(
      app,
      'msh_Plane',
      primitive('plane', { width: 4, height: 4, subdivisionsWidth: 4, subdivisionsHeight: 4 }),
    );
    await waitFor(() => app.meshes.get(plane)?.state === 'ready');
    const api = window.__EKZA_ANIMATOR_TEST__;
    expect(api?.symmetry(plane)).toEqual({
      mode: 'off',
      tolerance: 0.001,
      preserveSeam: true,
      unmatched: 0,
      vertexPartners: [],
    });
    app.session.setState({ selection: { ...app.session.getState().selection, objects: [plane] } });
    await run(app, 'model.symmetry.set', { mode: 'object-x' });
    const sym = api?.symmetry(plane);
    expect(sym?.unmatched).toBe(0);
    expect(sym?.vertexPartners).toHaveLength(25);
    expect(sym?.vertexPartners.every((p, v, all) => p < 0 || all[p] === v)).toBe(true);
    expect(api?.softWeights(plane)).toBeNull(); // soft selection off
    await run(app, 'select.mode', { mode: 'vertex' });
    await run(app, 'model.symmetry.set', { mode: 'off' });
    await run(app, 'select.components', { mesh: plane, kind: 'vertex', indices: [12], mode: 'replace' });
    await run(app, 'model.softSelect.set', { on: true, radius: 1.5, curve: 'linear' });
    const weights = api?.softWeights(plane) ?? [];
    expect(weights).toHaveLength(25);
    expect(weights[12]).toBe(1);
    expect(weights.filter((w) => w > 0 && w < 1).length).toBeGreaterThan(0);
    expect(Math.min(...weights)).toBe(0);
  });
});
