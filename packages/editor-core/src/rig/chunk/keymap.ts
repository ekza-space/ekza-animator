// The Rig & Skin rows of the `dcc` preset that come with the rig-workspace chunk (M6B-SPEC §7, cut to the MVP
// operators of §0.6; C7). The shadow rows (`S` and the other keying chords → `rig.animateOnly`) are eager
// (`keymap/dcc.rig.ts`, M6B-C7-15). Rows of operators whose owners have not landed are bound anyway and poll-fail
// until they do (§7). Deferred rows (Shapes `3`, the Joint tool, Delete Joint, Duplicate, Parent, pick-walk over
// joints, Paint Select, copy/paste vertex weights) are not bound (Q-MVP-15). Never bound: `Alt+F`, `Shift+B`.
import { RIG_SCOPE, rigKey as key, rigRows } from '../../keymap/dcc.rig';
import type { KeyBinding } from '../../types';

const RV = RIG_SCOPE.viewport;
const RVJ = RIG_SCOPE.skeleton;
const RVW = RIG_SCOPE.skin;
const RO = RIG_SCOPE.outliner;
const RPW = RIG_SCOPE.paintWeights;

const ARROWS = ['up', 'down', 'left', 'right'] as const;

/** The Rig & Skin rows of the chunk (§7, MVP). */
export const RIG_KEYMAP: readonly KeyBinding[] = Object.freeze([
  // Modes (§5.24): F8 object ↔ last mode; 1/2 Skeleton/Skin, the active digit again → Object.
  ...rigRows([key('F8')], 'rig.mode', [RV], { mode: 'toggle' }),
  ...rigRows([key('Digit1')], 'rig.mode', [RV], { mode: 'skeleton' }),
  ...rigRows([key('Digit2')], 'rig.mode', [RV], { mode: 'skin' }),
  // The Model habits that carry over.
  ...rigRows([key('KeyG')], 'edit.repeatLast', [RV]),
  ...rigRows([key('KeyT')], 'view.lastOpCard', [RV], { expand: true, focusPrimary: true }),
  ...rigRows([key('KeyY')], 'tool.last', [RV]),
  // Skin mode (C6's operators).
  ...rigRows([key('KeyE')], 'skin.testRotate.toggle', [RVW]),
  ...ARROWS.flatMap((direction) =>
    rigRows(
      [key(`Arrow${direction.charAt(0).toUpperCase()}${direction.slice(1)}`)],
      'skin.influence.walk',
      [RVW, RPW],
      { direction },
    ),
  ),
  ...rigRows([key('Comma', { ctrl: true, shift: true })], 'skin.paint.mode', [RVW, RPW], { step: -1 }),
  ...rigRows([key('Period', { ctrl: true, shift: true })], 'skin.paint.mode', [RVW, RPW], { step: 1 }),
  ...rigRows([key('KeyC', { alt: true })], 'view.display.toggle', [RVW], { flag: 'weights' }),
  ...rigRows([key('KeyR', { alt: true })], 'skin.paint.mirrorToggle', [RVW]),
  ...rigRows([key('KeyA', { alt: true })], 'view.display.toggle', [RVW], { flag: 'wireOnShaded' }),
  // Points (Skin mode; the M6a component operators).
  ...rigRows([key('Period', { shift: true })], 'select.mesh.grow', [RVW]),
  ...rigRows([key('Comma', { shift: true })], 'select.mesh.shrink', [RVW]),
  // Select all: joints (Skeleton), points (Skin), controls (Object; `select.all` is the shipped "every visible control
  // of the character", the contract's `select.controls` takes ids only).
  ...rigRows([key('KeyA', { mod: true })], 'select.joints', [RVJ], { all: true }),
  ...rigRows([key('KeyA', { mod: true })], 'select.mesh.all', [RVW]),
  ...rigRows([key('KeyA', { mod: true })], 'select.all', [RV]),
  // Hide, show, isolate (the M6a operators with their Rig variants: objects, joints in Skeleton mode, the faces of the
  // selected points in Skin mode).
  ...rigRows([key('KeyH')], 'view.hide', [RV, RO], { target: 'selected' }),
  ...rigRows([key('KeyH', { shift: true })], 'view.showAll', [RV, RO]),
  ...rigRows([key('KeyH', { alt: true })], 'view.hide', [RV, RO], { target: 'unselected' }),
  ...rigRows([key('KeyL', { shift: true })], 'view.isolate', [RV]),
]);
