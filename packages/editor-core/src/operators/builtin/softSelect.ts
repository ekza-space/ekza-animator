// Soft selection and selection settings (M6A-SPEC §6.2, §5.15): B0a stubs, owned by B12a.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

const model = { category: 'model', scope: 'model', workspaces: ['model'] } as const;

export const SOFT_SELECT_OPERATORS: readonly AnyOperator[] = [
  stubOperator('model.softSelect.set', 'Soft Select Settings', {
    ...model,
    description: 'Sets soft selection on/off, radius, falloff and curve.',
    extraArgs: ['on', 'radius', 'falloff', 'curve'],
  }),
  stubOperator('model.softSelect.toggle', 'Soft Select', {
    ...model,
    description: 'Turns soft selection on or off.',
    aliases: ['Proportional Editing'],
  }),
  stubOperator('model.selectionStyle.set', 'Selection Style', {
    ...model,
    description: 'Switches between marquee and tweak selection.',
    extraArgs: ['style'],
  }),
  stubOperator('model.cameraBased.set', 'Camera-Based Selection', {
    ...model,
    description: 'Selects only components visible from the camera (auto: on in shaded views).',
    extraArgs: ['value'],
  }),
  stubOperator('model.backfaces.toggle', 'Select Backfaces', {
    ...model,
    description: 'Lets clicks and marquees pick components facing away from the camera.',
  }),
  stubOperator('model.constraint.set', 'Selection Constraint', {
    ...model,
    description: 'Constrains selection gestures (angle, border, loop, ring, shell).',
    extraArgs: ['constraint'],
  }),
];
