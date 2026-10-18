import type { BoneRef, ConstraintRecord, ControlId, ControlRecord, SolverRecord } from '@ekza-animator/doc';
import { restWorlds } from '../humanoid/rest';
import { bendOf, restBand } from '../ik/core';
import { OP_BONE, OP_CONTROL, OP_CUSTOM } from '../kernel/constants';
import type { ScheduledRigOp } from '../kernel/internals';
import { lookupRigOp, type RigOpImpl, type RigOpKind } from '../kernel/ops';
import { createProgram } from '../kernel/program';
import { buildLimbDesc } from '../limb/ik2';
import { LIMB_TEMPLATES } from '../limb/template';
import type { LimbDesc, RigDefinition, RigOpCompileContext, RigProgram, RigWarning, SkeletonDesc } from '../types';
import { createBoneResolver } from './bones';
import { buildAttrSlots, buildInternals } from './build';
import { type SortNode, topologicalSort } from './schedule';
import { checkRig } from './warnings';

const PRIORITY_CONTROL = 0;
const PRIORITY_CONSTRAINT = 1;
const PRIORITY_SOLVER = 2;
const PRIORITY_BONE = 3;

type GraphEntry =
  | { readonly kind: 'control'; readonly control: ControlRecord }
  | { readonly kind: 'bone'; readonly node: number }
  | { readonly kind: 'op'; readonly op: PendingOp };

interface PendingOp {
  readonly kind: RigOpKind;
  readonly record: ConstraintRecord | SolverRecord;
  readonly impl: RigOpImpl;
  readonly readsControls: readonly ControlId[];
  readonly readsNodes: readonly number[];
  readonly writesControls: readonly ControlId[];
  readonly writesNodes: readonly number[];
  disabled: boolean;
}

/**
 * Compiles rig records into a program (ADR 0004 §6): resolves bone references, repairs dangling references and
 * cycles, schedules `controlWorld`, constraint/solver and bone ops by a Kahn sort with a `(opKindPriority, id)`
 * tie-break, and precomputes offsets and bind offsets. The schedule never depends on record order, and the
 * compiler never throws on document content: every repair is reported in `program.warnings`.
 *
 * Order (M2A-SPEC §5.4 rule 1): attribute slots first (schedule-independent), then the ops' `reads`/`writes` with a
 * `RigOpCompileContext`, the schedule, `createProgram`, and last each op's optional `compile` with the finished
 * program (its result is the op's run-time `state`; a throw skips the op and warns).
 */
export function compileRig(def: RigDefinition, skeleton: SkeletonDesc): RigProgram {
  const warnings: RigWarning[] = [];
  const rigId = def.rig.id;

  const controls = liveRecords(def.controls, rigId, 'control', warnings);
  const byId = new Map<ControlId, ControlRecord>(controls.map((control) => [control.id, control]));
  const attrs = buildAttrSlots(controls);

  const entries: GraphEntry[] = [];
  const nodes: SortNode[] = [];
  const edges: [number, number][] = [];
  const controlEntry = new Map<ControlId, number>();
  for (const control of controls) {
    controlEntry.set(control.id, entries.length);
    entries.push({ kind: 'control', control });
    nodes.push({ priority: PRIORITY_CONTROL, key: control.id });
  }
  const boneEntry = new Int32Array(skeleton.nodes.length);
  skeleton.nodes.forEach((_, node) => {
    boneEntry[node] = entries.length;
    entries.push({ kind: 'bone', node });
    nodes.push({ priority: PRIORITY_BONE, key: `node:${String(node).padStart(10, '0')}` });
  });

  // Control hierarchy.
  for (const control of controls) {
    if (control.parent === null) continue;
    const parent = controlEntry.get(control.parent);
    if (parent === undefined) {
      warnings.push({
        code: 'dangling-ref',
        message: `${control.key}: parent ${control.parent} does not exist; the control hangs off the character root`,
        ids: [control.id],
      });
      continue;
    }
    edges.push([parent, controlEntry.get(control.id) as number]);
  }

  // Bone hierarchy and bindings (the binding winner rule matches buildInternals: smallest control id).
  const resolve = createBoneResolver(skeleton);
  const driverOf = new Map<number, ControlRecord>();
  for (const control of controls) {
    if (control.drives === null || control.drives === undefined) continue;
    const node = resolve(control.drives.bone);
    if (node === -1) continue;
    const current = driverOf.get(node);
    if (current === undefined || control.id < current.id) driverOf.set(node, control);
  }
  skeleton.nodes.forEach((node, index) => {
    const parent = node.parent;
    if (Number.isInteger(parent) && parent >= 0 && parent < index) {
      edges.push([boneEntry[parent] as number, boneEntry[index] as number]);
    }
    const control = driverOf.get(index);
    if (control !== undefined) edges.push([controlEntry.get(control.id) as number, boneEntry[index] as number]);
  });

  // Constraint and solver slots.
  const children = new Map<ControlId, ControlId[]>();
  for (const control of controls) {
    if (control.parent === null || !byId.has(control.parent)) continue;
    const list = children.get(control.parent);
    if (list === undefined) children.set(control.parent, [control.id]);
    else list.push(control.id);
  }
  const drivenBy = new Map<ControlId, number>();
  for (const [node, control] of driverOf) drivenBy.set(control.id, node);
  const context = compileContext(skeleton, byId, children, resolve, attrs.index);
  const pending: PendingOp[] = [
    ...collectOps(
      'constraint',
      liveRecords(def.constraints, rigId, 'constraint', warnings),
      byId,
      skeleton,
      warnings,
      context,
    ),
    ...collectOps('solver', liveRecords(def.solvers, rigId, 'solver', warnings), byId, skeleton, warnings, context),
  ];
  const opEntries: number[] = [];
  for (const op of pending) {
    const entry = entries.length;
    opEntries.push(entry);
    entries.push({ kind: 'op', op });
    nodes.push({ priority: op.kind === 'constraint' ? PRIORITY_CONSTRAINT : PRIORITY_SOLVER, key: op.record.id });
    for (const id of op.readsControls) edges.push([controlEntry.get(id) as number, entry]);
    for (const node of op.readsNodes) edges.push([boneEntry[node] as number, entry]);
    // §5.4 rule 2: an op runs after the worlds it overwrites and before the children it does not overwrite, so an
    // op may write a parent together with its children (a limb's whole subtree) without closing a cycle.
    const writtenControls = new Set(op.writesControls);
    const writtenNodes = new Set(op.writesNodes);
    for (const id of op.writesControls) {
      edges.push([controlEntry.get(id) as number, entry]);
      for (const child of children.get(id) ?? []) {
        if (!writtenControls.has(child)) edges.push([entry, controlEntry.get(child) as number]);
      }
      const node = drivenBy.get(id);
      if (node !== undefined && !writtenNodes.has(node)) edges.push([entry, boneEntry[node] as number]);
    }
    for (const node of op.writesNodes) {
      edges.push([boneEntry[node] as number, entry]);
      for (const child of context.nodeChildren(node)) {
        if (!writtenNodes.has(child)) edges.push([entry, boneEntry[child] as number]);
      }
    }
  }
  // An op that writes a world another op reads runs first.
  pending.forEach((writer, w) => {
    pending.forEach((reader, r) => {
      if (w === r) return;
      const touches =
        writer.writesControls.some((id) => reader.readsControls.includes(id) || reader.writesControls.includes(id)) ||
        writer.writesNodes.some((node) => reader.readsNodes.includes(node) || reader.writesNodes.includes(node));
      if (touches && compareOps(writer, reader) < 0) edges.push([opEntries[w] as number, opEntries[r] as number]);
    });
  });

  const sorted = topologicalSort(nodes, edges);

  // Cycle repair: a dropped control → control edge detaches the child; a dropped edge at an op disables the op.
  const detached = new Set<ControlId>();
  for (const drop of sorted.dropped) {
    const from = entries[drop.from] as GraphEntry;
    const to = entries[drop.to] as GraphEntry;
    const ids = drop.cycle.map((index) => entryId(entries[index] as GraphEntry));
    if (from.kind === 'op' || to.kind === 'op') {
      const op = from.kind === 'op' ? from.op : (to as { readonly op: PendingOp }).op;
      op.disabled = true;
      warnings.push({
        code: 'cycle',
        message: `${op.record.id}: dependency cycle (${ids.join(' → ')}); the ${op.kind} is disabled`,
        ids,
      });
    } else if (to.kind === 'control') {
      detached.add(to.control.id);
      warnings.push({
        code: 'cycle',
        message: `${to.control.key}: parent cycle (${ids.join(' → ')}); the control hangs off the character root`,
        ids,
      });
    }
  }

  // Slots in schedule order; the schedule interleaves control, bone and op steps.
  const slotControls: ControlRecord[] = [];
  const slotOf = new Map<ControlId, number>();
  for (const index of sorted.order) {
    const entry = entries[index] as GraphEntry;
    if (entry.kind !== 'control') continue;
    slotOf.set(entry.control.id, slotControls.length);
    slotControls.push(entry.control);
  }
  const parents = slotControls.map((control) => {
    if (control.parent === null || detached.has(control.id)) return -1;
    return slotOf.get(control.parent) ?? -1;
  });
  const customOps: ScheduledRigOp[] = [];
  const kinds: number[] = [];
  const indices: number[] = [];
  for (const index of sorted.order) {
    const entry = entries[index] as GraphEntry;
    if (entry.kind === 'control') {
      kinds.push(OP_CONTROL);
      indices.push(slotOf.get(entry.control.id) as number);
    } else if (entry.kind === 'bone') {
      kinds.push(OP_BONE);
      indices.push(entry.node);
    } else if (!entry.op.disabled) {
      kinds.push(OP_CUSTOM);
      indices.push(customOps.length);
      customOps.push({
        record: entry.op.record,
        impl: entry.op.impl,
        writesControls: Int32Array.from(entry.op.writesControls.map((id) => slotOf.get(id) as number)),
        writesNodes: Int32Array.from(entry.op.writesNodes),
        readsControls: Int32Array.from(entry.op.readsControls.map((id) => slotOf.get(id) as number)),
        readsNodes: Int32Array.from(entry.op.readsNodes),
        state: undefined,
        skipped: false,
      });
    }
  }

  // §5.4 rule 4: RigProgram.limbs lists the enabled ik2 solvers that scheduled, in solver-id order.
  const limbs = buildLimbs(customOps, context, skeleton, warnings);

  const internals = buildInternals(
    {
      skeleton,
      controls: slotControls,
      parents,
      schedule: { kind: Uint8Array.from(kinds), index: Int32Array.from(indices) },
      customOps,
      attrs,
      limbs,
    },
    warnings,
  );
  checkRig(internals, warnings);
  const program = createProgram(rigId, internals, warnings);

  // §5.4 rule 1, last step: each op's optional compile with the finished program.
  for (const op of customOps) {
    if (op.impl.compile === undefined) continue;
    try {
      op.state = op.impl.compile(op.record, { ...context, program });
    } catch (error) {
      op.skipped = true;
      warnings.push({
        code: 'unsupported-op',
        message: `${op.record.id} (${op.record.type}) failed to compile: ${String(error)}; it is skipped`,
        ids: [op.record.id],
      });
    }
  }
  return program;
}

/**
 * The compile-time view handed to op implementations (M2A-SPEC §4.3): known before scheduling, so `reads`/`writes`
 * may already use attribute slots. Control children are ordered by `order`, then id; node children by index.
 */
function compileContext(
  skeleton: SkeletonDesc,
  controls: ReadonlyMap<ControlId, ControlRecord>,
  children: ReadonlyMap<ControlId, readonly ControlId[]>,
  resolveBone: (ref: BoneRef) => number,
  attrIndex: ReadonlyMap<string, number>,
): RigOpCompileContext {
  const sortedChildren = new Map<ControlId, readonly ControlId[]>();
  for (const [parent, list] of children) {
    sortedChildren.set(
      parent,
      [...list].sort((a, b) => {
        const oa = controls.get(a)?.order ?? '';
        const ob = controls.get(b)?.order ?? '';
        if (oa !== ob) return oa < ob ? -1 : 1;
        return a < b ? -1 : a > b ? 1 : 0;
      }),
    );
  }
  const nodeChildren: number[][] = skeleton.nodes.map(() => []);
  skeleton.nodes.forEach((node, index) => {
    const parent = node.parent;
    if (Number.isInteger(parent) && parent >= 0 && parent < index) nodeChildren[parent]?.push(index);
  });
  const none: readonly never[] = [];
  return {
    skeleton,
    controls,
    resolveBone,
    attrSlot: (control: ControlId, name: string): number => attrIndex.get(`${control}/@${name}`) ?? -1,
    controlChildren: (control: ControlId): readonly ControlId[] => sortedChildren.get(control) ?? none,
    nodeChildren: (node: number): readonly number[] => nodeChildren[node] ?? none,
  };
}

function entryId(entry: GraphEntry): string {
  if (entry.kind === 'control') return entry.control.id;
  if (entry.kind === 'op') return entry.op.record.id;
  return `node:${entry.node}`;
}

function compareOps(a: PendingOp, b: PendingOp): number {
  const pa = a.kind === 'constraint' ? PRIORITY_CONSTRAINT : PRIORITY_SOLVER;
  const pb = b.kind === 'constraint' ? PRIORITY_CONSTRAINT : PRIORITY_SOLVER;
  if (pa !== pb) return pa - pb;
  return a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;
}

/** Records of this rig that are not soft-deleted, unique by id (the first occurrence wins), sorted by id. */
function liveRecords<T extends { readonly id: string; readonly rig: string; readonly deleted: unknown }>(
  records: readonly T[],
  rigId: string,
  what: string,
  warnings: RigWarning[],
): T[] {
  const seen = new Map<string, T>();
  for (const record of records) {
    if (record === null || typeof record !== 'object' || typeof record.id !== 'string') continue;
    if (record.deleted !== null && record.deleted !== undefined) continue;
    if (record.rig !== rigId) {
      warnings.push({
        code: 'dangling-ref',
        message: `${what} ${record.id} belongs to rig ${record.rig}, not ${rigId}; ignored`,
        ids: [record.id],
      });
      continue;
    }
    if (!seen.has(record.id)) seen.set(record.id, record);
  }
  return [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function collectOps(
  kind: RigOpKind,
  records: readonly (ConstraintRecord | SolverRecord)[],
  controls: ReadonlyMap<ControlId, ControlRecord>,
  skeleton: SkeletonDesc,
  warnings: RigWarning[],
  context: RigOpCompileContext,
): PendingOp[] {
  const ops: PendingOp[] = [];
  for (const record of records) {
    if (record.enabled !== true) continue;
    const impl = lookupRigOp(kind, record.type);
    if (impl === undefined) {
      warnings.push({
        code: 'unsupported-op',
        message: `${kind} ${record.id} (${record.type}) has no implementation in this version; it is disabled`,
        ids: [record.id],
      });
      continue;
    }
    let reads: ReturnType<RigOpImpl['reads']>;
    let writes: ReturnType<RigOpImpl['writes']>;
    try {
      reads = impl.reads(record, context);
      writes = impl.writes(record, context);
    } catch (error) {
      warnings.push({
        code: 'unsupported-op',
        message: `${kind} ${record.id} (${record.type}) could not declare its dependencies: ${String(error)}`,
        ids: [record.id],
      });
      continue;
    }
    const missing = [...reads.controls, ...writes.controls].filter((id) => !controls.has(id));
    const badNodes = [...reads.nodes, ...writes.nodes].filter(
      (node) => !Number.isInteger(node) || node < 0 || node >= skeleton.nodes.length,
    );
    if (missing.length > 0 || badNodes.length > 0) {
      warnings.push({
        code: 'dangling-ref',
        message: `${kind} ${record.id} references missing controls or bones; it is disabled`,
        ids: [record.id, ...missing],
      });
      continue;
    }
    ops.push({
      kind,
      record,
      impl,
      readsControls: [...new Set(reads.controls)],
      readsNodes: [...new Set(reads.nodes)],
      writesControls: [...new Set(writes.controls)],
      writesNodes: [...new Set(writes.nodes)],
      disabled: false,
    });
  }
  return ops;
}

/** A rest bend against the hinge beyond this warns (§5.2.1). */
const HYPEREXTENDED_REST = (2 * Math.PI) / 180;

/**
 * LimbDesc of every scheduled `ik2` solver (§5.4 rule 4), in solver-id order (the schedule's custom ops are in
 * schedule order). A host-registered `ik2` implementation whose params are not `Ik2Params` gets no limb. Warns for
 * a hyperextended rest (§5.2.1, `asymmetric-rest` reused) and for a second solver on the same limb (the first in
 * id order owns the limb's IK/FK state).
 */
function buildLimbs(
  customOps: readonly ScheduledRigOp[],
  context: RigOpCompileContext,
  skeleton: SkeletonDesc,
  warnings: RigWarning[],
): LimbDesc[] {
  const candidates = customOps
    .filter((op) => op.record.type === 'ik2' && 'enabled' in op.record && !('target' in op.record))
    .map((op) => op.record as SolverRecord)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (candidates.length === 0) return [];
  const rest = restWorlds(skeleton);
  const limbs: LimbDesc[] = [];
  for (const record of candidates) {
    let limb: LimbDesc;
    try {
      limb = buildLimbDesc(record, context, rest);
    } catch {
      continue;
    }
    if (limbs.some((other) => other.id === limb.id)) {
      warnings.push({
        code: 'duplicate-binding',
        message: `${record.id}: ${LIMB_TEMPLATES[limb.id].label} already has the IK solver ${limbs.find((o) => o.id === limb.id)?.solver}`,
        ids: [record.id],
      });
    }
    const { upper, mid, end } = limb.nodes;
    const at = (node: number): [number, number, number] => [
      rest.t[node * 3] as number,
      rest.t[node * 3 + 1] as number,
      rest.t[node * 3 + 2] as number,
    ];
    const a = at(upper);
    const b = at(mid);
    const c = at(end);
    const u: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: [number, number, number] = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const k: [number, number, number] = [limb.params.hinge[0], limb.params.hinge[1], limb.params.hinge[2]];
    const bend = bendOf(u, v, k, [0, 0, 0]);
    if (bend < -HYPEREXTENDED_REST) {
      const t = LIMB_TEMPLATES[limb.id];
      const band = restBand(u, v, k);
      const mm = (m: number): string => (m * 1000).toFixed(m < 1e-3 ? 2 : 1);
      warnings.push({
        code: 'asymmetric-rest',
        message: `${t.label}: the rest pose bends the ${t.joint} ${((-bend * 180) / Math.PI).toFixed(1)}° against its hinge (hyperextended); IK straightens it towards full reach and passes to the normal bend over the first ${mm(band.depth)} mm closer than the rest, where the ${t.joint === 'knee' ? 'foot' : 'hand'} may pass its target by up to ${mm(band.overshoot)} mm`,
        ids: [record.id],
      });
    }
    limbs.push(limb);
  }
  return limbs;
}
