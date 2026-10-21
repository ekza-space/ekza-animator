// M6A-SPEC §5.17, §6.2 (B9): the four workspace tabs, `workspace.set` and its switching rules, Model's status glyph,
// `view.tool` in Model, and the pane and overlay operators through their ports.
import type { MeshId, MeshRef } from '@ekza-studio/doc';
import { makeTestMesh } from '@ekza-studio/doc/testing';
import { type MeshData, primitive, writeRevision } from '@ekza-studio/mesh-core';
import { describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_WORKSPACES,
  createMemoryBlobStore,
  type DisplayFlags,
  type EditorApp,
  LEFT_MODEL_REASON,
  type LastRun,
  loadMeshKernel,
  type MarkingMenuDef,
  MODEL_WORKSPACE,
  modelStatus,
  providePaneDisplay,
  provideShellOverlays,
  registerBuiltins,
  type RunContext,
  workspaceTabs,
} from '../../src';
import { createFakeEditorApp, createFakeServices } from '../../src/testing';
import { kernelApp, W, waveApp } from '../kernel/support';

function app(): EditorApp {
  const a = waveApp();
  registerBuiltins(a);
  return a;
}

async function run(a: EditorApp, op: string, args?: unknown, ctx?: RunContext) {
  return a.runUntyped(op, args, ctx);
}

describe('workspace tabs (§5.17)', () => {
  // M6B-SPEC §3 rule 9 literal update: Rig & Skin is enabled (M6b C0).
  it('registers Model › Rig & Skin › Animate › Review; Review is disabled with its release', () => {
    const a = app();
    expect(workspaceTabs(a).map((def) => [def.id, def.label, def.shortLabel, def.enabled])).toEqual([
      ['model', 'Model', 'Mdl', true],
      ['rig', 'Rig & Skin', 'Rig', true],
      ['animate', 'Animate', 'Anim', true],
      ['review', 'Review', 'Rev', false],
    ]);
    expect(a.workspaces.get('rig')?.disabledReason).toBeUndefined();
    expect(a.workspaces.get('review')?.disabledReason).toBe('Arrives in V1');
    expect(BUILTIN_WORKSPACES.map((def) => def.id)).toEqual(['model', 'rig', 'animate', 'review']);
  });

  it('defines Model: key scope, menus, status groups, select tool, mesh pick mask, no timeline, quad layout', () => {
    expect(MODEL_WORKSPACE).toMatchObject({
      keyScope: 'model',
      defaultTool: 'select',
      pickMask: { controls: false, joints: false, meshes: true, groups: true },
      timeline: false,
      layout: 'model-quad',
    });
    expect(MODEL_WORKSPACE.menus).toEqual([
      'file',
      'edit',
      'create',
      'select',
      'modify',
      'display',
      'mesh',
      'edit-mesh',
      'mesh-tools',
      'mesh-display',
      'uv',
      'windows',
      'help',
    ]);
    expect(MODEL_WORKSPACE.statusGroups).toEqual([
      'tools',
      'mode',
      'symmetry',
      'soft',
      'snap',
      'pivot',
      'moveSpace',
      'layout',
    ]);
  });
});

describe('workspace.set (§5.17)', () => {
  it('refuses unknown and disabled workspaces with their reason, and needs { workspace }', async () => {
    const a = app();
    // M6B-SPEC §3 rule 9 literal update: Rig & Skin is enabled, so only Review is refused as disabled.
    expect(await run(a, 'workspace.set', { workspace: 'review' })).toEqual({
      status: 'cancelled',
      reason: 'Arrives in V1',
    });
    expect(await run(a, 'workspace.set', { workspace: 'nope' })).toEqual({
      status: 'cancelled',
      reason: "Unknown workspace 'nope'",
    });
    expect(await run(a, 'workspace.set', undefined)).toEqual({ status: 'cancelled', reason: 'expects { workspace }' });
    expect(a.session.getState().workspace).toBe('animate');
  });

  it('keeps the document, selection, time; swaps layouts, tools and pick mask per workspace', async () => {
    const a = app();
    a.session.setState({
      selection: { ...a.session.getState().selection, controls: [W.handL] },
      time: { ...a.session.getState().time, sceneFrame: 12 },
      viewportLayout: 'single',
      maximizedPane: null,
      tools: { ...a.session.getState().tools, viewport: 'rotate' },
    });
    const doc = a.store.version;
    expect((await run(a, 'workspace.set', { workspace: 'model' })).status).toBe('finished');
    let s = a.session.getState();
    expect(s.workspace).toBe('model');
    expect(a.prefs.getState().lastWorkspace).toBe('model');
    // Model's first entry: M-Quad with the persp pane maximized, the select tool and the mesh pick mask.
    expect([s.viewportLayout, s.maximizedPane]).toEqual(['quad', 'pane-persp']);
    expect(s.tools.viewport).toBe('select');
    expect(s.tools.selectionMask).toEqual({ controls: false, joints: false, meshes: true, groups: true });
    expect(s.selection.controls).toEqual([W.handL]);
    expect(s.time.sceneFrame).toBe(12);
    expect(a.store.version).toBe(doc);
    expect(s.workspaceViews['animate']).toEqual({ layout: 'single', maximizedPane: null });
    // Model's own choices are remembered too.
    a.session.setState({ viewportLayout: 'split', maximizedPane: null });
    a.session.setState({ tools: { ...a.session.getState().tools, viewport: 'move' } });

    expect((await run(a, 'workspace.set', { workspace: 'animate' })).status).toBe('finished');
    s = a.session.getState();
    expect([s.viewportLayout, s.maximizedPane]).toEqual(['single', null]);
    expect(s.tools.viewport).toBe('rotate');
    expect(s.tools.selectionMask).toEqual({ controls: true, joints: false, meshes: false, groups: false });
    expect(s.workspaceViews['model']).toEqual({ layout: 'split', maximizedPane: null });
    expect(a.prefs.getState().lastWorkspace).toBe('animate');

    await run(a, 'workspace.set', { workspace: 'model' });
    s = a.session.getState();
    expect([s.viewportLayout, s.maximizedPane, s.tools.viewport]).toEqual(['split', null, 'move']);
    // No history step: switching is not an edit.
    expect(a.history.canUndo()).toBe(false);
  });

  it('switching to the active workspace changes nothing', async () => {
    const a = app();
    const before = a.session.getState();
    expect((await run(a, 'workspace.set', { workspace: 'animate' })).status).toBe('finished');
    expect(a.session.getState()).toBe(before);
  });

  it('leaving Model drops to object mode (remembering the mode), closes the Last-op card and ends sessions', async () => {
    const a = app();
    await run(a, 'workspace.set', { workspace: 'model' });
    const lastRun = { id: 'mesh.extrude', closed: null } as unknown as LastRun;
    a.session.setState({
      model: { ...a.session.getState().model, componentMode: 'face', hilite: ['msh_A' as MeshId] },
      lastRun,
    });
    const end = vi.spyOn(a.extrude, 'end');
    const disarm = vi.spyOn(a.capture, 'disarm');
    await run(a, 'workspace.set', { workspace: 'animate' });
    const s = a.session.getState();
    expect(s.model.componentMode).toBe('object');
    expect(s.model.lastComponentMode).toBe('face');
    expect(s.model.hilite).toEqual(['msh_A']); // kept (not drawn) for the next component entry
    expect(s.lastRun?.closed).toBe(LEFT_MODEL_REASON);
    // The stub services have no session and nothing armed: nothing to end.
    expect(end).not.toHaveBeenCalled();
    expect(disarm).not.toHaveBeenCalled();
  });

  it('ends an open extrude session and disarms the capture window when leaving Model', async () => {
    const a = app();
    await run(a, 'workspace.set', { workspace: 'model' });
    const end = vi.fn<(reason: string, opts: { readonly drop: boolean }) => void>();
    const disarm = vi.fn<() => void>();
    Object.defineProperty(a.extrude, 'state', { get: () => ({ stepId: 1 }) });
    (a.extrude as { end: unknown }).end = end;
    Object.defineProperty(a.capture, 'state', { get: () => ({ armed: 'keyboard-op', field: null, text: null }) });
    (a.capture as { disarm: unknown }).disarm = disarm;
    await run(a, 'workspace.set', { workspace: 'animate' });
    // §5.8 table: a workspace switch ends the session with the zero-drop (B12b aligned B9's call with the table).
    expect(end).toHaveBeenCalledWith('workspace', { drop: true });
    expect(disarm).toHaveBeenCalledOnce();
  });
});

describe('view.tool in Model (§6.2)', () => {
  it('accepts the M6a viewport tools: registered ones run, missing built-ins say "not available yet"', async () => {
    const a = app();
    a.contribute({
      kind: 'tool',
      def: { id: 'select', panel: 'viewport', label: 'Select', create: () => ({}) },
    });
    expect(await run(a, 'view.tool', { panel: 'viewport', tool: 'multiCut' })).toEqual({
      status: 'cancelled',
      reason: 'not available yet',
    });
    expect(await run(a, 'view.tool', { panel: 'viewport', tool: 'wand' })).toEqual({
      status: 'cancelled',
      reason: "Unknown viewport tool 'wand'",
    });
  });

  it('records the last non-transform tool in Model only (Y)', async () => {
    const a = app();
    await run(a, 'view.tool', { panel: 'viewport', tool: 'multiCut' }); // no viewport tools registered: any id
    expect(a.session.getState().model.lastTool).toBeNull();
    await run(a, 'workspace.set', { workspace: 'model' });
    await run(a, 'view.tool', { panel: 'viewport', tool: 'insertLoop' });
    expect(a.session.getState().model.lastTool).toBe('insertLoop');
    await run(a, 'view.tool', { panel: 'viewport', tool: 'move' });
    await run(a, 'view.tool', { panel: 'viewport', tool: 'scale' });
    expect(a.session.getState().model.lastTool).toBe('insertLoop');
    expect(a.session.getState().tools.viewport).toBe('scale');
  });
});

/** Animate's pane display (the viewport's DEFAULT_DISPLAY). */
const DISPLAY: DisplayFlags = {
  mesh: true,
  skeleton: false,
  controls: true,
  grid: true,
  xray: false,
  hud: true,
  springBones: false,
  shading: 'lit',
  wireOnShaded: false,
  flat: false,
  cull: false,
  components: true,
  normals: 'off',
  faceOrientation: false,
  triangulation: false,
  hardEdges: false,
  polyCount: false,
  meshCheck: false,
  symmetryPlane: true,
  dimUnhilited: false,
  imagePlanes: true,
  // M6B-SPEC §3 rule 9: the M6b display flags at their Animate defaults.
  joints: false,
  xrayJoints: false,
  jointAxes: 'none',
  jointLabels: 'none',
  weights: 'off',
  weightNumbers: false,
  lockRelative: false,
  constraintLines: false,
  shapeCvs: false,
};

/** A pane display port over a plain map (what the ViewportManager provides). */
function fakePanes(a: EditorApp, ids: readonly string[]) {
  const displays = new Map<string, DisplayFlags>(ids.map((id) => [id, DISPLAY]));
  const set = vi.fn<(id: string, display: DisplayFlags) => void>((id, display) => {
    displays.set(id, display);
  });
  const dispose = providePaneDisplay(a, {
    panes: () => [...displays.keys()],
    activePane: () => ids[ids.length - 1] ?? null,
    display: (id) => displays.get(id) ?? null,
    setDisplay: set,
  });
  return { displays, set, dispose };
}

describe('view.shading and view.display.set (§6.2)', () => {
  it('poll-fail without a viewport and with bad arguments', async () => {
    const a = app();
    expect(await run(a, 'view.shading', { mode: 'wire' })).toEqual({ status: 'cancelled', reason: 'No viewport pane' });
    fakePanes(a, ['pane-persp']);
    expect((await run(a, 'view.shading', { mode: 'toon' })).status).toBe('cancelled');
    expect(await run(a, 'view.shading', { mode: 'wire', paneId: 'pane-x' })).toEqual({
      status: 'cancelled',
      reason: "No viewport pane 'pane-x'",
    });
    expect(await run(a, 'view.display.set', { patch: { shading: 'toon' } })).toEqual({
      status: 'cancelled',
      reason: 'shading is one of wire, shaded, colours, lit',
    });
    expect(await run(a, 'view.display.set', { patch: { flat: 1 } })).toEqual({
      status: 'cancelled',
      reason: 'flat is true or false',
    });
    expect(await run(a, 'view.display.set', { patch: { bloom: true } })).toEqual({
      status: 'cancelled',
      reason: "Unknown display flag 'bloom'",
    });
  });

  it('set the explicit, the run’s, the hovered or the active pane; no history step', async () => {
    const a = app();
    const panes = fakePanes(a, ['pane-top', 'pane-persp']);
    await run(a, 'view.shading', { mode: 'wire', paneId: 'pane-top' });
    expect(panes.displays.get('pane-top')?.shading).toBe('wire');
    await run(a, 'view.shading', { mode: 'shaded' }, { panel: 'viewport', paneId: 'pane-top' });
    expect(panes.displays.get('pane-top')?.shading).toBe('shaded');
    a.session.setState({ hoveredPanel: { kind: 'viewport', paneId: 'pane-top' } });
    await run(a, 'view.shading', { mode: 'colours' });
    expect(panes.displays.get('pane-top')?.shading).toBe('colours');
    a.session.setState({ hoveredPanel: null });
    await run(a, 'view.display.set', { patch: { normals: 'face', flat: true, wireOnShaded: true } });
    expect(panes.displays.get('pane-persp')).toMatchObject({ normals: 'face', flat: true, wireOnShaded: true });
    // Unchanged values write nothing.
    const writes = panes.set.mock.calls.length;
    await run(a, 'view.display.set', { patch: { flat: true } });
    expect(panes.set.mock.calls.length).toBe(writes);
    expect(a.history.canUndo()).toBe(false);
    panes.dispose();
    expect(await run(a, 'view.shading', { mode: 'wire' })).toEqual({ status: 'cancelled', reason: 'No viewport pane' });
  });
});

describe('ui.commandPalette and ui.markingMenu (§5.18)', () => {
  const MERGE: MarkingMenuDef = {
    id: 'model.merge',
    trigger: { key: 'KeyM' },
    workspaces: ['model'],
    when: { modes: ['vertex', 'edge', 'face'], over: 'any' },
    slots: { N: { op: 'mesh.mergeToCenter' } },
    list: [],
  };

  it('open through the shell’s port, and say why not without it', async () => {
    const a = app();
    a.contribute({ kind: 'markingMenu', def: MERGE });
    expect(await run(a, 'ui.commandPalette')).toEqual({
      status: 'cancelled',
      reason: 'The command palette needs the editor window',
    });
    const openCommandPalette = vi.fn<() => void>();
    const openMarkingMenu = vi.fn<(menu: MarkingMenuDef, ctx: RunContext) => void>();
    provideShellOverlays(a, { openCommandPalette, openMarkingMenu });
    expect((await run(a, 'ui.commandPalette')).status).toBe('finished');
    expect(openCommandPalette).toHaveBeenCalledOnce();

    expect(await run(a, 'ui.markingMenu', { menu: 'model.nope' })).toEqual({
      status: 'cancelled',
      reason: "Unknown marking menu 'model.nope'",
    });
    expect(await run(a, 'ui.markingMenu', { menu: 'model.merge' })).toEqual({
      status: 'cancelled',
      reason: 'This menu is available in Model',
    });
    await run(a, 'workspace.set', { workspace: 'model' });
    expect(await run(a, 'ui.markingMenu', { menu: 'model.merge' })).toEqual({
      status: 'cancelled',
      reason: 'This menu works in vertex, edge, face mode',
    });
    a.session.setState({ model: { ...a.session.getState().model, componentMode: 'vertex' } });
    const result = await run(
      a,
      'ui.markingMenu',
      { menu: 'model.merge' },
      { panel: 'viewport', paneId: 'pane-persp', source: 'keyboard' },
    );
    expect(result.status).toBe('finished');
    expect(openMarkingMenu).toHaveBeenCalledWith(MERGE, {
      panel: 'viewport',
      paneId: 'pane-persp',
      source: 'keyboard',
    });
  });

  it('lists the palette with Blender-style aliases and keeps the marking menu out of it (internal)', () => {
    const a = app();
    expect(a.operators.get('ui.commandPalette')?.aliases).toContain('Search');
    expect(a.operators.get('ui.markingMenu')?.flags?.internal).toBe(true);
  });
});

/** Stores `data` as a revision and returns a mesh record id with it. */
function createMesh(a: EditorApp, id: string, data: MeshData, patch: Record<string, unknown> = {}): MeshId {
  const out = writeRevision(data);
  for (const [, chunk] of out.newChunks) a.blobs.put(chunk);
  a.blobs.put(out.manifestBytes);
  const ref: MeshRef = { manifest: out.manifestId, rev: 1, base: null, joints: [] };
  a.store.transact({ label: 'Create' }, (tx) => tx.put('meshes', makeTestMesh(id, { name: id, data: ref, ...patch })));
  return id as MeshId;
}

describe("Model's status glyph (§5.17)", () => {
  it('○ without an editable mesh, ● within budget, ◐ with the reasons when over budget', async () => {
    await loadMeshKernel();
    const a = kernelApp({ options: { services: { ...createFakeServices(), blobs: createMemoryBlobStore() } } });
    expect(modelStatus(a)).toEqual({ glyph: 'todo', reasons: ['No editable mesh yet'] });
    // Mesh Check (B5) has not landed: the reference kernel throws not-implemented and Model reads it as clean.
    createMesh(a, 'msh_Crate', primitive('cube', {}), { budget: { preset: 'small-prop' } });
    expect(modelStatus(a)).toEqual({ glyph: 'done', reasons: [] });
    createMesh(a, 'msh_Pole', primitive('cylinder', { subdivisionsAxis: 64, subdivisionsHeight: 8 }), {
      budget: { tris: 100 },
    });
    const status = modelStatus(a);
    expect(status.glyph).toBe('attention');
    expect(status.reasons).toEqual([
      expect.stringMatching(/^msh_Pole: [\d,]+ tris, over the 100 tris budget \(100\)$/),
    ]);
    a.dispose();
  });

  it('reads the budget of the nearest parent group', async () => {
    await loadMeshKernel();
    const a = kernelApp({ options: { services: { ...createFakeServices(), blobs: createMemoryBlobStore() } } });
    a.store.transact({ label: 'Group' }, (tx) =>
      tx.put('groups', {
        id: 'grp_Prop',
        name: 'Prop',
        owner: 'scene',
        parent: null,
        order: 'a0',
        placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
        pivot: [0, 0, 0],
        template: null,
        budget: { tris: 4 },
        handheld: null,
        deleted: null,
      } as never),
    );
    createMesh(a, 'msh_Crate', primitive('cube', {}), { parent: 'grp_Prop' });
    expect(modelStatus(a).reasons).toEqual(['msh_Crate: 12 tris, over the 4 tris budget (4)']);
    a.dispose();
  });

  it('the fake app without meshes reads ○', () => {
    expect(modelStatus(createFakeEditorApp())).toEqual({ glyph: 'todo', reasons: ['No editable mesh yet'] });
  });
});
