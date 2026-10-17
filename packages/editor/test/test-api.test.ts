// The e2e test API (MVP-SPEC §4.8) over the fake app with the synthetic wave document: reads, lookups by id or
// template key, evaluation at frames, screen positions through probes, run() results and lastExport().
import { DEG2RAD } from '@ekza-animator/anim-core';
import type { ClipId, ControlId, CurveId, DocSnapshot } from '@ekza-animator/doc';
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
    expect(parseEditorParams('?e2e=1&firstRun=1&nav=trackpad&space=play&platform=mac', true)).toEqual({
      e2e: true,
      firstRun: true,
      nav: 'trackpad',
      space: 'play',
      platform: 'mac',
    });
    expect(parseEditorParams('?e2e=1&nav=blender&platform=amiga', true)).toEqual({ ...DEFAULT_PARAMS, e2e: true });
    expect(parseEditorParams('?e2e=1&firstRun=1', false)).toEqual(DEFAULT_PARAMS);
    expect(isE2eRequested(true, '?nav=maya&e2e=1')).toBe(true);
    expect(isE2eRequested(true, '?e2e=0')).toBe(false);
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

  it('maps panel probes to page coordinates', () => {
    const { api, shell } = setup();
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:100px;top:200px;width:400px;height:100px';
    document.body.append(canvas);
    try {
      expect(api.graph()).toBeNull();
      expect(api.screenOfKey('k_SynthWave001')).toBeNull();
      const disposeGraph = shell.probes.set('graph', {
        canvas,
        view: () => ({ f0: 0, v0: -45, sx: 10, sy: 2 }),
        visibleCurves: () => [CURVE],
        keyPoint: (key) => (key === 'k_SynthWave001' ? { x: 5, y: 6 } : null),
        handlePoint: () => ({ x: 7, y: 8 }),
        curvePoint: (_curve, frame) => ({ x: frame * 10, y: 50 }),
      });
      expect(api.graph()).toEqual({
        visibleCurves: [CURVE],
        view: { f0: 0, v0: -45, sx: 10, sy: 2 },
        canvasRect: { x: 100, y: 200, w: 400, h: 100 },
      });
      expect(api.screenOfKey('k_SynthWave001')).toEqual({ x: 105, y: 206 });
      expect(api.screenOfKey('k_other')).toBeNull();
      expect(api.screenOfHandle('k_SynthWave001', 'out')).toEqual({ x: 107, y: 208 });
      expect(api.screenOfCurve(CURVE, 7.5)).toEqual({ x: 175, y: 250 });
      disposeGraph();
      expect(api.graph()).toBeNull();

      shell.probes.set('timeline', {
        canvas,
        frameToX: (frame) => frame * 4,
        tickPoint: (frame) => (frame === 15 ? { x: 60, y: 10 } : null),
      });
      expect(api.screenOfFrame(20)).toEqual({ x: 180, y: 250 });
      expect(api.screenOfTick(15)).toEqual({ x: 160, y: 210 });
      expect(api.screenOfTick(16)).toBeNull();

      const pane = document.createElement('div');
      pane.style.cssText = 'position:fixed;left:10px;top:20px;width:300px;height:200px';
      document.body.append(pane);
      shell.probes.set('viewport', {
        panes: () => [{ id: 'pane-left', element: pane, camera: { kind: 'view', preset: 'persp' } }],
      });
      expect(api.panes()).toEqual([
        { id: 'pane-left', camera: 'persp', locked: false, rect: { x: 10, y: 20, w: 300, h: 200 } },
      ]);
      pane.remove();
      expect(() => api.cameraOf('pane-left')).toThrow('No ViewportManager');
    } finally {
      canvas.remove();
    }
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

describe('placeholder test API (kernel unavailable)', () => {
  it('resolves ready and counts frames; everything else is not implemented', async () => {
    const testApi = createPlaceholderTestApi();
    testApi.settle({ ok: true, renderer: 'GPU' });
    await testApi.api.ready;
    testApi.countFrame();
    expect(testApi.api.renderedFrames()).toBe(1);
    expect(testApi.api.webgl).toEqual({ ok: true, renderer: 'GPU' });
    expect(() => testApi.api.counts()).toThrow(expect.objectContaining({ code: 'not-implemented' }));
  });
});
