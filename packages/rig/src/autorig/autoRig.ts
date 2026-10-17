import { EkzaError } from '@ekza-animator/anim-core';
import type { CharacterId, ReadView, RigId, RigRecord, Tx } from '@ekza-animator/doc';
import { VRM_REQUIRED_BONES } from '../humanoid/bones';
import { humanTemplateKey } from '../humanoid/map';
import type { RigDefinition, SkeletonDesc } from '../types';
import { genericControlSpecs, secondaryControlSpecs } from './generic';
import { humanoidControlSpecs } from './humanoid';
import { type ControlSpec, materializeControls, restContext } from './spec';

export const AUTORIG_VERSION: string = '0.2.0';

/** True when the skeleton maps every VRM-required humanoid bone (MVP-SPEC §4.11.6 step 8). */
export function hasRequiredHumanoid(skeleton: SkeletonDesc): boolean {
  const map = skeleton.humanoid;
  if (map === null) return false;
  return VRM_REQUIRED_BONES.every((bone) => {
    const node = map[bone];
    return node !== undefined && Number.isInteger(node) && node >= 0 && node < skeleton.nodes.length;
  });
}

/**
 * Generates a rig for a skeleton (MVP-SPEC §4.11.15). `kind: 'auto'` (default) builds the humanoid FK rig when the
 * skeleton maps the 15 VRM-required bones and the generic 1:1 FK rig otherwise; `secondary` (default true) adds
 * hidden secondary controls to humanoid rigs. Deterministic: control IDs are `${rig}:${templateKey}`.
 */
export function autoRig(
  skeleton: SkeletonDesc,
  ids: { readonly character: CharacterId; readonly rig: RigId },
  opts?: { readonly kind?: 'auto' | 'humanoid' | 'generic'; readonly secondary?: boolean },
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
  return { rig, controls: materializeControls(specs, ids.rig), constraints: [], solvers: [] };
}

/** The rig records of `rig` as a RigDefinition (soft-deleted records excluded); undefined when the rig is absent. */
export function readRigDefinition(view: ReadView, rig: RigId): RigDefinition | undefined {
  const record = view.get('rigs', rig);
  if (record === undefined) return undefined;
  return {
    rig: record,
    controls: view.query.controlsOfRig(rig),
    constraints: view.list('constraints').filter((constraint) => constraint.rig === rig),
    solvers: view.list('solvers').filter((solver) => solver.rig === rig),
  };
}

/** Inserts the records of a NEW rig (put only): the rig, then controls (parents first), constraints and solvers. */
export function writeRigDefinition(tx: Tx, def: RigDefinition): void {
  tx.put('rigs', def.rig);
  for (const control of parentsFirst(def)) tx.put('controls', control);
  for (const constraint of def.constraints) tx.put('constraints', constraint);
  for (const solver of def.solvers) tx.put('solvers', solver);
}

function parentsFirst(def: RigDefinition): RigDefinition['controls'] {
  const ids = new Set(def.controls.map((control) => control.id));
  const written = new Set<string>();
  const out: RigDefinition['controls'][number][] = [];
  let pending = [...def.controls];
  while (pending.length > 0) {
    const next = pending.filter(
      (control) => control.parent === null || !ids.has(control.parent) || written.has(control.parent),
    );
    // A parent cycle in the input cannot be ordered; write the rest as given.
    const batch = next.length > 0 ? next : pending;
    for (const control of batch) {
      out.push(control);
      written.add(control.id);
    }
    pending = pending.filter((control) => !written.has(control.id));
  }
  return out;
}
