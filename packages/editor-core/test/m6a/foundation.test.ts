// M6A-SPEC §9 B0a (6)–(7): workspaces and marking-menu registries, the M6a session and preference defaults, the
// service stubs (components, capture, extrude), RunContext source/repeat, the no-op LastRun recorder, selection
// snapshots as a superset of the shipped shape, and every new operator resolving and poll-failing cleanly.
import type { PrimitiveKind as DocPrimitiveKind } from '@ekza-animator/doc';
import { makeTestMesh } from '@ekza-animator/doc/testing';
import type { PrimitiveKind as MeshPrimitiveKind } from '@ekza-animator/mesh-core';
import { describe, expect, it } from 'vitest';
import {
  ANIMATE_ONLY_REASON,
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
  it('registers the Animate workspace with the built-ins (Model is B9’s)', () => {
    const app = waveApp();
    const dispose = registerBuiltins(app);
    expect(app.workspaces.list().map((w) => w.id)).toEqual([WORKSPACE.animate]);
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
    expect(() => app.capture.arm('drag', 'last-run')).toThrow(expect.objectContaining({ code: 'not-implemented' }));
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
    expect(() => app.components.set('msh_A' as never, {} as never)).toThrow(
      expect.objectContaining({ code: 'not-implemented' }),
    );
    expect(app.blobs.ids()).toEqual([]);
  });
});

describe('runner context and LastRun (B0a baselines)', () => {
  it('passes the run source and the auto-repeat flag to poll and apply; records no LastRun', async () => {
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
    expect(app.session.getState().lastRun).toBeNull();
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

  it('covers the §6 operators: 38 kernel ops, 4 set-ops and 77 editor operators', () => {
    expect(M6A.length).toBe(38 + 4 + 77);
    expect(M6A.filter((d) => d.id.startsWith('mesh.') && d.extraArgs?.includes('kind') === true)).toHaveLength(42);
  });

  /** Operators their owners have landed (no longer stubs): B7's `mesh.create.*` (§6.2). */
  const LANDED = new Set(['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'].map((kind) => `mesh.create.${kind}`));

  it('cancels with a reason, never fails or throws, with or without args', async () => {
    const app = createFakeEditorApp({ snapshot: waveDoc() });
    registerBuiltins(app);
    for (const def of M6A.filter((d) => !LANDED.has(d.id))) {
      for (const args of [undefined, {}, { meshes: ['msh_X'], kind: 'face' }, 42]) {
        const result = await app.runUntyped(def.id, args);
        expect([def.id, result.status]).toEqual([def.id, 'cancelled']);
        const reason = result.status === 'cancelled' ? result.reason : '';
        expect([def.id, [NOT_AVAILABLE_YET, ANIMATE_ONLY_REASON, 'Component pick-walk arrives later']]).toEqual([
          def.id,
          expect.arrayContaining([reason]),
        ]);
      }
    }
    expect(app.history.canUndo()).toBe(false);
  });
});
