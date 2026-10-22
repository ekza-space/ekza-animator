#!/usr/bin/env node
// Generates the unskinned Polybot fixtures of M6b (M6B-SPEC §9 C0 (6), §0.7) from fixtures/models/polybot.vrm
// (Polygonal Mind, CC0 1.0):
//
//   fixtures/models/polybot-unskinned.glb        Polybot's mesh at its rest (A-) pose, skin, skeleton and VRM
//                                                extensions removed: one static mesh node at identity placement
//   fixtures/models/polybot-unskinned-tpose.glb  the same mesh posed into a T-pose with Polybot's own skin (each arm's
//                                                upper and lower segment turned horizontal, linear blend skinning
//                                                baked into the positions and normals), then stripped the same way
//   fixtures/models/polybot-truth.json           per pose the rest joint positions (VRM 1.0 humanoid names and every
//                                                joint node), the nine Quick Rig v2 truth markers (§0.4.2) and the
//                                                artist's dominant joint per welded point (the auto-skin gate P-S7)
//
// Everything is in canonical character space (+Y up, +Z forward, left = +X): Polybot is a VRM 0.x avatar facing −Z, so
// its positions are turned 180° about Y. The output is byte-for-byte deterministic (glTF Transform 4.5.1); the files
// are CC0 1.0 like their source (fixtures/LICENSES.md).
//
// Usage: node tooling/make-polybot-unskinned.mjs [--check]
//   --check  write nothing; exit 1 when a file on disk differs from what this script generates

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SOURCE = join(ROOT, 'fixtures', 'models', 'polybot.vrm');
export const APOSE_GLB = join(ROOT, 'fixtures', 'models', 'polybot-unskinned.glb');
export const TPOSE_GLB = join(ROOT, 'fixtures', 'models', 'polybot-unskinned-tpose.glb');
export const TRUTH = join(ROOT, 'fixtures', 'models', 'polybot-truth.json');

/** VRM 0.x thumb names → VRM 1.0 (the io reader's aliases): Proximal → Metacarpal, Intermediate → Proximal. */
const VRM0_THUMB = { ThumbProximal: 'ThumbMetacarpal', ThumbIntermediate: 'ThumbProximal', ThumbDistal: 'ThumbDistal' };
const vrm1Name = (bone) => {
  for (const [from, to] of Object.entries(VRM0_THUMB)) {
    if (bone.endsWith(from)) return bone.slice(0, bone.length - from.length) + to;
  }
  return bone;
};

// ---------- small column-major 4×4 matrix kit ----------
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
  const out = Array.from({ length: 16 }, () => 0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  return out;
}
const transformPoint = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const transformDirection = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
];
const translationOf = (m) => [m[12], m[13], m[14]];
const normalize = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l === 0 ? [0, 1, 0] : [v[0] / l, v[1] / l, v[2] / l];
};
/** The rotation (as a matrix) taking unit vector `from` to unit vector `to` (Rodrigues). */
function rotationBetween(from, to) {
  const axis = [
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
  ];
  const s = Math.hypot(axis[0], axis[1], axis[2]);
  const c = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (s < 1e-12) return identity();
  const [x, y, z] = [axis[0] / s, axis[1] / s, axis[2] / s];
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y + s * z,
    t * x * z - s * y,
    0,
    t * x * y - s * z,
    t * y * y + c,
    t * y * z + s * x,
    0,
    t * x * z + s * y,
    t * y * z - s * x,
    t * z * z + c,
    0,
    0,
    0,
    0,
    1,
  ];
}
/** A rotation `R` about the pivot `p`: T(p)·R·T(−p). */
function aboutPivot(R, p) {
  const to = identity();
  to[12] = p[0];
  to[13] = p[1];
  to[14] = p[2];
  const back = identity();
  back[12] = -p[0];
  back[13] = -p[1];
  back[14] = -p[2];
  return multiply(to, multiply(R, back));
}
/** VRM 0.x faces −Z: a π yaw maps it to canonical space. */
const FACING = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
const round = (x) => Math.round(x * 1e6) / 1e6 + 0;
const point = (p) => p.map(round);

/** The raw glTF JSON of a GLB (the VRM humanoid map lives in the extension glTF Transform drops). */
function glbJson(bytes) {
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
}

/** Reads Polybot and returns its single skinned primitive, the joints and their canonical rest worlds. */
async function readSource(bytes) {
  // Quiet: the VRM extensions are unknown to glTF Transform and dropped on purpose.
  const logger = { debug() {}, info() {}, warn() {}, error: console.error };
  const io = new NodeIO().setLogger(logger).registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(new Uint8Array(bytes));
  doc.setLogger(logger);
  const json = glbJson(bytes);
  const nodes = doc.getRoot().listNodes();
  const meshNode = nodes.find((node) => node.getMesh() !== null && node.getSkin() !== null);
  if (meshNode === undefined) throw new Error('make-polybot-unskinned: no skinned mesh node in the source');
  const skin = meshNode.getSkin();
  const joints = skin.listJoints();
  const ibmArray = skin.getInverseBindMatrices().getArray();
  const inverseBind = joints.map((_, j) => Array.from(ibmArray.subarray(j * 16, j * 16 + 16)));
  const restWorld = new Map(nodes.map((node) => [node, multiply(FACING, node.getWorldMatrix())]));
  const humanoid = new Map();
  for (const bone of json.extensions.VRM.humanoid.humanBones) humanoid.set(nodes[bone.node], vrm1Name(bone.bone));
  return { doc, io, nodes, meshNode, joints, inverseBind, restWorld, humanoid };
}

/** Linear blend skinning of positions and normals with joint worlds `world` (canonical space). */
function skinPrimitive(primitive, joints, inverseBind, world) {
  const positions = primitive.getAttribute('POSITION').getArray();
  const normals = primitive.getAttribute('NORMAL').getArray();
  const jointIndex = primitive.getAttribute('JOINTS_0').getArray();
  const weights = primitive.getAttribute('WEIGHTS_0').getArray();
  const skinning = joints.map((joint, j) => multiply(world.get(joint), inverseBind[j]));
  const outPositions = new Float32Array(positions.length);
  const outNormals = new Float32Array(normals.length);
  for (let v = 0; v < positions.length / 3; v++) {
    const p = [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
    const n = [normals[3 * v], normals[3 * v + 1], normals[3 * v + 2]];
    const sp = [0, 0, 0];
    const sn = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const w = weights[4 * v + k];
      if (w === 0) continue;
      const m = skinning[jointIndex[4 * v + k]];
      const tp = transformPoint(m, p);
      const tn = transformDirection(m, n);
      for (let c = 0; c < 3; c++) {
        sp[c] += w * tp[c];
        sn[c] += w * tn[c];
      }
    }
    const unit = normalize(sn);
    for (let c = 0; c < 3; c++) {
      outPositions[3 * v + c] = sp[c];
      outNormals[3 * v + c] = unit[c];
    }
  }
  return { positions: outPositions, normals: outNormals };
}

/** The T-pose joint worlds: each arm's upper, then lower segment turned to the horizontal ±X (left = +X). */
function tposeWorlds(source) {
  const world = new Map(source.restWorld);
  const byBone = new Map([...source.humanoid].map(([node, bone]) => [bone, node]));
  const descendants = (node) => [node, ...node.listChildren().flatMap(descendants)];
  for (const side of ['left', 'right']) {
    const target = side === 'left' ? [1, 0, 0] : [-1, 0, 0];
    for (const [from, to] of [
      ['UpperArm', 'LowerArm'],
      ['LowerArm', 'Hand'],
    ]) {
      const a = byBone.get(`${side}${from}`);
      const b = byBone.get(`${side}${to}`);
      const pa = translationOf(world.get(a));
      const pb = translationOf(world.get(b));
      const R = aboutPivot(rotationBetween(normalize([pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]]), target), pa);
      for (const node of descendants(a)) world.set(node, multiply(R, world.get(node)));
    }
  }
  return world;
}

/** The primitive's welded points (by exact float32 position, first occurrence first) and each vertex's point. */
function weld(positions) {
  const index = new Map();
  const pointOf = new Uint32Array(positions.length / 3);
  const first = [];
  for (let v = 0; v < positions.length / 3; v++) {
    const key = `${positions[3 * v]},${positions[3 * v + 1]},${positions[3 * v + 2]}`;
    let id = index.get(key);
    if (id === undefined) {
      id = first.length;
      index.set(key, id);
      first.push(v);
    }
    pointOf[v] = id;
  }
  return { first, pointOf };
}

/** Joint positions (humanoid and every joint node), the nine markers and the height of a pose. */
function poseTruth(source, world, positions) {
  const humanoid = {};
  const nodes = {};
  for (const joint of source.joints) {
    const p = point(translationOf(world.get(joint)));
    nodes[joint.getName()] = p;
    const bone = source.humanoid.get(joint);
    if (bone !== undefined) humanoid[bone] = p;
  }
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let v = 1; v < positions.length; v += 3) {
    minY = Math.min(minY, positions[v]);
    maxY = Math.max(maxY, positions[v]);
  }
  const H = maxY - minY;
  const head = humanoid.head;
  const neck = humanoid.neck;
  // §0.4.2: centre markers have x = 0 (the axis rule clamps them); a marker lies on or above the ground (the artist's
  // toes joint sits a few millimetres below the sole: its marker is clamped to the ground, the joint truth is kept).
  const hips = humanoid.hips;
  const toes = humanoid.rightToes;
  const markers = {
    headTop: point([0, maxY, head[2]]),
    chin: point([0, neck[1] + 0.01 * H, neck[2]]),
    pelvis: point([0, hips[1], hips[2]]),
    shoulder: humanoid.rightUpperArm,
    elbow: humanoid.rightLowerArm,
    wrist: humanoid.rightHand,
    knee: humanoid.rightLowerLeg,
    ankle: humanoid.rightFoot,
    toe: point([toes[0], Math.max(toes[1], minY), toes[2]]),
  };
  return { height: round(H), ground: round(minY), humanoid, nodes, markers };
}

/** The static GLB of the primitive with the given positions and normals (skin, joints and VRM data removed). */
async function staticGlb(bytes, posed) {
  const source = await readSource(bytes);
  const { doc, io, meshNode } = source;
  const primitive = meshNode.getMesh().listPrimitives()[0];
  primitive.getAttribute('POSITION').setArray(posed.positions);
  primitive.getAttribute('NORMAL').setArray(posed.normals);
  for (const semantic of ['JOINTS_0', 'WEIGHTS_0']) {
    const accessor = primitive.getAttribute(semantic);
    primitive.setAttribute(semantic, null);
    accessor.dispose();
  }
  const scene = doc.getRoot().listScenes()[0];
  const node = doc.createNode('Polybot').setMesh(meshNode.getMesh());
  meshNode.setMesh(null).setSkin(null);
  for (const skin of doc.getRoot().listSkins()) skin.dispose();
  for (const child of scene.listChildren()) scene.removeChild(child);
  for (const other of doc.getRoot().listNodes()) if (other !== node) other.dispose();
  scene.addChild(node);
  for (const animation of doc.getRoot().listAnimations()) animation.dispose();
  doc.getRoot().getAsset().generator = 'Ekza Studio tooling/make-polybot-unskinned.mjs';
  doc.getRoot().getAsset().extras = {};
  await doc.transform(prune());
  return io.writeBinary(doc);
}

/** Every output: the two GLBs and the truth JSON text. */
export async function buildPolybotFixtures(bytes = readFileSync(SOURCE)) {
  const source = await readSource(bytes);
  const primitive = source.meshNode.getMesh().listPrimitives()[0];
  const apose = skinPrimitive(primitive, source.joints, source.inverseBind, source.restWorld);
  const tWorld = tposeWorlds(source);
  const tpose = skinPrimitive(primitive, source.joints, source.inverseBind, tWorld);
  // The artist's dominant joint per welded point (largest weight, ties to the smaller palette index).
  const { first, pointOf } = weld(apose.positions);
  const jointIndex = primitive.getAttribute('JOINTS_0').getArray();
  const weights = primitive.getAttribute('WEIGHTS_0').getArray();
  const names = source.joints.map((joint) => source.humanoid.get(joint) ?? `node:${joint.getName()}`);
  const dominant = first.map((v) => {
    let best = 0;
    for (let k = 1; k < 4; k++) {
      const w = weights[4 * v + k];
      const bw = weights[4 * v + best];
      if (w > bw || (w === bw && jointIndex[4 * v + k] < jointIndex[4 * v + best])) best = k;
    }
    return jointIndex[4 * v + best];
  });
  const truth = {
    version: 1,
    description:
      'M6B-SPEC §9 C0 (6), §0.7: Polybot (Polygonal Mind, CC0 1.0) without skin, in canonical space (+Z forward, left = +X); generated by tooling/make-polybot-unskinned.mjs',
    source: { file: 'models/polybot.vrm', sha256: createHash('sha256').update(bytes).digest('hex') },
    units: 'm',
    facing: '+Z',
    points: first.length,
    vertexPoint: Array.from(pointOf),
    joints: names,
    dominantJoint: dominant,
    poses: {
      apose: poseTruth(source, source.restWorld, apose.positions),
      tpose: poseTruth(source, tWorld, tpose.positions),
    },
  };
  return {
    apose: await staticGlb(bytes, apose),
    tpose: await staticGlb(bytes, tpose),
    truth: `${JSON.stringify(truth, null, 2)}\n`,
  };
}

async function main(argv) {
  const built = await buildPolybotFixtures();
  const outputs = [
    [APOSE_GLB, built.apose],
    [TPOSE_GLB, built.tpose],
    [TRUTH, new TextEncoder().encode(built.truth)],
  ];
  if (argv.includes('--check')) {
    let ok = true;
    for (const [file, bytes] of outputs) {
      if (!existsSync(file) || Buffer.compare(readFileSync(file), Buffer.from(bytes)) !== 0) {
        console.error(`make-polybot-unskinned: ${file} is stale; run node tooling/make-polybot-unskinned.mjs`);
        ok = false;
      }
    }
    return ok ? 0 : 1;
  }
  for (const [file, bytes] of outputs) {
    writeFileSync(file, bytes);
    console.log(`make-polybot-unskinned: wrote ${file} (${bytes.byteLength} bytes)`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
