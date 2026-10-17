// WP-3 stubs: final signatures (MVP-SPEC §7 WP-3); bodies throw until the auto-rig lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { CharacterId, ReadView, RigId, Tx } from '@ekza-animator/doc';
import type { RigDefinition, SkeletonDesc } from '../types';

export const AUTORIG_VERSION: string = '0.2.0';

export function autoRig(
  _skeleton: SkeletonDesc,
  _ids: { readonly character: CharacterId; readonly rig: RigId },
  _opts?: { readonly kind?: 'auto' | 'humanoid' | 'generic'; readonly secondary?: boolean },
): RigDefinition {
  throw new EkzaError('not-implemented', 'rig.autoRig');
}

export function readRigDefinition(_view: ReadView, _rig: RigId): RigDefinition | undefined {
  throw new EkzaError('not-implemented', 'rig.readRigDefinition');
}

/** Inserts the records of a NEW rig (put only). */
export function writeRigDefinition(_tx: Tx, _def: RigDefinition): void {
  throw new EkzaError('not-implemented', 'rig.writeRigDefinition');
}
