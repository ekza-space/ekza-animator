// Scene objects (M6A-SPEC §5.13, §6.2; B13): group (pivot at the bounding-box centre, world transforms kept), parent
// and unparent (same owner, no cycles, world kept), duplicate (shared revision, unique names, subtrees), delete
// (descendants, selection), rename and mesh attributes (record patches, never component edits).
import { type ReadonlyXf, xfIdentity } from '@ekza-studio/anim-core';
import type { GroupId, MeshId } from '@ekza-studio/doc';
import { makeTestGroup, makeTestMesh } from '@ekza-studio/doc/testing';
import { describe, expect, it } from 'vitest';
import { objectWorld, sceneObject } from '../../../src';
import { type MeshTestApp, meshTestApp, pollReason, runValue, selectObjects } from './support';

async function cube(t: MeshTestApp, args?: object): Promise<MeshId> {
  return (await runValue<{ mesh: MeshId }>(t, 'mesh.create.cube', args)).mesh;
}

function move(t: MeshTestApp, id: string, placement: ReadonlyXf): void {
  t.app.store.transact({ label: 'Move' }, (tx) =>
    id.startsWith('grp_')
      ? tx.patch('groups', id as GroupId, { placement })
      : tx.patch('meshes', id as MeshId, { placement }),
  );
}

const at = (x: number, y: number, z: number, s = 1): ReadonlyXf => ({ t: [x, y, z], q: [0, 0, 0, 1], s: [s, s, s] });

function world(t: MeshTestApp, id: string): ReadonlyXf {
  const object = sceneObject(t.app.store, id);
  if (object === undefined) throw new Error(`no ${id}`);
  return objectWorld(t.app.store, object);
}

function expectSameWorld(a: ReadonlyXf, b: ReadonlyXf): void {
  for (let i = 0; i < 3; i++) {
    expect(a.t[i]).toBeCloseTo(b.t[i] as number, 9);
    expect(a.s[i]).toBeCloseTo(b.s[i] as number, 9);
  }
  for (let i = 0; i < 4; i++) expect(Math.abs(a.q[i] as number)).toBeCloseTo(Math.abs(b.q[i] as number), 9);
}

describe('scene.group (Mod+G)', () => {
  it('groups the selection with the pivot at the bounding-box centre and keeps world transforms', async () => {
    const t = await meshTestApp();
    const a = await cube(t);
    const b = await cube(t);
    move(t, a, at(2, 0, 0));
    move(t, b, at(-1, 1, 0));
    const before = [world(t, a), world(t, b)];
    selectObjects(t, [a, b]);
    const { group } = await runValue<{ group: GroupId }>(t, 'scene.group');
    const record = t.app.store.get('groups', group);
    expect(record).toMatchObject({ name: 'Group', parent: null, template: null, placement: xfIdentity() });
    // bounds: x −1.5…2.5, y −0.5…1.5, z −0.5…0.5 → centre (0.5, 0.5, 0)
    expect(record?.pivot).toEqual([0.5, 0.5, 0]);
    expect(t.app.store.get('meshes', a)?.parent).toBe(group);
    expect(t.app.store.get('meshes', b)?.parent).toBe(group);
    expectSameWorld(world(t, a), before[0] as ReadonlyXf);
    expectSameWorld(world(t, b), before[1] as ReadonlyXf);
    expect(t.app.session.getState().selection.objects).toEqual([group]);
    expect(t.app.history.peekUndo()?.label).toBe('Group');
    t.app.history.undo();
    expect(t.app.store.get('groups', group)).toBeUndefined();
    expect(t.app.store.get('meshes', a)?.parent).toBeNull();
  });

  it('groups under the common parent; nested picks group only the topmost; an empty group goes to the root', async () => {
    const t = await meshTestApp();
    const a = await cube(t);
    const b = await cube(t);
    t.app.store.transact({ label: 'Outer' }, (tx) =>
      tx.put('groups', makeTestGroup('grp_Outer', { placement: at(0, 3, 0) })),
    );
    selectObjects(t, [a, b, 'grp_Outer']);
    await runValue(t, 'scene.parent');
    const worldA = world(t, a);
    selectObjects(t, [a, b]);
    const { group } = await runValue<{ group: GroupId }>(t, 'scene.group');
    expect(t.app.store.get('groups', group)?.parent).toBe('grp_Outer');
    expectSameWorld(world(t, a), worldA);
    // the pivot is in the group's (= the parent's) space: the cubes stayed at the world origin, 3 m below Outer
    expect(t.app.store.get('groups', group)?.pivot).toEqual([0, -3, 0]);
    selectObjects(t, [group, a]);
    const nested = await runValue<{ group: GroupId }>(t, 'scene.group');
    expect(t.app.store.get('groups', group)?.parent).toBe(nested.group);
    expect(t.app.store.get('meshes', a)?.parent).toBe(group);
    const empty = await runValue<{ group: GroupId }>(t, 'scene.group', { ids: [] });
    expect(t.app.store.get('groups', empty.group)).toMatchObject({ parent: null, pivot: [0, 0, 0], name: 'Group 4' }); // 'Group' is grp_Outer
    selectObjects(t, []);
    expect(pollReason(t, 'scene.group')).toBe('Select objects to group');
  });

  it('refuses objects of different owners and imported meshes', async () => {
    const t = await meshTestApp();
    const a = await cube(t);
    t.app.store.transact({ label: 'Asset' }, (tx) => {
      tx.put('meshes', makeTestMesh('msh_Char', { owner: { character: 'chr_A' as never } }));
      tx.put('meshes', makeTestMesh('msh_Asset', { source: { asset: 'a'.repeat(64) as never, mesh: 0 } }));
    });
    expect(pollReason(t, 'scene.group', { ids: [a, 'msh_Char'] })).toMatch(/one owner/);
    expect(pollReason(t, 'scene.group', { ids: ['msh_Asset'] })).toMatch(/Imported meshes/);
  });
});

describe('scene.parent / scene.unparent (P, Shift+P)', () => {
  it('parents to the last selected object keeping world transforms, and unparents back', async () => {
    const t = await meshTestApp();
    const child = await cube(t);
    const parent = await cube(t);
    move(t, child, at(1, 2, 3));
    move(t, parent, { t: [5, 0, 0], q: [0, Math.SQRT1_2, 0, Math.SQRT1_2], s: [2, 2, 2] });
    const before = world(t, child);
    selectObjects(t, [child, parent]);
    await runValue(t, 'scene.parent');
    expect(t.app.store.get('meshes', child)?.parent).toBe(parent);
    expectSameWorld(world(t, child), before);
    expect(t.app.store.get('meshes', child)?.placement.t).not.toEqual([1, 2, 3]);
    selectObjects(t, [child]);
    await runValue(t, 'scene.unparent');
    expect(t.app.store.get('meshes', child)?.parent).toBeNull();
    expectSameWorld(world(t, child), before);
    expect(pollReason(t, 'scene.unparent')).toBe('Select parented objects');
  });

  it('refuses cycles, other owners, a group under a mesh and a missing parent', async () => {
    const t = await meshTestApp();
    const a = await cube(t);
    const b = await cube(t);
    selectObjects(t, [b, a]);
    await runValue(t, 'scene.parent'); // b under a
    expect(pollReason(t, 'scene.parent', { ids: [a], parent: b })).toMatch(/under itself or its own child/);
    expect(pollReason(t, 'scene.parent', { ids: [a], parent: a })).toMatch(/under itself/);
    t.app.store.transact({ label: 'Other' }, (tx) => {
      tx.put('meshes', makeTestMesh('msh_Char', { owner: { character: 'chr_A' as never } }));
      tx.put('groups', makeTestGroup('grp_G'));
    });
    expect(pollReason(t, 'scene.parent', { ids: [a], parent: 'msh_Char' })).toBe('Parent objects of one owner only');
    expect(pollReason(t, 'scene.parent', { ids: ['grp_G'], parent: a })).toBe(
      'A group can only be parented under a group',
    );
    selectObjects(t, [a]);
    expect(pollReason(t, 'scene.parent')).toBe('Select the children, then the parent last');
  });
});

describe('scene.duplicate (Mod+D)', () => {
  it('copies meshes with a shared revision, live parameters and unique names, selected, right after the original', async () => {
    const t = await meshTestApp();
    const a = await cube(t, { subdivisionsWidth: 2 });
    move(t, a, at(1, 0, 0));
    selectObjects(t, [a]);
    const { created } = await runValue<{ created: MeshId[] }>(t, 'scene.duplicate');
    expect(created).toHaveLength(1);
    const copy = t.app.store.get('meshes', created[0] as MeshId);
    const original = t.app.store.get('meshes', a);
    expect(copy?.id).not.toBe(a);
    expect(copy?.name).toBe('Cube 2');
    expect(copy?.data).toEqual(original?.data);
    expect(copy?.generator).toEqual(original?.generator);
    expect(copy?.placement).toEqual(original?.placement);
    expect(copy?.palette).toBe(original?.palette);
    expect((copy?.order ?? '') > (original?.order ?? '')).toBe(true);
    expect(t.app.session.getState().selection.objects).toEqual(created);
    await expect.poll(() => t.app.meshes.get(created[0] as MeshId)?.data()?.counts.faces).toBe(10);
    t.app.history.undo();
    expect(t.app.store.get('meshes', created[0] as MeshId)).toBeUndefined();
  });

  it('copies a group with its subtree; refuses imported meshes', async () => {
    const t = await meshTestApp();
    const a = await cube(t);
    const b = await cube(t);
    selectObjects(t, [a, b]);
    const { group } = await runValue<{ group: GroupId }>(t, 'scene.group');
    selectObjects(t, [group]);
    const { created } = await runValue<{ created: string[] }>(t, 'scene.duplicate');
    const copy = created[0] as GroupId;
    const children = t.app.store.query.childrenOf(copy, 'scene');
    expect(children.map((c) => c.name).sort()).toEqual(['Cube 3', 'Cube 4']);
    expect(t.app.store.get('groups', copy)?.name).toBe('Group 2');
    t.app.store.transact({ label: 'Asset' }, (tx) =>
      tx.put('meshes', makeTestMesh('msh_Asset', { source: { asset: 'a'.repeat(64) as never, mesh: 0 } })),
    );
    expect(pollReason(t, 'scene.duplicate', { ids: ['msh_Asset'] })).toMatch(/Duplicate Face/);
  });
});

describe('scene.delete', () => {
  it('soft-deletes objects with their descendants and drops them from the selection and the hilite', async () => {
    const t = await meshTestApp();
    const a = await cube(t);
    const b = await cube(t);
    const c = await cube(t);
    selectObjects(t, [a, b]);
    const { group } = await runValue<{ group: GroupId }>(t, 'scene.group');
    t.app.session.setState({ model: { ...t.app.session.getState().model, hilite: [a, c] } });
    selectObjects(t, [group, c]);
    const { count } = await runValue<{ count: number }>(t, 'scene.delete', { ids: [group] });
    expect(count).toBe(3);
    expect([a, b].map((id) => t.app.store.get('meshes', id))).toEqual([undefined, undefined]);
    expect(t.app.store.get('groups', group)).toBeUndefined();
    expect(t.app.session.getState().selection.objects).toEqual([c]);
    expect(t.app.session.getState().model.hilite).toEqual([c]);
    expect(t.app.history.peekUndo()?.label).toBe('Delete Objects');
    t.app.history.undo();
    expect(t.app.store.get('meshes', a)?.parent).toBe(group);
  });
});

describe('scene.rename and mesh.setAttributes', () => {
  it('renames with unique mesh names per owner; groups keep any name', async () => {
    const t = await meshTestApp();
    const a = await cube(t);
    const b = await cube(t);
    await runValue(t, 'scene.rename', { id: b, name: ' Cube ' });
    expect(t.app.store.get('meshes', b)?.name).toBe('Cube 2');
    await runValue(t, 'scene.rename', { id: a, name: 'Crate' });
    expect(t.app.store.get('meshes', a)?.name).toBe('Crate');
    await runValue(t, 'scene.rename', { id: b, name: 'Cube' });
    expect(t.app.store.get('meshes', b)?.name).toBe('Cube');
    expect(pollReason(t, 'scene.rename', { id: a, name: '  ' })).toBe('The name must not be empty');
    // a rename keeps the live parameters (not a component edit, §5.5 rule 9)
    expect(t.app.store.get('meshes', a)?.generator?.kind).toBe('cube');
  });

  it('patches mesh attributes with validation; grips are clamped; groups take name, budget and grip', async () => {
    const t = await meshTestApp();
    const a = await cube(t);
    await runValue(t, 'mesh.setAttributes', {
      mesh: a,
      patch: { faceted: false, colourOutput: 'vertex-colour', material: { preset: 'lit' }, budget: { tris: 500 } },
    });
    expect(t.app.store.get('meshes', a)).toMatchObject({
      faceted: false,
      colourOutput: 'vertex-colour',
      material: { preset: 'lit' },
      budget: { tris: 500 },
    });
    expect(t.app.store.get('meshes', a)?.generator?.kind).toBe('cube');
    expect(pollReason(t, 'mesh.setAttributes', { mesh: a, patch: { material: { preset: 'toon' } } })).toBe(
      'Toon palette arrives with the VRM writer (v0.4)',
    );
    expect(pollReason(t, 'mesh.setAttributes', { mesh: a, patch: { budget: { preset: 'huge' } } })).toBe(
      'unknown preset',
    );
    expect(pollReason(t, 'mesh.setAttributes', { mesh: a, patch: { bogus: 1 } })).toMatch(/no attribute 'bogus'/);
    expect(pollReason(t, 'mesh.setAttributes', { mesh: a, patch: {} })).toBe('Nothing to change');
    await runValue(t, 'mesh.setAttributes', {
      mesh: a,
      patch: { handheld: { bone: 'leftHand', offset: [1, 0, -1], rotationDegrees: [400, 0, 0], scale: 9 } },
    });
    expect(t.app.store.get('meshes', a)?.handheld).toEqual({
      bone: 'leftHand',
      offset: [0.3, 0, -0.3],
      rotationDegrees: [360, 0, 0],
      scale: 2,
    });
    t.app.store.transact({ label: 'Group' }, (tx) => tx.put('groups', makeTestGroup('grp_G')));
    await runValue(t, 'mesh.setAttributes', {
      mesh: 'grp_G',
      patch: { budget: { preset: 'handheld' }, name: 'Sword' },
    });
    expect(t.app.store.get('groups', 'grp_G' as GroupId)).toMatchObject({
      budget: { preset: 'handheld' },
      name: 'Sword',
    });
    expect(pollReason(t, 'mesh.setAttributes', { mesh: 'grp_G', patch: { faceted: true } })).toMatch(
      /A group has no attribute/,
    );
    t.app.store.transact({ label: 'Asset' }, (tx) =>
      tx.put('meshes', makeTestMesh('msh_Asset', { source: { asset: 'a'.repeat(64) as never, mesh: 0 } })),
    );
    expect(pollReason(t, 'mesh.setAttributes', { mesh: 'msh_Asset', patch: { material: { preset: 'lit' } } })).toBe(
      'Imported meshes keep their materials',
    );
    await runValue(t, 'mesh.setAttributes', { mesh: 'msh_Asset', patch: { faceted: true } });
  });
});
