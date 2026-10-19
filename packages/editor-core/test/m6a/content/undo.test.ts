// M6A-SPEC §10.2 editor-core gate for B13's operators: each one, run on a valid case, is one history step whose undo
// restores the document exactly and whose redo gives back exactly what the run wrote.
import type { MeshId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE_ID, swatchIdFor } from '../../../src';
import { type MeshTestApp, meshTestApp, paintFaces, PNG_1X1, runValue, selectObjects } from './support';

interface Case {
  readonly name: string;
  /** Builds the starting state; returns the operator id and args to check. */
  readonly setup: (t: MeshTestApp) => Promise<readonly [string, unknown]>;
}

async function cube(t: MeshTestApp): Promise<MeshId> {
  return (await runValue<{ mesh: MeshId }>(t, 'mesh.create.cube')).mesh;
}

async function plane(t: MeshTestApp): Promise<string> {
  return (await runValue<{ id: string }>(t, 'imagePlane.import', { camera: 'front', bytes: PNG_1X1 })).id;
}

const CASES: readonly Case[] = [
  { name: 'scene.group', setup: async (t) => ['scene.group', { ids: [await cube(t)] }] },
  {
    name: 'scene.parent',
    setup: async (t) => {
      const a = await cube(t);
      const { group } = await runValue<{ group: string }>(t, 'scene.group', { ids: [] });
      return ['scene.parent', { ids: [a], parent: group }];
    },
  },
  {
    name: 'scene.unparent',
    setup: async (t) => {
      const a = await cube(t);
      await runValue(t, 'scene.group', { ids: [a] });
      return ['scene.unparent', { ids: [a] }];
    },
  },
  { name: 'scene.duplicate', setup: async (t) => ['scene.duplicate', { ids: [await cube(t)] }] },
  { name: 'scene.delete', setup: async (t) => ['scene.delete', { ids: [await cube(t)] }] },
  { name: 'scene.rename', setup: async (t) => ['scene.rename', { id: await cube(t), name: 'Crate' }] },
  {
    name: 'mesh.setAttributes',
    setup: async (t) => [
      'mesh.setAttributes',
      { mesh: await cube(t), patch: { faceted: false, colourOutput: 'vertex-colour', budget: { tris: 500 } } },
    ],
  },
  { name: 'palette.ensureDefault', setup: () => Promise.resolve(['palette.ensureDefault', undefined] as const) },
  { name: 'palette.create', setup: () => Promise.resolve(['palette.create', { name: 'Team' }] as const) },
  {
    name: 'palette.duplicate',
    setup: async (t) => {
      await cube(t);
      return ['palette.duplicate', { palette: DEFAULT_PALETTE_ID }];
    },
  },
  {
    name: 'palette.rename',
    setup: async (t) => {
      await cube(t);
      return ['palette.rename', { palette: DEFAULT_PALETTE_ID, name: 'Mine' }];
    },
  },
  {
    name: 'palette.addSwatch',
    setup: async (t) => {
      await cube(t);
      return ['palette.addSwatch', { palette: DEFAULT_PALETTE_ID, srgb: [1, 2, 3] }];
    },
  },
  {
    name: 'palette.setSwatch',
    setup: async (t) => {
      await cube(t);
      return ['palette.setSwatch', { swatch: swatchIdFor(DEFAULT_PALETTE_ID, 4), srgb: [255, 0, 0], name: 'Hot' }];
    },
  },
  {
    name: 'palette.removeSwatch',
    setup: async (t) => {
      await cube(t);
      return ['palette.removeSwatch', { swatch: swatchIdFor(DEFAULT_PALETTE_ID, 15) }];
    },
  },
  {
    name: 'palette.assign',
    setup: async (t) => {
      const a = await cube(t);
      const { palette } = await runValue<{ palette: string }>(t, 'palette.create', { name: 'Other' });
      return ['palette.assign', { meshes: [a], palette }];
    },
  },
  {
    name: 'palette.replaceSwatch',
    setup: async (t) => {
      const a = await cube(t);
      paintFaces(t, a, [0, 1], 4);
      return ['palette.replaceSwatch', { palette: DEFAULT_PALETTE_ID, from: 4, to: 9 }];
    },
  },
  {
    name: 'imagePlane.import',
    setup: () => Promise.resolve(['imagePlane.import', { camera: 'side', name: 'Side', bytes: PNG_1X1 }] as const),
  },
  {
    name: 'imagePlane.set',
    setup: async (t) => ['imagePlane.set', { id: await plane(t), patch: { size: 1.8, opacity: 0.4, locked: true } }],
  },
  { name: 'imagePlane.delete', setup: async (t) => ['imagePlane.delete', { id: await plane(t) }] },
  ...(['prop', 'handheld', 'humanoid', 'humanoidBody'] as const).map(
    (template): Case => ({
      name: `mesh.create.template ${template}`,
      setup: () => Promise.resolve(['mesh.create.template', { template }] as const),
    }),
  ),
  {
    name: 'mesh.primitive.set',
    setup: async (t) => {
      const { mesh } = await runValue<{ mesh: MeshId }>(t, 'mesh.create.cylinder');
      return ['mesh.primitive.set', { mesh, params: { subdivisionsAxis: 10 } }];
    },
  },
];

describe('B13 operators: one step, undo and redo exact (§10.2)', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const t = await meshTestApp();
    t.app.session.setState({ workspace: 'model' });
    const [op, args] = await c.setup(t);
    selectObjects(t, []);
    const before = t.app.store.snapshot();
    const steps = t.app.store.undo.entries().undo.length;
    await runValue(t, op, args);
    const after = t.app.store.snapshot();
    expect(after).not.toEqual(before);
    expect(t.app.store.undo.entries().undo.length).toBe(steps + 1);
    t.app.history.undo();
    expect(t.app.store.snapshot()).toEqual(before);
    t.app.history.redo();
    expect(t.app.store.snapshot()).toEqual(after);
  });
});
