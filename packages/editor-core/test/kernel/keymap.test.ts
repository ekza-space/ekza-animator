import { describe, expect, it } from 'vitest';
import { type KeyBinding, type KeyInput, type KeyScope, MAYA_KEYMAP } from '../../src';
import { createKeymapManager } from '../../src/keymap/manager';
import { createFakeEditorApp } from '../../src/testing';

type Mods = Partial<Pick<KeyInput, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'repeat'>>;
const key = (code: string, mods: Mods = {}): KeyInput => ({
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  ...mods,
});
const chain = (panel: KeyScope | null): readonly KeyScope[] => (panel === null ? ['global'] : [panel, 'global']);

function mayaKeymap(platform: 'mac' | 'other') {
  const keymap = createKeymapManager(platform);
  keymap.add(MAYA_KEYMAP);
  return keymap;
}

describe('MAYA_KEYMAP (§4.10)', () => {
  const other = mayaKeymap('other');
  const resolve = (input: KeyInput, panel: KeyScope | null, trigger: 'press' | 'tap' | 'hold' = 'press') => {
    const binding = other.resolve(input, chain(panel), trigger);
    return binding === null ? null : { op: binding.op, args: binding.args };
  };

  it.each([
    // [code, mods, panel, op, args]
    ['KeyZ', { ctrlKey: true }, null, 'edit.undo', undefined],
    ['KeyZ', {}, 'graph', 'edit.undo', undefined],
    ['KeyZ', { ctrlKey: true, shiftKey: true }, null, 'edit.redo', undefined],
    ['KeyZ', { shiftKey: true }, 'viewport', 'edit.redo', undefined],
    ['KeyY', { ctrlKey: true }, null, 'edit.redo', undefined],
    ['KeyO', { ctrlKey: true }, null, 'ui.open', { dialog: 'open' }],
    ['KeyI', { ctrlKey: true }, 'graph', 'ui.open', { dialog: 'import' }],
    ['KeyE', { ctrlKey: true }, 'viewport', 'ui.open', { dialog: 'export' }],
    ['KeyS', { ctrlKey: true }, 'viewport', 'file.save', undefined],
    ['KeyS', { ctrlKey: true, shiftKey: true }, null, 'file.saveAs', undefined],
    ['KeyC', { ctrlKey: true }, 'viewport', 'pose.copy', undefined],
    ['KeyV', { ctrlKey: true }, 'channelBox', 'pose.paste', undefined],
    ['KeyC', { ctrlKey: true }, 'graph', 'graph.keys.copy', undefined],
    ['KeyV', { ctrlKey: true }, 'timeline', 'graph.keys.paste', undefined],
    ['KeyV', { ctrlKey: true, shiftKey: true }, 'outliner', 'pose.paste', { mirrored: true }],
    ['KeyM', { altKey: true }, 'viewport', 'pose.mirror', { mode: 'flip' }],
    ['KeyA', { ctrlKey: true }, 'graph', 'select.all', undefined],
    ['Escape', {}, 'graph', 'edit.escape', undefined],
    ['KeyQ', {}, 'viewport', 'view.tool', { panel: 'viewport', tool: 'select' }],
    ['KeyW', {}, 'viewport', 'view.tool', { panel: 'viewport', tool: 'move' }],
    ['KeyE', {}, 'viewport', 'view.tool', { panel: 'viewport', tool: 'rotate' }],
    ['KeyQ', {}, 'graph', 'view.tool', { panel: 'graph', tool: 'select' }],
    ['KeyW', {}, 'graph', 'view.tool', { panel: 'graph', tool: 'move' }],
    ['KeyI', {}, 'graph', 'view.tool', { panel: 'graph', tool: 'insert' }],
    ['KeyS', {}, 'viewport', 'key.set', { channels: 'all' }],
    ['KeyS', {}, 'timeline', 'key.set', { channels: 'all' }],
    ['KeyS', {}, 'graph', 'graph.keys.keyCurves', undefined],
    ['KeyW', { shiftKey: true }, 'channelBox', 'key.set', { channels: 'translate' }],
    ['KeyE', { shiftKey: true }, 'viewport', 'key.set', { channels: 'rotate' }],
    ['KeyR', { shiftKey: true }, 'outliner', 'key.set', { channels: 'scale' }],
    ['KeyK', { shiftKey: true }, null, 'key.toggleAutoKey', undefined],
    ['Delete', {}, 'viewport', 'key.deleteAtFrame', undefined],
    ['Backspace', {}, 'channelBox', 'key.deleteAtFrame', undefined],
    ['Delete', {}, 'graph', 'graph.keys.delete', undefined],
    ['Backspace', {}, 'timeline', 'graph.keys.delete', undefined],
    ['KeyF', {}, 'viewport', 'view.frame', { what: 'selection' }],
    ['KeyA', {}, 'viewport', 'view.frame', { what: 'all' }],
    ['KeyF', {}, 'graph', 'graph.frame', { what: 'selection' }],
    ['KeyA', {}, 'graph', 'graph.frame', { what: 'all' }],
    ['Minus', {}, 'viewport', 'view.manipulatorSize', { delta: -10 }],
    ['Equal', {}, 'viewport', 'view.manipulatorSize', { delta: 10 }],
    ['KeyX', { altKey: true }, 'viewport', 'view.display.toggle', { flag: 'xray' }],
    ['KeyJ', { altKey: true }, 'viewport', 'view.display.toggle', { flag: 'skeleton' }],
    ['KeyC', { altKey: true }, 'viewport', 'view.display.toggle', { flag: 'controls' }],
    ['KeyL', { altKey: true }, 'viewport', 'view.toggleCameraLock', undefined],
    ['KeyV', { altKey: true }, 'graph', 'time.togglePlay', undefined],
    ['KeyV', { altKey: true, shiftKey: true }, null, 'time.goToStart', undefined],
    ['Home', {}, null, 'time.goToStart', undefined],
    ['End', {}, 'timeline', 'time.goToEnd', undefined],
    ['Comma', {}, null, 'time.prevKey', undefined],
    ['Period', {}, 'viewport', 'time.nextKey', undefined],
    ['Comma', { altKey: true }, null, 'time.step', { delta: -1 }],
    ['Period', { altKey: true }, null, 'time.step', { delta: 1 }],
    ['Digit1', {}, 'graph', 'graph.tangent.set', { type: 'auto' }],
    ['Digit2', {}, 'graph', 'graph.tangent.set', { type: 'spline' }],
    ['Digit3', {}, 'timeline', 'graph.tangent.set', { type: 'clamped' }],
    ['Digit4', {}, 'graph', 'graph.tangent.set', { type: 'linear' }],
    ['Digit5', {}, 'graph', 'graph.tangent.set', { type: 'flat' }],
    ['Digit6', {}, 'timeline', 'graph.tangent.set', { type: 'step' }],
    ['Digit7', {}, 'graph', 'graph.tangent.set', { type: 'plateau' }],
    ['KeyB', {}, 'graph', 'graph.tangent.break', undefined],
    ['KeyU', {}, 'graph', 'graph.tangent.unify', undefined],
    ['Slash', { shiftKey: true }, 'graph', 'ui.open', { dialog: 'shortcuts' }],
  ] as const)('%s %j over %s → %s', (code, mods, panel, op, args) => {
    expect(resolve(key(code, mods), panel)).toEqual({ op, args });
  });

  it('binds panel keys only in their panels', () => {
    expect(resolve(key('KeyS'), 'attributes')).toBeNull();
    expect(resolve(key('KeyS'), null)).toBeNull();
    expect(resolve(key('KeyB'), 'viewport')).toBeNull();
    expect(resolve(key('Digit1'), 'viewport')).toBeNull();
    expect(resolve(key('KeyM', { altKey: true }), 'channelBox')).toBeNull();
    expect(resolve(key('KeyA', { ctrlKey: true }), 'channelBox')).toBeNull();
  });

  it('resolves Space by trigger: tap maximizes anywhere, hold opens the viewport radial, press is unbound', () => {
    expect(resolve(key('Space'), 'graph', 'tap')?.op).toBe('view.toggleMaximize');
    expect(resolve(key('Space'), 'viewport', 'tap')?.op).toBe('view.toggleMaximize');
    expect(resolve(key('Space'), 'viewport', 'hold')?.op).toBe('view.cameraRadial');
    expect(resolve(key('Space'), 'graph', 'hold')).toBeNull();
    expect(resolve(key('Space'), 'viewport', 'press')).toBeNull();
    const noMods = { mod: false, shift: false, alt: false, ctrl: false };
    expect(other.isTapHoldKey('Space', ['viewport', 'global'], noMods)).toBe(true);
    expect(other.isTapHoldKey('KeyS', ['viewport', 'global'], noMods)).toBe(false);
  });

  it('never binds browser- and OS-reserved chords', () => {
    const reserved: [string, Mods][] = [
      ...['KeyW', 'KeyT', 'KeyN', 'KeyQ', 'KeyH', 'KeyM', 'KeyL', 'KeyR'].map((code): [string, Mods] => [
        code,
        { ctrlKey: true },
      ]),
      ...Array.from({ length: 9 }, (_, i): [string, Mods] => [`Digit${i + 1}`, { ctrlKey: true }]),
      ['Tab', { ctrlKey: true }],
      ['ArrowLeft', { altKey: true }],
      ['ArrowRight', { altKey: true }],
      ['Space', { ctrlKey: true }],
      ['KeyE', { altKey: true }],
      ['KeyF', { altKey: true }],
      ...Array.from({ length: 12 }, (_, i): [string, Mods] => [`F${i + 1}`, {}]),
    ];
    const scopes = ['viewport', 'graph', 'timeline', 'outliner', 'channelBox', 'clips', 'attributes'];
    for (const [code, mods] of reserved) {
      for (const scope of scopes) {
        for (const trigger of ['press', 'tap', 'hold'] as const) {
          expect(
            other.resolve(key(code, mods), [scope, 'global'], trigger),
            `${code} ${JSON.stringify(mods)}`,
          ).toBeNull();
        }
      }
    }
  });

  it('has no duplicate (chord, scope, trigger) bindings', () => {
    const seen = new Set<string>();
    for (const binding of MAYA_KEYMAP) {
      const id = JSON.stringify([binding.chord, binding.scope, binding.trigger ?? 'press']);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(Object.isFrozen(MAYA_KEYMAP)).toBe(true);
  });
});

describe('KeymapManager', () => {
  it('maps mod to Cmd on macOS and to Ctrl elsewhere; modifiers must match exactly', () => {
    const mac = mayaKeymap('mac');
    const other = mayaKeymap('other');
    expect(mac.resolve(key('KeyZ', { metaKey: true }), ['global'], 'press')?.op).toBe('edit.undo');
    expect(mac.resolve(key('KeyZ', { ctrlKey: true }), ['global'], 'press')).toBeNull();
    expect(other.resolve(key('KeyZ', { ctrlKey: true }), ['global'], 'press')?.op).toBe('edit.undo');
    expect(other.resolve(key('KeyZ', { metaKey: true }), ['global'], 'press')).toBeNull();
    expect(other.resolve(key('KeyZ', { ctrlKey: true, altKey: true }), ['global'], 'press')).toBeNull();
    // macOS Option produces other characters, but `code` stays the physical key.
    expect(mac.resolve(key('KeyV', { altKey: true }), ['viewport', 'global'], 'press')?.op).toBe('time.togglePlay');
  });

  it('matches a literal ctrl chord only with Ctrl on macOS', () => {
    const mac = createKeymapManager('mac');
    const other = createKeymapManager('other');
    const binding: KeyBinding = { chord: { code: 'KeyG', ctrl: true }, op: 'test.ctrl', scope: 'global' };
    mac.add([binding]);
    other.add([binding]);
    expect(mac.resolve(key('KeyG', { ctrlKey: true }), ['global'], 'press')?.op).toBe('test.ctrl');
    expect(mac.resolve(key('KeyG', { metaKey: true }), ['global'], 'press')).toBeNull();
    expect(other.resolve(key('KeyG', { ctrlKey: true }), ['global'], 'press')?.op).toBe('test.ctrl');
  });

  it('prefers the most specific scope, then overrides over preference bindings over later contributions', () => {
    const keymap = createKeymapManager('other');
    const bind = (op: string, scope: KeyScope): KeyBinding => ({
      chord: { code: 'KeyG' },
      op: op as KeyBinding['op'],
      scope,
    });
    keymap.add([bind('base.global', 'global'), bind('base.graph', 'graph')]);
    expect(keymap.resolve(key('KeyG'), ['graph', 'global'], 'press')?.op).toBe('base.graph');
    expect(keymap.resolve(key('KeyG'), ['viewport', 'global'], 'press')?.op).toBe('base.global');
    const removeLater = keymap.add([bind('later.global', 'global')]);
    expect(keymap.resolve(key('KeyG'), ['viewport', 'global'], 'press')?.op).toBe('later.global');
    keymap.setPreferenceBindings([bind('pref.global', 'global')]);
    expect(keymap.resolve(key('KeyG'), ['viewport', 'global'], 'press')?.op).toBe('pref.global');
    keymap.setOverrides([bind('user.global', 'global')]);
    expect(keymap.resolve(key('KeyG'), ['viewport', 'global'], 'press')?.op).toBe('user.global');
    // A global override never beats a more specific scope.
    expect(keymap.resolve(key('KeyG'), ['graph', 'global'], 'press')?.op).toBe('base.graph');
    keymap.setOverrides([]);
    keymap.setPreferenceBindings([]);
    removeLater();
    removeLater();
    expect(keymap.resolve(key('KeyG'), ['viewport', 'global'], 'press')?.op).toBe('base.global');
    expect(keymap.bindings().map((b) => b.op)).toEqual(['base.global', 'base.graph']);
  });

  it('fires only repeatable operators on auto-repeat', () => {
    const keymap = mayaKeymap('other');
    const repeat = { repeat: true };
    expect(keymap.resolve(key('Period', { altKey: true, ...repeat }), ['global'], 'press')?.op).toBe('time.step');
    expect(keymap.resolve(key('Period', repeat), ['global'], 'press')?.op).toBe('time.nextKey');
    expect(keymap.resolve(key('KeyZ', { ctrlKey: true, ...repeat }), ['global'], 'press')?.op).toBe('edit.undo');
    expect(keymap.resolve(key('Equal', repeat), ['viewport', 'global'], 'press')?.op).toBe('view.manipulatorSize');
    expect(keymap.resolve(key('KeyV', { altKey: true, ...repeat }), ['global'], 'press')).toBeNull();
    expect(keymap.resolve(key('KeyS', repeat), ['viewport', 'global'], 'press')).toBeNull();
  });

  it.each([
    [{ code: 'KeyS', mod: true, shift: true }, 'Ctrl+Shift+S', '⇧⌘S'],
    [{ code: 'KeyZ', mod: true }, 'Ctrl+Z', '⌘Z'],
    [{ code: 'KeyV', alt: true, shift: true }, 'Alt+Shift+V', '⌥⇧V'],
    [{ code: 'KeyG', ctrl: true, alt: true, shift: true, mod: true }, 'Ctrl+Alt+Shift+G', '⌃⌥⇧⌘G'],
    [{ code: 'Digit4' }, '4', '4'],
    [{ code: 'Period', alt: true }, 'Alt+.', '⌥.'],
    [{ code: 'Slash', shift: true }, 'Shift+/', '⇧/'],
    [{ code: 'Delete' }, 'Del', '⌦'],
    [{ code: 'Backspace' }, 'Backspace', '⌫'],
    [{ code: 'Escape' }, 'Esc', 'Esc'],
    [{ code: 'Space' }, 'Space', 'Space'],
    [{ code: 'Home' }, 'Home', 'Home'],
    [{ code: 'ArrowLeft' }, '←', '←'],
    [{ code: 'Numpad3' }, 'Num 3', 'Num 3'],
    [{ code: 'F5' }, 'F5', 'F5'],
  ])('labels %j as %s / %s', (chord, other, mac) => {
    expect(createKeymapManager('other').label(chord)).toBe(other);
    expect(createKeymapManager('mac').label(chord)).toBe(mac);
  });
});

describe('keymap preferences in the app', () => {
  it('turns a Space tap into play/stop when spaceBehaviour is play, and back', () => {
    const app = createFakeEditorApp();
    expect(app.keymap.resolve(key('Space'), ['viewport', 'global'], 'tap')?.op).toBe('view.toggleMaximize');
    app.prefs.setState({ spaceBehaviour: 'play' });
    expect(app.keymap.resolve(key('Space'), ['viewport', 'global'], 'tap')?.op).toBe('time.togglePlay');
    expect(app.keymap.resolve(key('Space'), ['viewport', 'global'], 'hold')?.op).toBe('view.cameraRadial');
    app.prefs.setState({ spaceBehaviour: 'maya' });
    expect(app.keymap.resolve(key('Space'), ['graph', 'global'], 'tap')?.op).toBe('view.toggleMaximize');
  });

  it('keeps user overrides and preferences in sync both ways', () => {
    const app = createFakeEditorApp();
    const override: KeyBinding = { chord: { code: 'KeyS' }, op: 'acme.save', scope: 'viewport' };
    app.prefs.setState({ keymapOverrides: [override] });
    expect(app.keymap.resolve(key('KeyS'), ['viewport', 'global'], 'press')?.op).toBe('acme.save');
    const other: KeyBinding = { chord: { code: 'KeyK' }, op: 'acme.k', scope: 'global' };
    app.keymap.setOverrides([other]);
    expect(app.prefs.getState().keymapOverrides).toEqual([other]);
    expect(app.keymap.resolve(key('KeyS'), ['viewport', 'global'], 'press')?.op).toBe('key.set');
    expect(app.keymap.bindings().at(-1)).toEqual(other);
  });
});
