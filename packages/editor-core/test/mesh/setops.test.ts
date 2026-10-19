// M6A-SPEC §5.13 (B7 runner): MeshSetOps commit in one transaction — updated inputs get new revisions, `new:<n>`
// outputs become records with derived ids (an adjusted re-run with the same seed reuses them), removed inputs are
// soft-deleted, the op's writes into its inputs are aborted, and the pre-op MeshData of every input is kept. The ops
// here are test MeshSetOps against the contract; B4's real ones run through the same runner.
import { derivedId, type MeshId, type MeshRef } from '@ekza-animator/doc';
import { makeTestGroup } from '@ekza-animator/doc/testing';
import {
  type MeshSetInput,
  type MeshSetOp,
  type MeshSetResult,
  primitive,
  refuse,
  selectionOf,
} from '@ekza-animator/mesh-core';
import { describe, expect, it } from 'vitest';
import type { OperatorDef } from '../../src';
import { createMesh, cube, meshTestApp, type MeshTestApp } from './support';

const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;

function setOp(id: string, arity: 'one' | 'many', run: (inputs: readonly MeshSetInput[]) => MeshSetResult): MeshSetOp {
  return {
    id: id as `mesh.${string}`,
    label: id.slice('mesh.test.'.length),
    arity,
    params: [],
    flags: { adjustable: true, repeatable: true, topology: true, manifoldPreserving: false },
    poll: (inputs) => (arity === 'many' && inputs.length < 2 ? refuse('test.arity', 'Needs two meshes') : true),
    run: (inputs) => run(inputs),
  };
}

/** Keeps the input (as a plane) and splits off two cubes; writes into its input first (must be aborted). */
const split = setOp('mesh.test.split', 'one', (inputs) => {
  const input = inputs[0] as MeshSetInput;
  input.mesh.setPosition(0, 5, 5, 5);
  const c = cube();
  return {
    outputs: [
      {
        key: input.key,
        data: primitive('plane', {}),
        placement: input.placement,
        materials: input.materials,
        from: [input.key],
        selection: null,
        name: 'kept',
      },
      {
        key: 'new:0',
        data: c,
        placement: { ...IDENTITY, t: [11, 0, 0] },
        materials: ['preset:lit'],
        from: [input.key],
        selection: selectionOf('face', [0], c.counts),
        name: 'Piece',
      },
      {
        key: 'new:1',
        data: c,
        placement: input.placement,
        materials: input.materials,
        from: [input.key],
        selection: null,
        name: 'Piece',
      },
    ],
    removed: [],
    warnings: [{ code: 'test.split', message: 'split' }],
  };
});

/** Keeps the first input (as a 2-wide cube) and removes the others. */
const merge = setOp('mesh.test.merge', 'many', (inputs) => ({
  outputs: [
    {
      key: (inputs[0] as MeshSetInput).key,
      data: primitive('cube', { subdivisionsWidth: 2 }),
      placement: (inputs[0] as MeshSetInput).placement,
      materials: (inputs[0] as MeshSetInput).materials,
      from: inputs.map((i) => i.key),
      selection: null,
      name: 'merged',
    },
  ],
  removed: inputs.slice(1).map((i) => i.key),
  warnings: [],
}));

const refusing = setOp('mesh.test.refuseSet', 'one', () => refuse('test.no', 'Never') as never);

function register(t: MeshTestApp, op: MeshSetOp, seed: () => string): void {
  const def: OperatorDef<unknown, unknown, void> = {
    id: op.id,
    label: op.label,
    category: 'mesh',
    scope: 'model',
    flags: { undo: true, adjustable: true, repeatable: true },
    params: op.params,
    extraArgs: ['meshes', 'kind'],
    apply(ctx, raw) {
      const meshes = (raw as { meshes?: MeshId[] } | undefined)?.meshes ?? [];
      return t.meshes.commitSetOp(ctx.tx as never, op, meshes, {}, { seed: seed(), kind: null });
    },
  };
  t.app.operators.register(def);
}

describe('MeshSetOp runner (§5.13)', () => {
  it('updates inputs, creates derived-id records under the same parent, aborts writes into inputs (one step)', async () => {
    const t = await meshTestApp();
    t.app.store.transact({ label: 'Group' }, (tx) =>
      tx.put('groups', makeTestGroup('grp_G', { name: 'G', placement: { ...IDENTITY, t: [10, 0, 0] } })),
    );
    const id = createMesh(t, 'msh_In', cube(), {
      parent: 'grp_G' as never,
      generator: { kind: 'cube', params: {}, version: 1 },
      palette: 'pal_P' as never,
    });
    const before = t.app.store.get('meshes', id)?.data as MeshRef;
    register(t, split, () => 'seed-1');
    const result = await t.app.runUntyped('mesh.test.split', { meshes: [id] });
    expect(result.status).toBe('finished');
    const value = (
      result as { value: { created: MeshId[]; updated: MeshId[]; removed: MeshId[]; warnings: unknown[] } }
    ).value;
    const created = [0, 1].map((n) => derivedId('mesh', 'mesh.test.split', [id], 'seed-1', n));
    expect(value).toMatchObject({ created, updated: [id], removed: [], warnings: [{ code: 'test.split' }] });
    // The input: a new revision with the output's data, generator null (a component edit).
    const input = t.app.store.get('meshes', id);
    expect(input).toMatchObject({ generator: null, data: { rev: 2, base: before.manifest } });
    expect(t.app.meshes.get(id)?.data()?.counts).toEqual(primitive('plane', {}).counts);
    // New records: same owner and parent, local placement under the group, unique names, faceted, palette.
    const [a, b] = created.map((c) => t.app.store.get('meshes', c));
    expect(a).toMatchObject({
      name: 'Piece',
      parent: 'grp_G',
      owner: { scene: true },
      placement: { t: [1, 0, 0] },
      faceted: true,
      palette: 'pal_P',
      generator: null,
      source: null,
      material: { preset: 'lit' },
      data: { rev: 1, base: null },
    });
    expect(b?.name).toBe('Piece 2');
    expect(a !== undefined && b !== undefined && a.order < b.order).toBe(true);
    expect(t.app.meshes.get(created[0] as MeshId)?.data()?.counts).toEqual(cube().counts);
    // Output selections are kept (component selections until B10: the runtime's fallback).
    expect(t.meshes.localSelection(created[0] as MeshId)?.faces.has(0)).toBe(true);
    // The pre-op MeshData of the input is the last set-op's.
    expect(t.meshes.lastSetOp?.opId).toBe('mesh.test.split');
    expect(t.meshes.lastSetOp?.inputs.get(id)?.counts).toEqual(cube().counts);
    expect(t.meshes.lastSetOp?.inputs.get(id)?.position[0]).not.toBe(5);
    expect(t.meshes.lastSetOp?.outputs).toEqual([id, 'new:0', 'new:1']);
    expect(t.app.history.peekUndo()?.label).toBe('split');
    // Undo restores the input and removes the created records; redo brings them back.
    t.app.history.undo();
    expect(t.app.store.get('meshes', id)?.data).toEqual(before);
    expect(t.app.meshes.get(id)?.data()?.counts).toEqual(cube().counts);
    expect(created.map((c) => t.app.store.get('meshes', c))).toEqual([undefined, undefined]);
    t.app.history.redo();
    expect(created.map((c) => t.app.store.get('meshes', c)?.name)).toEqual(['Piece', 'Piece 2']);
  });

  it('an adjusted re-run with the same seed reuses the derived ids', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_In');
    register(t, split, () => 'seed-x');
    const first = await t.app.runUntyped('mesh.test.split', { meshes: [id] });
    const ids = (first as { value: { created: MeshId[] } }).value.created;
    t.app.history.undo();
    const again = await t.app.runUntyped('mesh.test.split', { meshes: [id] });
    expect((again as { value: { created: MeshId[] } }).value.created).toEqual(ids);
  });

  it('soft-deletes removed inputs and disposes their runtimes', async () => {
    const t = await meshTestApp();
    const a = createMesh(t, 'msh_A');
    const b = createMesh(t, 'msh_B');
    register(t, merge, () => 'seed');
    const result = await t.app.runUntyped('mesh.test.merge', { meshes: [a, b] });
    expect(result).toMatchObject({ status: 'finished', value: { updated: [a], removed: [b], created: [] } });
    expect(t.app.store.get('meshes', b)).toBeUndefined();
    expect(t.app.store.getIncludingDeleted('meshes', b)?.deleted).not.toBeNull();
    expect(t.app.meshes.get(b)).toBeUndefined();
    expect(t.app.meshes.get(a)?.data()?.counts).toEqual(primitive('cube', { subdivisionsWidth: 2 }).counts);
    t.app.history.undo();
    expect(t.app.meshes.get(b)?.state).toBe('ready');
  });

  it('a refusal or a failed poll writes nothing (op-refused, no step)', async () => {
    const t = await meshTestApp();
    const a = createMesh(t, 'msh_A');
    register(t, refusing, () => 'seed');
    register(t, merge, () => 'seed');
    expect(await t.app.runUntyped('mesh.test.refuseSet', { meshes: [a] })).toMatchObject({
      status: 'failed',
      error: { code: 'op-refused', message: 'Never' },
    });
    expect(await t.app.runUntyped('mesh.test.merge', { meshes: [a] })).toMatchObject({
      status: 'failed',
      error: { code: 'op-refused', message: 'Needs two meshes' },
    });
    expect(t.app.history.peekUndo()?.label).toBe('Create');
    expect(t.app.meshes.get(a)?.isOpen).toBe(false);
  });
});
