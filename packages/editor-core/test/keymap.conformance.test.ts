// Keymap conformance (M6A-SPEC §7 "Conformance test", B0b). The DOM-adapter half of the conformance (real keydown and
// keyup through the editor's KeyboardAdapter) lives with the adapter: `packages/editor/test/input/conformance.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_MENU_ITEMS,
  GLOBAL_SCOPE,
  type KeyBinding,
  type KeyInput,
  MAYA_KEYMAP,
  MODEL_MENU_ITEMS,
  MODEL_MENUS,
  MODEL_SCOPE,
  type MarkingMenuItem,
  registerBuiltinOperators,
  registerBuiltinWorkspaces,
  TOOL_HOLD_CODES,
} from '../src';
import { createFakeEditorApp } from '../src/testing';
import { allAnimateChains, allModelChains, ch, mayaKeymap, resolved } from './keymap-support';
import { PROBE_MODS, probeInput } from './keymap-probes';

/** Operators the shell, the viewport and the curve editor register (not editor-core built-ins). */
const OTHER_PACKAGES: ReadonlySet<string> = new Set([
  'ui.open',
  'ui.close',
  'view.layout',
  'view.toggleMaximize',
  'view.frame',
  'view.display.toggle',
  'view.lookThrough',
  'view.copyViewToShot',
  'view.toggleCameraLock',
  'view.cameraRadial',
  'graph.frame',
  'graph.view.setMode',
  'dopeSheet.frame',
  'select.curveKeys',
  'time.selectBand',
  'workspace.showPanel',
  'workspace.reset',
  // layout presets (docs/LAYOUT-PRESETS.md)
  'workspace.toggleFocus',
  'workspace.preset.apply',
  'view.toggleFullscreen',
]);

const SCOPES_IN_USE = new Set(MAYA_KEYMAP.map((binding) => binding.scope));
const ALL_CHAINS = [...allModelChains(), ...allAnimateChains(), ...[...SCOPES_IN_USE].map((s) => [s, GLOBAL_SCOPE])];
const TRIGGERS = ['press', 'tap', 'hold'] as const;

/** Physical keys a binding may name (no pointer buttons: RMB is never a key, so it never maps to a cancel). */
const KEY_CODE =
  /^(Key[A-Z]|Digit\d|F([1-9]|1[0-2])|Space|Escape|Enter|NumpadEnter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right)|Comma|Period|Slash|Backslash|Minus|Equal|Semicolon|Quote|BracketLeft|BracketRight|Backquote)$/;

/** The fake app contributes the `maya` keymap; the built-in operators and workspaces come on top. */
function builtinApp() {
  const app = createFakeEditorApp();
  registerBuiltinOperators(app);
  registerBuiltinWorkspaces(app);
  return app;
}

describe('keymap conformance (§7)', () => {
  it('binds every chord to a registered operator', () => {
    const app = builtinApp();
    for (const binding of app.keymap.bindings()) {
      const known = app.operators.get(binding.op) !== undefined || OTHER_PACKAGES.has(binding.op);
      expect([binding.op, binding.scope, known]).toEqual([binding.op, binding.scope, true]);
    }
  });

  it('has no two bindings with the same chord, trigger and scope', () => {
    const app = builtinApp();
    const seen = new Map<string, KeyBinding>();
    for (const binding of app.keymap.bindings()) {
      const chord = binding.chord;
      const id = JSON.stringify([
        chord.code,
        chord.mod === true,
        chord.ctrl === true,
        chord.shift === true,
        chord.alt === true,
        binding.scope,
        binding.trigger ?? 'press',
      ]);
      expect([id, seen.get(id) ?? null]).toEqual([id, null]);
      seen.set(id, binding);
    }
  });

  it('never binds a never-bound chord, on either platform, in any scope chain', () => {
    const never = (platform: 'mac' | 'other'): KeyInput[] => {
      const mod = (code: string, extra: Partial<KeyInput> = {}) => ({
        ...probeInput(code, { mod: true }, platform),
        ...extra,
      });
      const ctrl = (code: string) => probeInput(code, { ctrl: true }, platform);
      return [
        mod('KeyR'),
        ctrl('KeyN'),
        ctrl('Tab'),
        mod('KeyI', { shiftKey: true }),
        ...Array.from({ length: 9 }, (_, i) => mod(`Digit${i + 1}`)),
        ctrl('KeyH'),
        ctrl('Digit1'),
        // F11 (fullscreen) and F12 (DevTools) are never bound; §7 binds only Mod+F11 (Convert to Faces, Maya's
        // Ctrl+F11), which the browser leaves alone.
        ...PROBE_MODS.filter((mods) => mods.mod !== true && mods.ctrl !== true).map((mods) =>
          probeInput('F11', mods, platform),
        ),
        ...PROBE_MODS.map((mods) => probeInput('F12', mods, platform)),
        probeInput('Tab', {}, platform),
        probeInput('Tab', { shift: true }, platform),
        ctrl('PageUp'),
        ctrl('PageDown'),
        ...(platform === 'other'
          ? [probeInput('KeyE', { alt: true }, platform), probeInput('KeyF', { alt: true }, platform)]
          : []),
      ];
    };
    for (const platform of ['other', 'mac'] as const) {
      const keymap = mayaKeymap(platform);
      for (const input of never(platform)) {
        for (const chain of ALL_CHAINS) {
          for (const trigger of TRIGGERS) {
            expect([platform, input, chain[0], trigger, keymap.resolve(input, chain, trigger)]).toEqual([
              platform,
              input,
              chain[0],
              trigger,
              null,
            ]);
          }
        }
      }
    }
  });

  it('never runs edit.escape (or anything) from RMB: bindings name keys only, and only Esc escapes', () => {
    for (const binding of MAYA_KEYMAP) {
      expect([binding.chord.code, KEY_CODE.test(binding.chord.code)]).toEqual([binding.chord.code, true]);
    }
    expect(MAYA_KEYMAP.filter((binding) => binding.op === 'edit.escape').map((binding) => binding.chord)).toEqual([
      { code: 'Escape' },
    ]);
    const app = builtinApp();
    const items = (list: readonly MarkingMenuItem[]): MarkingMenuItem[] =>
      list.flatMap((item) => [item, ...items(item.submenu ?? [])]);
    for (const menu of app.markingMenus.list()) {
      for (const item of items([...Object.values(menu.slots), ...menu.list])) {
        expect([menu.id, item.op]).not.toEqual([menu.id, 'edit.escape']);
      }
    }
  });

  it('reaches every Model operator with a menu item from a menu of the Model menu bar', () => {
    const app = builtinApp();
    // The Model items come with the Model operators chunk (M6A-INT-13).
    const model = [...BUILTIN_MENU_ITEMS, ...MODEL_MENU_ITEMS].filter(
      (item) => item.workspaces?.includes('model') === true,
    );
    expect(model.length).toBeGreaterThan(80);
    for (const item of model) {
      const top = item.menu.split('.')[0] ?? '';
      const def = app.operators.get(item.op);
      const registered = def !== undefined || OTHER_PACKAGES.has(item.op);
      expect([item.id, MODEL_MENUS.includes(top), registered]).toEqual([item.id, true, true]);
    }
    // Internal operators are hidden from menus and the palette (ADR 0008): no Model menu item may name one.
    for (const item of model) {
      expect([item.id, app.operators.get(item.op)?.flags?.internal === true]).toEqual([item.id, false]);
    }
  });

  it('resolves Mod+E to mesh.extrude everywhere in Model and to Export everywhere in Animate', () => {
    for (const platform of ['other', 'mac'] as const) {
      const keymap = mayaKeymap(platform);
      for (const chain of allModelChains()) {
        expect([platform, chain[0], resolved(keymap, 'Mod+KeyE', chain)]).toEqual([
          platform,
          chain[0],
          { op: 'mesh.extrude', scope: MODEL_SCOPE.model },
        ]);
        expect(resolved(keymap, 'Mod+Shift+KeyE', chain)).toEqual({
          op: 'ui.open',
          args: { dialog: 'export' },
          scope: GLOBAL_SCOPE,
        });
      }
      for (const chain of allAnimateChains()) {
        expect([platform, chain[0], resolved(keymap, 'Mod+KeyE', chain)]).toEqual([
          platform,
          chain[0],
          { op: 'ui.open', args: { dialog: 'export' }, scope: GLOBAL_SCOPE },
        ]);
      }
    }
  });

  it('reserves the tool modifiers in the Model viewport: no press binding, B only as the soft-select tap', () => {
    const keymap = mayaKeymap();
    const viewport = allModelChains().filter((chain) => chain.includes(MODEL_SCOPE.viewport));
    expect(viewport).toHaveLength(4);
    for (const chain of viewport) {
      for (const code of TOOL_HOLD_CODES) {
        expect([chain[0], code, resolved(keymap, code, chain)]).toEqual([chain[0], code, null]);
        expect([chain[0], code, resolved(keymap, code, chain, 'hold')]).toEqual([chain[0], code, null]);
        const tap = resolved(keymap, code, chain, 'tap');
        expect([chain[0], code, tap?.op ?? null]).toEqual([
          chain[0],
          code,
          code === 'KeyB' ? 'model.softSelect.toggle' : null,
        ]);
      }
    }
    expect(resolved(keymap, ch('KeyB').code, ['graph', GLOBAL_SCOPE])?.op).toBe('graph.tangent.break');
  });
});
