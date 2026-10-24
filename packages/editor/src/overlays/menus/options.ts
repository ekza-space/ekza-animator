// The selection options marking menu `model.options` (M6A-SPEC §8.4; B12a data, B9's generic marking menu draws it):
// Ctrl+Shift+RMB, and `Q`+LMB (the DCC hold-key marking-menu habit; one `MarkingMenuDef` has one trigger, so the
// `Q`+LMB copy is `model.options.lmb` with the same items). Slots N Symmetry: Object X · NE Symmetry: Off · E Soft
// Select ✓ · SE Camera-based ✓ · S Constraint ▸ (stretch items disabled) · SW Backfaces ✓ · W Selection Style ▸
// (Marquee, Tweak; Drag disabled) · NW Symmetry ▸ (World X/Y/Z, Object Y/Z); list Tolerance… · Preserve Seam ✓.
//
// Also the transform tools' space menus (§7 "Pointer gestures": `W`/`E`+LMB; Move and Rotate gain Component, §5.15):
// `model.space.move` (World, Object, Component) and `model.space.rotate` (World, Object, Gimbal, Component). Positions
// are provisional (Q-MOD-UI-1).
import {
  componentSpaceOn,
  type EditorApp,
  type MarkingMenuDef,
  type MarkingMenuItem,
  SYMMETRY_LABELS,
  type SymmetryMode,
  symmetryOf,
  symmetryTargets,
} from '@ekza-studio/editor-core';

/** The symmetry mode the options menu reflects: the first target mesh's (hilite, else selection). */
function currentSymmetry(app: EditorApp): SymmetryMode | null {
  const lead = symmetryTargets(app)[0];
  return lead === undefined ? null : symmetryOf(app, lead).mode;
}

const symmetry = (mode: SymmetryMode, label = `Symmetry: ${SYMMETRY_LABELS[mode]}`): MarkingMenuItem => ({
  label,
  op: 'model.symmetry.set',
  args: { mode },
  checked: (app) => currentSymmetry(app) === mode,
});

const STRETCH_CONSTRAINT = 'Selection constraints arrive later';

const OPTIONS_SLOTS: MarkingMenuDef['slots'] = {
  N: symmetry('object-x'),
  NE: symmetry('off'),
  E: {
    label: 'Soft Select',
    op: 'model.softSelect.toggle',
    checked: (app) => app.session.getState().model.softSelect.on,
  },
  SE: {
    label: 'Camera-based',
    op: 'model.cameraBased.set',
    args: { value: 'toggle' },
    checked: (app) => app.session.getState().model.cameraBased !== 'off',
  },
  S: {
    label: 'Constraint',
    submenu: [
      {
        label: 'Off',
        op: 'model.constraint.set',
        args: { constraint: 'off' },
        checked: (app) => app.session.getState().model.constraint === 'off',
      },
      { label: 'Angle', disabledReason: STRETCH_CONSTRAINT },
      { label: 'Border', disabledReason: STRETCH_CONSTRAINT },
      { label: 'Loop', disabledReason: STRETCH_CONSTRAINT },
      { label: 'Ring', disabledReason: STRETCH_CONSTRAINT },
      { label: 'Shell', disabledReason: STRETCH_CONSTRAINT },
    ],
  },
  SW: {
    label: 'Backfaces',
    op: 'model.backfaces.toggle',
    checked: (app) => app.session.getState().model.backfaces,
  },
  W: {
    label: 'Selection Style',
    submenu: [
      {
        label: 'Marquee',
        op: 'model.selectionStyle.set',
        args: { style: 'marquee' },
        checked: (app) => app.session.getState().model.selectionStyle === 'marquee',
      },
      {
        label: 'Tweak',
        op: 'model.selectionStyle.set',
        args: { style: 'tweak' },
        checked: (app) => app.session.getState().model.selectionStyle === 'tweak',
      },
      { label: 'Drag', disabledReason: 'Drag selection arrives later' },
    ],
  },
  NW: {
    label: 'Symmetry',
    submenu: [
      symmetry('world-x', 'World X'),
      symmetry('world-y', 'World Y'),
      symmetry('world-z', 'World Z'),
      symmetry('object-y', 'Object Y'),
      symmetry('object-z', 'Object Z'),
    ],
  },
};

const OPTIONS_LIST: readonly MarkingMenuItem[] = [
  // The tolerance is typed in the Modeling Tools panel's Symmetry section (B11, `mtk-sym-tol`).
  { label: 'Tolerance…', op: 'workspace.showPanel', args: { panel: 'toolkit' } },
  {
    label: 'Preserve Seam',
    op: 'model.symmetry.set',
    args: { preserveSeam: 'toggle' },
    checked: (app) => {
      const lead = symmetryTargets(app)[0];
      return lead !== undefined && symmetryOf(app, lead).preserveSeam;
    },
  },
];

export const OPTIONS_MENU: MarkingMenuDef = {
  id: 'model.options',
  trigger: { button: 'rmb', mods: 'ctrl+shift' },
  workspaces: ['model'],
  when: { over: 'any' },
  slots: OPTIONS_SLOTS,
  list: OPTIONS_LIST,
};

/** The `Q`+LMB copy of `model.options` (desktop-DCC habit: `Q`+LMB opens the selection options). */
export const OPTIONS_MENU_LMB: MarkingMenuDef = {
  ...OPTIONS_MENU,
  id: 'model.options.lmb',
  trigger: { button: 'lmb', mods: 'none', holdKey: 'KeyQ' },
};

const space = (tool: 'move' | 'rotate', value: 'world' | 'object' | 'gimbal' | 'component'): MarkingMenuItem => ({
  label: value === 'component' ? 'Component' : `${value[0]?.toUpperCase()}${value.slice(1)}`,
  op: 'view.setManipSpace',
  args: { tool, space: value },
  checked: (app) => {
    if (componentSpaceOn(app, tool)) return value === 'component';
    const prefs = app.prefs.getState();
    return (tool === 'move' ? prefs.moveSpace : prefs.rotateSpace) === value;
  },
});

/** `W`+LMB: the Move tool's orientation (§5.15). */
export const MOVE_SPACE_MENU: MarkingMenuDef = {
  id: 'model.space.move',
  trigger: { button: 'lmb', mods: 'none', holdKey: 'KeyW' },
  workspaces: ['model'],
  when: { over: 'any' },
  slots: { N: space('move', 'world'), E: space('move', 'object'), S: space('move', 'component') },
  list: [],
};

/** `E`+LMB: the Rotate tool's orientation. */
export const ROTATE_SPACE_MENU: MarkingMenuDef = {
  id: 'model.space.rotate',
  trigger: { button: 'lmb', mods: 'none', holdKey: 'KeyE' },
  workspaces: ['model'],
  when: { over: 'any' },
  slots: {
    N: space('rotate', 'world'),
    E: space('rotate', 'object'),
    S: space('rotate', 'component'),
    W: space('rotate', 'gimbal'),
  },
  list: [],
};
