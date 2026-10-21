import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { APOSE_GLB, buildPolybotFixtures, TPOSE_GLB, TRUTH } from '../make-polybot-unskinned.mjs';

/** The JSON chunk of a GLB. */
function glbJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
}

const built = buildPolybotFixtures();

test('the committed Polybot fixtures are exactly what the generator writes', async () => {
  const { apose, tpose, truth } = await built;
  assert.ok(Buffer.compare(readFileSync(APOSE_GLB), Buffer.from(apose)) === 0, `${APOSE_GLB} is stale`);
  assert.ok(Buffer.compare(readFileSync(TPOSE_GLB), Buffer.from(tpose)) === 0, `${TPOSE_GLB} is stale`);
  assert.equal(readFileSync(TRUTH, 'utf8'), truth);
});

test('both GLBs are static: one mesh node, no skin, no joint attributes, no VRM extension', async () => {
  const { apose, tpose } = await built;
  for (const bytes of [apose, tpose]) {
    const json = glbJson(bytes);
    assert.equal(json.skins, undefined);
    assert.equal(json.nodes.length, 1);
    assert.equal(json.extensions?.VRM, undefined);
    assert.ok(!(json.extensionsUsed ?? []).some((name) => name.startsWith('VRM')));
    const attributes = Object.keys(json.meshes[0].primitives[0].attributes);
    assert.ok(!attributes.includes('JOINTS_0') && !attributes.includes('WEIGHTS_0'));
  }
});

test('the truth: canonical facing, horizontal T-pose arms, the markers and one dominant joint per welded point', async () => {
  const truth = JSON.parse((await built).truth);
  const { apose, tpose } = truth.poses;
  assert.equal(truth.facing, '+Z');
  // Canonical space: left = +X, the toes in front of the ankles.
  assert.ok(apose.humanoid.leftUpperArm[0] > 0 && apose.humanoid.rightUpperArm[0] < 0);
  assert.ok(apose.markers.toe[2] > apose.markers.ankle[2]);
  // A-pose arms hang below the shoulders; T-pose arms are horizontal (the legs and spine do not move).
  assert.ok(apose.humanoid.leftHand[1] < apose.humanoid.leftUpperArm[1] - 0.05);
  for (const side of ['left', 'right']) {
    assert.ok(Math.abs(tpose.humanoid[`${side}Hand`][1] - tpose.humanoid[`${side}UpperArm`][1]) < 1e-5, side);
    assert.ok(Math.abs(tpose.humanoid[`${side}LowerArm`][1] - tpose.humanoid[`${side}UpperArm`][1]) < 1e-5, side);
  }
  assert.deepEqual(tpose.humanoid.hips, apose.humanoid.hips);
  assert.deepEqual(tpose.markers.knee, apose.markers.knee);
  for (const pose of [apose, tpose]) {
    assert.deepEqual(Object.keys(pose.markers), [
      'headTop',
      'chin',
      'pelvis',
      'shoulder',
      'elbow',
      'wrist',
      'knee',
      'ankle',
      'toe',
    ]);
    for (const name of ['shoulder', 'elbow', 'wrist', 'knee', 'ankle', 'toe']) assert.ok(pose.markers[name][0] < 0);
  }
  assert.equal(truth.dominantJoint.length, truth.points);
  assert.ok(Math.max(...truth.vertexPoint) === truth.points - 1);
  assert.ok(truth.dominantJoint.every((index) => index >= 0 && index < truth.joints.length));
  assert.ok(truth.joints.includes('leftUpperArm') && truth.joints.includes('hips'));
});
