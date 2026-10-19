// The MeshSetOp runner (M6A-SPEC §5.13, ADR 0014 D7): Combine, Separate, Extract, Duplicate Faces. In the operator's
// one transaction it writes new revisions for updated inputs, creates `MeshRecord`s for `new:<n>` outputs with
// `derivedId('mesh', op.id, inputIds, seed, n)` (an adjusted re-run with the same seed reuses the ids), soft-deletes
// removed inputs and keeps the pre-op MeshData of every input (the last set-op, §5.5 rule 5). The op runs on the
// inputs' EditMeshes inside kernel transactions that are aborted afterwards: inputs change only through the outputs.
import { EkzaError, type ParamValues, type ReadonlyXf } from '@ekza-animator/anim-core';
import { derivedId, type MeshId, type MeshRecord, type MeshRef, type Tx } from '@ekza-animator/doc';
import type {
  ComponentKind,
  ComponentSelection,
  MeshData,
  MeshSetInput,
  MeshSetOp,
  MeshSetResult,
  Refusal,
} from '@ekza-animator/mesh-core';
import { DEFAULT_DEPS } from '../app/deps';
import type { MeshSetCommitResult } from '../types';
import { epsilonOf } from './context';
import type { MeshKernel } from './kernel';
import {
  localFromWorld,
  materialKeys,
  materialOfKeys,
  orderAfterSiblings,
  skeletonKey,
  uniqueMeshName,
} from './records';
import type { MeshRuntimeImpl } from './runtime';
import { refJointsOf } from './skin';

export interface SetOpRun {
  readonly tx: Tx;
  readonly kernel: MeshKernel;
  readonly op: MeshSetOp;
  readonly inputs: readonly MeshId[];
  readonly args: ParamValues;
  readonly seed: string;
  readonly kind: ComponentKind | null;
  readonly selection?: ReadonlyMap<MeshId, ComponentSelection>;
  /** The ready runtime of an input, in sync with the transaction's ref. */
  runtime(id: MeshId): MeshRuntimeImpl;
  selectionFor(id: MeshId, kind: ComponentKind): ComponentSelection | null;
  placement(record: MeshRecord): ReadonlyXf;
  storeRevision(data: MeshData, prior: MeshRef | null, joints: readonly string[]): MeshRef;
}

export interface SetOpOutcome {
  readonly result: MeshSetCommitResult;
  readonly preOp: ReadonlyMap<MeshId, MeshData>;
  readonly outputKeys: readonly string[];
  readonly selections: ReadonlyMap<MeshId, ComponentSelection | null>;
}

const isRefusal = (x: unknown): x is Refusal =>
  typeof x === 'object' && x !== null && (x as { refused?: unknown }).refused === true;

const NEW_KEY = /^new:(\d+)$/;

export function runSetOp(run: SetOpRun): SetOpOutcome {
  const { tx, op, kernel } = run;
  if (run.inputs.length === 0) throw new EkzaError('op-refused', 'Select a mesh first');
  const records = new Map<MeshId, MeshRecord>();
  const runtimes = new Map<MeshId, MeshRuntimeImpl>();
  const wasOpen = new Map<MeshId, boolean>();
  const preOp = new Map<MeshId, MeshData>();
  const setInputs: MeshSetInput[] = [];
  for (const id of run.inputs) {
    const runtime = run.runtime(id);
    const record = tx.get('meshes', id);
    if (record === undefined || record.data === null) throw new EkzaError('invalid-record', `No mesh record ${id}`);
    records.set(id, record);
    runtimes.set(id, runtime);
    wasOpen.set(id, runtime.isOpen);
    const mesh = runtime.ensureLineage();
    preOp.set(id, runtime.data() as MeshData);
    const selection = run.selection?.get(id) ?? (run.kind === null ? null : run.selectionFor(id, run.kind));
    setInputs.push({
      key: id,
      mesh,
      selection,
      placement: run.placement(record),
      palette: record.palette,
      skeleton: skeletonKey(record),
      assetBacked: record.source !== null,
      materials: materialKeys(record.material),
    });
  }
  const close = (): void => {
    for (const [id, runtime] of runtimes) if (wasOpen.get(id) !== true) runtime.close();
  };

  const verdict = op.poll(setInputs, run.args);
  if (verdict !== true) {
    close();
    throw new EkzaError('op-refused', verdict.reason, { code: verdict.code });
  }
  const first = records.get(run.inputs[0] as MeshId) as MeshRecord;
  const firstData = preOp.get(run.inputs[0] as MeshId) as MeshData;
  // The op may write into an input (appendMesh): every input runs inside a kernel transaction aborted afterwards.
  for (const input of setInputs) input.mesh.begin(op.id);
  let result: MeshSetResult | Refusal;
  try {
    result = op.run(setInputs, run.args, {
      hidden: null,
      faceted: first.faceted,
      curves: DEFAULT_DEPS.curves.engine,
      epsilon: epsilonOf(firstData.position, firstData.counts.points),
    });
  } finally {
    for (const input of setInputs) input.mesh.abort();
    close();
  }
  if (isRefusal(result)) throw new EkzaError('op-refused', result.reason, { code: result.code });

  const created: MeshId[] = [];
  const updated: MeshId[] = [];
  const removed: MeshId[] = [];
  const selections = new Map<MeshId, ComponentSelection | null>();
  const names = new Set<string>();
  const inputSet = new Set<string>(run.inputs);
  for (const output of result.outputs) {
    const sources = (output.from.length > 0 ? output.from : [run.inputs[0] as string])
      .map((key) => records.get(key as MeshId))
      .filter((r): r is MeshRecord => r !== undefined);
    const source = sources[0] ?? first;
    const faceted = sources.every((r) => r.faceted);
    const palette = sources.find((r) => r.palette !== null)?.palette ?? null;
    if (inputSet.has(output.key)) {
      const id = output.key as MeshId;
      const record = records.get(id) as MeshRecord;
      const ref = run.storeRevision(output.data, record.data, refJointsOf(record, output.data));
      tx.patch('meshes', id, {
        data: ref,
        placement: localFromWorld(tx, record.owner, record.parent, output.placement),
        material: materialOfKeys(output.materials, record.material),
        faceted,
        palette: record.palette ?? palette,
        generator: null,
      });
      updated.push(id);
      selections.set(id, output.selection);
      continue;
    }
    const match = NEW_KEY.exec(output.key);
    if (match === null) throw new EkzaError('invalid-mesh', `${op.id}: unknown output key '${output.key}'`);
    const n = Number(match[1]);
    let id = derivedId('mesh', op.id, run.inputs, run.seed, n) as MeshId;
    // A record with the derived id still exists (soft-deleted by a later edit): never overwrite it.
    for (let k = 1; tx.getIncludingDeleted('meshes', id) !== undefined; k++) {
      id = derivedId('mesh', op.id, run.inputs, `${run.seed}:${k}`, n) as MeshId;
    }
    const skin = source.source !== null ? null : source.skin;
    const record: MeshRecord = {
      id,
      name: uniqueMeshName(tx, source.owner, output.name, names),
      owner: source.owner,
      parent: source.parent,
      order: orderAfterSiblings(tx, source.owner, source.parent, source.order),
      placement: localFromWorld(tx, source.owner, source.parent, output.placement),
      pivot: source.pivot,
      source: null,
      data: run.storeRevision(output.data, null, refJointsOf({ skin }, output.data)),
      faceted,
      generator: null,
      palette,
      material: materialOfKeys(output.materials, source.source !== null ? { preset: 'unlit' } : source.material),
      colourOutput: source.colourOutput,
      skin,
      budget: null,
      handheld: null,
      deleted: null,
    };
    names.add(record.name);
    tx.put('meshes', record);
    created.push(id);
    selections.set(id, output.selection);
  }
  for (const key of result.removed) {
    if (!inputSet.has(key)) continue;
    tx.softDelete('meshes', key as MeshId);
    removed.push(key as MeshId);
  }
  return {
    result: { created, updated, removed, warnings: result.warnings },
    preOp,
    outputKeys: result.outputs.map((o) => o.key),
    selections,
  };
}
