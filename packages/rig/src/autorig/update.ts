// `rig.autoRig.update` core (M6B-SPEC §4.3, §5.16; C1): regenerates the control rig from the skeleton and merges it
// with the current rig so that nothing the user made is lost.
//
// 1. IDs: `<rigId>:<templateKey>` (shipped); non-humanoid keys of model-sourced skeletons come from the joints' stable
//    keys (`SkeletonDesc.jointKeys`), so a rename keeps every control and its curves (P-J6). Limb solver ids are kept.
// 2. Kind: humanoid when the 15 required bones are mapped, else generic; a kind change soft-deletes the old controls
//    (their curves stay) with the warning "The control rig became humanoid; curves of n generic controls are kept but
//    unused".
// 3. Regenerated: restWorld, parents, bindings, names, mirrors, default shapes, sizes, limb parameters.
// 4. Kept from existing controls: rotateOrder, hiddenByDefault, locked channels, attributes added by constraints
//    (`<key>.<attr>`, §5.18.4) and every ControlShape field listed in `shape.edited`.
// 5. Model-sourced skeletons: prop and socket controls (`./model.ts`); every secondary control this update *creates*
//    is visible (`hiddenByDefault: false`); existing ones keep their visibility (rule 4).
// 6. Removed bones: their controls are soft-deleted (`softDeleted`; curves kept) with a warning.
// 7. Stale offsets: constraints with stored offsets whose driven or target control's rest moved are listed once.
import type { CharacterId, ControlId, ControlRecord, ControlShape, RigId, ShapeField } from '@ekza-studio/doc';
import type { AutoRigUpdate, RigDefinition, SkeletonDesc } from '../types';
import { autoRig } from './autoRig';
import { isModelSkeleton } from './model';

/** Version of the update rules (bumped when a rule changes what an update writes). */
export const AUTORIG_UPDATE_RULES = 1;

const SHAPE_FIELDS: readonly ShapeField[] = ['kind', 'size', 'offset', 'color', 'lineWidth'];

/** The limb IK a rig has now (`rig.autoRig.update` inside skeleton edits keeps it). */
export function ikOf(def: RigDefinition | null): { readonly legs: boolean; readonly arms: boolean } {
  if (def === null) return { legs: true, arms: false };
  const limbs = new Set<string>();
  for (const solver of def.solvers) {
    if (solver.deleted !== null || solver.type !== 'ik2') continue;
    const limb = solver.params['limb'];
    if (typeof limb === 'string') limbs.add(limb);
  }
  return {
    legs: limbs.has('leg.L') || limbs.has('leg.R'),
    arms: limbs.has('arm.L') || limbs.has('arm.R'),
  };
}

export function updateAutoRig(
  current: RigDefinition | null,
  skeleton: SkeletonDesc,
  ids: { readonly character: CharacterId; readonly rig: RigId },
  opts: { readonly ik: { readonly legs: boolean; readonly arms: boolean } },
): AutoRigUpdate {
  const fresh = autoRig(skeleton, ids, { ik: opts.ik });
  const model = isModelSkeleton(skeleton);
  if (current === null) {
    // Rule 5: a model-sourced rig's secondary controls are visible from the start.
    const controls = model
      ? fresh.controls.map((c) => (c.hiddenByDefault ? { ...c, hiddenByDefault: false } : c))
      : fresh.controls;
    return { rig: { ...fresh, controls }, softDeleted: [], staleOffsets: [], warnings: [] };
  }
  const existing = new Map<string, ControlRecord>(current.controls.map((control) => [control.id, control]));
  const controls = fresh.controls.map((control) => {
    const before = existing.get(control.id);
    if (before === undefined)
      return model && control.hiddenByDefault ? { ...control, hiddenByDefault: false } : control;
    return mergeControl(control, before);
  });
  const kept = new Set<ControlId>(controls.map((control) => control.id));
  const softDeleted = current.controls
    .filter((control) => control.deleted === null && !kept.has(control.id))
    .map((control) => control.id);
  const warnings: string[] = [];
  const before = current.rig.generator.name;
  const after = fresh.rig.generator.name;
  if (before !== after && softDeleted.length > 0) {
    const [from, to] = after === 'ekza-autorig-humanoid' ? ['generic', 'humanoid'] : ['humanoid', 'generic'];
    warnings.push(`The control rig became ${to}; curves of ${softDeleted.length} ${from} controls are kept but unused`);
  } else {
    for (const id of softDeleted)
      warnings.push(`${id}: its bone is gone; the control is removed and its curves are kept`);
  }
  // Solver records: the regenerated ones (ids kept by limbIkRecords); the user's constraints stay as they are.
  const rig: RigDefinition = {
    rig: { ...fresh.rig, deleted: null },
    controls,
    constraints: current.constraints,
    solvers: fresh.solvers,
  };
  return { rig, softDeleted, staleOffsets: staleOffsets(current, controls), warnings };
}

/** Rule 3 + 4: the regenerated control with what the user owns kept from the existing one. */
function mergeControl(fresh: ControlRecord, before: ControlRecord): ControlRecord {
  const attrs = { ...fresh.attrs };
  // Attributes added by constraints (`<constraintKey>.<name>`, §5.18.4) are kept; generated ones are regenerated.
  for (const [name, def] of Object.entries(before.attrs)) if (name.includes('.') && !(name in attrs)) attrs[name] = def;
  return {
    ...fresh,
    rotateOrder: before.rotateOrder,
    hiddenByDefault: before.hiddenByDefault,
    locked: before.locked,
    attrs,
    shape: mergeShape(fresh.shape, before.shape),
  };
}

/** The generated shape with every field the user edited (`shape.edited`) taken from the existing one. */
export function mergeShape(fresh: ControlShape, before: ControlShape): ControlShape {
  const edited = before.edited ?? [];
  if (edited.length === 0) return fresh;
  let out: ControlShape = { ...fresh, edited: SHAPE_FIELDS.filter((field) => edited.includes(field)) };
  for (const field of edited) {
    if (field === 'kind') out = { ...out, kind: before.kind, custom: before.custom };
    else if (field === 'size') out = { ...out, size: before.size };
    else if (field === 'offset') out = { ...out, offset: before.offset };
    else if (field === 'color') out = { ...out, color: before.color };
    else if (field === 'lineWidth') out = { ...out, lineWidth: before.lineWidth };
  }
  return out;
}

/** Rule 7: live constraints with a stored offset whose driven or target control's rest world changed. */
function staleOffsets(current: RigDefinition, controls: readonly ControlRecord[]): string[] {
  const now = new Map(controls.map((control) => [control.id as string, control.restWorld]));
  const was = new Map(current.controls.map((control) => [control.id as string, control.restWorld]));
  const moved = (id: string): boolean => {
    const a = was.get(id);
    const b = now.get(id);
    if (a === undefined || b === undefined) return false;
    return [...a.t, ...a.q, ...a.s].some((v, i) => v !== [...b.t, ...b.q, ...b.s][i]);
  };
  const out: string[] = [];
  for (const constraint of current.constraints) {
    if (constraint.deleted !== null) continue;
    const stored = Object.values(constraint.targets).filter((target) => target.offset !== undefined);
    if (stored.length === 0) continue;
    const touched =
      ('control' in constraint.driven && moved(constraint.driven.control)) ||
      stored.some((target) => target.target.kind === 'control' && moved(target.target.id));
    if (touched) out.push(constraint.id);
  }
  return out;
}
