// Registration of the built-in contributions (MVP-SPEC §7 WP-7b, ADR 0008): every §4.9 operator owned by WP-7b,
// importers, exporters, export profiles, menu items and the maya keymap; robustness of polls against untyped args.
import { EkzaError } from '@ekza-studio/anim-core';
import { BUILTIN_EXPORT_PROFILES } from '@ekza-studio/io';
import { MESH_OP_DESCRIPTORS, MESH_SET_OP_DESCRIPTORS } from '@ekza-studio/mesh-core/descriptors';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_EXPORTERS,
  BUILTIN_IMPORTERS,
  BUILTIN_MENU_ITEMS,
  loadModelOperators,
  MODEL_MENU_ITEMS,
  MAYA_KEYMAP,
  RIG_SHADOW_KEYMAP,
  registerBuiltinOperators,
  registerBuiltins,
} from '../../src';
import { BUILTIN_OPERATORS } from '../../src/operators/builtin';
import { resolveImporter } from '../../src/operators/builtin/importers';
import { createFakeEditorApp } from '../../src/testing';
import type { OperatorContext } from '../../src/types';
import { kernelApp } from '../kernel/support';
import { glbOf, humanoidSkeleton, opsApp, waveDoc } from './support';

/** §4.9 rows owned by WP-7b, with the U column. */
const CATALOG: Readonly<Record<string, boolean>> = {
  'file.new': false,
  'file.open': false,
  'file.openProject': false,
  'file.importModel': true,
  'file.importAnimation': true,
  'file.loadSample': true,
  'file.save': false,
  'file.saveAs': false,
  'file.saveJson': false,
  'file.export': false,
  'edit.undo': false,
  'edit.redo': false,
  'edit.copy': false,
  'edit.paste': false,
  'edit.delete': false,
  'edit.escape': false,
  'select.controls': false,
  'select.all': false,
  'select.none': false,
  'select.mirror': false,
  'select.keys': false,
  'key.set': true,
  'key.deleteAtFrame': true,
  'key.toggleAutoKey': false,
  'channel.setValues': true,
  'channel.toggleLock': true,
  'pose.resetToRest': true,
  'pose.copy': false,
  'pose.paste': true,
  'pose.mirror': true,
  'pose.pinFeet': false,
  'pose.unpinFeet': false,
  'pose.plantFeet': true,
  'time.setFrame': false,
  'time.step': false,
  'time.nextKey': false,
  'time.prevKey': false,
  'time.goToStart': false,
  'time.goToEnd': false,
  'time.togglePlay': false,
  'time.play': false,
  'time.stop': false,
  'time.setPlaybackRange': false,
  'time.setLoop': false,
  'time.setSpeed': false,
  'graph.tangent.set': true,
  'graph.tangent.break': true,
  'graph.tangent.unify': true,
  'graph.curve.setWeighted': true,
  'graph.tangent.lockWeight': true,
  'graph.infinity.set': true,
  'graph.keys.setFields': true,
  'graph.keys.move': true,
  'graph.keys.scale': true,
  'graph.keys.delete': true,
  'graph.key.insert': true,
  'graph.keys.keyCurves': true,
  'graph.keys.copy': false,
  'graph.keys.paste': true,
  'graph.eulerFilter': true,
  'graph.curves.simplify': true,
  'clip.new': true,
  'clip.rename': true,
  'clip.duplicate': true,
  'clip.delete': true,
  'clip.setActive': false,
  'clip.setSettings': true,
  'view.tool': false,
  'view.manipulatorSize': false,
  'view.setManipSpace': false,
  'view.setNavProfile': false,
  'rig.setRotateOrder': true,
  'rig.setControlSize': true,
  'rig.toggleSecondary': false,
};

function isStub(error: unknown): boolean {
  return error instanceof EkzaError && error.code === 'not-implemented';
}

// M6A-SPEC §3 rule 9 literal update (§8.3): Model's menus, whose items appear only in the Model workspace.
const MENUS =
  /^(file|edit|select|key|pose|clip|graph|time|rig|view|create|modify|display|mesh|edit-mesh|mesh-tools|mesh-display|uv)$/;
const MODEL_ONLY_MENUS = /^(create|modify|display|mesh|edit-mesh|mesh-tools|mesh-display|uv)$/;

/** Operators beyond §4.9 requested by other work packages (WP-9 R-1, R-3), with their undo flag. */
const ADDITIONS: Readonly<Record<string, boolean>> = { 'select.channels': false, 'view.camera.setSettings': true };

/**
 * M2A-SPEC §4.9 operators registered by the built-ins from A0 on (stubs until their owners land them), with the U
 * column (literal update, M2A-SPEC §3 rule 8).
 */
const M2A_OPERATORS: Readonly<Record<string, boolean>> = {
  'rig.addLimbIk': true,
  'rig.ikFk.switch': true,
  'rig.ikFk.match': true,
  'rig.ikFk.matchRange': true,
  'rig.setFootParams': true,
  'select.pickWalk': false,
  'key.setTarget': false,
  'key.toggleRipple': false,
  'key.tween': true,
  'key.convert': true,
  'pose.mirrorAnimation': true,
  'time.insertTime': true,
  'time.deleteTime': true,
  'graph.keys.copyTo': true,
  'graph.buffer.snapshot': false,
  'graph.buffer.swap': true,
  'graph.buffer.clear': false,
  'file.recover': false,
  'file.discardRecovery': false,
  'file.autosaveNow': false,
};

/**
 * M6A-SPEC §6 operators registered by the built-ins from B0a on (stubs until their owners land them), with the U
 * column (§3 rule 9 literal update): every §6.1 kernel op (undoable) and the §6.2 editor operators.
 */
const M6A_OPERATORS: Readonly<Record<string, boolean>> = {
  ...Object.fromEntries(
    [...Object.keys(MESH_OP_DESCRIPTORS), ...Object.keys(MESH_SET_OP_DESCRIPTORS)].map((id) => [id, true]),
  ),
  'workspace.set': false,
  'view.shading': false,
  'view.display.set': false,
  'ui.commandPalette': false,
  'ui.markingMenu': false,
  'select.mode': false,
  'model.hilite': false,
  'select.components': false,
  'select.mesh.loop': false,
  'select.mesh.ring': false,
  'select.mesh.grow': false,
  'select.mesh.shrink': false,
  'select.mesh.border': false,
  'select.mesh.shell': false,
  'select.mesh.all': false,
  'select.mesh.invert': false,
  'select.mesh.none': false,
  'select.mesh.convert': false,
  'select.mesh.matching': false,
  'select.mesh.bySwatch': false,
  'select.objects': false,
  'select.mesh.pickWalk': false,
  'view.hide': false,
  'view.showAll': false,
  'view.isolate': false,
  'model.symmetry.set': false,
  'model.softSelect.set': false,
  'model.softSelect.toggle': false,
  'model.selectionStyle.set': false,
  'model.cameraBased.set': false,
  'model.backfaces.toggle': false,
  'model.constraint.set': false,
  'model.snap.toggle': false,
  'model.pivot.editToggle': false,
  'mesh.pivot.set': true,
  'mesh.pivot.center': true,
  'mesh.pivot.bottomCenter': true,
  'mesh.pivot.reset': true,
  'mesh.pivot.bake': true,
  'mesh.resetTransforms': true,
  'mesh.freezeTransforms': true,
  'scene.object.transform': true,
  'edit.adjustLast': false,
  'edit.repeatLast': false,
  'model.animateOnly': false,
  'tool.last': false,
  'view.lastOpCard': false,
  'mesh.create.cube': true,
  'mesh.create.sphere': true,
  'mesh.create.cylinder': true,
  'mesh.create.cone': true,
  'mesh.create.plane': true,
  'mesh.create.torus': true,
  'mesh.create.template': true,
  'mesh.primitive.set': true,
  'mesh.makeEditable': true,
  'mesh.setAttributes': true,
  'palette.ensureDefault': true,
  'palette.create': true,
  'palette.duplicate': true,
  'palette.rename': true,
  'palette.addSwatch': true,
  'palette.setSwatch': true,
  'palette.removeSwatch': true,
  'palette.assign': true,
  'palette.replaceSwatch': true,
  'palette.setActive': false,
  // SHADING-SPEC §5: Assign New Material.
  'palette.assignMaterial': true,
  'imagePlane.import': true,
  'imagePlane.set': true,
  'imagePlane.delete': true,
  'scene.group': true,
  'scene.parent': true,
  'scene.unparent': true,
  'scene.duplicate': true,
  'scene.delete': true,
  'scene.rename': true,
  'file.exportModel': false,
};

/** M6a operators that act anywhere (key scope 'global'); every other M6a operator is in the 'model' scope. */
const M6A_GLOBAL: ReadonlySet<string> = new Set([
  'workspace.set',
  'view.shading',
  'view.display.set',
  'ui.commandPalette',
  'ui.markingMenu',
  'edit.adjustLast',
  'edit.repeatLast',
  'file.exportModel',
]);

/** §4.9 operators registered by other work packages (menus and keymaps may name them). */
const OTHERS: ReadonlySet<string> = new Set([
  'select.curveKeys',
  'time.selectBand',
  'graph.frame',
  'view.layout',
  'view.toggleMaximize',
  'view.frame',
  'view.display.toggle',
  'view.lookThrough',
  'view.copyViewToShot',
  'view.toggleCameraLock',
  'view.cameraRadial',
  'ui.open',
  'ui.close',
  // M2a: registered by the curve-editor contribution functions (M2A-SPEC §3 rule 2)
  'dopeSheet.frame',
  'graph.view.setMode',
  // layout presets: registered by the shell (docs/LAYOUT-PRESETS.md)
  'workspace.toggleFocus',
  'workspace.preset.apply',
  'view.toggleFullscreen',
]);

/** The built-in menu data: the eager items and the Model items of the Model operators chunk (M6A-INT-13). */
const ALL_MENU_ITEMS = [...BUILTIN_MENU_ITEMS, ...MODEL_MENU_ITEMS];

describe('built-in operators', () => {
  it('registers every §4.9 operator owned by WP-7b with its undo flag, plus the requested additions', () => {
    const app = createFakeEditorApp({ snapshot: waveDoc(), skeleton: humanoidSkeleton() });
    const dispose = registerBuiltinOperators(app);
    const ids = app.operators.list().map((def) => def.id);
    expect([...ids].sort()).toEqual(
      [
        ...Object.keys(CATALOG),
        ...Object.keys(ADDITIONS),
        ...Object.keys(M2A_OPERATORS),
        ...Object.keys(M6A_OPERATORS),
      ].sort(),
    );
    for (const [id, undo] of Object.entries({ ...ADDITIONS, ...M2A_OPERATORS, ...M6A_OPERATORS })) {
      expect([id, app.operators.get(id)?.flags?.undo === true]).toEqual([id, undo]);
    }
    for (const [id, undo] of Object.entries(CATALOG)) {
      expect([id, app.operators.get(id)?.flags?.undo === true]).toEqual([id, undo]);
    }
    dispose();
    expect(app.operators.list()).toEqual([]);
  });

  it('gives every operator a label, a description, a category and a scope', () => {
    for (const def of BUILTIN_OPERATORS) {
      expect({
        id: def.id,
        label: def.label !== '',
        description: (def.description ?? '') !== '',
        category: def.category,
        scope: def.scope,
      }).toEqual({
        id: def.id,
        label: true,
        description: true,
        category: def.id.split('.')[0],
        scope: def.id in M6A_OPERATORS && !M6A_GLOBAL.has(def.id) ? 'model' : 'global',
      });
    }
  });

  it('leaves operators that are already registered alone', () => {
    const app = createFakeEditorApp({ snapshot: waveDoc(), skeleton: humanoidSkeleton() });
    const own = {
      id: 'key.set' as const,
      label: 'Host key',
      category: 'key',
      scope: 'global',
      apply: () => ({ count: 7 }),
    };
    app.operators.register(own);
    const dispose = registerBuiltinOperators(app);
    expect(app.operators.get('key.set')?.label).toBe('Host key');
    dispose();
    expect(app.operators.get('key.set')?.label).toBe('Host key');
  });

  it('never throws from poll, whatever the arguments', () => {
    const app = opsApp();
    const ctx: OperatorContext = { app, panel: null, paneId: null };
    const garbage: unknown[] = [undefined, null, 0, 'x', [], {}, { ids: 'a' }, { frame: Number.NaN }, { mode: 'x' }];
    for (const def of BUILTIN_OPERATORS) {
      for (const args of garbage) {
        let thrown: unknown = null;
        try {
          def.poll?.(ctx, args);
        } catch (error) {
          // A sibling package's WP-0a stub is not the poll's fault (it lands before WP-7b, §8.1).
          if (!isStub(error)) thrown = error;
        }
        expect([def.id, args, thrown]).toEqual([def.id, args, null]);
      }
    }
  });

  it('never fails with an internal error on untyped arguments', async () => {
    const garbage: unknown[] = [undefined, null, 1, {}, { ids: [1], mode: 'replace' }, { edits: [{}] }];
    for (const def of BUILTIN_OPERATORS) {
      for (const args of garbage) {
        const app = opsApp();
        const result = await app.runUntyped(def.id, args);
        const internal = result.status === 'failed' && result.error.code === 'internal';
        expect([def.id, args, internal ? result : null]).toEqual([def.id, args, null]);
        app.dispose();
      }
    }
  });
});

describe('registerBuiltins', () => {
  it('contributes operators, importers, exporters, profiles, menu items and the maya keymap', async () => {
    // The Model menu items register once the Model operators chunk has loaded (M6A-INT-13).
    await loadModelOperators();
    const app = kernelApp({ snapshot: waveDoc() });
    const before = app.keymap.bindings().length;
    const dispose = registerBuiltins(app);
    expect(app.operators.get('key.set')).toBeDefined();
    expect(app.importers.list().map((def) => def.id)).toEqual(BUILTIN_IMPORTERS.map((def) => def.id));
    expect(app.exporters.list().map((def) => def.id)).toEqual(['bake-into-model', 'animation-glb', 'vrma']);
    expect(app.exportProfiles.list().map((def) => def.id)).toEqual(BUILTIN_EXPORT_PROFILES.map((def) => def.id));
    expect(app.menus.list()).toHaveLength(ALL_MENU_ITEMS.length);
    // M6b C7 (M6B-C7-15): the Rig & Skin shadow rows come with the preset.
    expect(app.keymap.bindings().length).toBe(before + MAYA_KEYMAP.length + RIG_SHADOW_KEYMAP.length);
    dispose();
    expect(app.operators.list()).toEqual([]);
    expect(app.importers.list()).toEqual([]);
    expect(app.exporters.list()).toEqual([]);
    expect(app.menus.list()).toEqual([]);
    expect(app.keymap.bindings().length).toBe(before);
  });

  it('runs from the kernel when an app is created with builtins (the default)', () => {
    const app = kernelApp({ snapshot: waveDoc(), options: { builtins: true } });
    expect(app.operators.get('file.importModel')).toBeDefined();
    expect(app.exporters.get('vrma')).toBeDefined();
    expect(app.keymap.bindings().some((binding) => binding.op === 'key.set')).toBe(true);
  });

  it('lists exporters with their kinds', () => {
    expect(BUILTIN_EXPORTERS.map((def) => [def.id, def.label])).toEqual([
      ['bake-into-model', 'Bake into model'],
      ['animation-glb', 'Animation-only GLB'],
      ['vrma', 'VRMA (one file per clip)'],
    ]);
  });

  it('builds menu items for registered (or other packages’) operators only, with unique ids', () => {
    const ids = new Set(BUILTIN_OPERATORS.map((def) => def.id));
    expect(new Set(ALL_MENU_ITEMS.map((item) => item.id)).size).toBe(ALL_MENU_ITEMS.length);
    for (const item of ALL_MENU_ITEMS) {
      const top = item.menu.split('.')[0] ?? '';
      expect({ id: item.id, known: ids.has(item.op) || OTHERS.has(item.op), menu: MENUS.test(top) }).toEqual({
        id: item.id,
        known: true,
        menu: true,
      });
    }
    // The time slider owns its context menu.
    expect(ALL_MENU_ITEMS.some((item) => item.menu === 'timeline.context')).toBe(false);
    // Model's own menus never reach the Animate menu bar.
    for (const item of ALL_MENU_ITEMS.filter((entry) => MODEL_ONLY_MENUS.test(entry.menu.split('.')[0] ?? ''))) {
      expect([item.id, item.workspaces]).toEqual([item.id, ['model']]);
    }
  });

  it('binds keys only to registered operators or to the ones of other packages', () => {
    const ids = new Set(BUILTIN_OPERATORS.map((def) => def.id));
    for (const binding of MAYA_KEYMAP) {
      expect([binding.op, ids.has(binding.op) || OTHERS.has(binding.op)]).toEqual([binding.op, true]);
    }
  });

  it('menu-item arguments pass their operator polls', () => {
    const app = opsApp();
    const ctx: OperatorContext = { app, panel: null, paneId: null };
    for (const item of ALL_MENU_ITEMS) {
      const def = app.operators.get(item.op);
      if (def === undefined) continue;
      let result: ReturnType<NonNullable<typeof def.poll>> = true;
      try {
        result = def.poll?.(ctx, item.args) ?? true;
      } catch (error) {
        if (!isStub(error)) throw error;
      }
      if (result === true) continue;
      // Allowed: state-dependent refusals, never argument-shape refusals.
      expect([item.id, /^expects|must be|unknown/.test(result.reason)]).toEqual([item.id, false]);
    }
  });
});

describe('importers', () => {
  it('resolve files by extension, the longest match first', () => {
    const app = kernelApp({ snapshot: waveDoc() });
    registerBuiltins(app);
    const op = (name: string) => resolveImporter(app.importers, name, new Uint8Array(0))?.op ?? null;
    expect(op('Seed-San.VRM')).toBe('file.importModel');
    expect(op('ual.glb')).toBe('file.importModel');
    expect(op('wave.vrma')).toBe('file.importAnimation');
    expect(op('scene.ekzanim')).toBe('file.openProject');
    expect(op('scene.ekzanim.json')).toBe('file.openProject');
    expect(op('notes.json')).toBeNull();
    expect(op('model.fbx')).toBeNull();
  });

  it('sniff .glb files: animation-only files add clips, others are models', () => {
    const app = kernelApp({ snapshot: waveDoc() });
    registerBuiltins(app);
    const id = (bytes: Uint8Array) => resolveImporter(app.importers, 'clip.glb', bytes)?.id;
    expect(id(glbOf({ asset: { version: '2.0' }, animations: [{ channels: [], samplers: [] }] }))).toBe(
      'gltf-animation',
    );
    expect(id(glbOf({ asset: { version: '2.0' }, skins: [{ joints: [0] }], animations: [{}] }))).toBe('gltf-model');
    expect(id(glbOf({ asset: { version: '2.0' } }))).toBe('gltf-model');
    expect(id(new Uint8Array(3))).toBe('gltf-model');
    // An extension's importer with its own sniffer takes the files the built-ins leave.
    app.contribute({
      kind: 'importer',
      def: { id: 'acme.gltf', label: 'Acme', extensions: ['gltf'], op: 'acme.importGltf', sniff: () => true },
    });
    expect(resolveImporter(app.importers, 'scene.gltf', new Uint8Array(0))?.id).toBe('acme.gltf');
  });
});
