// B10 (M6A-SPEC §5.24, §5.25, §8.4, §8.7, §4.8): the Poly Count HUD (counts equal the runtimes' counts and
// triangulation, the selected column with the mirrored partners, the badge line, the budget bar), BIND POSE, the
// `model.modes` and `model.convert` marking menus, the Mesh Check panel (Clean, a template mesh's open border, Select,
// Fix) and its helpers, and the B10 test API group on the whole shell. Mesh Check results need B5's `checkMesh`
// (READY.b5).
import type {
  AssetId,
  DocSnapshot,
  GroupId,
  GroupRecord,
  MeshId,
  MeshRecord,
  MeshRef,
  PaletteId,
  SwatchId,
  SwatchRecord,
} from '@ekza-animator/doc';
import {
  BUILTIN_MENU_ITEMS,
  type EditorApp,
  loadMeshKernel,
  type MarkingMenuItem,
  registerBuiltinOperators,
  registerBuiltinWorkspaces,
} from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import { type MeshData, primitive, type SymmetryMap, writeRevision } from '@ekza-animator/mesh-core';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { viewportManagerOf } from '@ekza-animator/viewport';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CONVERT_MENU } from '../src/overlays/menus/convert';
import { MODES_MENU } from '../src/overlays/menus/modes';
import { checkRows, duplicateSwatchOf, FIX_OF, severityOf } from '../src/panels/meshcheck/checks';
import MeshCheckView from '../src/panels/meshcheck/MeshCheckView';
import { budgetState, hudData } from '../src/panels/viewport/hud/data';
import { EditorRoot } from '../src/shell/EditorRoot';
import type { Shell } from '../src/shell/types';
import { createSyntheticModelLoader } from '../src/testing/syntheticModels';
import { DEFAULT_PARAMS } from '../src/test-api/params';
import { READY } from './m6a-select/ready';
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

async function enterFaceMode(app: EditorApp, meshes: readonly MeshId[]): Promise<void> {
  await waitFor(() => meshes.every((id) => app.meshes.get(id)?.state === 'ready'));
  app.session.setState({ selection: { ...app.session.getState().selection, objects: [...meshes] } });
  const result = await app.runUntyped('select.mode', { mode: 'face' });
  expect(result.status).toBe('finished');
}

describe('Poly Count HUD (§5.24)', () => {
  it('counts equal the runtimes (triangulation for tris); the selected column and the budget bar', async () => {
    const { app } = await mount();
    const cube = createMesh(app, 'msh_Cube', primitive('cube', {}), { budget: { tris: 12 } });
    const plane = createMesh(app, 'msh_Plane', primitive('plane', { subdivisionsWidth: 2, subdivisionsHeight: 1 }));
    await enterFaceMode(app, [cube]);
    const runtime = app.meshes.get(cube);
    const data = hudData(app, 'pane-persp');
    // UVs are a row only when the meshes have them (B1's primitives do, the reference kernel's do not).
    expect(data?.scene).toMatchObject({ vertex: 8 + 6, edge: 12 + 7, face: 6 + 2, tris: 12 + 4 });
    expect(data?.object).toMatchObject({
      vertex: runtime?.data()?.counts.points,
      edge: runtime?.data()?.counts.edges,
      face: runtime?.data()?.counts.faces,
      tris: runtime?.triangulation().triFace.length,
    });
    expect(data?.budget).toEqual({ tris: 12, limit: 12, state: 'warn', label: '12 tris' });
    app.components.apply(cube, 'face', [0, 3], 'replace');
    const api = window.__EKZA_ANIMATOR_TEST__;
    expect(api?.hud('pane-persp')?.selected).toMatchObject({ face: 2, tris: 4, vertex: 0 });
    expect(api?.hud('pane-persp')?.mode).toBe('face');
    // The HUD element shows the same numbers (lazy chunk, top-left of the pane).
    await waitFor(() => query('hud-pane-persp') !== null);
    await waitFor(() => query('hud-pane-persp-selected-face')?.textContent === '2');
    expect(query('hud-pane-persp-scene-tris')?.textContent).toBe('16');
    expect(query('hud-budget-pane-persp')?.getAttribute('data-state')).toBe('warn');
    expect(query('hud-mode-pane-persp')?.textContent).toBe('FACE');
    void plane;
  });

  it('the Selected column reads "N (+N sym)" under symmetry; the badge names SYM and SOFT', async () => {
    const { app } = await mount();
    const plane = createMesh(app, 'msh_Plane', primitive('plane', { subdivisionsWidth: 2, subdivisionsHeight: 1 }));
    await enterFaceMode(app, [plane]);
    // Faces 0 (left) and 1 (right) of the 2×1 plane mirror each other across x = 0.
    const map: SymmetryMap = {
      axis: 'x',
      space: 'object',
      plane: 0,
      tolerance: 0.001,
      vertex: Int32Array.from([2, 1, 0, 5, 4, 3]),
      edge: Int32Array.from([5, 4, 2, 6, 1, 0, 3]),
      edgeReversed: new Uint8Array(7),
      edgeSelf: Uint8Array.from([0, 0, 2, 0, 0, 0, 0]),
      face: Int32Array.from([1, 0]),
      unmatched: 0,
    };
    const runtime = app.meshes.get(plane);
    if (runtime === undefined) throw new Error('runtime');
    vi.spyOn(runtime, 'symmetry').mockReturnValue(map);
    const model = app.session.getState().model;
    app.session.setState({
      model: {
        ...model,
        symmetry: new Map([[plane, { mode: 'object-x', tolerance: 0.001, preserveSeam: true }]]),
        softSelect: { ...model.softSelect, on: true },
      },
    });
    app.components.apply(plane, 'face', [0], 'replace');
    const data = hudData(app, 'pane-persp');
    expect([data?.selected.face, data?.selectedSym.face, data?.selectedSym.tris]).toEqual([1, 1, 2]);
    expect(data?.badge).toBe('FACE · SYM X · SOFT 0.50 m');
    await waitFor(() => query('hud-pane-persp-selected-face')?.textContent === '1 (+1 sym)');
  });

  it('budget states: ok below 90 %, warn up to 100 %, danger above; no budget is ok', () => {
    expect([budgetState(89, 100), budgetState(90, 100), budgetState(100, 100), budgetState(101, 100)]).toEqual([
      'ok',
      'warn',
      'warn',
      'danger',
    ]);
    expect(budgetState(5_000, null)).toBe('ok');
  });

  it('BIND POSE shows in Model while a skinned mesh exists', async () => {
    const { app } = await mount();
    expect(query('bind-pose-pane-persp')).toBeNull();
    createMesh(app, 'msh_Skinned', primitive('cube', {}), { skin: { asset: 'ast_Body' as AssetId, skin: 0 } });
    await waitFor(() => query('bind-pose-pane-persp') !== null);
    expect(query('bind-pose-pane-persp')?.textContent).toBe('BIND POSE');
  });
});

describe('marking menus (§8.4)', () => {
  const ops = (items: readonly (MarkingMenuItem | undefined)[]): string[] =>
    items.flatMap((item) =>
      item === undefined ? [] : [...(item.op === undefined ? [] : [item.op]), ...ops(item.submenu ?? [])],
    );

  it('registers model.modes (RMB on a mesh) and model.convert (Ctrl+RMB, component modes) with registered operators', async () => {
    const { app } = await mount();
    await waitFor(() => app.markingMenus.get('model.modes') !== undefined);
    expect(app.markingMenus.get('model.convert')).toBe(CONVERT_MENU);
    expect(MODES_MENU.trigger).toEqual({ button: 'rmb', mods: 'none' });
    expect(MODES_MENU.when).toEqual({ over: 'mesh' });
    expect(CONVERT_MENU.trigger).toEqual({ button: 'rmb', mods: 'ctrl' });
    expect(CONVERT_MENU.when.modes).toEqual(['vertex', 'edge', 'face']);
    for (const def of [MODES_MENU, CONVERT_MENU]) {
      for (const op of ops([...Object.values(def.slots), ...def.list])) {
        expect([def.id, op, app.operators.get(op) !== undefined]).toEqual([def.id, op, true]);
      }
    }
    expect(MODES_MENU.slots.S).toMatchObject({ op: 'select.mode', args: { mode: 'face' } });
    expect(MODES_MENU.slots.E?.disabledReason).toBe('UV editor arrives later');
    expect(CONVERT_MENU.slots.N).toMatchObject({ op: 'select.mesh.convert', args: { to: 'edge', mode: 'touching' } });
    expect(MODES_MENU.slots.S?.checked?.(app)).toBe(false);
  });
});

describe('Mesh Check (§5.25)', () => {
  it('groups problems by code with their elements, severities and fixes', () => {
    const rows = checkRows([
      { code: 'lamina', message: 'Lamina faces', elements: Uint32Array.from([4, 2]), domain: 'face' },
      { code: 'open-border', message: 'Open border', elements: Uint32Array.from([1]), domain: 'edge' },
      { code: 'lamina', message: 'Lamina faces', elements: Uint32Array.from([2, 7]), domain: 'face' },
      { code: 'concave-ngon', message: 'Concave n-gon' },
    ]);
    expect(rows.map((row) => [row.code, row.count, row.elements, row.severity, row.fix])).toEqual([
      ['lamina', 3, [2, 4, 7], 'error', 'deleteLamina'],
      ['open-border', 1, [1], 'info', null],
      ['concave-ngon', 1, [], 'warning', 'triangulate'],
    ]);
    expect(severityOf('non-manifold-edge')).toBe('error');
    expect(Object.keys(FIX_OF)).toContain('loose-geometry');
  });

  it('keeps elements per domain: loose point 5 and wire edge 5 are two elements of one row', () => {
    const [row] = checkRows([
      { code: 'loose-geometry', message: 'Loose points', elements: Uint32Array.from([5, 9]), domain: 'point' },
      { code: 'loose-geometry', message: 'Wire edges', elements: Uint32Array.from([5]), domain: 'edge' },
    ]);
    expect([row?.count, row?.domain, row?.elements, row?.byDomain]).toEqual([
      3,
      'point',
      [5, 9],
      { point: [5, 9], edge: [5] },
    ]);
  });

  /**
   * A plane coloured from a palette whose slot 0 two live swatches share (a merge of two peers' palettes): its faces,
   * unpainted, read slot 0, so B5 reports each as `duplicate-slot`.
   */
  const duplicatePalette = (app: FakeEditorApp): MeshId => {
    // `@ekza-animator/doc/testing` reads fixtures from disk (node:fs), so the records are spelled out here.
    const swatch = (id: string, slot: number, order: string): SwatchRecord => ({
      id: id as SwatchId,
      palette: 'pal_P' as PaletteId,
      slot,
      order,
      name: `Swatch ${slot}`,
      srgb: [128, 128, 128],
      kind: 'flat',
      ramp: null,
      deleted: null,
    });
    app.store.transact({ label: 'Palette' }, (tx) => {
      tx.put('palettes', { id: 'pal_P' as PaletteId, name: 'Palette', order: 'a0', deleted: null });
      tx.put('swatches', swatch('sw_A', 0, 'a0'));
      tx.put('swatches', swatch('sw_B', 0, 'a1'));
      tx.put('swatches', swatch('sw_C', 4, 'a2'));
    });
    return createMesh(app, 'msh_Painted', primitive('plane', {}), { palette: 'pal_P' as PaletteId });
  };

  it('"select swatch" for duplicate-slot picks the swatch the reader shadows; none without a duplicate', () => {
    const app = createFakeEditorApp();
    try {
      const painted = duplicatePalette(app);
      const plain = createMesh(app, 'msh_Plain', primitive('plane', {}));
      // The reader takes the smallest SwatchId on a duplicate (sw_A): the duplicate to fix is sw_B.
      expect([duplicateSwatchOf(app, painted), duplicateSwatchOf(app, plain)]).toEqual(['sw_B', null]);
    } finally {
      app.dispose();
    }
  });

  /** The panel body over a fake app in Model with the mesh `make` creates, unmounted after `body`. */
  async function withPanel(
    make: (app: FakeEditorApp) => MeshId,
    body: (app: FakeEditorApp, mesh: MeshId, container: HTMLElement) => Promise<void>,
  ) {
    const app = createFakeEditorApp();
    registerBuiltinOperators(app);
    app.session.setState({ workspace: 'model' });
    const mesh = make(app);
    await waitFor(() => app.meshes.get(mesh)?.state === 'ready');
    const view = mountLive(<MeshCheckView app={app} />);
    try {
      await waitFor(() => view.container.textContent?.includes(mesh) === true);
      await body(app, mesh, view.container);
    } finally {
      await view.unmount();
      app.dispose();
    }
  }

  const openPlane = (app: FakeEditorApp): MeshId => createMesh(app, 'msh_Open', primitive('plane', {}));

  /** A plane under a `prop` template group: the template flags it closed, so its border is a problem (§5.25). */
  const templatePlane = (app: FakeEditorApp): MeshId => {
    const group: GroupRecord = {
      id: 'grp_Prop' as GroupId,
      name: 'Prop',
      owner: { scene: true },
      parent: null,
      order: 'a0',
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      pivot: [0, 0, 0],
      template: { kind: 'prop', params: {} },
      budget: null,
      handheld: null,
      deleted: null,
    };
    app.store.transact({ label: 'Template' }, (tx) => tx.put('groups', group));
    return createMesh(app, 'msh_Lid', primitive('plane', {}), { parent: 'grp_Prop' as GroupId });
  };

  /**
   * A cylinder (8 sides) with one top-ring vertex lifted by 0.5 m: its top cap n-gon is no longer planar
   * (`nonplanar-ngon`, fixed by `mesh.cleanup {fix: 'triangulate'}`).
   */
  const warped = (app: FakeEditorApp): MeshId => {
    const base = primitive('cylinder', { subdivisionsAxis: 8 });
    const position = new Float32Array(base.position);
    let top = 0;
    for (let v = 1; v < base.counts.points; v++) {
      const y = position[3 * v + 1] as number;
      const best = position[3 * top + 1] as number;
      if (
        y > best + 1e-6 ||
        (Math.abs(y - best) <= 1e-6 && (position[3 * v] as number) > (position[3 * top] as number))
      )
        top = v;
    }
    position[3 * top + 1] = (position[3 * top + 1] as number) + 0.5;
    return createMesh(app, 'msh_Warped', { ...base, position });
  };

  it.skipIf(READY.b5)('the panel body names the checked mesh and says why it has no results yet', async () => {
    await withPanel(openPlane, async (_app, _plane, container) => {
      expect(container.textContent).toContain('Mesh Check arrives with the diagnostics package');
    });
  });

  it.skipIf(!READY.b5)(
    'an open mesh is Clean: open borders count only on meshes their template flags closed (B5)',
    async () => {
      await withPanel(openPlane, async () => {
        await waitFor(() => query('meshcheck-status') !== null);
        expect(query('meshcheck-status')?.textContent).toBe('Clean');
        expect(query('meshcheck-row-open-border')).toBeNull();
      });
    },
  );

  it.skipIf(!READY.b5)('lists a template mesh’s open border; Select selects its edges in edge mode (B5)', async () => {
    await withPanel(templatePlane, async (app, lid) => {
      await waitFor(() => query('meshcheck-row-open-border') !== null);
      expect(query('meshcheck-row-open-border')?.textContent).toContain('4');
      expect(query('meshcheck-status')?.textContent).toBe('1 problem');
      // Open borders have no fix (§5.25: select border).
      expect(query('meshcheck-fix-open-border')).toBeNull();
      query('meshcheck-select-open-border')?.click();
      await waitFor(() => app.session.getState().model.componentMode === 'edge');
      expect(app.session.getState().model.hilite).toEqual([lid]);
      expect([...app.components.get(lid, 'edge').edges.toArray()]).toEqual([0, 1, 2, 3]);
      expect(app.calls.filter((call) => call.id === 'select.mesh.matching').map((call) => call.args)).toEqual([
        { mesh: lid, code: 'open-border' },
      ]);
    });
  });

  it.skipIf(!READY.b5)('duplicate-slot offers Swatch: it makes the shadowed duplicate active (B5, B13)', async () => {
    await withPanel(duplicatePalette, async (app) => {
      await waitFor(() => query('meshcheck-row-duplicate-slot') !== null);
      expect(query('meshcheck-fix-duplicate-slot')).toBeNull();
      query('meshcheck-swatch-duplicate-slot')?.click();
      await waitFor(() => app.calls.some((call) => call.id === 'palette.setActive'));
      expect(app.calls.filter((call) => call.id === 'palette.setActive').map((call) => call.args)).toEqual([
        { swatch: 'sw_B' },
      ]);
    });
  });

  it.skipIf(!READY.b5)('Fix runs the code’s mesh.cleanup fix on the checked mesh (B5)', async () => {
    await withPanel(warped, async (app, cylinder) => {
      await waitFor(() => query('meshcheck-row-nonplanar-ngon') !== null);
      expect(query('meshcheck-row-nonplanar-ngon')?.textContent).toContain('1');
      query('meshcheck-fix-nonplanar-ngon')?.click();
      await waitFor(() => app.calls.some((call) => call.id === 'mesh.cleanup'));
      expect(app.calls.filter((call) => call.id === 'mesh.cleanup').map((call) => call.args)).toEqual([
        { meshes: [cylinder], fix: 'triangulate', selectOnly: false },
      ]);
    });
  });
});

describe('Mesh Check overlay flag (§5.25, DisplayFlags.meshCheck)', () => {
  it('is on in every pane while the panel is shown, panes of a later layout too, and off again after', async () => {
    const { app } = await mount();
    await waitFor(() => (viewportManagerOf(app)?.paneIds().length ?? 0) > 0);
    const flags = (): Record<string, boolean | undefined> => {
      const vm = viewportManagerOf(app);
      return Object.fromEntries((vm?.paneIds() ?? []).map((id) => [id, vm?.paneState(id)?.display.meshCheck]));
    };
    const all = (value: boolean): boolean => Object.values(flags()).every((flag) => flag === value);
    expect(all(false)).toBe(true);
    const panel = mountLive(<MeshCheckView app={app} />);
    try {
      await waitFor(() => all(true));
      const single = Object.keys(flags()).length;
      // Model opens on the quad layout with the persp pane maximized: leaving it makes the other three panes.
      expect((await app.runUntyped('view.layout', { layout: 'quad' })).status).toBe('finished');
      if (app.session.getState().maximizedPane !== null) await app.runUntyped('view.toggleMaximize');
      await waitFor(() => Object.keys(flags()).length > single);
      await waitFor(() => all(true));
      expect(Object.keys(flags()).length).toBe(4);
    } finally {
      await panel.unmount();
    }
    expect(flags()).toEqual(Object.fromEntries(Object.keys(flags()).map((id) => [id, false])));
  });
});

describe('test API (B10 group, §4.8)', () => {
  it('model(), paneObjects() and screenOfFace() on the live shell', async () => {
    const { app } = await mount();
    const cube = createMesh(app, 'msh_Cube', primitive('cube', {}));
    await enterFaceMode(app, [cube]);
    app.components.apply(cube, 'face', [2], 'replace');
    const api = window.__EKZA_ANIMATOR_TEST__;
    if (api === undefined) throw new Error('no test API');
    const model = api.model();
    expect(model.mode).toBe('face');
    expect(model.hilite).toEqual([cube]);
    expect(model.selected[cube]).toMatchObject({ face: [2], vertex: [], edge: [], active: 2, order: [2] });
    expect(model.expanded[cube]?.face).toEqual([2]);
    expect(model.hidden[cube]).toEqual({ vertex: [], edge: [], face: [] });
    expect(api.paneObjects('pane-persp')).toEqual([cube]);
    await waitFor(
      () => api.screenOfFace(cube, 0, 'pane-persp') !== null || api.screenOfFace(cube, 1, 'pane-persp') !== null,
    );
  });

  it.skipIf(READY.b5)('meshCheck() reports the kernel stub until B5 lands', async () => {
    const { app } = await mount();
    const cube = createMesh(app, 'msh_Cube', primitive('cube', {}));
    await waitFor(() => app.meshes.get(cube)?.state === 'ready');
    expect(() => window.__EKZA_ANIMATOR_TEST__?.meshCheck(cube)).toThrow(/checkMesh/);
  });

  it.skipIf(!READY.b5)('meshCheck() of a closed cube is empty (B5)', async () => {
    const { app } = await mount();
    const cube = createMesh(app, 'msh_Cube', primitive('cube', {}));
    await waitFor(() => app.meshes.get(cube)?.state === 'ready');
    expect(window.__EKZA_ANIMATOR_TEST__?.meshCheck(cube)).toEqual([]);
  });
});
