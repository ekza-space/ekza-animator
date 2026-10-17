// WP-3 rig records through a document store (shared test kit store until WP-2's memory store lands).
import type { ConstraintId, ConstraintRecord, SolverId, SolverRecord } from '@ekza-animator/doc';
import { createNaiveStore } from '@ekza-animator/editor-core/testing';
import { autoRig, compileRig, readRigDefinition, type SkeletonDesc, writeRigDefinition } from '@ekza-animator/rig';
import { readSyntheticFixture } from '@ekza-animator/doc/testing';
import { describe, expect, it } from 'vitest';

const IDS = { character: 'chr_DefinitionTest01' as never, rig: 'rig_DefinitionTest01' as never };

describe('rig: write/read rig definitions', () => {
  const skeleton = readSyntheticFixture('humanoid-skeleton.json') as SkeletonDesc;

  it('writes a new rig with put only and reads the same definition back', () => {
    const store = createNaiveStore();
    const def = autoRig(skeleton, IDS);
    const constraint: ConstraintRecord = {
      id: 'cns_DefinitionTest01' as ConstraintId,
      rig: IDS.rig,
      type: 'parent',
      driven: { control: def.controls[3]?.id as never },
      targets: {},
      maintainOffset: false,
      params: {},
      enabled: false,
      deleted: null,
    };
    const solver: SolverRecord = {
      id: 'slv_DefinitionTest01' as SolverId,
      rig: IDS.rig,
      type: 'footRoll',
      params: {},
      enabled: false,
      deleted: null,
    };
    store.transact({ label: 'Import' }, (tx) =>
      writeRigDefinition(tx, { ...def, controls: [...def.controls].reverse(), constraints: [constraint], solvers: [solver] }),
    );
    const read = readRigDefinition(store, IDS.rig);
    expect(read?.rig).toEqual(def.rig);
    expect(new Set(read?.controls.map((c) => c.id))).toEqual(new Set(def.controls.map((c) => c.id)));
    expect(read?.constraints).toEqual([constraint]);
    expect(read?.solvers).toEqual([solver]);
    // Compiling the stored records gives the same program as compiling the generated definition.
    const a = compileRig(def, skeleton);
    const b = compileRig(read as NonNullable<typeof read>, skeleton);
    expect(b.controlIds).toEqual(a.controlIds);
    expect(readRigDefinition(store, 'rig_Missing000000001' as never)).toBeUndefined();
  });

  it('omits soft-deleted controls', () => {
    const store = createNaiveStore();
    const def = autoRig(skeleton, IDS);
    store.transact({ label: 'Import' }, (tx) => writeRigDefinition(tx, def));
    const toes = def.controls.find((c) => c.key === 'fk.toes.L');
    if (toes === undefined) throw new Error('missing control');
    store.transact({ label: 'Delete' }, (tx) => tx.softDelete('controls', toes.id));
    expect(readRigDefinition(store, IDS.rig)?.controls.some((c) => c.id === toes.id)).toBe(false);
  });
});
