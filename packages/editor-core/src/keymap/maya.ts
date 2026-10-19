// The `maya` keymap preset: MVP-SPEC §4.10, the M2A-SPEC §6 and the M6A-SPEC §7 additions as data. Chords use `KeyboardEvent.code`;
// `mod` is Cmd on macOS and Ctrl elsewhere. A more specific scope wins over 'global' (KeymapManager.resolve).
import type { Chord, KeyBinding, KeyScope, KeyTrigger, OperatorId } from '../types';
import { MODEL_SCOPE } from './scopes';

const V = 'viewport';
const G = 'graph';
const T = 'timeline';
const O = 'outliner';
const C = 'channelBox';
const D = 'dopeSheet';
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

// ---------- M2a additions (M2A-SPEC §6; D = Dope Sheet) ----------
// Arrows: pick-walk in the viewport and Channel Box (select.pickWalk itself runs the time operators when
// prefs.arrowKeys is 'frames', §5.17); key nudge in the Graph Editor, Dope Sheet and time slider.
const ARROWS = [
  ['ArrowUp', 'up'],
  ['ArrowDown', 'down'],
  ['ArrowLeft', 'left'],
  ['ArrowRight', 'right'],
] as const;
for (const [code, direction] of ARROWS) {
  bind([key(code)], 'select.pickWalk', [V, C], { direction });
  bind([key(code, { shift: true })], 'select.pickWalk', [V, C], { direction, add: true });
}
bind([key('ArrowLeft')], 'graph.keys.move', [G, D, T], { dFrames: -1, dValue: 0 });
bind([key('ArrowRight')], 'graph.keys.move', [G, D, T], { dFrames: 1, dValue: 0 });
bind([key('KeyS', { alt: true })], 'key.set', [V, O, C, T, D], { breakdown: true });
bind([key('KeyQ')], 'view.tool', [D], { panel: 'dopeSheet', tool: 'select' });
bind([key('KeyW')], 'view.tool', [D], { panel: 'dopeSheet', tool: 'move' });
bind([key('KeyR')], 'view.tool', [D], { panel: 'dopeSheet', tool: 'scale' });
bind([key('KeyR')], 'view.tool', [G], { panel: 'graph', tool: 'scale' });
bind([key('KeyN')], 'graph.view.setMode', [G], { mode: 'toggleNormalized' });
bind([key('KeyN', { shift: true })], 'graph.view.setMode', [G], { mode: 'toggleStacked' });
bind([key('KeyS')], 'key.set', [D], { channels: 'all' });
bind([key('Delete'), key('Backspace')], 'graph.keys.delete', [D]);
bind([key('KeyC', { mod: true })], 'graph.keys.copy', [D]);
bind([key('KeyV', { mod: true })], 'graph.keys.paste', [D]);
bind([key('KeyA', { mod: true })], 'select.all', [D]);
TANGENT_DIGITS.forEach((type, i) => bind([key(`Digit${i + 1}`)], 'graph.tangent.set', [D], { type }));
bind([key('KeyF')], 'dopeSheet.frame', [D], { what: 'selection' });
bind([key('KeyA')], 'dopeSheet.frame', [D], { what: 'all' });

// ---------- M6a additions (M6A-SPEC §7; the Model scopes of §5.17) ----------
// m = the whole Model workspace, mv = its viewport, mvc = any component mode there, mve/mvf = edge/face mode,
// mo = its Outliner. Rows bind to the §6 operators (stubs until their owners land). `V`/`ANY` rows reach Animate too:
// the §3 rule 10 changes (`R` Scale tool, `4`–`7` shading, `Mod+Shift+E` Export) and `Mod+K` (command palette).
const M = MODEL_SCOPE.model;
const MV = MODEL_SCOPE.viewport;
const MVC = MODEL_SCOPE.component;
const MO = MODEL_SCOPE.outliner;
const COMPONENTS = ['vertex', 'edge', 'face'] as const;

bind([key('F8')], 'select.mode', [MV], { mode: 'toggle' });
COMPONENTS.forEach((mode, i) => {
  // F9 vertex, F10 edge (F11 is never bound: browser fullscreen); 1/2/3 on every keyboard (Blender habit).
  bind(i < 2 ? [key(`F${9 + i}`), key(`Digit${i + 1}`)] : [key('Digit3')], 'select.mode', [MV], { mode });
  bind([key(`F${9 + i}`, { mod: true })], 'select.mesh.convert', [MVC], { to: mode, mode: 'touching' });
});
(['wire', 'shaded', 'colours', 'lit'] as const).forEach((mode, i) =>
  bind([key(`Digit${4 + i}`)], 'view.shading', [V], { mode }),
);
bind([key('KeyE', { mod: true })], 'mesh.extrude', [M]);
bind([key('KeyE', { mod: true, shift: true })], 'ui.open', [ANY], { dialog: 'export' });
bind([key('KeyB', { mod: true })], 'mesh.bevel', [MVC]);
bind([key('KeyK')], 'view.tool', [MV], { panel: 'viewport', tool: 'multiCut' });
bind([key('KeyM')], 'ui.markingMenu', [MVC], { menu: 'model.merge' });
bind([key('KeyG')], 'edit.repeatLast', [MV]);
bind([key('KeyT')], 'view.lastOpCard', [MV], { expand: true, focusPrimary: true });
bind([key('KeyY')], 'tool.last', [MV]);
bind([key('KeyR')], 'view.tool', [V], { panel: 'viewport', tool: 'scale' });
bind([key('Delete'), key('Backspace')], 'mesh.delete', [MVC]);
bind([key('Delete'), key('Backspace')], 'scene.delete', [MV]);
bind([key('Delete', { mod: true }), key('Backspace', { mod: true })], 'mesh.deleteEdgeVertex', [MVC]);
bind([key('Period', { shift: true })], 'select.mesh.grow', [MVC]);
bind([key('Comma', { shift: true })], 'select.mesh.shrink', [MVC]);
bind([key('KeyH')], 'view.hide', [MV, MO], { target: 'selected' });
bind([key('KeyH', { shift: true })], 'view.showAll', [MV, MO]);
bind([key('KeyH', { alt: true })], 'view.hide', [MV, MO], { target: 'unselected' });
bind([key('KeyL', { shift: true })], 'view.isolate', [MV]);
bind([key('ArrowRight', { ctrl: true, alt: true })], 'mesh.spinEdge', [MODEL_SCOPE.edge], { direction: 'forward' });
bind([key('ArrowLeft', { ctrl: true, alt: true })], 'mesh.spinEdge', [MODEL_SCOPE.edge], { direction: 'back' });
for (const [code, direction] of ARROWS) bind([key(code)], 'select.mesh.pickWalk', [MVC], { direction });
bind([key('KeyD', { mod: true })], 'scene.duplicate', [MV, MO]);
bind([key('KeyD', { mod: true })], 'mesh.duplicateFaces', [MODEL_SCOPE.face]);
bind([key('KeyG', { mod: true })], 'scene.group', [MV, MO]);
bind([key('KeyP')], 'scene.parent', [MV, MO]);
bind([key('KeyP', { shift: true })], 'scene.unparent', [MV, MO]);
bind([key('Insert'), key('Home')], 'model.pivot.editToggle', [MV]);
bind([key('KeyB')], 'model.softSelect.toggle', [MV], undefined, 'tap');
bind([key('Backquote')], 'model.selectionStyle.set', [MV], { style: 'toggle' });
// Animate rows that would key, mirror or paste controls the modeler cannot see (§5.17): poll-fail in Model.
bind(
  [
    key('KeyS'),
    key('KeyW', { shift: true }),
    key('KeyE', { shift: true }),
    key('KeyR', { shift: true }),
    key('KeyS', { alt: true }),
    key('KeyM', { alt: true }),
    key('KeyC', { mod: true }),
    key('KeyV', { mod: true }),
    key('KeyV', { mod: true, shift: true }),
  ],
  'model.animateOnly',
  [MV],
);
bind([key('KeyA', { mod: true })], 'select.mesh.all', [MVC]);
bind([key('KeyA', { mod: true })], 'select.objects', [MV], { all: 'meshes', mode: 'replace' });
bind([key('KeyK', { mod: true })], 'ui.commandPalette', [ANY]);

/** The `maya` preset (MVP-SPEC §4.10 + M2A-SPEC §6 + M6A-SPEC §7), registered by `registerBuiltins` through a keymap contribution. */
export const MAYA_KEYMAP: readonly KeyBinding[] = Object.freeze(bindings.map((binding) => Object.freeze(binding)));
