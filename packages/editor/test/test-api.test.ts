// The e2e test API (MVP-SPEC §4.8) over the fake app with the synthetic wave document: reads, lookups by id or
// template key, evaluation at frames, screen positions through probes, run() results and lastExport().
import { DEG2RAD } from '@ekza-animator/anim-core';
import type { ClipId, ControlId, CurveId, DocSnapshot, MeshId, MeshRecord, MeshRef } from '@ekza-animator/doc';
import { loadMeshKernel, registerBuiltins } from '@ekza-animator/editor-core';
import { naiveCurveEngine } from '@ekza-animator/editor-core/testing';
import type { ExportArtifact } from '@ekza-animator/io';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApi } from '../src/test-api/createTestApi';
import { createPlaceholderTestApi } from '../src/test-api/placeholder';
import { DEFAULT_PARAMS, isE2eRequested, parseEditorParams } from '../src/test-api/params';
import { readSynthetic } from './render';
import { createTestShell } from './shell-helpers';

let snapshot: DocSnapshot;
let skeleton: SkeletonDesc;
let restHips: readonly number[];
beforeAll(async () => {
  snapshot = (await readSynthetic('wave-doc.json')) as DocSnapshot;
  skeleton = (await readSynthetic('humanoid-skeleton.json')) as SkeletonDesc;
  const rest = (await readSynthetic('rest-pose.json')) as { bones: { name: string; t: number[] }[] };
  restHips = rest.bones.find((bone) => bone.name === 'hips')?.t ?? [];
});

const CHARACTER = 'chr_SyntheticWave001';
const CLIP = 'clp_SyntheticWave001' as ClipId;
const CURVE = 'crv_SyntheticWave001' as CurveId;
const LOWER_ARM = 'rig_SyntheticWave001:fk.lowerArm.L' as ControlId;

function setup() {
  const test = createTestShell({ snapshot, skeleton, params: { ...DEFAULT_PARAMS, e2e: true } });
  const handle = createTestApi(test.shell, { engine: naiveCurveEngine });
  return { ...test, api: handle.api, dispose: () => handle.dispose() };
}

describe('URL parameters (e2e builds only)', () => {
  it('honours ?e2e=1 and its overrides only when the build allows e2e mode', () => {
    // M2a storage switches at their defaults (literal update, M2A-SPEC §3 rule 8).
    expect(parseEditorParams('?e2e=1&firstRun=1&nav=trackpad&space=play&platform=mac', true)).toEqual({
      e2e: true,
      firstRun: true,
      nav: 'trackpad',
      space: 'play',
      platform: 'mac',
      ns: null,
      storageBlocked: false,
      pointerLock: true,
      ws: null, // M6a (literal update, M6A-SPEC §4.8)
    });
    expect(parseEditorParams('?e2e=1&nav=blender&platform=amiga', true)).toEqual({ ...DEFAULT_PARAMS, e2e: true });
    expect(parseEditorParams('?e2e=1&firstRun=1', false)).toEqual(DEFAULT_PARAMS);
    expect(isE2eRequested(true, '?nav=maya&e2e=1')).toBe(true);
    expect(isE2eRequested(true, '?e2e=0')).toBe(false);
  });

  it('M6a: reads ws=<id> in any build (a workspace deep link), ignoring malformed ids', () => {
    expect(parseEditorParams('?ws=model', false)).toEqual({ ...DEFAULT_PARAMS, ws: 'model' });
    expect(parseEditorParams('?ws=model&e2e=1&platform=mac', true)).toMatchObject({
      e2e: true,
      platform: 'mac',
      ws: 'model',
    });
    expect(parseEditorParams('?ws=Model!', true)).toEqual(DEFAULT_PARAMS);
    expect(parseEditorParams('?e2e=1&ws=../x', true).ws).toBeNull();
  });
});

describe('createTestApi', () => {
  it('resolves `ready` once the GL host settles and reports WebGL', async () => {
    const { api, shell } = setup();
    let settled = false;
    void api.ready.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    shell.ui.setState({ gl: { status: 'ready', renderer: 'Test GPU' } });
    await api.ready;
    expect(api.webgl).toEqual({ ok: true, renderer: 'Test GPU' });
    shell.ui.setState({ gl: { status: 'unavailable', renderer: null } });
    expect(api.webgl.ok).toBe(false);
  });

  it('reports state, counts, characters, controls and clips', () => {
    const { api, app } = setup();
    const state = api.state();
    expect(state).toMatchObject({
      clipFrame: 0,
      sceneFrame: 0,
      playing: false,
      layout: 'split',
      maximizedPane: null,
      activeCharacter: CHARACTER,
      activeClip: CLIP,
      band: null,
      selection: { controls: [], keys: [] },
      history: { canUndo: false, canRedo: false, undoLabel: null },
      tool: 'select',
      dialog: null,
      readOnly: false,
    });
    expect(api.counts()).toMatchObject({ characters: 1, clips: 1, curves: 1, keys: 3, controls: 27 });
    expect(api.characters()).toEqual([{ id: CHARACTER, name: 'Synthetic Humanoid', format: 'vrm1' }]);
    const controls = api.controls();
    expect(controls).toHaveLength(27);
    expect(controls.find((c) => c.key === 'fk.lowerArm.L')).toMatchObject({ id: LOWER_ARM, side: 'L', visible: true });
    expect(api.controls('Synthetic Humanoid')).toHaveLength(27);
    expect(api.clips()).toEqual([{ id: CLIP, name: 'wave', fps: 30, start: 0, end: 30, loop: true, sceneStart: 0 }]);
    app.session.setState({ dialog: 'about' });
    expect(api.state().dialog).toBe('about');
  });

  it('lists curves by clip id or name and filters by control id or template key', () => {
    const { api } = setup();
    const curves = api.curves(CLIP);
    expect(curves).toHaveLength(1);
    expect(curves[0]).toMatchObject({ id: CURVE, control: LOWER_ARM, channel: 'rz', weighted: false });
    expect(curves[0]?.keys.map((k) => k.t)).toEqual([0, 15, 30]);
    expect(api.curves('wave', 'fk.lowerArm.L')).toHaveLength(1);
    expect(api.curves('wave', 'fk.head')).toHaveLength(0);
    expect(() => api.curves('nope')).toThrow("Unknown clip 'nope'");
  });

  it('evaluates curves and channel values at the current or a given clip frame', () => {
    const { api, app } = setup();
    expect(api.curveValue(CURVE, 15)).toBeCloseTo(-30 * DEG2RAD, 12);
    expect(api.channelValues('fk.lowerArm.L').rz).toBeCloseTo(30 * DEG2RAD, 12);
    expect(api.channelValues(LOWER_ARM, 15).rz).toBeCloseTo(-30 * DEG2RAD, 12);
    expect(api.channelValues(LOWER_ARM, 15).sx).toBe(1);
    app.session.setState({ overrides: new Map([[LOWER_ARM, { rz: 0.5 }]]) });
    expect(api.overrides('fk.lowerArm.L')).toEqual({ rz: 0.5 });
    expect(api.overrides('fk.head')).toEqual({});
  });

  it('computes bone worlds and the canonical facing from the rig program', () => {
    const { api } = setup();
    const hips = api.boneWorld(CHARACTER, 'hips');
    expect(hips.t[1]).toBeCloseTo(restHips[1] ?? Number.NaN, 9);
    expect(api.boneWorld(CHARACTER, 'Root').t).toEqual([0, 0, 0]);
    const facing = api.facing(CHARACTER);
    expect(facing[2]).toBeGreaterThan(0.999);
    expect(() => api.boneWorld(CHARACTER, 'tail')).toThrow("No humanoid bone or node named 'tail'");
  });

  it('delegates the panel slices to the registered probes; the newest probe wins', () => {
    const { api, shell } = setup();
    expect(api.graph()).toBeNull();
    expect(api.screenOfKey('k_SynthWave001')).toBeNull();
    expect(api.screenOfFrame(10)).toBeNull();
    expect(api.panes()).toEqual([]);
    expect(() => api.cameraOf('pane-left')).toThrow('No ViewportManager');

    const graph = {
      visibleCurves: [CURVE],
      view: { f0: 0, v0: -45, sx: 10, sy: 2 },
      canvasRect: { x: 100, y: 200, w: 400, h: 100 },
    };
    const disposeGraph = shell.probes.set('graph', {
      graph: () => graph,
      screenOfKey: (key) => (key === 'k_SynthWave001' ? { x: 105, y: 206 } : null),
      screenOfHandle: (_key, side) => (side === 'out' ? { x: 107, y: 208 } : null),
      screenOfCurve: (_curve, frame) => ({ x: 100 + frame * 10, y: 250 }),
    });
    // M2a: the view mode defaults to 'absolute' before A4's probe; buffers come from the session.
    expect(api.graph()).toEqual({ ...graph, viewMode: 'absolute', buffers: [] });
    expect(api.screenOfKey('k_SynthWave001')).toEqual({ x: 105, y: 206 });
    expect(api.screenOfKey('k_other')).toBeNull();
    expect(api.screenOfHandle('k_SynthWave001', 'out')).toEqual({ x: 107, y: 208 });
    expect(api.screenOfHandle('k_SynthWave001', 'in')).toBeNull();
    expect(api.screenOfCurve(CURVE, 7.5)).toEqual({ x: 175, y: 250 });
    const disposeOther = shell.probes.set('graph', {
      graph: () => null,
      screenOfKey: () => null,
      screenOfHandle: () => null,
      screenOfCurve: () => null,
    });
    expect(api.graph()).toBeNull();
    disposeOther();
    expect(api.graph()).toEqual({ ...graph, viewMode: 'absolute', buffers: [] });
    disposeGraph();
    expect(api.graph()).toBeNull();

    shell.probes.set('timeline', {
      screenOfFrame: (frame) => ({ x: 100 + frame * 4, y: 250 }),
      screenOfTick: (frame) => (frame === 15 ? { x: 160, y: 210 } : null),
    });
    expect(api.screenOfFrame(20)).toEqual({ x: 180, y: 250 });
    expect(api.screenOfTick(15)).toEqual({ x: 160, y: 210 });
    expect(api.screenOfTick(16)).toBeNull();

    shell.probes.set('viewport', {
      panes: () => [{ id: 'pane-left', camera: 'shot', locked: true, rect: { x: 10, y: 20, w: 300, h: 200 } }],
      cameraOf: () => ({ position: [0, 1, 2], quaternion: [0, 0, 0, 1] }),
      screenOfControl: (control, paneId) =>
        control === 'fk.lowerArm.L' && paneId === 'pane-left' ? { x: 1, y: 2 } : null,
      screenOfManipulator: (_paneId, handle) => (handle === 'rz' ? { x: 3, y: 4 } : null),
      renderedFrames: () => 99,
    });
    expect(api.panes()).toEqual([
      { id: 'pane-left', camera: 'shot', locked: true, rect: { x: 10, y: 20, w: 300, h: 200 } },
    ]);
    expect(api.cameraOf('pane-left')).toEqual({ position: [0, 1, 2], quaternion: [0, 0, 0, 1] });
    expect(api.screenOfControl('fk.lowerArm.L', 'pane-left')).toEqual({ x: 1, y: 2 });
    expect(api.screenOfManipulator('pane-left', 'rz')).toEqual({ x: 3, y: 4 });
    // The shell counts frames itself (fallback frames + the ViewportManager's counter).
    expect(api.renderedFrames()).toBe(shell.renderedFrames());
  });

  it('runs operators and maps results; records export artifacts for lastExport()', async () => {
    const { api, app } = setup();
    const unknown = await api.run('acme.unknown');
    expect(unknown.status).toBe('cancelled');
    expect(unknown.reason).toContain('acme.unknown');
    const artifact: ExportArtifact = {
      kind: 'vrma',
      fileName: 'hero_wave.vrma',
      mime: 'model/gltf-binary',
      bytes: new Uint8Array([1, 2, 3]),
      sha256: 'abc',
      lints: [{ code: 'ekza.test', severity: 'info', message: 'test' }],
      readBack: null,
      validation: null,
      stats: { clips: 1, channels: 1, keys: 3 },
    };
    app.contribute({
      kind: 'operator',
      def: { id: 'file.export', label: 'Export', category: 'file', scope: 'global', apply: () => [artifact] },
    });
    app.contribute({
      kind: 'operator',
      def: {
        id: 'acme.fail',
        label: 'Fail',
        category: 'acme',
        scope: 'global',
        apply: () => {
          throw new Error('boom');
        },
      },
    });
    expect(api.lastExport()).toBeNull();
    const result = await api.run('file.export', { kind: 'vrma' });
    expect(result.status).toBe('finished');
    expect(api.lastExport()).toMatchObject({
      fileName: 'hero_wave.vrma',
      sha256: 'abc',
      lints: [{ code: 'ekza.test' }],
    });
    expect(await api.run('acme.fail')).toEqual({ status: 'failed', error: { code: 'internal', message: 'boom' } });
  });

  it('loadFile goes through the importer registry like a drop, accepting plain number arrays', async () => {
    const { api, app } = setup();
    const received: unknown[] = [];
    app.contribute({
      kind: 'operator',
      def: {
        id: 'file.importAnimation',
        label: 'Import Animation',
        category: 'file',
        scope: 'global',
        apply: (_ctx, args) => received.push(args),
      },
    });
    app.contribute({
      kind: 'importer',
      def: { id: 'vrma', label: 'VRMA', extensions: ['vrma'], op: 'file.importAnimation' },
    });
    await api.loadFile('wave.vrma', [1, 2, 3] as unknown as Uint8Array);
    expect(received).toEqual([{ name: 'wave.vrma', bytes: new Uint8Array([1, 2, 3]) }]);
    await expect(api.loadFile('notes.txt', new Uint8Array())).rejects.toThrow('No importer');
  });
});

/** An authored scene cube record over a stored revision. */
const cubeRecord = (data: MeshRef): MeshRecord => ({
  id: 'msh_Cube' as MeshId,
  name: 'Cube',
  owner: { scene: true },
  parent: null,
  order: 'a0',
  placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
  pivot: [0, 0, 0],
  source: null,
  data,
  faceted: true,
  generator: { kind: 'cube', params: {}, version: 1 },
  palette: null,
  material: { preset: 'unlit' },
  colourOutput: 'palette-texture',
  skin: null,
  budget: null,
  handheld: null,
  deleted: null,
});

describe('M6a test API (B0a kernel-level functions)', () => {
  it('extends state() with the workspace, component mode, hilite, capture and extrude session', () => {
    const { api } = setup();
    expect(api.state()).toMatchObject({
      workspace: 'animate',
      mode: 'object',
      hilite: [],
      capture: { armed: null, field: null, text: null },
      extrudeSession: false,
    });
  });

  it('lists workspaces (Animate active, ○ without keys … ● with) and resolves keys through the keymap', () => {
    const { api, app } = setup();
    registerBuiltins(app);
    // M6A-SPEC §3 rule 9 literal update (§5.17, B9): the four tabs; disabled ones carry no glyph.
    expect(api.workspaces()).toEqual([
      { id: 'model', label: 'Model', enabled: true, active: false, glyph: 'todo', reasons: ['No editable mesh yet'] },
      { id: 'rig', label: 'Rig & Skin', enabled: false, active: false, glyph: 'none', reasons: [] },
      { id: 'animate', label: 'Animate', enabled: true, active: true, glyph: 'done', reasons: [] },
      { id: 'review', label: 'Review', enabled: false, active: false, glyph: 'none', reasons: [] },
    ]);
    expect(api.resolveKey({ code: 'KeyS' }, { panel: 'viewport', paneId: 'pane-persp' })).toEqual({
      op: 'key.set',
      args: { channels: 'all' },
      scope: 'viewport',
    });
    expect(api.resolveKey({ code: 'KeyZ', mod: true }, { panel: 'graph' })).toMatchObject({ op: 'edit.undo' });
    expect(api.resolveKey({ code: 'F13' }, { panel: 'viewport' })).toBeNull();
  });

  it('reports history labels oldest first and the blob store', async () => {
    const { api, app } = setup();
    app.store.transact({ label: 'Rename' }, (tx) => tx.patch('clips', CLIP, { name: 'one' }));
    app.store.transact({ label: 'Loop' }, (tx) => tx.patch('clips', CLIP, { loop: false }));
    app.history.undo();
    expect(api.history()).toEqual({ undo: ['Rename'], redo: ['Loop'] });
    expect(api.blobs()).toEqual({ resident: 0, residentBytes: 0, historyBytes: 0, journalBytes: 0 });
  });

  it('lists mesh records with counts, info and normals from the reference kernel', async () => {
    const { api, app } = setup();
    const kernel = await loadMeshKernel();
    const cube = kernel.primitive('cube', {});
    const out = kernel.writeRevision(cube);
    for (const [, chunk] of out.newChunks) app.blobs.put(chunk);
    app.blobs.put(out.manifestBytes);
    const ref: MeshRef = { manifest: out.manifestId, rev: 1, base: null, joints: [] };
    app.store.transact({ label: 'Create' }, (tx) => tx.put('meshes', cubeRecord(ref)));
    expect(api.meshes()).toEqual([
      {
        id: 'msh_Cube',
        name: 'Cube',
        owner: 'scene',
        parent: null,
        badge: 'prim',
        manifest: out.manifestId,
        rev: 1,
        faceted: true,
        generator: 'cube',
        palette: null,
        counts: { v: 8, e: 12, f: 6, c: 24, tris: 12 },
        runtime: 'ready',
      },
    ]);
    expect(api.meshInfo('msh_Cube')).toEqual({
      counts: { v: 8, e: 12, f: 6, c: 24, tris: 12 },
      stats: { shells: 1, boundaryLoops: 0, euler: 2, nonManifoldEdges: 0, nonManifoldVerts: 0 },
      problems: 0,
      bounds: [
        [-0.5, -0.5, -0.5],
        [0.5, 0.5, 0.5],
      ],
      manifest: out.manifestId,
      layers: [...cube.layers.keys()],
    });
    const normals = api.meshNormals('msh_Cube');
    expect(normals?.face).toHaveLength(6);
    expect(normals?.corner).toHaveLength(24);
    expect(normals?.face.map((n) => n.map((x) => Math.round(x)))).toContainEqual([0, 1, 0]);
    expect(api.meshInfo('msh_None')).toBeNull();
    expect(api.meshNormals('msh_None')).toBeNull();
  });

  it('owner groups that have not landed throw not-implemented with their owner', () => {
    const { api } = setup();
    // B10 landed its group (literal update): the Model state reads without a viewport.
    expect(api.model()).toMatchObject({ mode: 'object', hilite: [], hiddenObjects: [], isolate: {} });
    expect(api.paneObjects('pane-persp')).toEqual([]);
    expect(() => api.lastOp()).toThrow(/B11/);
    expect(() => api.palettes()).toThrow(/B13/);
    expect(() => api.symmetry('msh_A')).toThrow(/B12a/);
    // B9 landed `pixel` (literal update): without a viewport it answers transparent black.
    expect(api.pixel('pane-persp', 0, 0)).toEqual([0, 0, 0, 0]);
    // B7 landed (literal update): an unknown mesh has no ready runtime.
    expect(() => api.meshFaces('msh_A')).toThrow(/has no ready runtime/);
    expect(() => api.setExpression('c', 'smile', 1)).toThrow(/INT/);
  });
});

describe('placeholder test API (kernel unavailable)', () => {
  it('resolves ready and counts frames; everything else is not implemented', async () => {
    const testApi = createPlaceholderTestApi();
    testApi.settle({ ok: true, renderer: 'GPU' });
    await testApi.api.ready;
    testApi.countFrame();
    expect(testApi.api.renderedFrames()).toBe(1);
    expect(testApi.api.webgl).toEqual({ ok: true, renderer: 'GPU' });
    expect(() => testApi.api.counts()).toThrow(expect.objectContaining({ code: 'not-implemented' }));
    expect(() => testApi.api.workspaces()).toThrow(expect.objectContaining({ code: 'not-implemented' }));
    expect(() => testApi.api.meshes()).toThrow(expect.objectContaining({ code: 'not-implemented' }));
  });
});
