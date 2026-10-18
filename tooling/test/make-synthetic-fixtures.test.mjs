import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildSyntheticFixtures, SYNTHETIC_DIR, SYNTHETIC_FILES } from '../make-synthetic-fixtures.mjs';

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
