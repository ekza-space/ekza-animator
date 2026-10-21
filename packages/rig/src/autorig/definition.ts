// The rig-definition records and the humanoid check (MVP-SPEC §4.11.6, §4.11.15) without the rig generators: the
// editor's first route reads rigs (`readRigDefinition`) and checks humanoid skeletons; `autoRig` and its control
// templates (`./autoRig`, `./generic`, `./humanoid`) load with the import path.
import type { ReadView, RigId, Tx } from '@ekza-studio/doc';
import { VRM_REQUIRED_BONES } from '../humanoid/bones';
import type { RigDefinition, SkeletonDesc } from '../types';

/** True when the skeleton maps every VRM-required humanoid bone (MVP-SPEC §4.11.6 step 8). */
export function hasRequiredHumanoid(skeleton: SkeletonDesc): boolean {
  const map = skeleton.humanoid;
  if (map === null) return false;
  return VRM_REQUIRED_BONES.every((bone) => {
    const node = map[bone];
    return node !== undefined && Number.isInteger(node) && node >= 0 && node < skeleton.nodes.length;
  });
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
