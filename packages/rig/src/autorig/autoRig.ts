import { EkzaError } from '@ekza-animator/anim-core';
import type { CharacterId, RigId, RigRecord } from '@ekza-animator/doc';
import { VRM_REQUIRED_BONES } from '../humanoid/bones';
import { humanTemplateKey } from '../humanoid/map';
import { limbIkRecords } from '../limb/records';
import type { LimbId, RigDefinition, SkeletonDesc } from '../types';
import { hasRequiredHumanoid } from './definition';
import { genericControlSpecs, secondaryControlSpecs } from './generic';
import { humanoidControlSpecs } from './humanoid';
import { type ControlSpec, materializeControls, restContext } from './spec';

export const AUTORIG_VERSION: string = '0.2.0';
/** Generator version of humanoid rigs that `autoRig(…, { ik })` gave limb IK (M2A-SPEC §8 A1). */
const AUTORIG_IK_VERSION = '0.3.0';

/**
 * Generates a rig for a skeleton (MVP-SPEC §4.11.15). `kind: 'auto'` (default) builds the humanoid FK rig when the
 * skeleton maps the 15 VRM-required bones and the generic 1:1 FK rig otherwise; `secondary` (default true) adds
 * hidden secondary controls to humanoid rigs. Deterministic: control IDs are `${rig}:${templateKey}`.
 *
 * M2a (M2A-SPEC §5.2): `ik` adds limb IK records (`limbIkRecords`, legs `ikFk` 1, arms 0) for the requested limb
 * kinds of a humanoid rig and marks the generator version 0.3.0; absent (or nothing added) = the M1 output.
 */
export function autoRig(
  skeleton: SkeletonDesc,
  ids: { readonly character: CharacterId; readonly rig: RigId },
  opts?: {
    readonly kind?: 'auto' | 'humanoid' | 'generic';
    readonly secondary?: boolean;
    readonly ik?: { readonly legs: boolean; readonly arms: boolean };
  },
): RigDefinition {
  const requested = opts?.kind ?? 'auto';
  const humanoid = requested === 'humanoid' || (requested === 'auto' && hasRequiredHumanoid(skeleton));
  if (humanoid && !hasRequiredHumanoid(skeleton)) {
    throw new EkzaError('unsupported', 'A humanoid rig needs the 15 VRM-required humanoid bones', {
      missing: VRM_REQUIRED_BONES.filter((bone) => skeleton.humanoid?.[bone] === undefined),
    });
  }
  const ctx = restContext(skeleton);
  let specs: ControlSpec[];
  if (humanoid) {
    specs = humanoidControlSpecs(ctx);
    if (opts?.secondary !== false) {
      const drivenBy = new Map<number, string>();
      for (const spec of specs) {
        const bone = spec.drives?.bone;
        if (bone === undefined || !('humanoid' in bone)) continue;
        const node = skeleton.humanoid?.[bone.humanoid];
        if (node !== undefined) drivenBy.set(node, humanTemplateKey(bone.humanoid));
      }
      specs = [...specs, ...secondaryControlSpecs(ctx, drivenBy)];
    }
  } else {
    specs = genericControlSpecs(ctx);
  }
  const rig: RigRecord = {
    id: ids.rig,
    character: ids.character,
    format: 'ekza.rig',
    version: 1,
    generator: { name: humanoid ? 'ekza-autorig-humanoid' : 'ekza-autorig-generic', version: AUTORIG_VERSION },
    skeleton: { format: skeleton.format, fingerprint: skeleton.fingerprint, facing: skeleton.facing },
    deleted: null,
  };
  const def: RigDefinition = { rig, controls: materializeControls(specs, ids.rig), constraints: [], solvers: [] };
  const ik = opts?.ik;
  if (!humanoid || ik === undefined) return def;
  const limbs: LimbId[] = [
    ...(ik.legs ? (['leg.L', 'leg.R'] as const) : []),
    ...(ik.arms ? (['arm.L', 'arm.R'] as const) : []),
  ];
  if (limbs.length === 0) return def;
  const added = limbIkRecords(def, skeleton, { limbs, ikFkDefault: 'by-limb' });
  if (added.solvers.length === 0) return def;
  return {
    rig: { ...rig, generator: { ...rig.generator, version: AUTORIG_IK_VERSION } },
    controls: [...def.controls, ...added.controls],
    constraints: [],
    solvers: [...added.solvers],
  };
}
