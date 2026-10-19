// Animate-only rows shadowed in Model (M6A-SPEC §5.17, §6.2): `model.animateOnly` is the target of the shipped
// `viewport` rows that would act on controls the modeler cannot see; it always poll-fails. B0a lands the operator;
// B0b adds the shadow rows (then B9 owns the file).
import { defineOperator, fail, type AnyOperator } from './define';

/** The poll reason of every shadowed Animate row in Model. */
export const ANIMATE_ONLY_REASON = 'Keys and poses are set in Animate';

export const KEYMAP_SHADOW_OPERATORS: readonly AnyOperator[] = [
  defineOperator<'model.animateOnly'>({
    id: 'model.animateOnly',
    label: 'Animate Only',
    description: 'Keys and poses are set in the Animate workspace.',
    category: 'model',
    scope: 'model',
    flags: { internal: true },
    workspaces: ['model'],
    poll: () => fail(ANIMATE_ONLY_REASON),
    apply: () => {},
  }),
];
