import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildSyntheticBinaries,
  buildSyntheticFixtures,
  SYNTHETIC_BINARIES,
  SYNTHETIC_DIR,
  SYNTHETIC_FILES,
} from '../make-synthetic-fixtures.mjs';

test('the committed synthetic fixtures are exactly what the generator writes', () => {
  const files = buildSyntheticFixtures();
  assert.deepEqual(Object.keys(files).sort(), [...SYNTHETIC_FILES].sort());
  for (const [name, text] of Object.entries(files)) {
    assert.equal(readFileSync(join(SYNTHETIC_DIR, name), 'utf8'), text, `${name} is stale: regenerate it`);
  }
});

test('the generator is deterministic', () => {
  assert.deepEqual(buildSyntheticFixtures(), buildSyntheticFixtures());
});

test('the skeleton is topologically ordered and names ~25 VRM 1.0 humanoid bones', () => {
  const skeleton = JSON.parse(buildSyntheticFixtures()['humanoid-skeleton.json']);
  skeleton.nodes.forEach((node, i) => {
    assert.equal(node.index, i);
    assert.ok(node.parent < i, `${node.name} must come after its parent`);
  });
  const humanoid = Object.entries(skeleton.humanoid);
  assert.ok(humanoid.length >= 20 && humanoid.length <= 30);
  for (const [bone, index] of humanoid) assert.equal(skeleton.nodes[index].name, bone);
  assert.deepEqual(skeleton.facing, [0, 0, 0, 1]);
});

test('the wave clip keys fk.lowerArm.L rz at 30° / −30° / 30° on frames 0 / 15 / 30', () => {
  const doc = JSON.parse(buildSyntheticFixtures()['wave-doc.json']);
  const [curve] = Object.values(doc.tables.curves);
  assert.equal(doc.tables.controls[curve.control].key, 'fk.lowerArm.L');
  assert.equal(curve.channel, 'rz');
  const clip = doc.tables.clips[curve.clip];
  assert.equal(clip.name, 'wave');
  const keys = Object.values(doc.tables.keys)
    .filter((key) => key.curve === curve.id)
    .sort((a, b) => a.t - b.t)
    .map((key) => [key.t, Math.round((key.v * 180) / Math.PI)]);
  assert.deepEqual(keys, [
    [0, 30],
    [15, -30],
    [30, 30],
  ]);
});

test('the committed binary fixtures are exactly what the generator writes (M6a)', () => {
  const binaries = buildSyntheticBinaries();
  assert.deepEqual(Object.keys(binaries).sort(), [...SYNTHETIC_BINARIES].sort());
  for (const [name, bytes] of Object.entries(binaries)) {
    assert.equal(Buffer.compare(readFileSync(join(SYNTHETIC_DIR, name)), Buffer.from(bytes)), 0, `${name} is stale`);
  }
  assert.deepEqual(buildSyntheticBinaries(), buildSyntheticBinaries());
});

test('prohibited-modification.vrm is a VRM 1.0 whose meta forbids modification, on the synthetic skeleton', () => {
  const bytes = buildSyntheticBinaries()['prohibited-modification.vrm'];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint32(0, true), 0x46546c67);
  assert.equal(dv.getUint32(8, true), bytes.length);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + dv.getUint32(12, true))));
  const vrm = json.extensions.VRMC_vrm;
  assert.equal(vrm.specVersion, '1.0');
  assert.equal(vrm.meta.modification, 'prohibited');
  assert.deepEqual(json.extensionsUsed, ['VRMC_vrm']);
  const skeleton = JSON.parse(buildSyntheticFixtures()['humanoid-skeleton.json']);
  assert.deepEqual(Object.keys(vrm.humanoid.humanBones).sort(), Object.keys(skeleton.humanoid).sort());
  assert.equal(json.skins[0].joints.length, skeleton.nodes.length - 1);
  assert.equal(json.meshes[0].primitives.length, 1);
});
