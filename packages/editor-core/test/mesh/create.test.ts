// M6A-SPEC §5.16, §6.2, §6.3 (B7): `mesh.create.<kind>` — authored scene meshes at the origin, faceted (every edge
// hard), live parameters with the preferred default set, the default palette, derived ids kept by an adjusted
// re-run, unique names, selection and object mode, creation into a template group with its symmetry, undo/redo.
import { derivedId, type MeshId } from '@ekza-animator/doc';
import { makeTestGroup, makeTestPalette } from '@ekza-animator/doc/testing';
import { EDGE_HARD } from '@ekza-animator/mesh-core';
import { describe, expect, it } from 'vitest';
import { type LastRun, runSeedOf } from '../../src';
import { DEFAULT_PALETTE_ID } from '../../src/operators/builtin/create';
import { flushMicrotasks, meshTestApp } from './support';
import { READY } from './ready';

const counts = (t: Awaited<ReturnType<typeof meshTestApp>>, id: string) => {
  const c = t.app.meshes.get(id as MeshId)?.data()?.counts;
  return c === undefined ? null : `${c.points}/${c.edges}/${c.faces}`;
};

/** What B11's LastRun recorder will store for the latest run (the runner's recorder is a no-op until then). */
function recordLastRun(t: Awaited<ReturnType<typeof meshTestApp>>, id: string, args: Record<string, unknown>): void {
  const seed = runSeedOf(t.app)?.seed ?? '';
  const lastRun: LastRun = {
    id: id as LastRun['id'],
    label: 'Cube',
    params: [],
    args: args as never,
    kind: null,
    stepId: 0,
    docSeqAfter: t.app.store.version,
    paneId: null,
    source: 'menu',
    adjustable: true,
    repeatable: true,
    tool: null,
    targets: [],
    seed,
    context: { symmetry: {}, soft: null },
    closed: null,
  };
  t.app.session.setState({ lastRun });
}

describe('mesh.create.* (§5.16)', () => {
  it('creates a faceted cube at the origin with its parameters, selected, in object mode (one step)', async () => {
    const t = await meshTestApp();
    t.app.session.setState({ model: { ...t.app.session.getState().model, componentMode: 'face' } });
    const result = await t.app.run('mesh.create.cube', { subdivisionsWidth: 2 });
    expect(result.status).toBe('finished');
    const id = (result as { value: { mesh: MeshId } }).value.mesh;
    expect(id).toBe(derivedId('mesh', 'mesh.create.cube', [], runSeedOf(t.app)?.seed ?? '', 0));
    expect(counts(t, id)).toBe('12/20/10');
    const record = t.app.store.get('meshes', id);
    expect(record).toMatchObject({
      name: 'Cube',
      owner: { scene: true },
      parent: null,
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      pivot: [0, 0, 0],
      source: null,
      faceted: true,
      palette: null,
      material: { preset: 'unlit' },
      colourOutput: 'palette-texture',
      generator: {
        kind: 'cube',
        version: 1,
        params: { width: 1, height: 1, depth: 1, subdivisionsWidth: 2, subdivisionsHeight: 1, subdivisionsDepth: 1 },
      },
      data: { rev: 1, base: null, joints: [] },
    });
    const data = t.app.meshes.get(id)?.data();
    expect([...(data?.edgeFlags ?? [])].every((f) => (f & EDGE_HARD) !== 0)).toBe(true);
    // Centred at the origin.
    const p = [...(data?.position ?? [])];
    for (let k = 0; k < 3; k++) {
      const axis = p.filter((_, i) => i % 3 === k);
      expect(Math.min(...axis) + Math.max(...axis)).toBeCloseTo(0, 9);
    }
    const state = t.app.session.getState();
    expect(state.selection.objects).toEqual([id]);
    expect(state.model.componentMode).toBe('object');
    expect(t.app.history.peekUndo()?.label).toBe('Cube');
    t.app.history.undo();
    expect(t.app.store.get('meshes', id)).toBeUndefined();
    expect(t.app.meshes.get(id)).toBeUndefined();
    t.app.history.redo();
    expect(counts(t, id)).toBe('12/20/10');
  });

  it('names meshes uniquely per owner and gives every run a new id', async () => {
    const t = await meshTestApp();
    const a = await t.app.run('mesh.create.plane');
    const b = await t.app.run('mesh.create.plane');
    const ids = [a, b].map((r) => (r as { value: { mesh: MeshId } }).value.mesh);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids.map((id) => t.app.store.get('meshes', id)?.name)).toEqual(['Plane', 'Plane 2']);
    expect(counts(t, ids[0] as string)).toBe('4/4/1');
  });

  it('an adjusted re-run (card, same operator) reuses the seed: same id, new parameters', async () => {
    const t = await meshTestApp();
    const first = await t.app.run('mesh.create.cube', { subdivisionsWidth: 2 });
    const id = (first as { value: { mesh: MeshId } }).value.mesh;
    recordLastRun(t, 'mesh.create.cube', { subdivisionsWidth: 2 });
    // edit.adjustLast: undo, then the re-run from the card.
    t.app.history.undo();
    const again = await t.app.run('mesh.create.cube', { subdivisionsWidth: 3 }, { source: 'card' });
    expect((again as { value: { mesh: MeshId } }).value.mesh).toBe(id);
    expect(counts(t, id)).toBe('16/28/14');
    expect(t.app.store.get('meshes', id)?.generator?.params['subdivisionsWidth']).toBe(3);
  });

  it('assigns the default palette when the project has one', async () => {
    const t = await meshTestApp();
    t.app.store.transact({ label: 'Palette' }, (tx) =>
      tx.put('palettes', makeTestPalette(DEFAULT_PALETTE_ID, { name: 'Ekza Default 16' })),
    );
    const result = await t.app.run('mesh.create.cube');
    const id = (result as { value: { mesh: MeshId } }).value.mesh;
    expect(t.app.store.get('meshes', id)?.palette).toBe(DEFAULT_PALETTE_ID);
  });

  it('creates into the selected template group with its symmetry (humanoid: Object X)', async () => {
    const t = await meshTestApp();
    t.app.store.transact({ label: 'Group' }, (tx) =>
      tx.put('groups', makeTestGroup('grp_Humanoid', { name: 'Humanoid', template: { kind: 'humanoid', params: {} } })),
    );
    t.app.session.setState({
      selection: { ...t.app.session.getState().selection, objects: ['grp_Humanoid' as never] },
    });
    const result = await t.app.run('mesh.create.cube');
    const id = (result as { value: { mesh: MeshId } }).value.mesh;
    expect(t.app.store.get('meshes', id)).toMatchObject({ parent: 'grp_Humanoid', owner: { scene: true } });
    expect(t.app.session.getState().model.symmetry.get(id)).toEqual({
      mode: 'object-x',
      tolerance: t.app.prefs.getState().modeling.symmetryTolerance,
      preserveSeam: true,
    });
    // A plain group (no template) is not a creation target.
    t.app.store.transact({ label: 'Group' }, (tx) => tx.put('groups', makeTestGroup('grp_Plain', { name: 'Plain' })));
    t.app.session.setState({ selection: { ...t.app.session.getState().selection, objects: ['grp_Plain' as never] } });
    const plain = await t.app.run('mesh.create.cube');
    expect(t.app.store.get('meshes', (plain as { value: { mesh: MeshId } }).value.mesh)?.parent).toBeNull();
  });

  it("uses Maya's defaults with the 'maya' preference", async () => {
    const t = await meshTestApp();
    t.app.prefs.setState({ modeling: { ...t.app.prefs.getState().modeling, primitiveDefaults: 'maya' } });
    const result = await t.app.run('mesh.create.cylinder');
    const id = (result as { value: { mesh: MeshId } }).value.mesh;
    expect(t.app.store.get('meshes', id)?.generator?.params).toMatchObject({
      radius: 1,
      height: 2,
      subdivisionsAxis: 20,
    });
    expect(counts(t, id)).toBe('40/60/22');
  });

  it.skipIf(READY.b1)('poll-fails the kinds the reference kernel cannot build until B1 lands', async () => {
    const t = await meshTestApp();
    for (const kind of ['sphere', 'cone', 'torus'] as const) {
      expect(t.app.operators.poll(`mesh.create.${kind}`, undefined, {})).toEqual({
        ok: false,
        reason: `${kind[0]?.toUpperCase()}${kind.slice(1)} is not available yet`,
      });
    }
  });

  it.skipIf(!READY.b1)(
    '[READY.b1] creates sphere, cone and torus with the low-poly defaults (§5.29 oracles)',
    async () => {
      const t = await meshTestApp();
      const expected = { sphere: '86/180/96', cone: '9/16/9', torus: '72/144/72' } as const;
      for (const [kind, c] of Object.entries(expected)) {
        const result = await t.app.runUntyped(`mesh.create.${kind}`, {});
        await flushMicrotasks();
        expect(counts(t, (result as { value: { mesh: MeshId } }).value.mesh)).toBe(c);
      }
    },
  );
});
