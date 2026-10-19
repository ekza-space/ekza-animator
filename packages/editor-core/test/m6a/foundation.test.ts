// M6A-SPEC §9 B0a (6)–(7): workspaces and marking-menu registries, the M6a session and preference defaults, the
// service stubs (components, capture, extrude), RunContext source/repeat, the no-op LastRun recorder, selection
// snapshots as a superset of the shipped shape, and every new operator resolving and poll-failing cleanly.
import type { PrimitiveKind as DocPrimitiveKind } from '@ekza-animator/doc';
import { makeTestMesh } from '@ekza-animator/doc/testing';
import type { PrimitiveKind as MeshPrimitiveKind } from '@ekza-animator/mesh-core';
import { describe, expect, it } from 'vitest';
import {
  ANIMATE_ONLY_REASON,
  MODEL_ONLY_REASON,
  MODEL_SETTINGS_REASON,
  NOTHING_TO_TRANSFORM,
  ANIMATE_WORKSPACE,
  type MarkingMenuDef,
  NOT_AVAILABLE_YET,
  type OperatorContext,
  registerBuiltins,
  restoreSelection,
  selectionSnapshot,
  WORKSPACE,
  type WorkspaceDef,
} from '../../src';
import { BUILTIN_OPERATORS } from '../../src/operators/builtin';
import { createFakeEditorApp } from '../../src/testing';
import { W, waveApp, waveDoc } from '../kernel/support';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('contract coherence', () => {
  it('PrimitiveKind is the same union in doc and mesh-core', () => {
    const same: Equal<DocPrimitiveKind, MeshPrimitiveKind> = true;
    expect(same).toBe(true);
  });
});

describe('workspaces and marking menus', () => {
  // M6A-SPEC §3 rule 9 literal update (§5.17, B9): the built-ins register Model, Rig & Skin and Review next to Animate.
  it('registers the Animate workspace with the built-ins, next to B9’s Model, Rig & Skin and Review', () => {
    const app = waveApp();
    const dispose = registerBuiltins(app);
    expect(app.workspaces.list().map((w) => w.id)).toEqual([
      WORKSPACE.model,
      WORKSPACE.rig,
      WORKSPACE.animate,
      WORKSPACE.review,
    ]);
    const animate = app.workspaces.get('animate') as WorkspaceDef;
    expect(animate).toBe(ANIMATE_WORKSPACE);
    expect(animate).toMatchObject({
      label: 'Animate',
      shortLabel: 'Anim',
      enabled: true,
      keyScope: null,
      defaultTool: 'select',
      pickMask: { controls: true, joints: false, meshes: false, groups: false },
      timeline: true,
      layout: 'animate',
    });
    expect(animate.menus).toEqual([
      'file',
      'edit',
      'select',
      'key',
      'pose',
      'clip',
      'graph',
      'time',
      'playback',
      'rig',
      'view',
      'display',
      'windows',
      'help',
    ]);
    expect(animate.status?.(app)).toEqual({ glyph: 'done', reasons: [] }); // the wave clip has keys
    dispose();
    expect(app.workspaces.list()).toEqual([]);
    expect(WORKSPACE).toEqual({ model: 'model', rig: 'rig', animate: 'animate', review: 'review' });
  });

  it('shows ○ for Animate without keys', () => {
    const app = createFakeEditorApp();
    expect(ANIMATE_WORKSPACE.status?.(app)).toEqual({ glyph: 'todo', reasons: ['No keys yet'] });
  });

  it('accepts workspace and marking-menu contributions through one path', () => {
    const app = waveApp();
    const model: WorkspaceDef = { ...ANIMATE_WORKSPACE, id: 'model', label: 'Model', order: 0 };
    const menu: MarkingMenuDef = {
      id: 'model.merge',
      trigger: { key: 'KeyM' },
      workspaces: ['model'],
      when: { over: 'any' },
      slots: { N: { op: 'mesh.merge' } },
      list: [],
    };
    const disposeWorkspace = app.contribute({ kind: 'workspace', def: model });
    const disposeMenu = app.contribute({ kind: 'markingMenu', def: menu });
    expect(app.workspaces.get('model')).toBe(model);
    expect(app.markingMenus.list()).toEqual([menu]);
    expect(() => app.contribute({ kind: 'markingMenu', def: menu })).toThrow(/already registered/);
    disposeMenu();
    disposeWorkspace();
    expect(app.markingMenus.list()).toEqual([]);
    expect(app.workspaces.get('model')).toBeUndefined();
  });
});

describe('M6a session defaults and service stubs', () => {
  it('starts in Animate, object mode, with nothing selected, hidden or remembered', () => {
    const state = waveApp().session.getState();
    expect(state.workspace).toBe('animate');
    expect(state.lastRun).toBeNull();
    expect(state.workspaceViews).toEqual({});
    expect(state.selection.objects).toEqual([]);
    expect(state.tools.selectionMask.groups).toBe(false);
    expect(state.model).toMatchObject({
      componentMode: 'object',
      lastComponentMode: 'vertex',
      hilite: [],
      softSelect: { on: false, radius: 0.5, falloff: 'volume', curve: 'smooth' },
      constraint: 'off',
      selectionStyle: 'marquee',
      cameraBased: 'auto',
      backfaces: false,
      snap: { grid: false, vertex: false, increment: false },
      pivotEdit: false,
      componentPivot: null,
      isolate: {},
      extrudeSession: null,
      capture: { armed: null, field: null, text: null },
      lastTool: null,
      activeSwatch: null,
      tweakHandle: null,
    });
    expect(state.model.symmetry.size).toBe(0);
    expect(state.model.hiddenObjects.size).toBe(0);
  });

  it('wires the stubs: no extrude session, an idle capture, an object-level component snapshot', () => {
    const app = waveApp();
    expect(app.extrude.state).toBeNull();
    expect(app.extrude.beginAbsorb('move', 'world')).toBeNull();
    expect(app.extrude.stepBack()).toBe(false);
    expect(app.extrude.stepForward()).toBe(false);
    expect(app.extrude.reopen()).toBe(false);
    app.extrude.end('test', { drop: true });
    expect(app.capture.state).toEqual({ armed: null, field: null, text: null });
    expect(app.capture.key({ code: 'Digit1', key: '1', shift: false, mod: false, alt: false })).toBe(false);
    app.capture.disarm();
    // B11 landed the capture (literal update, M6A-SPEC §5.10): with no live last operation there is nothing to arm.
    app.capture.arm('keyboard-op', 'last-run');
    expect(app.capture.state).toEqual({ armed: null, field: null, text: null });
    expect(app.components.snapshot()).toEqual({
      controls: [],
      objects: [],
      componentMode: 'object',
      hilite: [],
      meshes: {},
    });
    expect(app.components.restore({ ...app.components.snapshot(), meshes: { msh_A: {} as never } })).toEqual({
      skipped: ['msh_A'],
    });
    // B10 landed the service (M6A-SPEC §4.6): its writers refuse a mesh without a runtime (a caller error).
    expect(() => app.components.set('msh_A' as never, {} as never)).toThrow(
      expect.objectContaining({ code: 'invalid-record' }),
    );
    expect(app.blobs.ids()).toEqual([]);
  });
});

describe('runner context and LastRun (B0a baselines)', () => {
  // B11 landed the LastRun recorder (literal update, M6A-SPEC §5.7): the paramless repeatable run is recorded.
  it('passes the run source and the auto-repeat flag to poll and apply; records the LastRun', async () => {
    const app = waveApp();
    const seen: { readonly phase: string; readonly source: unknown; readonly repeat: unknown }[] = [];
    app.operators.register<void, void, void>({
      id: 'test.context',
      label: 'Context',
      category: 'test',
      scope: 'global',
      flags: { undo: true, repeatable: true },
      params: [],
      poll: (ctx: OperatorContext) => {
        seen.push({ phase: 'poll', source: ctx.source, repeat: ctx.repeat });
        return true;
      },
      apply: (ctx) => {
        seen.push({ phase: 'apply', source: ctx.source, repeat: ctx.repeat });
        ctx.tx?.patch('clips', W.clip, { name: 'renamed' });
      },
    });
    await app.runUntyped('test.context', undefined, { source: 'keyboard', repeat: true });
    await app.runUntyped('test.context');
    expect(seen).toEqual([
      { phase: 'poll', source: 'keyboard', repeat: true },
      { phase: 'poll', source: 'keyboard', repeat: true },
      { phase: 'apply', source: 'keyboard', repeat: true },
      { phase: 'poll', source: undefined, repeat: undefined },
      { phase: 'poll', source: undefined, repeat: undefined },
      { phase: 'apply', source: undefined, repeat: undefined },
    ]);
    // The second run renames to the same name: no step, so the first (keyboard) run stays the last operation.
    expect(app.session.getState().lastRun).toMatchObject({
      id: 'test.context',
      source: 'keyboard',
      repeatable: true,
      adjustable: false,
      closed: null,
    });
  });
});

describe('selection snapshots (TxMeta.selectionBefore/After)', () => {
  it('stores a superset of the M6a SelectionSnapshot and the shipped shape, and reads both', () => {
    const app = waveApp();
    app.store.transact({ label: 'Create' }, (tx) => tx.put('meshes', makeTestMesh('msh_A')));
    const stored = selectionSnapshot(
      { controls: [W.handL], keys: new Map(), channels: [], objects: ['msh_A' as never] },
      { componentMode: 'face', hilite: ['msh_A' as never] },
    ) as Record<string, unknown>;
    expect(stored).toEqual({
      kind: 'ekza.selection',
      controls: [W.handL],
      keys: [],
      channels: [],
      objects: ['msh_A'],
      componentMode: 'face',
      hilite: ['msh_A'],
      meshes: {},
    });
    restoreSelection(app, JSON.parse(JSON.stringify(stored)));
    expect(app.session.getState().selection.objects).toEqual(['msh_A']);
    expect(app.session.getState().model.componentMode).toBe('object'); // never restored
    // A shipped (M2a) snapshot has no objects: read as none.
    restoreSelection(app, { kind: 'ekza.selection', controls: [W.handL], keys: [], channels: [] });
    expect(app.session.getState().selection).toEqual({
      controls: [W.handL],
      keys: new Map(),
      channels: [],
      objects: [],
    });
  });
});

describe('every M6a operator resolves and poll-fails cleanly (§3 rule 1)', () => {
  /** §6.2 operators listed in every workspace. */
  const GLOBAL = new Set([
    'workspace.set',
    'view.shading',
    'view.display.set',
    'ui.commandPalette',
    'ui.markingMenu',
    'edit.adjustLast',
    'edit.repeatLast',
  ]);
  const M6A = BUILTIN_OPERATORS.filter((def) => def.workspaces?.includes('model') === true || GLOBAL.has(def.id));
  /** Poll reasons of the operators that have landed, for the arguments below (headless: no viewport, no shell). */
  const LANDED: Readonly<Record<string, readonly string[]>> = {
    'workspace.set': ['expects { workspace }'],
    'view.shading': ['expects { mode: wire | shaded | colours | lit }'],
    'view.display.set': ['expects { patch }'],
    'ui.commandPalette': ['The command palette needs the editor window'],
    'ui.markingMenu': ['expects { menu }'],
    // B10 (modes, selection, hide): argument checks first, then "Model only" (this app is in Animate).
    'select.mode': ['expects { mode: object | vertex | edge | face | toggle }'],
    'model.hilite': ['expects { meshes, mode: add | replace | remove }'],
    'select.components': ['expects { mesh, kind, indices, mode }'],
    'select.mesh.loop': ['expects { mesh, kind, component, gesture: double | shift-double | mod-double }'],
    'select.mesh.ring': ['expects { mesh?, component? }', MODEL_ONLY_REASON],
    'select.mesh.grow': [MODEL_ONLY_REASON],
    'select.mesh.shrink': [MODEL_ONLY_REASON],
    'select.mesh.border': [MODEL_ONLY_REASON],
    'select.mesh.shell': [MODEL_ONLY_REASON],
    'select.mesh.all': [MODEL_ONLY_REASON],
    'select.mesh.invert': [MODEL_ONLY_REASON],
    'select.mesh.none': [MODEL_ONLY_REASON],
    'select.mesh.convert': ['expects { to: vertex | edge | face, mode? }'],
    'select.mesh.matching': ['expects { mesh, code }'],
    'select.objects': ['expects { ids?, all?: meshes, mode }'],
    'view.hide': ['expects { target: selected | unselected }'],
    'view.showAll': [MODEL_ONLY_REASON],
    'view.isolate': ['expects { paneId? }', MODEL_ONLY_REASON],
    // B11 landed (literal update, M6A-SPEC §5.7): Adjust Last, Repeat Last, `Y` and `T` with nothing recorded.
    'edit.adjustLast': ['No operation to adjust'],
    'edit.repeatLast': ['Nothing to repeat'],
    'tool.last': ['No tool used yet'],
    'view.lastOpCard': ['No operation to adjust'],
    // B12a landed (literal update, M6A-SPEC §6.2): argument checks, "Modeling settings are in the Model workspace" for
    // the argument-free toggles, and "Select a mesh or group first" for the pivot and transform operators.
    'model.symmetry.set': ['expects { meshes?, mode?, tolerance?, preserveSeam? } with at least one setting'],
    'model.softSelect.set': ['expects { on?, radius?, falloff?, curve? } with at least one setting'],
    'model.softSelect.toggle': [MODEL_SETTINGS_REASON],
    'model.selectionStyle.set': ['expects { style: marquee | tweak | toggle }'],
    'model.cameraBased.set': ['expects { value: auto | on | off }'],
    'model.backfaces.toggle': [MODEL_SETTINGS_REASON],
    'model.constraint.set': ['expects { constraint: off | angle | border | loop | ring | shell }'],
    'model.snap.toggle': ['expects { kind: grid | vertex | increment }'],
    'model.pivot.editToggle': [MODEL_SETTINGS_REASON],
    'mesh.pivot.set': ['expects { id, pivot: [x, y, z] }'],
    'mesh.pivot.center': [NOTHING_TO_TRANSFORM, 'expects { ids? }'],
    'mesh.pivot.bottomCenter': [NOTHING_TO_TRANSFORM, 'expects { ids? }'],
    'mesh.pivot.reset': [NOTHING_TO_TRANSFORM, 'expects { ids? }'],
    'mesh.pivot.bake': [NOTHING_TO_TRANSFORM, 'expects { ids? }'],
    'mesh.resetTransforms': [NOTHING_TO_TRANSFORM, 'expects { ids? }'],
    'mesh.freezeTransforms': [NOTHING_TO_TRANSFORM, 'expects { ids? }'],
    'scene.object.transform': ['expects { ids, placements } (one placement per id)'],
  };
  /**
   * B11 landed the `mesh.*` operators through `meshOperator`/`meshSetOperator` (literal update, M6A-SPEC §6.1): with
   * no hilite, no selection and no such mesh they poll-fail with the wrappers' reasons (B7, `mesh/operator.ts`).
   */
  const meshReasons = (def: { readonly id: string; readonly label: string }): readonly string[] =>
    def.id.startsWith('mesh.') && !def.id.startsWith('mesh.create.') && !NOT_KERNEL_OPS.has(def.id)
      ? [
          'Mesh tools are loading',
          `${def.label}: enter a component mode first`,
          'Select a mesh first',
          'Select components first',
          'Unknown mesh msh_X',
          `${def.label} needs at least two meshes`,
          ...['vertex', 'edge', 'face'].flatMap((a) =>
            ['vertex', 'edge', 'face'].map((b) => `${def.label} works on ${a}, ${b} components`),
          ),
          ...['vertex', 'edge', 'face'].map((a) => `${def.label} works on ${a} components`),
          `${def.label} works on vertex, edge, face components`,
          // B11's help-line wording for Extrude (§7 Mod+E, §6.1).
          'Select faces or border edges',
          'Vertex extrude is not available yet',
        ]
      : [];
  /** `mesh.*` editor operators of §6.2 that are not kernel ops (their owners land them). */
  const NOT_KERNEL_OPS = new Set([
    'mesh.pivot.set',
    'mesh.pivot.center',
    'mesh.pivot.bottomCenter',
    'mesh.pivot.reset',
    'mesh.pivot.bake',
    'mesh.resetTransforms',
    'mesh.freezeTransforms',
    'mesh.template',
    'mesh.primitive.set',
    'mesh.makeEditable',
    'mesh.setAttributes',
  ]);

  it('covers the §6 operators: 38 kernel ops, 4 set-ops and 77 editor operators', () => {
    expect(M6A.length).toBe(38 + 4 + 77);
    expect(M6A.filter((d) => d.id.startsWith('mesh.') && d.extraArgs?.includes('kind') === true)).toHaveLength(42);
  });

  /** Operators their owners have landed (no longer stubs): B7's `mesh.create.*` (§6.2). */
  const LANDED_CREATE = new Set(
    ['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'].map((kind) => `mesh.create.${kind}`),
  );

  it('cancels with a reason, never fails or throws, with or without args', async () => {
    const app = createFakeEditorApp({ snapshot: waveDoc() });
    registerBuiltins(app);
    for (const def of M6A.filter((d) => !LANDED_CREATE.has(d.id))) {
      for (const args of [undefined, {}, { meshes: ['msh_X'], kind: 'face' }, 42]) {
        const result = await app.runUntyped(def.id, args);
        expect([def.id, result.status]).toEqual([def.id, 'cancelled']);
        const reason = result.status === 'cancelled' ? result.reason : '';
        const reasons = [
          NOT_AVAILABLE_YET,
          ANIMATE_ONLY_REASON,
          'Component pick-walk arrives later',
          // Landed operators poll-fail with their own reasons on these arguments (B9: workspace and shell).
          ...(LANDED[def.id] ?? []),
          ...meshReasons(def),
        ];
        expect([def.id, reasons]).toEqual([def.id, expect.arrayContaining([reason])]);
      }
    }
    expect(app.history.canUndo()).toBe(false);
  });
});
