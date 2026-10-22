// The C2 test-API group (M6B-SPEC §4.8; skeleton kernel): templateJoints, quickRigGuess (start checks and the
// One-Click guess over the world triangles), quickRigFit (the preview Create Skeleton writes) and skeletonChecks.
import type { DocSnapshot, MeshId, MeshRecord, MeshRef } from '@ekza-studio/doc';
import { loadMeshKernel } from '@ekza-studio/editor-core';
import { naiveCurveEngine } from '@ekza-studio/editor-core/testing';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApi } from '../src/test-api/createTestApi';
import { DEFAULT_PARAMS } from '../src/test-api/params';
import { readSynthetic } from './render';
import { createTestShell } from './shell-helpers';

let snapshot: DocSnapshot;
let skeleton: SkeletonDesc;
beforeAll(async () => {
  snapshot = (await readSynthetic('wave-doc.json')) as DocSnapshot;
  skeleton = (await readSynthetic('humanoid-skeleton.json')) as SkeletonDesc;
});

type Api = {
  templateJoints(preset: string, height: number): { key: string; parent: string | null; position: number[] }[];
  quickRigGuess(meshes: string[]): Promise<{
    checks: { centred: boolean; grounded: boolean; facing: boolean };
    markers: Record<string, number[]> | null;
    aPose: boolean | null;
  }>;
  quickRigFit(args: {
    markers: Record<string, number[]>;
    meshes: string[];
  }): Promise<{ key: string; position: number[] }[]>;
  skeletonChecks(character: string): unknown;
};

async function setupBody() {
  const test = createTestShell({ snapshot, skeleton, params: { ...DEFAULT_PARAMS, e2e: true } });
  const handle = createTestApi(test.shell, { engine: naiveCurveEngine });
  const app = test.shell.app;
  const kernel = await loadMeshKernel();
  const body = kernel.humanoidBody({ style: 'smooth', height: 1.6 });
  const out = kernel.writeRevision(body);
  for (const [, chunk] of out.newChunks) app.blobs.put(chunk);
  app.blobs.put(out.manifestBytes);
  const ref: MeshRef = { manifest: out.manifestId, rev: 1, base: null, joints: [] };
  const record: MeshRecord = {
    id: 'msh_Body' as MeshId,
    name: 'Body',
    owner: { scene: true },
    parent: null,
    order: 'a0',
    placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    pivot: [0, 0, 0],
    source: null,
    data: ref,
    faceted: true,
    generator: null,
    palette: null,
    material: { preset: 'unlit' },
    colourOutput: 'palette-texture',
    skin: null,
    budget: null,
    handheld: null,
    deleted: null,
  };
  app.store.transact({ label: 'Create' }, (tx) => tx.put('meshes', record));
  return { api: handle.api as unknown as Api, kernel };
}

describe('C2 test API', () => {
  it('templateJoints: the §5.2 template (34 joints for Standard 33, hips at 0.5 H)', async () => {
    const { api } = await setupBody();
    const joints = api.templateJoints('standard33', 2);
    expect(joints).toHaveLength(34);
    expect(joints.find((j) => j.key === 'hips')?.position).toEqual([0, 1, 0]);
  });

  it('quickRigGuess and quickRigFit on the generated body; skeletonChecks is null without a skeleton', async () => {
    const { api, kernel } = await setupBody();
    const guess = await api.quickRigGuess(['msh_Body']);
    expect(guess.checks).toEqual({ centred: true, grounded: true, facing: true });
    expect(guess.aPose).toBe(false);
    const rig = kernel.humanoidBodyRig({ height: 1.6 });
    const hips = rig.hips as readonly number[];
    expect(Math.abs((guess.markers?.['pelvis']?.[1] as number) - (hips[1] as number))).toBeLessThan(0.05 * 1.6);
    const fit = await api.quickRigFit({ markers: guess.markers ?? {}, meshes: ['msh_Body'] });
    expect(fit.find((j) => j.key === 'hips')?.position).toEqual(guess.markers?.['pelvis']);
    expect(api.skeletonChecks('chr_none')).toBeNull();
  });
});
