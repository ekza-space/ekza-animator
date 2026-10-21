// The Rig & Skin rows of the `maya` preset (M6B-SPEC §7, cut to the MVP operators of §0.6; C7). Contributed by the
// rig-workspace chunk when it loads (`app.rig.load()`), so none of it is in the eager route; every row's scope starts
// with `rig`, so Model and Animate never see them. Chain over a pane (CR-4): `rig.viewport.<mode>` → `rig.viewport` →
// `viewport` → `rig` → `global`; over a panel `rig.<panel>` → `<panel>` → `rig` → `global`.
//
// Keying is impossible in Rig & Skin (§5.17): every shipped chord that keys, mirrors or pastes a pose resolves to
// `rig.animateOnly` — in the viewport (`rig.viewport`, §7) and, beyond the §7 table, over every panel whose shipped
// rows key (Outliner, Channel Box, time slider, Dope Sheet, Graph Editor), so `S` keys nothing in any Rig scope.
// Deferred rows (Shapes `3`, the Joint tool, Delete Joint, Duplicate, Parent, pick-walk over joints, Paint Select,
// copy/paste vertex weights) are not bound (Q-MVP-15). Never bound: `Alt+F`, `Shift+B`.
import type { Chord, KeyBinding, KeyScope, OperatorId } from '../types';

/** The Rig & Skin scopes of §7 (`r`, `rv`, `rvj`, `rvw`, `ro`, `rpw`). */
export const RIG_SCOPE = {
  rig: 'rig',
  viewport: 'rig.viewport',
  skeleton: 'rig.viewport.skeleton',
  skin: 'rig.viewport.skin',
  outliner: 'rig.outliner',
  channelBox: 'rig.channelBox',
  timeline: 'rig.timeline',
  dopeSheet: 'rig.dopeSheet',
  graph: 'rig.graph',
  paintWeights: 'rig.paintWeights',
} as const;

const RV = RIG_SCOPE.viewport;
const RVJ = RIG_SCOPE.skeleton;
const RVW = RIG_SCOPE.skin;
const RO = RIG_SCOPE.outliner;

const rows: KeyBinding[] = [];
function bind(chords: readonly Chord[], op: OperatorId, scopes: readonly KeyScope[], args?: unknown): void {
  for (const chord of chords) {
    for (const scope of scopes) rows.push({ chord, op, scope, ...(args === undefined ? {} : { args }) });
  }
}
const key = (code: string, mods: Omit<Chord, 'code'> = {}): Chord => ({ code, ...mods });

// Modes (§5.24): F8 object ↔ last mode; 1/2 Skeleton/Skin, the active digit again → Object.
bind([key('F8')], 'rig.mode', [RV], { mode: 'toggle' });
bind([key('Digit1')], 'rig.mode', [RV], { mode: 'skeleton' });
bind([key('Digit2')], 'rig.mode', [RV], { mode: 'skin' });
// The Model habits that carry over.
bind([key('KeyG')], 'edit.repeatLast', [RV]);
bind([key('KeyT')], 'view.lastOpCard', [RV], { expand: true, focusPrimary: true });
bind([key('KeyY')], 'tool.last', [RV]);
// Skin mode (C6's operators).
bind([key('KeyE')], 'skin.testRotate.toggle', [RVW]);
for (const direction of ['up', 'down', 'left', 'right'] as const) {
  const code = `Arrow${direction.charAt(0).toUpperCase()}${direction.slice(1)}`;
  bind([key(code)], 'skin.influence.walk', [RVW, RIG_SCOPE.paintWeights], { direction });
}
bind([key('KeyC', { alt: true })], 'view.display.toggle', [RVW], { flag: 'weights' });
bind([key('KeyR', { alt: true })], 'skin.paint.mirrorToggle', [RVW]);
bind([key('KeyA', { alt: true })], 'view.display.toggle', [RVW], { flag: 'wireOnShaded' });
// Skeleton mode (C3's selection).
bind([key('KeyA', { mod: true })], 'select.joints', [RVJ], { all: true });
// Hide, show, isolate (the M6a operators).
bind([key('KeyH')], 'view.hide', [RV, RO], { target: 'selected' });
bind([key('KeyH', { shift: true })], 'view.showAll', [RV, RO]);
bind([key('KeyH', { alt: true })], 'view.hide', [RV, RO], { target: 'unselected' });
bind([key('KeyL', { shift: true })], 'view.isolate', [RV]);

/** The chords that key, mirror or paste a pose in Animate (§7 row `rig.animateOnly`). */
export const KEYING_CHORDS: readonly Chord[] = [
  key('KeyS'),
  key('KeyW', { shift: true }),
  key('KeyE', { shift: true }),
  key('KeyR', { shift: true }),
  key('KeyS', { alt: true }),
  key('KeyM', { alt: true }),
  key('KeyV', { mod: true, shift: true }),
  key('KeyC', { mod: true }),
  key('KeyV', { mod: true }),
];
const KEYING_SCOPES: readonly KeyScope[] = [
  RV,
  RO,
  RIG_SCOPE.channelBox,
  RIG_SCOPE.timeline,
  RIG_SCOPE.dopeSheet,
  RIG_SCOPE.graph,
];
bind(KEYING_CHORDS, 'rig.animateOnly', KEYING_SCOPES);
// Key deletion (Delete/Backspace delete keys in the viewport, Channel Box, time slider, Dope Sheet and Graph Editor).
bind(
  [key('Delete'), key('Backspace')],
  'rig.animateOnly',
  KEYING_SCOPES.filter((scope) => scope !== RO),
);

/** The Rig & Skin rows (§7, MVP). */
export const RIG_KEYMAP: readonly KeyBinding[] = Object.freeze(rows.map((row) => Object.freeze(row)));
