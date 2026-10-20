// The Ctrl+RMB convert menu `model.convert` (M6A-SPEC §8.4; B10 data): component modes only. Slots N To Edges ·
// W To Vertices · S To Faces · E To UVs (later) · NE To Edge Loop · NW To Edge Ring · SE To Shell · SW To Border; the
// list holds the contained and perimeter conversions and Grow/Shrink. Every item is also in Select › Convert
// Selection and the command palette (ADR 0016 D10).
import type { MarkingMenuDef, MarkingMenuItem } from '@ekza-animator/editor-core';

const convert = (
  label: string,
  to: 'vertex' | 'edge' | 'face',
  mode: 'touching' | 'contained' | 'perimeter' | 'border' | 'loop' | 'ring',
): MarkingMenuItem => ({ label, op: 'select.mesh.convert', args: { to, mode } });

export const CONVERT_MENU: MarkingMenuDef = {
  id: 'model.convert',
  trigger: { button: 'rmb', mods: 'ctrl' },
  workspaces: ['model'],
  when: { modes: ['vertex', 'edge', 'face'] },
  slots: {
    N: convert('To Edges', 'edge', 'touching'),
    W: convert('To Vertices', 'vertex', 'touching'),
    S: convert('To Faces', 'face', 'touching'),
    E: { label: 'To UVs', disabledReason: 'UV editor arrives later' },
    NE: convert('To Edge Loop', 'edge', 'loop'),
    NW: convert('To Edge Ring', 'edge', 'ring'),
    SE: { label: 'To Shell', op: 'select.mesh.shell' },
    SW: convert('To Border', 'edge', 'border'),
  },
  list: [
    convert('Contained Edges', 'edge', 'contained'),
    convert('Contained Faces', 'face', 'contained'),
    convert('Edge Perimeter', 'edge', 'perimeter'),
    convert('Vertex Perimeter', 'vertex', 'perimeter'),
    { label: 'Grow', op: 'select.mesh.grow' },
    { label: 'Shrink', op: 'select.mesh.shrink' },
  ],
};
