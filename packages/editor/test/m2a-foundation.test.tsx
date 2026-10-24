// M2A-SPEC §4.8 (A0, editor): the kernel-level test API functions and the panel-slice stubs, the M2a URL parameters
// and storage switches, layout v1 → v2 migration (the v1 key is kept), the Dope Sheet placeholder panel, the status
// line key-target toggle and Tween bar slot, and the frame loop's first step.
import { DEG2RAD } from '@ekza-studio/anim-core';
import type { AttrDef, ClipId, ControlId, CurveId, DocSnapshot } from '@ekza-studio/doc';
import { PANEL, registerBuiltinOperators } from '@ekza-studio/editor-core';
import { naiveCurveEngine } from '@ekza-studio/editor-core/testing';
import type { SkeletonDesc } from '@ekza-studio/rig';
import type { SerializedDockview } from 'dockview-react';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPanelRegistry, registerBuiltinPanels } from '../src';
import { createFrameHooks } from '../src/gl/frameLoop';
import { DOPE_SHEET_PANEL, registerDopeSheetPanel } from '../src/panels/dopesheet';
import { createShellServices } from '../src/services/browser';
import { createBlockedStorage, createMemoryStorage, namespacePrefix } from '../src/services/storage';
import { layoutStorageKey, layoutStorageKeyV1, readStoredLayout } from '../src/shell/layout';
import { StatusLine } from '../src/shell/StatusLine';
import { tweenProbeKey } from '../src/shell/types';
import { WorkspaceHost } from '../src/shell/WorkspaceHost';
import { createTestApi, oneSidedSlope } from '../src/test-api/createTestApi';
import { DEFAULT_PARAMS, parseEditorParams } from '../src/test-api/params';
import { readSynthetic, render, update } from './render';
import { createTestShell, ShellFrame, waitFor } from './shell-helpers';

let snapshot: DocSnapshot;
let skeleton: SkeletonDesc;
beforeAll(async () => {
  snapshot = (await readSynthetic('wave-doc.json')) as DocSnapshot;
  skeleton = (await readSynthetic('humanoid-skeleton.json')) as SkeletonDesc;
});

const RIG = 'rig_SyntheticWave001';
const CLIP = 'clp_SyntheticWave001';
const CURVE = 'crv_SyntheticWave001' as CurveId;
const FOOT = `${RIG}:fk.foot.L` as ControlId;
const HAND = `${RIG}:fk.hand.L` as ControlId;
const ATTRS: Readonly<Record<string, AttrDef>> = {
  roll: { type: 'float', default: 0, keyable: true, unit: 'angle' },
  ikFk: { type: 'float', default: 1, min: 0, max: 1, keyable: true, keyAll: false },
};

function setup(params = { ...DEFAULT_PARAMS, e2e: true }) {
  const test = createTestShell({ snapshot, skeleton, params });
  test.app.store.transact({ label: 'Attributes' }, (tx) => tx.patch('controls', FOOT, { attrs: ATTRS }));
  const handle = createTestApi(test.shell, { engine: naiveCurveEngine });
  return { ...test, api: handle.api };
}

describe('URL parameters ns, storage and pointerLock (§4.8)', () => {
  it('parse in e2e builds only, with validation', () => {
    expect(parseEditorParams('?e2e=1&ns=r1&storage=blocked&pointerLock=off', true)).toMatchObject({
      e2e: true,
      ns: 'r1',
      storageBlocked: true,
      pointerLock: false,
    });
    expect(parseEditorParams('?e2e=1&ns=../x&storage=open', true)).toMatchObject({
      ns: null,
      storageBlocked: false,
      pointerLock: true,
    });
    expect(parseEditorParams('?ns=r1&storage=blocked&pointerLock=off', true)).toEqual(DEFAULT_PARAMS);
    expect(parseEditorParams('?e2e=1&ns=r1', false)).toEqual(DEFAULT_PARAMS);
  });

  it('createShellServices: a namespace prefixes localStorage keys; blocked storage throws on every access', () => {
    const { services } = createShellServices({ decoderPath: '/decoders/', storage: 'local', storageNamespace: 'm2a' });
    const key = `a0-test-${Math.random().toString(36).slice(2)}`;
    services.storage?.setItem(key, 'v');
    expect(localStorage.getItem(`${namespacePrefix('m2a')}${key}`)).toBe('v');
    expect(localStorage.getItem(key)).toBeNull();
    const again = createShellServices({ decoderPath: '/decoders/', storage: 'local', storageNamespace: 'm2a' });
    expect(again.services.storage?.getItem(key)).toBe('v');
    localStorage.removeItem(`${namespacePrefix('m2a')}${key}`);

    const blocked = createShellServices({ decoderPath: '/decoders/', storageBlocked: true }).services.storage;
    expect(() => blocked?.getItem('x')).toThrow('Storage is blocked');
    expect(() => blocked?.setItem('x', 'y')).toThrow('Storage is blocked');
    // Layout storage survives a blocked storage (every access is guarded).
    expect(readStoredLayout(createBlockedStorage())).toEqual({ kind: 'none' });
  });
});

describe('test API: kernel-level M2a functions (§4.8)', () => {
  it('state() reports the key target, ripple, dirty and recovery slots', () => {
    const { api, app } = setup();
    expect(api.state()).toMatchObject({ keyTarget: 'selected', ripple: false, dirty: true, recovery: [] });
    app.session.setState({
      tools: { ...app.session.getState().tools, keyTarget: 'bodyPart', ripple: true },
      recovery: [
        {
          id: 'as_0000000000000001',
          projectName: 'p',
          savedAt: 1,
          characters: 1,
          clips: 1,
          bytes: 10,
          appVersion: '0.2.0',
          schemaVersion: 2,
        },
      ],
    });
    expect(api.state()).toMatchObject({ keyTarget: 'bodyPart', ripple: true, recovery: ['as_0000000000000001'] });
  });

  it('curves() reports breakdown flags; controls() uses the visibility rule', () => {
    const { api, app } = setup();
    expect(api.curves(CLIP)[0]?.keys.map((key) => key.breakdown)).toEqual([false, false, false]);
    app.store.transact({ label: 'Breakdown' }, (tx) => {
      const key = tx.get('keys', 'k_SynthWave002' as never);
      if (key !== undefined) tx.put('keys', { ...key, breakdown: true });
    });
    expect(api.curves(CLIP)[0]?.keys.map((key) => key.breakdown)).toEqual([false, true, false]);
    app.session.setState({ hiddenControls: new Set([HAND]) });
    expect(api.controls().find((control) => control.id === HAND)?.visible).toBe(false);
  });

  it('attrs() at the current frame (curves ⊕ overrides) and at a clip frame (curves only)', () => {
    const { api, app } = setup();
    expect(api.attrs(FOOT)).toEqual({ roll: 0, ikFk: 1 });
    expect(api.attrs('fk.foot.L')).toEqual({ roll: 0, ikFk: 1 });
    app.store.transact({ label: 'Roll' }, (tx) => {
      tx.put('curves', {
        id: 'crv_AttrRoll0000001' as CurveId,
        clip: CLIP as never,
        layer: 'lay_SyntheticWave001' as never,
        control: FOOT,
        channel: '@roll',
        weighted: false,
        pre: 'constant',
        post: 'constant',
        staticValue: null,
        locked: false,
        muted: false,
        deleted: null,
      });
      for (const [id, t, v] of [
        ['k_AttrRoll0001', 0, 0],
        ['k_AttrRoll0002', 10, 20 * DEG2RAD],
      ] as const) {
        tx.put('keys', {
          id: id as never,
          clip: CLIP as never,
          curve: 'crv_AttrRoll0000001' as CurveId,
          t,
          v,
          inType: 'linear',
          outType: 'linear',
          inHandle: { dt: 0, dv: 0 },
          outHandle: { dt: 0, dv: 0 },
          broken: false,
          weightLocked: true,
        });
      }
    });
    expect(api.attrs(FOOT, 10).roll).toBeCloseTo(20 * DEG2RAD, 12);
    const mid = api.attrs(FOOT, 5);
    expect(mid.roll).toBeCloseTo(10 * DEG2RAD, 12);
    expect(mid.ikFk).toBe(1);
    app.session.setState({ overrides: new Map([[FOOT, { '@ikFk': 0 }]]) });
    expect(api.attrs(FOOT).ikFk).toBe(0);
    expect(api.attrs(FOOT, 5).ikFk).toBe(1);
  });

  it('controlWorld() reads the evaluated control world at a frame', () => {
    const { api, app } = setup();
    const lower = `${RIG}:fk.lowerArm.L` as ControlId;
    const rest = api.controlWorld(lower, 0);
    const at15 = api.controlWorld(lower, 15);
    expect(at15.t).toEqual(rest.t);
    expect(Math.abs(at15.q[2] - rest.q[2])).toBeGreaterThan(1e-3);
    const runtime = app.characters.get('chr_SyntheticWave001' as never);
    expect(runtime).toBeDefined();
    expect(api.controlWorld(lower).t).toEqual(rest.t);
  });

  it('curveSlope() gives one-sided derivatives at keys and the infinity outside', () => {
    const { api, app } = setup();
    const c = app.evaluation.compiledCurve(CURVE);
    expect(api.curveSlope(CURVE, 7.5, 'left')).toBeCloseTo(api.curveSlope(CURVE, 7.5, 'right'), 12);
    expect(api.curveSlope(CURVE, 15, 'left')).toBeCloseTo(oneSidedSlope(c, 15, 'left'), 12);
    // Constant infinities: flat outside the key range and at the outer sides of the end keys.
    expect(api.curveSlope(CURVE, 0, 'left')).toBe(0);
    expect(api.curveSlope(CURVE, 30, 'right')).toBe(0);
    expect(api.curveSlope(CURVE, -5, 'right')).toBe(0);
    expect(() => api.curveSlope('crv_Missing', 0, 'left')).toThrow('Unknown curve');
  });

  it('limbs() lists the compiled limbs (none before A1) and limbPivots() is null without a leg limb', () => {
    const { api } = setup();
    expect(api.limbs()).toEqual([]);
    expect(api.limbs('chr_SyntheticWave001')).toEqual([]);
    expect(api.limbPivots('chr_SyntheticWave001', 'leg.L')).toBeNull();
  });

  it('panel slices answer from their probes, null or [] without one', () => {
    const { api, shell } = setup();
    expect(api.dopeSheet()).toBeNull();
    expect(api.screenOfDopeKey('summary', 10)).toBeNull();
    expect(api.screenOfDopeRegion('end')).toBeNull();
    expect(api.timelineTicks()).toEqual([]);
    expect(api.screenOfBand('middle')).toBeNull();
    expect(api.screenOfRegionHandle('right')).toBeNull();
    expect(api.screenOfTween('status', 0)).toBeNull();
    expect(api.tweenTarget('graph')).toBeNull();
    const rows = { rows: [], view: { f0: 0, sx: 4, scrollY: 0 }, canvasRect: { x: 0, y: 0, w: 1, h: 1 } };
    shell.probes.set('dopeSheet', {
      dopeSheet: () => rows,
      screenOfDopeKey: (row, frame) => (row === 'summary' ? { x: frame, y: 1 } : null),
      screenOfDopeRegion: () => ({ x: 5, y: 6 }),
    });
    expect(api.dopeSheet()).toEqual(rows);
    expect(api.screenOfDopeKey('summary', 10)).toEqual({ x: 10, y: 1 });
    expect(api.screenOfDopeRegion('start')).toEqual({ x: 5, y: 6 });
    shell.probes.set('timeline', {
      screenOfFrame: () => null,
      screenOfTick: () => null,
      timelineTicks: () => [{ frame: 10, breakdown: true, selected: false }],
      screenOfBand: (part) => (part === 'end' ? { x: 9, y: 9 } : null),
    });
    expect(api.timelineTicks()).toEqual([{ frame: 10, breakdown: true, selected: false }]);
    expect(api.screenOfBand('end')).toEqual({ x: 9, y: 9 });
    shell.probes.set(tweenProbeKey('status'), {
      screenOfTween: (amount) => ({ x: amount, y: 0 }),
      tweenTarget: () => ({ kind: 'frame', label: 'Pose @ f0' }),
    });
    expect(api.screenOfTween('status', 50)).toEqual({ x: 50, y: 0 });
    expect(api.tweenTarget('status')).toEqual({ kind: 'frame', label: 'Pose @ f0' });
    expect(api.tweenTarget('dopeSheet')).toBeNull();
    shell.probes.set('graph', {
      graph: () => ({
        visibleCurves: [],
        view: { f0: 0, v0: 0, sx: 1, sy: 1 },
        canvasRect: { x: 0, y: 0, w: 1, h: 1 },
        viewMode: 'stacked',
      }),
      screenOfKey: () => null,
      screenOfHandle: () => null,
      screenOfCurve: () => null,
      screenOfRegionHandle: (handle) => (handle === 'top' ? { x: 1, y: 2 } : null),
    });
    expect(api.graph()?.viewMode).toBe('stacked');
    expect(api.screenOfRegionHandle('top')).toEqual({ x: 1, y: 2 });
  });

  it('a panel whose canvas is off screen (an inactive dock tab) reads null, its Tween bar too', () => {
    const { api, shell } = setup();
    let graphRect = { x: 0, y: 0, w: 0, h: 0 };
    let dopeRect = { x: 0, y: 0, w: 0, h: 0 };
    shell.probes.set('graph', {
      graph: () => ({ visibleCurves: [CURVE], view: { f0: 0, v0: 0, sx: 1, sy: 1 }, canvasRect: graphRect }),
      screenOfKey: () => ({ x: 1, y: 1 }),
      screenOfHandle: () => ({ x: 2, y: 2 }),
      screenOfCurve: () => ({ x: 3, y: 3 }),
      screenOfRegionHandle: () => ({ x: 4, y: 4 }),
    });
    shell.probes.set('dopeSheet', {
      dopeSheet: () => ({ rows: [], view: { f0: 0, sx: 4, scrollY: 0 }, canvasRect: dopeRect }),
      screenOfDopeKey: () => ({ x: 5, y: 5 }),
      screenOfDopeRegion: () => ({ x: 6, y: 6 }),
    });
    for (const panel of ['graph', 'dopeSheet'] as const) {
      shell.probes.set(tweenProbeKey(panel), {
        screenOfTween: (amount) => ({ x: amount, y: 0 }),
        tweenTarget: () => ({ kind: 'keys', label: '2 keys' }),
      });
    }
    const reads = () => [
      api.graph(),
      api.screenOfKey('key_x'),
      api.screenOfHandle('key_x', 'in'),
      api.screenOfCurve(CURVE, 1),
      api.screenOfRegionHandle('top'),
      api.screenOfTween('graph', 10),
      api.tweenTarget('graph'),
      api.dopeSheet(),
      api.screenOfDopeKey('summary', 1),
      api.screenOfDopeRegion('start'),
      api.screenOfTween('dopeSheet', 10),
      api.tweenTarget('dopeSheet'),
    ];
    expect(reads()).toEqual(Array.from({ length: 12 }, () => null));
    graphRect = { x: 0, y: 0, w: 300, h: 0 }; // still no area
    expect(api.graph()).toBeNull();
    graphRect = { x: 0, y: 0, w: 300, h: 200 };
    const shown = (graph: boolean, dope: boolean): boolean[] => [
      ...Array.from({ length: 7 }, () => graph),
      ...Array.from({ length: 5 }, () => dope),
    ];
    expect(reads().map((read) => read !== null)).toEqual(shown(true, false));
    dopeRect = { x: 0, y: 0, w: 300, h: 200 };
    graphRect = { x: 0, y: 0, w: 0, h: 0 };
    expect(reads().map((read) => read !== null)).toEqual(shown(false, true));
  });

  it('graph().buffers lists the session buffer curves', () => {
    const { api, app, shell } = setup();
    shell.probes.set('graph', {
      graph: () => ({
        visibleCurves: [],
        view: { f0: 0, v0: 0, sx: 1, sy: 1 },
        canvasRect: { x: 0, y: 0, w: 1, h: 1 },
      }),
      screenOfKey: () => null,
      screenOfHandle: () => null,
      screenOfCurve: () => null,
    });
    app.session.setState({
      curveBuffers: new Map([
        [CURVE, { curve: { keys: [], weighted: false, pre: 'constant', post: 'constant' }, capturedAt: 1 }],
      ]),
    });
    expect(api.graph()).toMatchObject({ viewMode: 'absolute', buffers: [CURVE] });
  });

  it('autosave() mirrors session.autosave; flushAutosave() rejects when file.autosaveNow cannot run (no store)', async () => {
    const { api, app } = setup();
    expect(api.autosave()).toEqual({ enabled: false, slot: null, lastSavedAt: null, pending: false });
    app.session.setState({
      autosave: { enabled: true, slot: 'as_x', lastSavedAt: 5, pending: true, error: null },
    });
    expect(api.autosave()).toEqual({ enabled: true, slot: 'as_x', lastSavedAt: 5, pending: true });
    await expect(api.flushAutosave()).rejects.toThrow('flushAutosave');
  });

  it('reads apply pending once-per-frame updates first', () => {
    const { api, app } = setup();
    app.setFrameRequester(() => undefined);
    app.scheduleBeforeFrame('test', () => {
      app.session.setState({ overrides: new Map([[HAND, { rz: 0.25 }]]) });
    });
    expect(api.overrides(HAND)).toEqual({ rz: 0.25 });
  });

  it('document reads (curveValue, counts, controls, clips, characters) apply pending updates first', () => {
    const { api, app } = setup();
    app.setFrameRequester(() => undefined);
    const key = app.store.query.keysOfCurve(CURVE)[0];
    if (key === undefined) throw new Error('no key');
    const schedule = (fn: () => void) => app.scheduleBeforeFrame('test', fn);
    schedule(() => app.store.transact({ label: 'Key' }, (tx) => tx.patch('keys', key.id, { v: 0.75 })));
    expect(api.curveValue(CURVE, key.t)).toBe(0.75);
    const keys = app.store.list('keys').length;
    schedule(() => app.store.transact({ label: 'Delete' }, (tx) => tx.remove('keys', key.id)));
    expect(api.counts()['keys']).toBe(keys - 1);
    schedule(() => app.store.transact({ label: 'Rename' }, (tx) => tx.patch('controls', HAND, { name: 'Left hand' })));
    expect(api.controls().find((control) => control.id === HAND)?.name).toBe('Left hand');
    schedule(() => app.store.transact({ label: 'Clip' }, (tx) => tx.patch('clips', CLIP as ClipId, { name: 'cycle' })));
    expect(api.clips().map((clip) => clip.name)).toContain('cycle');
    const character = app.store.list('characters')[0];
    if (character === undefined) throw new Error('no character');
    schedule(() =>
      app.store.transact({ label: 'Name' }, (tx) => tx.patch('characters', character.id, { name: 'Bot' })),
    );
    expect(api.characters().map((c) => c.name)).toEqual(['Bot']);
  });
});

describe('oneSidedSlope', () => {
  it('distinguishes the sides at a key and follows cyclic infinities', () => {
    const keys = [
      [0, 0],
      [10, 10],
      [20, 0],
    ].map(([t, v]) => ({
      t: t as number,
      v: v as number,
      inType: 'linear' as const,
      outType: 'linear' as const,
      inHandle: { dt: 0, dv: 0 },
      outHandle: { dt: 0, dv: 0 },
      broken: false,
      weightLocked: true,
    }));
    const c = naiveCurveEngine.compile({ keys, weighted: false, pre: 'cycle', post: 'cycle' });
    expect(oneSidedSlope(c, 10, 'left')).toBeCloseTo(1, 12);
    expect(oneSidedSlope(c, 10, 'right')).toBeCloseTo(-1, 12);
    expect(oneSidedSlope(c, 20, 'right')).toBeCloseTo(1, 12);
    expect(oneSidedSlope(c, 0, 'left')).toBeCloseTo(-1, 12);
    const linear = naiveCurveEngine.compile({ keys, weighted: false, pre: 'linear', post: 'oscillate' });
    expect(oneSidedSlope(linear, 0, 'left')).toBeCloseTo(1, 12);
    expect(oneSidedSlope(linear, 20, 'right')).toBeCloseTo(1, 12);
  });
});

describe('the Dope Sheet panel (A0 placeholder)', () => {
  it('registers with key scope dopeSheet, and registerBuiltinPanels includes it', () => {
    const registry = createPanelRegistry();
    const dispose = registerDopeSheetPanel(registry);
    expect(registry.get(PANEL.dopeSheet)).toMatchObject({
      id: 'dopeSheet',
      kind: 'dopeSheet',
      title: 'Dope Sheet',
      keyScope: 'dopeSheet',
    });
    dispose();
    expect(registry.get(PANEL.dopeSheet)).toBeUndefined();
    const all = createPanelRegistry();
    registerBuiltinPanels(all);
    expect(all.get(PANEL.dopeSheet)).toBe(DOPE_SHEET_PANEL);
  });
});

describe('layout v1 → v2 migration (§4.8)', () => {
  /** A v1 layout as M1 stored it: the default Animate layout without the Dope Sheet. */
  async function v1Layout(opts: { readonly graph: boolean }): Promise<string> {
    const panels = createPanelRegistry();
    const { shell } = createTestShell({ panels, storage: createMemoryStorage() });
    const view = await render(
      <ShellFrame shell={shell}>
        <WorkspaceHost />
      </ShellFrame>,
    );
    await waitFor(() => shell.workspace.kinds().length === 7);
    const api = shell.workspace.dockview;
    if (api === null) throw new Error('no dockview');
    await update(() => {
      for (const kind of opts.graph ? ['dopeSheet'] : ['dopeSheet', 'graph']) {
        const panel = api.getPanel(kind);
        if (panel !== undefined) api.removePanel(panel);
      }
    });
    const json = api.toJSON();
    await view.unmount();
    return JSON.stringify({ schemaVersion: 1, workspace: 'animate', dockview: json });
  }

  it('adds the Dope Sheet tab to the Graph Editor group, stores v2 and keeps the v1 key', async () => {
    const v1 = await v1Layout({ graph: true });
    const storage = createMemoryStorage();
    storage.setItem(layoutStorageKeyV1(), v1);
    expect(readStoredLayout(storage).kind).toBe('migrate');
    const { shell, toasts } = createTestShell({ panels: createPanelRegistry(), storage });
    const view = await render(
      <ShellFrame shell={shell}>
        <WorkspaceHost />
      </ShellFrame>,
    );
    await waitFor(() => shell.workspace.kinds().includes('dopeSheet'));
    const api = shell.workspace.dockview;
    expect(api?.getPanel('dopeSheet')?.group.id).toBe(api?.getPanel('graph')?.group.id);
    expect(api?.getPanel('dopeSheet')?.api.isVisible).toBe(false);
    expect(api?.getPanel('graph')?.api.isVisible).toBe(true);
    expect(storage.getItem(layoutStorageKeyV1())).toBe(v1);
    const stored = JSON.parse(storage.getItem(layoutStorageKey()) ?? '{}') as {
      schemaVersion?: number;
      dockview?: SerializedDockview;
    };
    expect(stored.schemaVersion).toBe(2);
    expect(Object.keys(stored.dockview?.panels ?? {}).sort()).toEqual(
      ['attributes', 'channels', 'clips', 'dopeSheet', 'graph', 'outliner', 'viewport'].sort(),
    );
    expect(toasts.store.getState().toasts).toEqual([]);
    await view.unmount();
  });

  it('puts the Dope Sheet in a new bottom group when the Graph Editor was closed', async () => {
    const v1 = await v1Layout({ graph: false });
    const storage = createMemoryStorage();
    storage.setItem(layoutStorageKeyV1(), v1);
    const { shell } = createTestShell({ panels: createPanelRegistry(), storage });
    const view = await render(
      <ShellFrame shell={shell}>
        <WorkspaceHost />
      </ShellFrame>,
    );
    await waitFor(() => shell.workspace.kinds().includes('dopeSheet'));
    expect(shell.workspace.kinds()).not.toContain('graph');
    const api = shell.workspace.dockview;
    const groupOf = (kind: string) => api?.getPanel(kind)?.group.id;
    expect(groupOf('dopeSheet')).not.toBe(groupOf('viewport'));
    expect(api?.getPanel('dopeSheet')?.api.isVisible).toBe(true);
    await view.unmount();
  });

  it('prefers a v2 layout and resets on other v1 problems (M1 rule)', async () => {
    const storage = createMemoryStorage();
    storage.setItem(layoutStorageKeyV1(), JSON.stringify({ schemaVersion: 1, workspace: 'other', dockview: {} }));
    expect(readStoredLayout(storage)).toEqual({ kind: 'reset', reason: 'invalid' });
    storage.setItem(layoutStorageKeyV1(), '{broken');
    expect(readStoredLayout(storage)).toEqual({ kind: 'reset', reason: 'invalid' });
    const { shell, toasts } = createTestShell({ panels: createPanelRegistry(), storage });
    const view = await render(
      <ShellFrame shell={shell}>
        <WorkspaceHost />
      </ShellFrame>,
    );
    await waitFor(() => shell.workspace.kinds().length === 7);
    expect(toasts.store.getState().toasts.map((t) => t.text)).toContain('Layout reset (saved layout unreadable)');
    await view.unmount();
    const v1 = await v1Layout({ graph: true });
    storage.setItem(layoutStorageKeyV1(), v1);
    storage.setItem(layoutStorageKey(), JSON.stringify({ schemaVersion: 2, workspace: 'animate', dockview: {} }));
    expect(readStoredLayout(storage)).toEqual({ kind: 'reset', reason: 'invalid' });
  });
});

describe('status line (§7)', () => {
  const item = (container: ParentNode, target: string) =>
    container.querySelector<HTMLButtonElement>(`[data-testid="status-keytarget-${target}"]`);

  it('shows the key-target toggle, enabled by the built-in key.setTarget (A2), and the Tween bar slot', async () => {
    const { shell } = createTestShell({ snapshot, skeleton });
    registerBuiltinOperators(shell.app);
    expect(shell.app.operators.poll('key.setTarget', {}, { target: 'bodyPart' })).toBe(true);
    const view = await render(
      <ShellFrame shell={shell}>
        <StatusLine />
      </ShellFrame>,
    );
    expect(item(view.container, 'selected')?.getAttribute('aria-checked')).toBe('true');
    expect(item(view.container, 'selected')?.disabled).toBe(false);
    expect(item(view.container, 'bodyPart')?.disabled).toBe(false);
    expect(item(view.container, 'character')?.disabled).toBe(false);
    expect(view.container.querySelector('[data-testid="status-tween-slot"]')).not.toBeNull();
    await view.unmount();
  });

  it('runs key.setTarget once an implementation is registered', async () => {
    const { shell } = createTestShell({ snapshot, skeleton });
    shell.app.operators.register({
      id: 'key.setTarget',
      label: 'Key Target',
      category: 'key',
      scope: 'global',
      apply: (_ctx, args: { readonly target: 'selected' | 'bodyPart' | 'character' }) => {
        const tools = shell.app.session.getState().tools;
        shell.app.session.setState({ tools: { ...tools, keyTarget: args.target } });
      },
    });
    const view = await render(
      <ShellFrame shell={shell}>
        <StatusLine />
      </ShellFrame>,
    );
    expect(item(view.container, 'bodyPart')?.disabled).toBe(false);
    await update(() => item(view.container, 'bodyPart')?.click());
    await waitFor(() => shell.app.session.getState().tools.keyTarget === 'bodyPart');
    expect(item(view.container, 'bodyPart')?.getAttribute('aria-checked')).toBe('true');
    await view.unmount();
  });
});

describe('frame loop (§4.5)', () => {
  it('runs the scheduled tasks before the clock and the evaluation', () => {
    const { app } = createTestShell({ snapshot, skeleton });
    const order: string[] = [];
    app.setFrameRequester(() => undefined);
    app.scheduleBeforeFrame('task', () => order.push('task'));
    const tick = app.evaluation.tick.bind(app.evaluation);
    (app.evaluation as { tick: () => boolean }).tick = () => {
      order.push('tick');
      return tick();
    };
    const hooks = createFrameHooks(app, (error) => {
      throw error;
    });
    hooks.before.add(() => order.push('before'));
    hooks.runBefore(16);
    expect(order).toEqual(['task', 'tick', 'before']);
  });
});
