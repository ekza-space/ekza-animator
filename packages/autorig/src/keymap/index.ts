// Auto-Rig key bindings (AUTORIG-SPEC §8.1; D0, closed): key scope `autorig`, one list per step owner
// (`steps/<step>.ts`) merged here. A binding runs an operator (shipped ids, e.g. `edit.undo`) or a shell action (the
// step's primary button, go to step n), in every step or only in the steps it names.
import type { Chord, OperatorId } from '@ekza-studio/editor-core';
import type { AutoRigStep } from '../types';
import { animationsKeys } from './steps/animations';
import { exportKeys } from './steps/export';
import { frameKeys } from './steps/frame';
import { markersKeys } from './steps/markers';
import { modelKeys } from './steps/model';
import { rigKeys } from './steps/rig';

/** The key scope of the Auto-Rig shell (§8.1). */
export const AUTORIG_KEY_SCOPE = 'autorig' as const;

export interface AutoRigKeyBinding {
  readonly chord: Chord;
  /** What the key does: an operator run, or a named shell action (the frame and step packages define theirs). */
  readonly run:
    | { readonly op: OperatorId; readonly args?: unknown }
    | { readonly action: string; readonly args?: unknown };
  /** The steps it works in (`'all'` = every step). */
  readonly steps: readonly AutoRigStep[] | 'all';
  /** Not while focus is in a text field (default true). */
  readonly notInText?: boolean;
}

/** Every binding: the frame's global rows first, then each step's. */
export const AUTORIG_KEYMAP: readonly AutoRigKeyBinding[] = [
  ...frameKeys,
  ...modelKeys,
  ...markersKeys,
  ...rigKeys,
  ...animationsKeys,
  ...exportKeys,
];
