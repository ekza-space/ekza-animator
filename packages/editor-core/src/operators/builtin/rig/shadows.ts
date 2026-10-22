// C7 (rig shell; M6B-SPEC §5.17, §7): `rig.animateOnly`, the target of every shadowed keying chord in Rig & Skin
// (`S`, `Shift+W/E/R`, `Alt+S`, `Alt+M`, pose copy/paste, key deletion; `keymap/maya.rig.ts`). It always poll-fails,
// so a test pose or a rig edit is never keyed or pasted unseen.
import { ANIMATE_ONLY_REASON } from '../keymapShadows';
import { type AnyOperator, defineOperator, fail } from '../define';

export const RIG_SHADOW_OPERATORS: readonly AnyOperator[] = [
  defineOperator({
    id: 'rig.animateOnly',
    label: 'Animate Only',
    description: 'Keys and poses are set in the Animate workspace; Rig & Skin poses are test poses.',
    category: 'rig',
    scope: 'rig',
    flags: { internal: true },
    workspaces: ['rig'],
    poll: () => fail(ANIMATE_ONLY_REASON),
    apply: () => {},
  }),
];
