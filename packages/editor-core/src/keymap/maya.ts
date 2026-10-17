// The `maya` keymap preset: MVP-SPEC §4.10 as data. Chords use `KeyboardEvent.code`; `mod` is Cmd on macOS and Ctrl
// elsewhere. A more specific scope wins over 'global' (KeymapManager.resolve).
import type { Chord, KeyBinding, KeyScope, KeyTrigger, OperatorId } from '../types';

const V = 'viewport';
const G = 'graph';
const T = 'timeline';
const O = 'outliner';
const C = 'channelBox';
const ANY = 'global';

const bindings: KeyBinding[] = [];

/** One binding per (chord, scope). */
function bind(
  chords: readonly Chord[],
  op: OperatorId,
  scopes: readonly KeyScope[],
  args?: unknown,
  trigger?: KeyTrigger,
): void {
  for (const chord of chords) {
    for (const scope of scopes) {
      bindings.push({
        chord,
        op,
        scope,
        ...(args === undefined ? {} : { args }),
        ...(trigger === undefined ? {} : { trigger }),
      });
    }
  }
}

const key = (code: string, mods: Omit<Chord, 'code'> = {}): Chord => ({ code, ...mods });

// edit and file
bind([key('KeyZ', { mod: true }), key('KeyZ')], 'edit.undo', [ANY]);
bind([key('KeyZ', { mod: true, shift: true }), key('KeyZ', { shift: true }), key('KeyY', { mod: true })], 'edit.redo', [
  ANY,
]);
bind([key('KeyO', { mod: true })], 'ui.open', [ANY], { dialog: 'open' });
bind([key('KeyI', { mod: true })], 'ui.open', [ANY], { dialog: 'import' });
bind([key('KeyE', { mod: true })], 'ui.open', [ANY], { dialog: 'export' });
bind([key('KeyS', { mod: true })], 'file.save', [ANY]);
bind([key('KeyS', { mod: true, shift: true })], 'file.saveAs', [ANY]);
bind([key('Escape')], 'edit.escape', [ANY]);
bind([key('Slash', { shift: true })], 'ui.open', [ANY], { dialog: 'shortcuts' });

// pose and key clipboards
bind([key('KeyC', { mod: true })], 'pose.copy', [V, O, C]);
bind([key('KeyV', { mod: true })], 'pose.paste', [V, O, C]);
bind([key('KeyC', { mod: true })], 'graph.keys.copy', [G, T]);
bind([key('KeyV', { mod: true })], 'graph.keys.paste', [G, T]);
bind([key('KeyV', { mod: true, shift: true })], 'pose.paste', [V, O, C], { mirrored: true });
bind([key('KeyM', { alt: true })], 'pose.mirror', [V, O], { mode: 'flip' });

// selection and tools
bind([key('KeyA', { mod: true })], 'select.all', [V, O, G]);
bind([key('KeyQ')], 'view.tool', [V], { panel: 'viewport', tool: 'select' });
bind([key('KeyW')], 'view.tool', [V], { panel: 'viewport', tool: 'move' });
bind([key('KeyE')], 'view.tool', [V], { panel: 'viewport', tool: 'rotate' });
bind([key('KeyQ')], 'view.tool', [G], { panel: 'graph', tool: 'select' });
bind([key('KeyW')], 'view.tool', [G], { panel: 'graph', tool: 'move' });
bind([key('KeyI')], 'view.tool', [G], { panel: 'graph', tool: 'insert' });

// keying
bind([key('KeyS')], 'key.set', [V, O, C, T], { channels: 'all' });
bind([key('KeyS')], 'graph.keys.keyCurves', [G]);
bind([key('KeyW', { shift: true })], 'key.set', [V, O, C], { channels: 'translate' });
bind([key('KeyE', { shift: true })], 'key.set', [V, O, C], { channels: 'rotate' });
bind([key('KeyR', { shift: true })], 'key.set', [V, O, C], { channels: 'scale' });
bind([key('KeyK', { shift: true })], 'key.toggleAutoKey', [ANY]);
bind([key('Delete'), key('Backspace')], 'key.deleteAtFrame', [V, C]);
bind([key('Delete'), key('Backspace')], 'graph.keys.delete', [G, T]);

// framing, panes and display
bind([key('KeyF')], 'view.frame', [V], { what: 'selection' });
bind([key('KeyA')], 'view.frame', [V], { what: 'all' });
bind([key('KeyF')], 'graph.frame', [G], { what: 'selection' });
bind([key('KeyA')], 'graph.frame', [G], { what: 'all' });
bind([key('Space')], 'view.toggleMaximize', [ANY], undefined, 'tap');
bind([key('Space')], 'view.cameraRadial', [V], undefined, 'hold');
bind([key('Minus')], 'view.manipulatorSize', [V], { delta: -10 });
bind([key('Equal')], 'view.manipulatorSize', [V], { delta: 10 });
bind([key('KeyX', { alt: true })], 'view.display.toggle', [V], { flag: 'xray' });
bind([key('KeyJ', { alt: true })], 'view.display.toggle', [V], { flag: 'skeleton' });
bind([key('KeyC', { alt: true })], 'view.display.toggle', [V], { flag: 'controls' });
bind([key('KeyL', { alt: true })], 'view.toggleCameraLock', [V]);

// time
bind([key('KeyV', { alt: true })], 'time.togglePlay', [ANY]);
bind([key('KeyV', { alt: true, shift: true }), key('Home')], 'time.goToStart', [ANY]);
bind([key('End')], 'time.goToEnd', [ANY]);
bind([key('Comma')], 'time.prevKey', [ANY]);
bind([key('Period')], 'time.nextKey', [ANY]);
bind([key('Comma', { alt: true })], 'time.step', [ANY], { delta: -1 });
bind([key('Period', { alt: true })], 'time.step', [ANY], { delta: 1 });

// tangents
const TANGENT_DIGITS = ['auto', 'spline', 'clamped', 'linear', 'flat', 'step', 'plateau'] as const;
TANGENT_DIGITS.forEach((type, i) => bind([key(`Digit${i + 1}`)], 'graph.tangent.set', [G, T], { type }));
bind([key('KeyB')], 'graph.tangent.break', [G]);
bind([key('KeyU')], 'graph.tangent.unify', [G]);

/** The `maya` preset (MVP-SPEC §4.10), registered by `registerBuiltins` through a keymap contribution. */
export const MAYA_KEYMAP: readonly KeyBinding[] = Object.freeze(bindings.map((binding) => Object.freeze(binding)));
