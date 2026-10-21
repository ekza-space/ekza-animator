import { derivedId } from '@ekza-studio/doc';
import { expect, test } from '@playwright/test';
import { exportOne, readGlb, sampleBytes, validatorErrors } from './helpers/g4-export';
import { accessorValues, bodyOf, changedValues, forearmRingEdge, type Json } from './helpers/m6a-bake';
import { controlId, seedWaveClip } from './helpers/seed';
import { call, expectKernelStarted, loadFile, openEditor, runOk, waitForCount } from './helpers/test-api';

// E2E-MOD-31 "Re-bake an edited export" (M6A-SPEC §10.1, §5.22; owner INT). Polybot's body is made editable, gets a
// forearm loop and is baked into the model (bytes A, marker v2). A is loaded as a new character, one control is keyed
// and A is baked again (bytes B). B validates with no errors, keeps marker v2 with A's baseline (the original Polybot:
// a later bake can still roll back to it), every primitive's accessors exist and its indices are in range, the
// original file's JSON values outside the bake's allowed diffs are preserved, and the edited mesh's geometry is A's
// (the same triangle count, positions within 1e-6).

const DEG = Math.PI / 180;

type Glb = ReturnType<typeof readGlb>;

const markerOf = (json: Json): Json | undefined =>
  ((json['asset'] as Json | undefined)?.['extras'] as Json | undefined)?.['ekza_animator_bake_v2'] as Json | undefined;

/** Problems of B's primitives: accessors that do not exist, indices outside their POSITION count. */
function primitiveProblems(glb: Glb): string[] {
  const accessors = glb.json['accessors'] as Json[];
  const problems: string[] = [];
  (glb.json['meshes'] as Json[]).forEach((mesh, m) => {
    (mesh['primitives'] as Json[]).forEach((primitive, p) => {
      const where = `meshes[${m}].primitives[${p}]`;
      const attributes = primitive['attributes'] as Record<string, number>;
      const referenced = [
        ...Object.values(attributes),
        ...(primitive['indices'] === undefined ? [] : [primitive['indices'] as number]),
        ...((primitive['targets'] as Record<string, number>[] | undefined) ?? []).flatMap((t) => Object.values(t)),
      ];
      for (const index of referenced) if (accessors[index] === undefined) problems.push(`${where}: accessor ${index}`);
      const count = accessors[attributes['POSITION'] ?? -1]?.['count'] as number | undefined;
      if (count === undefined) {
        problems.push(`${where}: no POSITION`);
        return;
      }
      if (primitive['indices'] !== undefined) {
        const indices = accessorValues(glb, primitive['indices'] as number);
        if (indices.some((i) => i >= count)) problems.push(`${where}: index ≥ ${count}`);
      }
    });
  });
  return problems;
}

/** The edited mesh's triangles and positions (mesh 0, every primitive). */
function geometryOf(glb: Glb): { readonly triangles: number; readonly positions: number[] } {
  let triangles = 0;
  const positions: number[] = [];
  for (const primitive of ((glb.json['meshes'] as Json[])[0]?.['primitives'] ?? []) as Json[]) {
    const attributes = primitive['attributes'] as Record<string, number>;
    const position = accessorValues(glb, attributes['POSITION'] ?? -1);
    positions.push(...position);
    triangles +=
      (primitive['indices'] === undefined
        ? position.length / 3
        : accessorValues(glb, primitive['indices'] as number).length) / 3;
  }
  return { triangles, positions };
}

test('E2E-MOD-31 — re-bake an edited export: marker v2 baseline, valid primitives, the edit kept', async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await expectKernelStarted(page);
  const { character, clip } = await seedWaveClip(page, 'polybot');
  const body = derivedId('mesh', 'asset', [character], '', 0);
  await runOk(page, 'mesh.makeEditable', { character, meshIndex: 0 });
  const original = readGlb(sampleBytes('polybot.vrm'));
  const seedEdge = forearmRingEdge(await bodyOf(page, body), original.json);
  await runOk(page, 'mesh.insertLoop', { meshes: [body], kind: 'edge', seedEdge, weight: 0.5 });
  const a = await exportOne(page, { kind: 'bake-into-model', character, clips: [clip] });
  expect(await validatorErrors(a.bytes)).toEqual([]);
  const glbA = readGlb(a.bytes);
  const markerA = markerOf(glbA.json);
  expect(markerA).toMatchObject({ version: 2 });

  // A as a new character; one control keyed in a new clip; baked again.
  await loadFile(page, 'a.glb', a.bytes, { auto: true });
  await waitForCount(page, 'characters', 2);
  const other = (await call(page, 'characters')).find((candidate) => candidate.id !== character)?.id ?? '';
  // Selecting another character's control makes it the active one (MVP selection rule); the clip is its.
  const control = await controlId(page, 'fk.lowerArm.L', other);
  await runOk(page, 'select.controls', { ids: [control], mode: 'replace' });
  const { clip: second } = await runOk<{ clip: string }>(page, 'clip.new', { name: 'nod' });
  await runOk(page, 'time.setFrame', { frame: 0 });
  await runOk(page, 'channel.setValues', { edits: [{ control, channel: 'rz', value: 20 * DEG }] });
  await runOk(page, 'key.set', { channels: 'rotate' });
  const b = await exportOne(page, { kind: 'bake-into-model', character: other, clips: [second] });

  expect(await validatorErrors(b.bytes)).toEqual([]);
  const glbB = readGlb(b.bytes);
  // Marker v2 with A's baseline (the original Polybot's counts and hashes).
  const markerB = markerOf(glbB.json);
  expect(markerB).toMatchObject({ version: 2 });
  for (const key of ['baseAccessors', 'baseBufferViews', 'baseBinLength', 'baseBinSha256', 'baseSha256']) {
    expect(markerB?.[key], key).toEqual(markerA?.[key]);
  }
  expect(primitiveProblems(glbB)).toEqual([]);
  // The original file's untouched JSON values are preserved: B rolls back to A's baseline (the original Polybot) and
  // bakes again, so A's own appended accessors and views are replaced, never the original's (the bake's allowed
  // diffs: animations, extension lists, the asset's generator and extras, the buffer length and mesh 0's primitives).
  expect(changedValues(original.json, glbB.json)).toEqual([]);
  expect(changedValues(original.json, glbA.json)).toEqual([]);
  // The edited mesh's geometry is A's.
  const geometryA = geometryOf(glbA);
  const geometryB = geometryOf(glbB);
  expect(geometryB.triangles).toBe(geometryA.triangles);
  expect(geometryB.positions.length).toBe(geometryA.positions.length);
  const worst = geometryB.positions.reduce(
    (max, value, i) => Math.max(max, Math.abs(value - (geometryA.positions[i] ?? 0))),
    0,
  );
  expect(worst).toBeLessThanOrEqual(1e-6);
  expect(geometryA.triangles).toBeGreaterThan(geometryOf(original).triangles);
});
