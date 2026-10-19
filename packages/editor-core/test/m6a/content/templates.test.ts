// Templates and live primitive parameters (M6A-SPEC §5.16, §6.2; B13): prop, handheld, humanoid guides and the
// humanoid body with derived ids; a cube created with the Humanoid group selected is its child with Object X
// symmetry; `mesh.primitive.set` regenerates until the first component edit freezes the parameters (renames, palette
// and attribute changes keep them).
import type { GroupId, MeshId } from '@ekza-animator/doc';
import { derivedId } from '@ekza-animator/doc';
import { MESH_OPS } from '@ekza-animator/mesh-core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE_ID, FROZEN_REASON, type LastRun, runSeedOf } from '../../../src';
import { counts, type MeshTestApp, meshTestApp, paintFaces, pollReason, runValue, selectObjects } from './support';

type Created = { root: string; created: string[] };

/** World-space min/max Y of a mesh child of an identity-placed group (placement translation + local positions). */
function worldYRange(t: MeshTestApp, id: MeshId): [number, number] {
  const record = t.app.store.get('meshes', id);
  const data = t.app.meshes.get(id)?.data();
  if (record === undefined || data === undefined || data === null) throw new Error('no mesh');
  let lo = Infinity;
  let hi = -Infinity;
  for (let v = 0; v < data.counts.points; v++) {
    const y = (data.position[3 * v + 1] as number) + record.placement.t[1];
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return [lo, hi];
}

function recordLastRun(t: MeshTestApp, id: string, args: Record<string, unknown>): void {
  const lastRun: LastRun = {
    id: id as LastRun['id'],
    label: 'New From Template',
    params: [],
    args: args as never,
    kind: null,
    stepId: 0,
    docSeqAfter: t.app.store.version,
    paneId: null,
    source: 'menu',
    adjustable: true,
    repeatable: false,
    tool: null,
    targets: [],
    seed: runSeedOf(t.app)?.seed ?? '',
    context: { symmetry: {}, soft: null },
    closed: null,
  };
  t.app.session.setState({ lastRun });
}

describe('mesh.create.template (§5.16)', () => {
  it('prop: a "Prop" group (small-prop budget) with a cube standing on the ground, pivot at its bottom centre', async () => {
    const t = await meshTestApp();
    const { root, created } = await runValue<Created>(t, 'mesh.create.template', { template: 'prop' });
    const seed = runSeedOf(t.app)?.seed ?? '';
    expect(root).toBe(derivedId('group', 'mesh.create.template', [], seed, 0));
    expect(created).toEqual([root, derivedId('mesh', 'mesh.create.template', [], seed, 1)]);
    const group = t.app.store.get('groups', root as GroupId);
    expect(group).toMatchObject({
      name: 'Prop',
      template: { kind: 'prop', params: {} },
      budget: { preset: 'small-prop' },
      handheld: null,
      parent: null,
    });
    const cube = created[1] as MeshId;
    expect(t.app.store.get('meshes', cube)).toMatchObject({
      parent: root,
      pivot: [0, -0.5, 0],
      faceted: true,
      palette: DEFAULT_PALETTE_ID,
      generator: { kind: 'cube' },
    });
    expect(worldYRange(t, cube)).toEqual([0, 1]);
    expect(counts(t, cube)).toBe('8/12/6');
    expect(t.app.session.getState().selection.objects).toEqual([root]);
    expect(t.app.history.peekUndo()?.label).toBe('Prop Template');
    t.app.history.undo();
    expect(t.app.store.get('groups', root as GroupId)).toBeUndefined();
    expect(t.app.store.get('meshes', cube)).toBeUndefined();
  });

  it('handheld: grip defaults, handheld budget, a 0.04 × 0.3 × 0.04 m cube on the grip', async () => {
    const t = await meshTestApp();
    const { root, created } = await runValue<Created>(t, 'mesh.create.template', { template: 'handheld' });
    expect(t.app.store.get('groups', root as GroupId)).toMatchObject({
      name: 'Handheld',
      template: { kind: 'handheld' },
      budget: { preset: 'handheld' },
      handheld: { bone: 'rightHand', offset: [0, 0, 0], rotationDegrees: [0, 0, 0], scale: 1 },
    });
    const cube = created[1] as MeshId;
    expect(t.app.store.get('meshes', cube)?.generator?.params).toMatchObject({ width: 0.04, height: 0.3, depth: 0.04 });
    const [lo, hi] = worldYRange(t, cube);
    expect(lo).toBeCloseTo(0, 6);
    expect(hi).toBeCloseTo(0.3, 6);
  });

  it('humanoid guides: a "Humanoid" group with height and preset, hero budget, no mesh', async () => {
    const t = await meshTestApp();
    const { root, created } = await runValue<Created>(t, 'mesh.create.template', {
      template: 'humanoid',
      height: 1.8,
      preset: 'chibi',
    });
    expect(created).toEqual([root]);
    expect(t.app.store.get('groups', root as GroupId)).toMatchObject({
      name: 'Humanoid',
      template: { kind: 'humanoid', params: { height: 1.8, preset: 'chibi' } },
      budget: { preset: 'hero' },
    });
    expect(t.app.store.list('meshes')).toHaveLength(0);
    expect(t.app.history.peekUndo()?.label).toBe('Humanoid Guides');
  });

  it('a cube created with the Humanoid group selected is its child with Object X symmetry', async () => {
    const t = await meshTestApp();
    const { root } = await runValue<Created>(t, 'mesh.create.template', { template: 'humanoid' });
    expect(t.app.session.getState().selection.objects).toEqual([root]);
    const { mesh } = await runValue<{ mesh: MeshId }>(t, 'mesh.create.cube');
    expect(t.app.store.get('meshes', mesh)?.parent).toBe(root);
    expect(t.app.session.getState().model.symmetry.get(mesh)?.mode).toBe('object-x');
  });

  it('humanoid body: one live mesh (494 tris smooth), into a selected Humanoid group with Object X', async () => {
    const t = await meshTestApp();
    const body = await runValue<Created>(t, 'mesh.create.template', { template: 'humanoidBody', height: 1.6 });
    const id = body.root as MeshId;
    expect(body.created).toEqual([id]);
    expect(t.app.store.get('meshes', id)).toMatchObject({
      name: 'Body',
      parent: null,
      faceted: true,
      generator: { kind: 'humanoidBody', params: { height: 1.6, style: 'smooth' } },
    });
    expect(t.app.meshes.get(id)?.triangulation().tris.length).toBe(494 * 3);
    expect(t.app.history.peekUndo()?.label).toBe('Humanoid Body');
    const guides = await runValue<Created>(t, 'mesh.create.template', { template: 'humanoid' });
    const inGroup = await runValue<Created>(t, 'mesh.create.template', {
      template: 'humanoidBody',
      style: 'segmented',
    });
    expect(t.app.store.get('meshes', inGroup.root as MeshId)).toMatchObject({ parent: guides.root, name: 'Body 2' });
    expect(t.app.session.getState().model.symmetry.get(inGroup.root as MeshId)?.mode).toBe('object-x');
    expect(t.app.meshes.get(inGroup.root as MeshId)?.triangulation().tris.length).toBe(560 * 3);
  });

  it('an adjusted re-run (card) keeps the derived ids', async () => {
    const t = await meshTestApp();
    const first = await runValue<Created>(t, 'mesh.create.template', { template: 'humanoidBody', height: 1.6 });
    recordLastRun(t, 'mesh.create.template', { template: 'humanoidBody', height: 1.6 });
    t.app.history.undo();
    const again = await runValue<Created>(
      t,
      'mesh.create.template',
      { template: 'humanoidBody', height: 2 },
      { source: 'card' },
    );
    expect(again.root).toBe(first.root);
    expect(t.app.store.get('meshes', again.root as MeshId)?.generator?.params['height']).toBe(2);
  });

  it('polls the template id', async () => {
    const t = await meshTestApp();
    expect(pollReason(t, 'mesh.create.template', { template: 'dragon' })).toMatch(/expects \{ template/);
    expect(pollReason(t, 'mesh.create.template')).toMatch(/expects \{ template/);
  });
});

describe('mesh.primitive.set (live parameters, §5.16)', () => {
  it('regenerates the cylinder with the merged parameters: same id, rev + 1, one undoable step', async () => {
    const t = await meshTestApp();
    const { mesh } = await runValue<{ mesh: MeshId }>(t, 'mesh.create.cylinder');
    expect(counts(t, mesh)).toBe('16/24/10');
    const rev = t.app.store.get('meshes', mesh)?.data?.rev ?? 0;
    await runValue(t, 'mesh.primitive.set', { mesh, params: { subdivisionsAxis: 10 } });
    expect(counts(t, mesh)).toBe('20/30/12');
    expect(t.app.store.get('meshes', mesh)?.data?.rev).toBe(rev + 1);
    await runValue(t, 'mesh.primitive.set', {
      mesh,
      params: { ...t.app.store.get('meshes', mesh)?.generator?.params, subdivisionsHeight: 2 },
    });
    expect(counts(t, mesh)).toBe('30/50/22');
    expect(t.app.store.get('meshes', mesh)?.generator?.params).toMatchObject({
      subdivisionsAxis: 10,
      subdivisionsHeight: 2,
      radius: 0.5,
    });
    expect(t.app.history.peekUndo()?.label).toBe('Primitive Parameters');
    t.app.history.undo();
    expect(counts(t, mesh)).toBe('20/30/12');
    expect(t.app.store.get('meshes', mesh)?.generator?.params['subdivisionsHeight']).toBe(1);
  });

  it('renames, attribute and palette changes keep the parameters; the first component edit freezes them', async () => {
    const t = await meshTestApp();
    const { mesh } = await runValue<{ mesh: MeshId }>(t, 'mesh.create.cube');
    await runValue(t, 'scene.rename', { id: mesh, name: 'Crate' });
    await runValue(t, 'mesh.setAttributes', { mesh, patch: { faceted: false, budget: { tris: 12 } } });
    const { palette } = await runValue<{ palette: string }>(t, 'palette.create', { name: 'P' });
    await runValue(t, 'palette.assign', { palette, meshes: [mesh] });
    selectObjects(t, [mesh]);
    await runValue(t, 'scene.duplicate');
    expect(t.app.store.get('meshes', mesh)?.generator?.kind).toBe('cube');
    expect(pollReason(t, 'mesh.primitive.set', { mesh, params: { subdivisionsWidth: 2 } })).toBeNull();
    // a component edit through the runtime (Assign Colour): the generator goes null in the same step
    expect(MESH_OPS['mesh.paint']).toBeDefined();
    paintFaces(t, mesh, [0], 3);
    expect(t.app.store.get('meshes', mesh)?.generator).toBeNull();
    expect(pollReason(t, 'mesh.primitive.set', { mesh, params: { subdivisionsWidth: 2 } })).toBe(FROZEN_REASON);
    t.app.history.undo();
    expect(t.app.store.get('meshes', mesh)?.generator?.kind).toBe('cube');
  });

  it('polls its args and unknown meshes', async () => {
    const t = await meshTestApp();
    expect(pollReason(t, 'mesh.primitive.set', { mesh: 'msh_nope', params: {} })).toBe('Unknown mesh msh_nope');
    expect(pollReason(t, 'mesh.primitive.set', { mesh: 'msh_nope' })).toBe('expects { mesh, params }');
  });
});
