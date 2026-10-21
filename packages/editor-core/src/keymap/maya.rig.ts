// The Rig & Skin rows of the `maya` preset (M6B-SPEC §7, cut to the MVP operators of §0.6; C7). Every row's scope
// starts with `rig`, so Model and Animate never see them. Chain over a pane (CR-4): `rig.viewport.<mode>` →
// `rig.viewport` → `viewport` → `rig` → `global`; over a panel `rig.<panel>` → `<panel>` → `rig` → `global`.
//
// This module is eager and small: the scopes and the **shadow rows** (`RIG_SHADOW_KEYMAP`), which the built-ins
// contribute with the `maya` preset (`registerBuiltins`), so `S` keys nothing in Rig & Skin even before the
// rig-workspace chunk has loaded (a reload straight into Rig & Skin, a failed chunk load; M6B-C7-15). The other rows
// (`RIG_KEYMAP`, `rig/chunk/keymap.ts`) come with the chunk. Keying is impossible in Rig & Skin (§5.17): every
// shipped chord that keys, mirrors or pastes a pose resolves to `rig.animateOnly` — in the viewport (`rig.viewport`,
// §7) and, beyond the §7 table, over every panel whose shipped rows key (Outliner, Channel Box, time slider, Dope
// Sheet, Graph Editor). `rig.animateOnly` is a rig-workspace operator: the runner loads the chunk, then it poll-fails.
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

export const rigKey = (code: string, mods: Omit<Chord, 'code'> = {}): Chord => ({ code, ...mods });

/** One row per chord and scope. */
export function rigRows(
  chords: readonly Chord[],
  op: OperatorId,
  scopes: readonly KeyScope[],
  args?: unknown,
): KeyBinding[] {
  return chords.flatMap((chord) =>
    scopes.map((scope): KeyBinding => Object.freeze({ chord, op, scope, ...(args === undefined ? {} : { args }) })),
  );
}

/** The chords that key, mirror or paste a pose in Animate (§7 row `rig.animateOnly`). */
export const KEYING_CHORDS: readonly Chord[] = [
  rigKey('KeyS'),
  rigKey('KeyW', { shift: true }),
  rigKey('KeyE', { shift: true }),
  rigKey('KeyR', { shift: true }),
  rigKey('KeyS', { alt: true }),
  rigKey('KeyM', { alt: true }),
  rigKey('KeyV', { mod: true, shift: true }),
  rigKey('KeyC', { mod: true }),
  rigKey('KeyV', { mod: true }),
];
const KEYING_SCOPES: readonly KeyScope[] = [
  RIG_SCOPE.viewport,
  RIG_SCOPE.outliner,
  RIG_SCOPE.channelBox,
  RIG_SCOPE.timeline,
  RIG_SCOPE.dopeSheet,
  RIG_SCOPE.graph,
];

/** The shadow rows (§7 `rig.animateOnly`; eager, contributed by `registerBuiltins`). */
export const RIG_SHADOW_KEYMAP: readonly KeyBinding[] = Object.freeze([
  ...rigRows(KEYING_CHORDS, 'rig.animateOnly', KEYING_SCOPES),
  // Key deletion (Delete/Backspace delete keys in the viewport, Channel Box, time slider, Dope Sheet, Graph Editor).
  ...rigRows(
    [rigKey('Delete'), rigKey('Backspace')],
    'rig.animateOnly',
    KEYING_SCOPES.filter((scope) => scope !== RIG_SCOPE.outliner),
  ),
]);
