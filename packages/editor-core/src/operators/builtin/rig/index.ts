// The rig-workspace chunk's operator entry (M6B-SPEC §2.1, §9.1; C0, closed): every §6 operator from its owner's file
// (one line per file), registered when the chunk loads (`app.rig.load()`: entering Rig & Skin, opening the palette,
// running one of its ids). `RIG_WORKSPACE_MARKER` is the check-size marker of the `rig-workspace` boundary: this module
// references it, so eager code that imports the chunk fails the size gate.
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '../../../types';
import type { AnyOperator } from '../define';
import { AUTORIG_OPERATORS } from './autorig';
import { BIND_OPERATORS } from './bind';
import { CHARACTER_OPERATORS } from './character';
import { CONSTRAINT_OPERATORS } from './constraints';
import { CHARACTER_EXPORT_OPERATORS } from './export';
import { INFLUENCE_OPERATORS } from './influence';
import { MAKE_CHARACTER_EDITABLE_OPERATORS } from './makeEditable';
import { MODE_OPERATORS } from './mode';
import { RIG_POSE_OPERATORS } from './pose';
import { PROP_OPERATORS } from './prop';
import { QUICK_RIG_OPERATORS } from './quickRig';
import { QUICK_RIG_SESSION_OPERATORS } from './quickRigSession';
import { RECOVERY_OPERATORS } from './recovery';
import { ROM_OPERATORS } from './rom';
import { RIG_SHADOW_OPERATORS } from './shadows';
import { SHAPE_OPERATORS } from './shapes';
import { SKELETON_OPERATORS } from './skeleton';
import { WEIGHT_OPERATORS } from './weights';
// The Rig & Skin services live in this chunk (§0.4.9); `app.rig.load()` creates them.
export { createRigServices } from '../../../rig/chunk/services';

/** `check-size` marker of the rig-workspace chunk (§2.1). */
export const RIG_WORKSPACE_MARKER = 'ekza-rig-workspace' as const;

/** Every operator of the chunk, by owner file. */
export const RIG_WORKSPACE_OPERATORS: readonly AnyOperator[] = [
  ...CHARACTER_OPERATORS,
  ...AUTORIG_OPERATORS,
  ...SKELETON_OPERATORS,
  ...QUICK_RIG_OPERATORS,
  ...QUICK_RIG_SESSION_OPERATORS,
  ...PROP_OPERATORS,
  ...BIND_OPERATORS,
  ...WEIGHT_OPERATORS,
  ...INFLUENCE_OPERATORS,
  ...MODE_OPERATORS,
  ...RIG_POSE_OPERATORS,
  ...ROM_OPERATORS,
  ...RIG_SHADOW_OPERATORS,
  ...CONSTRAINT_OPERATORS,
  ...SHAPE_OPERATORS,
  ...CHARACTER_EXPORT_OPERATORS,
  ...MAKE_CHARACTER_EDITABLE_OPERATORS,
  ...RECOVERY_OPERATORS,
];

/** Registers the chunk's operators that this app does not have yet (a host or an extension may have registered one). */
export function registerRigWorkspaceOperators(app: EditorApp): Disposer {
  if (typeof RIG_WORKSPACE_MARKER !== 'string') throw new Error('rig-workspace chunk without its marker');
  const disposers: Disposer[] = [];
  for (const def of RIG_WORKSPACE_OPERATORS) {
    if (app.operators.get(def.id) === undefined) disposers.push(app.contribute({ kind: 'operator', def }));
  }
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
