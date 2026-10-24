// The primitives marking menu (M6A-SPEC §8.4 `model.primitives`; B11): Shift+RMB over empty space in object mode
// creates a primitive at the origin with the low-poly defaults (§5.16, §6.3). The humanoid body opens with its
// smooth style; the templates, reference images and mesh import are in the list.
import type { MarkingMenuDef, MarkingMenuItem } from '@ekza-studio/editor-core';

const create = (kind: string, label: string): MarkingMenuItem => ({ op: `mesh.create.${kind}`, label });
const template = (label: string, args: Readonly<Record<string, unknown>>): MarkingMenuItem => ({
  op: 'mesh.create.template',
  label,
  args,
});

export const PRIMITIVES_MENU: MarkingMenuDef = {
  id: 'model.primitives',
  trigger: { button: 'rmb', mods: 'shift' },
  workspaces: ['model'],
  when: { modes: ['object'], over: 'empty' },
  slots: {
    N: create('cube', 'Cube'),
    NE: create('cylinder', 'Cylinder'),
    E: create('sphere', 'Sphere'),
    SE: create('plane', 'Plane'),
    S: create('cone', 'Cone'),
    SW: create('torus', 'Torus'),
    W: template('Humanoid Body…', { template: 'humanoidBody', style: 'smooth' }),
    // Primitive options are the Toolkit's option boxes (⋯) until an option-box operator exists (M6A-B11-7).
    NW: { label: 'Primitive Options…', disabledReason: 'Primitive options are in the Toolkit (⋯)' },
  },
  list: [
    {
      label: 'Templates',
      submenu: [
        template('Prop', { template: 'prop' }),
        template('Handheld', { template: 'handheld' }),
        template('Humanoid Guides', { template: 'humanoid' }),
        template('Humanoid Body (Smooth)', { template: 'humanoidBody', style: 'smooth' }),
        template('Humanoid Body (Segmented)', { template: 'humanoidBody', style: 'segmented' }),
      ],
    },
    {
      label: 'Reference Image',
      submenu: (['front', 'side', 'top'] as const).map((camera) => ({
        op: 'imagePlane.import',
        label: `${camera.charAt(0).toUpperCase()}${camera.slice(1)}…`,
        args: { camera },
      })),
    },
    { op: 'ui.open', label: 'Import mesh…', args: { dialog: 'import' } },
  ],
};
