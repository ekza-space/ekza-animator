// B0b (M6A-SPEC §8.1, §8.3): the Model menu set as data. The menu bar's per-workspace filtering is tested with the
// shell (`packages/editor/test/input/menu-sets.test.ts`).
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_MENU_ITEMS,
  type ComponentMode,
  MAYA_KEYMAP,
  type MenuItemDef,
  MODEL_MENUS,
  registerBuiltinOperators,
} from '../src';
import { createFakeEditorApp } from '../src/testing';
import { ch, sameChord, stableKeyOf } from './keymap-support';

const app = createFakeEditorApp();
registerBuiltinOperators(app);

const MODEL_ITEMS = BUILTIN_MENU_ITEMS.filter((item) => item.workspaces?.includes('model') === true);
const label = (item: MenuItemDef): string => item.label ?? app.operators.get(item.op)?.label ?? item.op;

/** Items of one menu (or sub-menu) in order, as `label` or `label [modes]`. */
function menu(id: string): string[] {
  return MODEL_ITEMS.filter((item) => item.menu === id)
    .sort((a, b) => a.order - b.order)
    .map((item) => (item.modes === undefined ? label(item) : `${label(item)} [${item.modes.join(' ')}]`));
}

describe('Model menus (§8.3)', () => {
  it('lists the Model menu bar in the §8.1 order', () => {
    expect(MODEL_MENUS).toEqual([
      'file',
      'edit',
      'create',
      'select',
      'modify',
      'display',
      'mesh',
      'edit-mesh',
      'mesh-tools',
      'mesh-display',
      'uv',
      'windows',
      'help',
    ]);
    const tops = new Set(MODEL_ITEMS.map((item) => item.menu.split('.')[0]));
    for (const top of tops) expect(MODEL_MENUS).toContain(top);
  });

  it('gives every Model item a unique id, workspaces [model] and a registered operator', () => {
    expect(new Set(MODEL_ITEMS.map((item) => item.id)).size).toBe(MODEL_ITEMS.length);
    for (const item of MODEL_ITEMS) {
      expect([item.id, item.workspaces]).toEqual([item.id, ['model']]);
      const known = app.operators.get(item.op) !== undefined || item.op === 'view.display.toggle';
      expect([item.id, known]).toEqual([item.id, true]);
    }
  });

  it.each([
    [
      'edit',
      [
        'Adjust Last Operation',
        'Repeat Last',
        'Last Tool',
        'Duplicate',
        'Group',
        'Parent',
        'Unparent',
        'Delete [object]',
        'Delete [vertex edge face]',
      ],
    ],
    ['create', ['Empty Group']],
    ['create.polygon-primitives', ['Cube', 'Sphere', 'Cylinder', 'Cone', 'Plane', 'Torus']],
    [
      'create.templates',
      ['Prop', 'Handheld', 'Humanoid Guides', 'Humanoid Body (Smooth)', 'Humanoid Body (Segmented)'],
    ],
    ['create.reference-image', ['Front…', 'Side…', 'Top…']],
    [
      'select',
      [
        'Object Mode',
        'Vertex',
        'Edge',
        'Face',
        'Grow',
        'Shrink',
        'Edge Loop',
        'Edge Ring',
        'Border',
        'Shell',
        'All [object]',
        'All [vertex edge face]',
        'Invert',
        'None',
        'By Swatch',
      ],
    ],
    [
      'select.convert-selection',
      [
        'To Vertices',
        'To Edges',
        'To Faces',
        'To Edge Loop',
        'To Edge Ring',
        'To Shell',
        'To Border',
        'Contained Edges',
        'Contained Faces',
        'Edge Perimeter',
        'Vertex Perimeter',
      ],
    ],
    ['modify', ['Center Pivot', 'Freeze Transformations', 'Reset Transformations']],
    ['modify.pivot', ['Bottom Center', 'Reset', 'Bake', 'Edit Pivot']],
    ['modify.snap', ['Grid', 'Vertex', 'Increment']],
    ['display', ['Hide Selected', 'Show All', 'Hide Unselected', 'Isolate']],
    ['display.shading', ['Wireframe', 'Shaded', 'Colours', 'Lit']],
    [
      'mesh',
      [
        'Combine',
        'Separate',
        'Fill Hole',
        'Mirror…',
        'Symmetrize',
        'Triangulate',
        'Quadrangulate',
        'Cleanup…',
        'Make Editable',
      ],
    ],
    [
      'edit-mesh',
      [
        'Extrude',
        'Inset',
        'Bevel',
        'Bridge',
        'Connect',
        'Insert Edge Loop',
        'Average Vertices',
        'Extract',
        'Duplicate Face',
        'Delete Edge/Vertex',
        'Flip Triangle Edge',
      ],
    ],
    ['edit-mesh.merge', ['Merge', 'Merge to Center', 'Merge by Distance', 'Collapse']],
    ['edit-mesh.spin-edge', ['Spin Edge Forward', 'Spin Edge Backward']],
    ['edit-mesh.assign-colour', ['Active Swatch']],
    ['mesh-tools', ['Multi-Cut', 'Insert Edge Loop', 'Offset Edge Loop', 'Slide Edge', 'Target Weld', 'Paint Colour']],
    ['mesh-display', ['Soften Edge', 'Harden Edge', 'Set Normal Angle…', 'Reverse', 'Conform']],
    [
      'mesh-display.show',
      [
        'Normals',
        'Hide Normals',
        'Face Orientation',
        'Triangulation',
        'Hard Edges',
        'Wire on Shaded',
        'Backface Culling',
        'Dim Unhilited',
      ],
    ],
    ['uv', ['Planar', 'Automatic', 'Cylindrical']],
  ])('%s', (id, labels) => {
    expect(menu(id)).toEqual(labels);
  });

  it('binds the §8.3 shortcut of each item that names one to the same operator and arguments', () => {
    // Item → the chord §8.3 prints next to it.
    const shortcuts: readonly (readonly [string, string])[] = [
      ['builtin.model.edit.adjustLast', 'KeyT'],
      ['builtin.model.edit.repeatLast', 'KeyG'],
      ['builtin.model.edit.lastTool', 'KeyY'],
      ['builtin.model.edit.duplicate', 'Mod+KeyD'],
      ['builtin.model.edit.group', 'Mod+KeyG'],
      ['builtin.model.edit.parent', 'KeyP'],
      ['builtin.model.edit.unparent', 'Shift+KeyP'],
      ['builtin.model.select.vertex', 'F9'],
      ['builtin.model.select.edge', 'F10'],
      ['builtin.model.select.face', 'Digit3'],
      ['builtin.model.select.grow', 'Shift+Period'],
      ['builtin.model.select.shrink', 'Shift+Comma'],
      ['builtin.model.display.hideSelected', 'KeyH'],
      ['builtin.model.display.showAll', 'Shift+KeyH'],
      ['builtin.model.display.hideUnselected', 'Alt+KeyH'],
      ['builtin.model.display.isolate', 'Shift+KeyL'],
      ['builtin.model.display.shading.wire', 'Digit4'],
      ['builtin.model.display.shading.lit', 'Digit7'],
      ['builtin.model.edit-mesh.extrude', 'Mod+KeyE'],
      ['builtin.model.edit-mesh.bevel', 'Mod+KeyB'],
      ['builtin.model.edit-mesh.deleteEdgeVertex', 'Mod+Delete'],
      ['builtin.model.mesh-tools.multiCut', 'KeyK'],
      ['builtin.model.modify.pivot.edit', 'Insert'],
    ];
    for (const [id, chord] of shortcuts) {
      const item = MODEL_ITEMS.find((entry) => entry.id === id);
      expect([id, item === undefined]).toEqual([id, false]);
      const want = ch(chord);
      const bound = MAYA_KEYMAP.filter(
        (binding) =>
          binding.op === item?.op &&
          stableKeyOf(binding.args) === stableKeyOf(item?.args) &&
          sameChord(binding.chord, want),
      );
      expect([id, bound.length > 0]).toEqual([id, true]);
    }
  });

  it('marks the Animate-only shipped items, so Model shows its own Edit and Select items', () => {
    const animate = BUILTIN_MENU_ITEMS.filter((item) => item.workspaces?.includes('animate') === true).map(
      (item) => item.id,
    );
    expect(animate).toEqual([
      'builtin.edit.copy',
      'builtin.edit.paste',
      'builtin.edit.delete',
      'builtin.select.all',
      'builtin.select.none',
      'builtin.select.mirror',
    ]);
    const modes: ComponentMode[] = ['object', 'vertex', 'edge', 'face'];
    for (const item of MODEL_ITEMS) for (const mode of item.modes ?? []) expect(modes).toContain(mode);
  });
});
