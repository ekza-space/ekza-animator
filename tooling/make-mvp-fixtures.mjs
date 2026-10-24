#!/usr/bin/env node
// Generates the "Cube Lad" fixtures of the M6b MVP (M6B-SPEC §0.7, C0):
//
//   fixtures/models/cube-lad-truth.json  the design: 1.70 m, T-posed, X-symmetric, facing +Z, standing on y = 0; its
//                                        boxes (centre and size, the order the e2e helper builds them in), the nine
//                                        truth markers of Quick Rig v2 (§0.4.2) and the designed position of every
//                                        Standard 33 joint and the `root` helper (with parents and tails)
//   fixtures/models/cube-lad.glb         the same boxes as one unskinned, flat-shaded mesh at identity placement
//
// The e2e helper `apps/web/e2e/helpers/m6b-cube-lad.ts` builds the Cube Lad in the editor from the truth file's
// boxes (`mesh.create.cube` per box, a placement each, `mesh.combine` with the origin as pivot); its welded points
// equal the GLB's within 1e-6 m. The joints follow the §0.4.2 fit formulas applied to the truth markers (rest
// flexion as the minimum bend of 2°), so the fitter's gates have an exact target. Deterministic: the same bytes on
// every run (glTF Transform 4.5.1). MIT (this repository; fixtures/LICENSES.md).
//
// Usage: node tooling/make-mvp-fixtures.mjs [--check]
//   --check  write nothing; exit 1 when a file on disk differs from what this script generates

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const CUBE_LAD_GLB = join(ROOT, 'fixtures', 'models', 'cube-lad.glb');
export const CUBE_LAD_TRUTH = join(ROOT, 'fixtures', 'models', 'cube-lad-truth.json');

/** Height H (metres) and the rest flexion θ (radians) of the design. */
export const HEIGHT = 1.7;
export const FLEXION = (2 * Math.PI) / 180;

/** Rounds to 1e-9 m so the JSON stays readable and the arithmetic noise never reaches the bytes. */
const r = (x) => Math.round(x * 1e9) / 1e9 + 0;
const v = (x, y, z) => [r(x), r(y), r(z)];

/**
 * The boxes, right side (x < 0) first for each pair: centre and size in metres. 16 boxes: torso, pelvis, neck, head,
 * and per side upper arm, forearm, hand, thigh, shin, foot (the arms horizontal: a T-pose).
 */
function boxes() {
  const pair = (name, cx, cy, cz, sx, sy, sz) => [
    { name: `${name}.R`, center: v(-cx, cy, cz), size: v(sx, sy, sz) },
    { name: `${name}.L`, center: v(cx, cy, cz), size: v(sx, sy, sz) },
  ];
  return [
    { name: 'torso', center: v(0, 1.2, 0), size: v(0.36, 0.4, 0.2) },
    { name: 'pelvis', center: v(0, 0.93, 0), size: v(0.32, 0.14, 0.18) },
    { name: 'neck', center: v(0, 1.44, 0), size: v(0.1, 0.08, 0.1) },
    { name: 'head', center: v(0, 1.59, 0.01), size: v(0.22, 0.22, 0.24) },
    ...pair('upperArm', 0.33, 1.33, 0, 0.3, 0.1, 0.1),
    ...pair('forearm', 0.61, 1.33, 0, 0.26, 0.09, 0.09),
    ...pair('hand', 0.81, 1.33, 0, 0.14, 0.05, 0.1),
    ...pair('thigh', 0.1, 0.66, 0, 0.12, 0.4, 0.12),
    ...pair('shin', 0.1, 0.26, 0, 0.1, 0.4, 0.1),
    ...pair('foot', 0.1, 0.03, 0.04, 0.1, 0.06, 0.24),
  ];
}

/** The nine Quick Rig v2 markers (§0.4.2): centre markers on x = 0, side markers on the character's right (x < 0). */
function markers() {
  return {
    headTop: v(0, 1.7, 0.01),
    chin: v(0, 1.48, 0),
    pelvis: v(0, 0.93, 0),
    shoulder: v(-0.2, 1.33, 0),
    elbow: v(-0.48, 1.33, 0),
    wrist: v(-0.74, 1.33, 0),
    knee: v(-0.1, 0.46, 0),
    ankle: v(-0.1, 0.085, 0),
    toe: v(-0.1, 0.034, 0.104),
  };
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const mirror = (p) => [-p[0], p[1], p[2]];

/** Moves the hinge joint B along `d` until the limb A–B–C bends by at least θ toward `d` (§0.4.2 minimum bend). */
function minimumBend(A, B, C, d) {
  const a = length(sub(B, A));
  const b = length(sub(C, B));
  const ac = sub(C, A);
  const t = (sub(B, A)[0] * ac[0] + sub(B, A)[1] * ac[1] + sub(B, A)[2] * ac[2]) / length(ac) ** 2;
  const P = add(A, scale(ac, t));
  const bend = sub(B, P)[0] * d[0] + sub(B, P)[1] * d[1] + sub(B, P)[2] * d[2];
  const required = (FLEXION * a * b) / (a + b);
  return bend >= required ? B : add(B, scale(d, required - bend));
}

/** The Standard 33 joints and `root` from the markers (§0.4.2 fit, §5.2 finger table), right side then mirrored. */
function joints(m) {
  const H = m.headTop[1];
  const right = {};
  right.rightUpperLeg = [m.knee[0], m.pelvis[1] - 0.02 * H, m.pelvis[2]];
  right.rightLowerLeg = m.knee;
  right.rightFoot = m.ankle;
  right.rightToes = m.toe;
  right.rightUpperArm = m.shoulder;
  right.rightLowerArm = m.elbow;
  right.rightHand = m.wrist;
  right.rightShoulder = [m.shoulder[0] / 2, m.shoulder[1], 0];
  // Rest flexion as the minimum bend (elbow backward, knee forward).
  right.rightLowerArm = minimumBend(right.rightUpperArm, right.rightLowerArm, right.rightHand, [0, 0, -1]);
  right.rightLowerLeg = minimumBend(right.rightUpperLeg, right.rightLowerLeg, right.rightFoot, [0, 0, 1]);
  // Fingers along wrist − elbow (the −X direction of the right hand), h = the hand length.
  const handTail = add(m.wrist, scale(sub(m.wrist, m.elbow), 0.55));
  const h = length(sub(handTail, m.wrist));
  const along = [-1, 0, 0];
  const thumbDirection = [-Math.SQRT1_2, 0, Math.SQRT1_2];
  right.rightMiddleProximal = add(m.wrist, scale(along, 0.55 * h));
  right.rightMiddleIntermediate = add(right.rightMiddleProximal, scale(along, 0.17 * h));
  right.rightMiddleDistal = add(right.rightMiddleIntermediate, scale(along, 0.13 * h));
  right.rightThumbMetacarpal = add(m.wrist, [-0.15 * h, -0.05 * h, 0.2 * h]);
  right.rightThumbProximal = add(right.rightThumbMetacarpal, scale(thumbDirection, 0.25 * h));
  right.rightThumbDistal = add(right.rightThumbProximal, scale(thumbDirection, 0.2 * h));
  const tails = {
    rightHand: handTail,
    rightMiddleDistal: add(right.rightMiddleDistal, scale(along, 0.1 * h)),
    rightThumbDistal: add(right.rightThumbDistal, scale(thumbDirection, 0.15 * h)),
    rightToes: [m.toe[0], m.toe[1], 0.16],
  };
  const neck = [0, m.chin[1] - 0.01 * H, m.chin[2]];
  const head = [0, m.chin[1] + 0.02 * H, m.chin[2]];
  const hips = m.pelvis;
  const spine = add(hips, scale(sub(neck, hips), 1 / 3));
  const chest = add(hips, scale(sub(neck, hips), 2 / 3));
  const parents = {
    root: null,
    hips: 'root',
    spine: 'hips',
    chest: 'spine',
    neck: 'chest',
    head: 'neck',
    Shoulder: 'chest',
    UpperArm: 'Shoulder',
    LowerArm: 'UpperArm',
    Hand: 'LowerArm',
    ThumbMetacarpal: 'Hand',
    ThumbProximal: 'ThumbMetacarpal',
    ThumbDistal: 'ThumbProximal',
    MiddleProximal: 'Hand',
    MiddleIntermediate: 'MiddleProximal',
    MiddleDistal: 'MiddleIntermediate',
    UpperLeg: 'hips',
    LowerLeg: 'UpperLeg',
    Foot: 'LowerLeg',
    Toes: 'Foot',
  };
  const out = {};
  const put = (key, position, parent, tail = null) => {
    out[key] = { position: v(...position), parent, tail: tail === null ? null : v(...tail) };
  };
  put('root', [0, 0, 0], null);
  put('hips', hips, 'root');
  put('spine', spine, 'hips');
  put('chest', chest, 'spine');
  put('neck', neck, 'chest');
  put('head', head, 'neck', m.headTop);
  for (const [key, position] of Object.entries(right)) {
    const stem = key.slice('right'.length);
    const parentStem = parents[stem];
    const parentOf = (side) =>
      parentStem === 'chest' ? 'chest' : parentStem === 'hips' ? 'hips' : `${side}${parentStem}`;
    put(key, position, parentOf('right'), tails[key] ?? null);
    const left = `left${stem}`;
    put(left, mirror(position), parentOf('left'), tails[key] === undefined ? null : mirror(tails[key]));
  }
  // Stable key order: root, the spine chain, then the limbs in the order above.
  return out;
}

/** The truth file of the Cube Lad. */
export function cubeLadTruth() {
  const m = markers();
  return {
    version: 1,
    name: 'Cube Lad',
    description:
      'M6B-SPEC §0.7: a low-poly humanoid box-modelled from cubes, T-posed, X-symmetric, facing +Z, standing on y = 0; generated by tooling/make-mvp-fixtures.mjs',
    units: 'm',
    height: HEIGHT,
    ground: 0,
    facing: '+Z',
    preset: 'standard33',
    flexionDegrees: 2,
    boxes: boxes(),
    markers: m,
    joints: joints(m),
  };
}

/** The 8 corners of a box and its 6 quads in the usual DCC side order (front +Z, top +Y, back −Z, bottom −Y, ±X). */
function boxGeometry(box) {
  const [cx, cy, cz] = box.center;
  const [hx, hy, hz] = box.size.map((s) => s / 2);
  const corner = (i, j, k) => [r(cx + (i ? hx : -hx)), r(cy + (j ? hy : -hy)), r(cz + (k ? hz : -hz))];
  const faces = [
    { normal: [0, 0, 1], quad: [corner(0, 0, 1), corner(1, 0, 1), corner(1, 1, 1), corner(0, 1, 1)] },
    { normal: [0, 1, 0], quad: [corner(0, 1, 1), corner(1, 1, 1), corner(1, 1, 0), corner(0, 1, 0)] },
    { normal: [0, 0, -1], quad: [corner(1, 0, 0), corner(0, 0, 0), corner(0, 1, 0), corner(1, 1, 0)] },
    { normal: [0, -1, 0], quad: [corner(0, 0, 0), corner(1, 0, 0), corner(1, 0, 1), corner(0, 0, 1)] },
    { normal: [1, 0, 0], quad: [corner(1, 0, 1), corner(1, 0, 0), corner(1, 1, 0), corner(1, 1, 1)] },
    { normal: [-1, 0, 0], quad: [corner(0, 0, 0), corner(0, 0, 1), corner(0, 1, 1), corner(0, 1, 0)] },
  ];
  return faces;
}

/** The Cube Lad as one flat-shaded, unskinned mesh at identity placement (positions, normals, uint16 indices). */
export async function buildCubeLadGlb(truth = cubeLadTruth()) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (const box of truth.boxes) {
    for (const face of boxGeometry(box)) {
      const base = positions.length / 3;
      for (const p of face.quad) {
        positions.push(...p);
        normals.push(...face.normal);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'Ekza Studio tooling/make-mvp-fixtures.mjs';
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor('POSITION')
    .setType('VEC3')
    .setArray(new Float32Array(positions))
    .setBuffer(buffer);
  const normal = doc.createAccessor('NORMAL').setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer);
  const index = doc.createAccessor('indices').setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer);
  const material = doc
    .createMaterial('Cube Lad')
    .setBaseColorFactor([0.8, 0.8, 0.8, 1])
    .setRoughnessFactor(1)
    .setMetallicFactor(0);
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setAttribute('NORMAL', normal)
    .setIndices(index)
    .setMaterial(material);
  const mesh = doc.createMesh('Cube Lad').addPrimitive(primitive);
  const node = doc.createNode('Cube Lad').setMesh(mesh);
  doc.createScene('Scene').addChild(node);
  return new NodeIO().writeBinary(doc);
}

/** The deterministic JSON text of the truth file. */
export function cubeLadTruthText(truth = cubeLadTruth()) {
  return `${JSON.stringify(truth, null, 2)}\n`;
}

async function main(argv) {
  const truth = cubeLadTruth();
  const outputs = [
    [CUBE_LAD_TRUTH, new TextEncoder().encode(cubeLadTruthText(truth))],
    [CUBE_LAD_GLB, await buildCubeLadGlb(truth)],
  ];
  if (argv.includes('--check')) {
    let ok = true;
    for (const [file, bytes] of outputs) {
      if (!existsSync(file) || Buffer.compare(readFileSync(file), Buffer.from(bytes)) !== 0) {
        console.error(`make-mvp-fixtures: ${file} is stale; run node tooling/make-mvp-fixtures.mjs`);
        ok = false;
      }
    }
    return ok ? 0 : 1;
  }
  for (const [file, bytes] of outputs) {
    writeFileSync(file, bytes);
    console.log(`make-mvp-fixtures: wrote ${file} (${bytes.byteLength} bytes)`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
