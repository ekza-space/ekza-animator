// M2A-SPEC §3 rule 4: which M2a sibling packages are merged, probed through their public API (a stub throws
// EkzaError 'not-implemented'). Unit tests that need one use `describe.skipIf(!READY.<id>)` / `it.skipIf`, and the
// cases that hold only BEFORE it lands use `it.skipIf(READY.<id>)`; the integration agent turns them into failures.
import { limbIkRecords } from '@ekza-animator/rig';
import { implemented } from './builtin/support';

export const READY = {
  /** A1: rig limb IK (limbIkRecords, the ik2 op, matching). */
  a1: implemented(() => limbIkRecords(undefined as never, undefined as never, { limbs: [], ikFkDefault: 0 })),
} as const;
