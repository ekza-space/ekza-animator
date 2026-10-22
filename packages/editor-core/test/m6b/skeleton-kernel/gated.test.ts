// C2 tests that need other packages (M6B-SPEC §9.0 mutual gates, §3 rule 4): with C1's `char.fromModel` (no stand-in)
// Create Skeleton adopts the scene meshes (generator null, frozen placement) in the same step; with C1's
// `updateAutoRig` a rename keeps every control id (P-J6 through `jointKeys`); with C4's solver a confirmed re-run on a
// bound character rebinds every bound mesh in the "Refit Skeleton" step.
import type { MeshId, SkeletonId } from '@ekza-studio/doc';
import { DEFAULT_FLEXION } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { createMesh, meshTestApp } from '../../mesh/support';
import { READY } from '../../m6b-ready';
import { cubeLadData, ladMeshes, rigTestApp, truthMarkers } from './support';

const commit = (meshes: readonly MeshId[]) => ({
  preset: 'standard33',
  markers: truthMarkers(),
  meshes,
  flexion: DEFAULT_FLEXION,
});

describe.skipIf(!READY.c1)('with C1 (char.fromModel, updateAutoRig)', () => {
  it('Create Skeleton adopts the scene mesh through the real char.fromModel in one step', async () => {
    const t = await meshTestApp();
    await t.app.rig.load();
    const lad = createMesh(t, 'msh_cubeLad00000000', cubeLadData(), {
      name: 'Cube Lad',
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    });
    const before = t.app.history.peekUndo()?.id ?? null;
    const result = await t.app.runUntyped('skel.quickRig.commit', commit([lad]));
    expect(result.status).toBe('finished');
    const adopted = t.app.store.list('meshes');
    expect(adopted).toHaveLength(1);
    expect(adopted[0]?.generator).toBeNull();
    expect(adopted[0] !== undefined && 'character' in adopted[0].owner).toBe(true);
    t.app.history.undo();
    expect(t.app.history.peekUndo()?.id ?? null).toBe(before);
    expect(t.app.store.get('meshes', lad)).toBeDefined();
  });

  it('a rename keeps every control id (P-J6 through the joint keys)', async () => {
    const t = await rigTestApp();
    const result = await t.app.runUntyped('skel.quickRig.commit', commit([t.lad]));
    const { skeleton, character } = (result as { value: { skeleton: SkeletonId; character: string } }).value;
    const rig = t.app.store.query.rigOfCharacter(character as never)?.id as never;
    const ids = t.app.store.query
      .controlsOfRig(rig)
      .map((c) => c.id)
      .sort();
    await t.app.runUntyped('skel.joint.rename', { joint: `${skeleton}:leftHand`, name: 'paw_L' });
    expect(
      t.app.store.query
        .controlsOfRig(rig)
        .map((c) => c.id)
        .sort(),
    ).toEqual(ids);
  });
});

describe.skipIf(!READY.c4)('with C4 (the bind solver)', () => {
  it('a confirmed re-run on a bound character refits and rebinds in one "Refit Skeleton" step', async () => {
    const t = await rigTestApp();
    await t.app.runUntyped('skel.quickRig.commit', commit([t.lad]));
    expect((await t.app.runUntyped('skin.bind', {})).status).toBe('finished');
    const meshes = ladMeshes(t.app);
    const refs = () => meshes.map((id) => t.app.store.get('meshes', id)?.data);
    const bound = refs();
    const knee = [-0.1, 0.46, 0.03] as const;
    const result = await t.app.runUntyped('skel.quickRig.commit', {
      ...commit(meshes),
      markers: { ...truthMarkers(), knee },
      confirm: true,
    });
    expect(result.status).toBe('finished');
    expect(t.app.history.peekUndo()?.label).toBe('Refit Skeleton');
    // The step wrote a new revision of every bound mesh, palette included (INT: with C4's real solver the Cube Lad's
    // boxes bind rigidly, so a knee nudge can leave the weights themselves unchanged — the rebind is asserted by the
    // revision and by equality with a fresh Bind Skin over the refitted joints).
    const refit = refs();
    expect(refit.map((ref) => ref?.rev)).toEqual(bound.map((ref) => (ref?.rev ?? 0) + 1));
    expect(refit.every((ref) => (ref?.joints.length ?? 0) > 0)).toBe(true);
    expect((await t.app.runUntyped('skin.bind', { confirm: true })).status).toBe('finished');
    expect(refs().map((ref) => [ref?.manifest, ref?.joints])).toEqual(refit.map((ref) => [ref?.manifest, ref?.joints]));
    // Undo removes the refit and its rebind in one step.
    t.app.history.undo();
    t.app.history.undo();
    expect(refs().map((ref) => ref?.manifest)).toEqual(bound.map((ref) => ref?.manifest));
  });
});
