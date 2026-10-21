import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildCubeLadGlb,
  CUBE_LAD_GLB,
  CUBE_LAD_TRUTH,
  cubeLadTruth,
  cubeLadTruthText,
  FLEXION,
  HEIGHT,
} from '../make-mvp-fixtures.mjs';

/** The JSON and BIN chunks of a GLB. */
function glb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const binStart = 20 + jsonLength + 8;
  return { json, bin: bytes.subarray(binStart) };
}

/** POSITION as a packed array (glTF Transform may interleave the vertex attributes: honour byteStride). */
function positionsOf(bytes) {
  const { json, bin } = glb(bytes);
  const accessor = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  const view = json.bufferViews[accessor.bufferView];
  const stride = view.byteStride ?? 12;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Float32Array(accessor.count * 3);
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < 3; c++) out[3 * i + c] = data.getFloat32(base + i * stride + 4 * c, true);
  }
  return out;
}

const truth = cubeLadTruth();
const built = buildCubeLadGlb(truth);

test('the committed Cube Lad files are exactly what the generator writes', async () => {
  assert.equal(readFileSync(CUBE_LAD_TRUTH, 'utf8'), cubeLadTruthText(truth));
  assert.ok(Buffer.compare(readFileSync(CUBE_LAD_GLB), Buffer.from(await built)) === 0, `${CUBE_LAD_GLB} is stale`);
});

test('the Cube Lad is 1.70 m, grounded, X-symmetric, facing +Z, and 16 boxes of 12 triangles', async () => {
  const bytes = await built;
  const { json } = glb(bytes);
  assert.equal(json.nodes.length, 1);
  assert.equal(json.skins, undefined);
  const primitive = json.meshes[0].primitives[0];
  assert.equal(json.accessors[primitive.indices].count / 3, truth.boxes.length * 12);
  assert.equal(truth.boxes.length, 16);
  const p = positionsOf(bytes);
  let [minY, maxY, maxZ, minZ] = [Infinity, -Infinity, -Infinity, Infinity];
  const keys = new Set();
  for (let i = 0; i < p.length; i += 3) {
    minY = Math.min(minY, p[i + 1]);
    maxY = Math.max(maxY, p[i + 1]);
    maxZ = Math.max(maxZ, p[i + 2]);
    minZ = Math.min(minZ, p[i + 2]);
    keys.add(`${p[i].toFixed(6)},${p[i + 1].toFixed(6)},${p[i + 2].toFixed(6)}`);
  }
  assert.ok(Math.abs(minY) < 1e-6 && Math.abs(maxY - HEIGHT) < 1e-6, `bounds y ${minY}…${maxY}`);
  assert.ok(maxZ > -minZ, 'the feet stick out to the front (+Z)');
  for (const key of keys) {
    const [x, y, z] = key.split(',').map(Number);
    assert.ok(
      keys.has(`${(-x).toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`) ||
        keys.has(`${(x === 0 ? 0 : -x).toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`),
      `no mirror of ${key}`,
    );
  }
});

test('every Standard 33 joint and root, with the markers on the right side and the elbow/knee minimum bend', () => {
  const keys = Object.keys(truth.joints);
  assert.equal(keys.length, 34);
  assert.equal(truth.joints.root.parent, null);
  assert.equal(truth.joints.hips.parent, 'root');
  for (const [key, joint] of Object.entries(truth.joints)) {
    if (joint.parent !== null) assert.ok(keys.includes(joint.parent), `${key}: parent ${joint.parent}`);
    if (key.startsWith('left')) {
      const right = truth.joints[`right${key.slice(4)}`];
      assert.deepEqual(joint.position, [-right.position[0], right.position[1], right.position[2]]);
    }
  }
  for (const name of ['shoulder', 'elbow', 'wrist', 'knee', 'ankle', 'toe'])
    assert.ok(truth.markers[name][0] < 0, name);
  for (const name of ['headTop', 'chin', 'pelvis']) assert.equal(truth.markers[name][0], 0, name);
  assert.equal(truth.joints.rightUpperArm.position.join(), truth.markers.shoulder.join());
  // §0.4.2: a straight limb gets exactly the minimum bend θ·a·b/(a + b) on its hinge side.
  const a = 0.28;
  const b = 0.26;
  assert.ok(Math.abs(truth.joints.rightLowerArm.position[2] + (FLEXION * a * b) / (a + b)) < 1e-6);
  assert.ok(truth.joints.rightLowerLeg.position[2] > 0);
  assert.deepEqual(truth.joints.head.tail, truth.markers.headTop);
});
