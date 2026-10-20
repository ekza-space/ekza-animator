#!/usr/bin/env node
// Generates the synthetic test fixtures of the shared test kit (MVP-SPEC §7 WP-0b) into fixtures/synthetic/:
//
//   humanoid-skeleton.json  a SkeletonDesc: a `Root` node plus 25 VRM 1.0-named humanoid bones, identity facing,
//                           raw bone frames like a Blender export (arm, leg and toe bones are rotated at rest)
//   wave-doc.json           a DocSnapshot: project, asset, character, rig with FK controls for those bones and a clip
//                           `wave` whose `fk.lowerArm.L` rz curve has keys 30° / −30° / 30° at frames 0 / 15 / 30
//   rest-pose.json          the expected canonical bone worlds at rest (t, q, s and the column-major matrix)
//   prohibited-modification.vrm
//                           (M6a, B8) a VRM 1.0 avatar on that skeleton — one skinned mesh of a box per bone — whose
//                           meta says `modification: 'prohibited'`: Make editable must refuse it (E2E-MOD-12)
//
// The output is byte-for-byte deterministic. The data is synthetic (MIT, repository licence): the control records
// follow the auto-rig conventions of MVP-SPEC §4.11.15 but are not a golden for `autoRig`.
//
// Usage: node tooling/make-synthetic-fixtures.mjs [--out <dir>] [--check]
//   --out <dir>  write somewhere else (default: fixtures/synthetic)
//   --check      write nothing; exit 1 when the files on disk differ from what this script generates

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SYNTHETIC_DIR = join(ROOT, 'fixtures', 'synthetic');
export const SYNTHETIC_FILES = ['humanoid-skeleton.json', 'wave-doc.json', 'rest-pose.json'];
/** Binary fixtures (written as bytes, compared byte for byte). */
export const SYNTHETIC_BINARIES = ['prohibited-modification.vrm'];

const DEG = Math.PI / 180;
const HEIGHT = 1.7;

// ---------- quaternion helpers (x, y, z, w; Hamilton product, column vectors) ----------

const qIdentity = () => [0, 0, 0, 1];
const qAxisAngle = (axis, angle) => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qRotate = (q, v) => {
  const p = qMul(qMul(q, [v[0], v[1], v[2], 0]), qConj(q));
  return [p[0], p[1], p[2]];
};
/** Shortest rotation taking unit `from` to unit `to`. */
const qShortestArc = (from, to) => {
  const d = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (d < -1 + 1e-12) return qAxisAngle(Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], Math.PI);
  const c = [from[1] * to[2] - from[2] * to[1], from[2] * to[0] - from[0] * to[2], from[0] * to[1] - from[1] * to[0]];
  const q = [c[0], c[1], c[2], 1 + d];
  const n = Math.hypot(...q);
  return q.map((x) => x / n);
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const length = (a) => Math.hypot(a[0], a[1], a[2]);

/** Column-major T·R·S (three.js `Matrix4.compose`). */
function mat4Compose(t, q, s) {
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0],
    (xy + wz) * s[0],
    (xz - wy) * s[0],
    0,
    (xy - wz) * s[1],
    (1 - (xx + zz)) * s[1],
    (yz + wx) * s[1],
    0,
    (xz + wy) * s[2],
    (yz - wx) * s[2],
    (1 - (xx + yy)) * s[2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
}

/** Removes floating-point noise so the JSON stays readable: ~0 → 0, ~±1 → ±1. */
const clean = (x) => {
  if (Math.abs(x) < 1e-12) return 0;
  if (Math.abs(x - 1) < 1e-12) return 1;
  if (Math.abs(x + 1) < 1e-12) return -1;
  return x;
};
/** Translations are authored in millimetres; round away the noise of the world → local conversion. */
const mm = (x) => clean(Math.round(x * 1e9) / 1e9);

// ---------- skeleton ----------

const Rz = (deg) => qAxisAngle([0, 0, 1], deg * DEG);
const Rx = (deg) => qAxisAngle([1, 0, 0], deg * DEG);

/**
 * World rest pose in canonical character space (+Y up, +Z forward, character left = +X), metres. Bone frames follow
 * a Blender export (local +Y points to the child) so the rest rotations are not all identity.
 */
const BONES = [
  // name, humanoid, parent, world position, world rotation, bone radius (m)
  ['Root', null, null, [0, 0, 0], qIdentity(), null],
  ['hips', 'hips', 'Root', [0, 0.95, 0], qIdentity(), 0.14],
  ['spine', 'spine', 'hips', [0, 1.05, 0], qIdentity(), 0.13],
  ['chest', 'chest', 'spine', [0, 1.17, 0], qIdentity(), 0.14],
  ['upperChest', 'upperChest', 'chest', [0, 1.29, 0], qIdentity(), 0.14],
  ['neck', 'neck', 'upperChest', [0, 1.43, 0], qIdentity(), 0.06],
  ['head', 'head', 'neck', [0, 1.53, 0], qIdentity(), 0.11],
  ['jaw', 'jaw', 'head', [0, 1.51, 0.05], qIdentity(), 0.05],
  ['leftShoulder', 'leftShoulder', 'upperChest', [0.04, 1.39, -0.01], Rz(-90), 0.05],
  ['leftUpperArm', 'leftUpperArm', 'leftShoulder', [0.14, 1.39, -0.01], Rz(-90), 0.05],
  ['leftLowerArm', 'leftLowerArm', 'leftUpperArm', [0.4, 1.39, -0.01], Rz(-90), 0.04],
  ['leftHand', 'leftHand', 'leftLowerArm', [0.64, 1.39, -0.01], Rz(-90), 0.035],
  ['leftIndexProximal', 'leftIndexProximal', 'leftHand', [0.72, 1.39, 0.01], Rz(-90), 0.009],
  ['rightShoulder', 'rightShoulder', 'upperChest', [-0.04, 1.39, -0.01], Rz(90), 0.05],
  ['rightUpperArm', 'rightUpperArm', 'rightShoulder', [-0.14, 1.39, -0.01], Rz(90), 0.05],
  ['rightLowerArm', 'rightLowerArm', 'rightUpperArm', [-0.4, 1.39, -0.01], Rz(90), 0.04],
  ['rightHand', 'rightHand', 'rightLowerArm', [-0.64, 1.39, -0.01], Rz(90), 0.035],
  ['rightIndexProximal', 'rightIndexProximal', 'rightHand', [-0.72, 1.39, 0.01], Rz(90), 0.009],
  ['leftUpperLeg', 'leftUpperLeg', 'hips', [0.09, 0.9, 0], Rx(180), 0.08],
  ['leftLowerLeg', 'leftLowerLeg', 'leftUpperLeg', [0.09, 0.48, 0], Rx(180), 0.06],
  ['leftFoot', 'leftFoot', 'leftLowerLeg', [0.09, 0.08, 0], Rx(180), 0.045],
  ['leftToes', 'leftToes', 'leftFoot', [0.09, 0.02, 0.12], Rx(90), 0.035],
  ['rightUpperLeg', 'rightUpperLeg', 'hips', [-0.09, 0.9, 0], Rx(180), 0.08],
  ['rightLowerLeg', 'rightLowerLeg', 'rightUpperLeg', [-0.09, 0.48, 0], Rx(180), 0.06],
  ['rightFoot', 'rightFoot', 'rightLowerLeg', [-0.09, 0.08, 0], Rx(180), 0.045],
  ['rightToes', 'rightToes', 'rightFoot', [-0.09, 0.02, 0.12], Rx(90), 0.035],
];

function buildSkeleton() {
  const index = new Map(BONES.map(([name], i) => [name, i]));
  const nodes = BONES.map(([name, , parentName, worldT, worldQ], i) => {
    const parent = parentName === null ? -1 : index.get(parentName);
    let t = worldT;
    let q = worldQ;
    if (parent !== -1) {
      const [, , , parentT, parentQ] = BONES[parent];
      const inv = qConj(parentQ);
      t = qRotate(inv, sub(worldT, parentT));
      q = qMul(inv, worldQ);
    }
    return {
      index: i,
      gltfIndex: i,
      name,
      parent,
      restLocal: { t: t.map(mm), q: q.map(clean), s: [1, 1, 1] },
      hasMatrix: false,
      isJoint: parent !== -1,
      hasMesh: false,
    };
  });
  const humanoid = {};
  for (const [name, human] of BONES) if (human !== null) humanoid[human] = index.get(name);
  const desc = {
    format: 'vrm1',
    facing: [0, 0, 0, 1],
    nodes,
    humanoid,
    springJoints: [],
    nodeConstraints: [],
    constrainedNodes: [],
    boneRadii: BONES.map((bone) => bone[5]),
    height: HEIGHT,
    heightSource: 'joints',
    fingerprint: '',
    ekzaHeightScale: null,
    warnings: [],
  };
  desc.fingerprint = skeletonFingerprint(desc);
  return desc;
}

/** sha256 over the names, parent names and rest TRS (1e-5) sorted by name (synthetic stand-in for io's rule). */
function skeletonFingerprint(desc) {
  const round = (x) => (Math.round(x * 1e5) / 1e5).toFixed(5);
  const lines = desc.nodes
    .map((node) => {
      const parent = node.parent === -1 ? '' : desc.nodes[node.parent].name;
      const { t, q, s } = node.restLocal;
      return [node.name, parent, ...t.map(round), ...q.map(round), ...s.map(round)].join('|');
    })
    .sort();
  return `sha256:${createHash('sha256').update(lines.join('\n')).digest('hex')}`;
}

/** Canonical rest worlds by composing the written rest locals (so rest-pose.json matches the skeleton exactly). */
function restWorlds(skeleton) {
  const worlds = [];
  for (const node of skeleton.nodes) {
    const { t, q, s } = node.restLocal;
    if (node.parent === -1) {
      worlds.push({ t: qRotate(skeleton.facing, t), q: qMul(skeleton.facing, q), s });
    } else {
      const p = worlds[node.parent];
      worlds.push({
        t: add(p.t, qRotate(p.q, [t[0] * p.s[0], t[1] * p.s[1], t[2] * p.s[2]])),
        q: qMul(p.q, q),
        s: [p.s[0] * s[0], p.s[1] * s[1], p.s[2] * s[2]],
      });
    }
  }
  return worlds;
}

function buildRestPose(skeleton) {
  const humanOf = new Map(Object.entries(skeleton.humanoid).map(([human, node]) => [node, human]));
  return {
    format: 'ekza-animator-rest-pose',
    version: 1,
    skeleton: 'humanoid-skeleton.json',
    space: 'canonical',
    bones: restWorlds(skeleton).map((w, i) => ({
      node: i,
      name: skeleton.nodes[i].name,
      humanoid: humanOf.get(i) ?? null,
      t: w.t,
      q: w.q,
      s: w.s,
      world: mat4Compose(w.t, w.q, w.s),
    })),
  };
}

// ---------- document ----------

const IDS = {
  character: 'chr_SyntheticWave001',
  rig: 'rig_SyntheticWave001',
  clip: 'clp_SyntheticWave001',
  layer: 'lay_SyntheticWave001',
  curve: 'crv_SyntheticWave001',
  keys: ['k_SynthWave001', 'k_SynthWave002', 'k_SynthWave003'],
};
/** The asset is a placeholder without bytes: its id is the SHA-256 of the empty byte string and its size is 0. */
const EMPTY_SHA256 = createHash('sha256').update(new Uint8Array(0)).digest('hex');
const FPS = { num: 30, den: 1 };
const XF_IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
const AXES_ALL = [true, true, true];
const AXES_NONE = [false, false, false];

/** Order keys among siblings: 'a0', 'a1', … (valid fractional-index keys). */
const orderKey = (i) => `a${i.toString(36)}`;

/** Control template: key, display name, side, group, parent key, humanoid bone (null: pure space), extra. */
const CONTROLS = [
  ['root', 'Root', 'C', 'body', null, null],
  ['cog', 'COG', 'C', 'body', 'root', null],
  ['fk.hips', 'Hips', 'C', 'body', 'cog', 'hips'],
  ['fk.spine', 'Spine', 'C', 'body', 'cog', 'spine'],
  ['fk.chest', 'Chest', 'C', 'body', 'fk.spine', 'chest'],
  ['fk.upperChest', 'Upper Chest', 'C', 'body', 'fk.chest', 'upperChest'],
  ['fk.neck', 'Neck', 'C', 'body', 'fk.upperChest', 'neck'],
  ['fk.head', 'Head', 'C', 'body', 'fk.neck', 'head'],
  ['fk.jaw', 'Jaw', 'C', 'face', 'fk.head', 'jaw'],
  ...['L', 'R'].flatMap((side) => {
    const s = side === 'L' ? 'left' : 'right';
    return [
      [`fk.shoulder.${side}`, `${side} Shoulder`, side, 'body', 'fk.upperChest', `${s}Shoulder`],
      [`fk.upperArm.${side}`, `${side} Upper Arm`, side, 'body', `fk.shoulder.${side}`, `${s}UpperArm`],
      [`fk.lowerArm.${side}`, `${side} Lower Arm`, side, 'body', `fk.upperArm.${side}`, `${s}LowerArm`],
      [`fk.hand.${side}`, `${side} Hand`, side, 'body', `fk.lowerArm.${side}`, `${s}Hand`],
      [`fk.indexProximal.${side}`, `${side} Index Proximal`, side, 'fingers', `fk.hand.${side}`, `${s}IndexProximal`],
      [`fk.upperLeg.${side}`, `${side} Upper Leg`, side, 'body', 'fk.hips', `${s}UpperLeg`],
      [`fk.lowerLeg.${side}`, `${side} Lower Leg`, side, 'body', `fk.upperLeg.${side}`, `${s}LowerLeg`],
      [`fk.foot.${side}`, `${side} Foot`, side, 'body', `fk.lowerLeg.${side}`, `${s}Foot`],
      [`fk.toes.${side}`, `${side} Toes`, side, 'body', `fk.foot.${side}`, `${s}Toes`],
    ];
  }),
];

/** Rotate order per bone family (MVP-SPEC §4.11.15). */
function rotateOrderOf(key) {
  if (/^fk\.(shoulder|upperArm)\./.test(key)) return 'yxz';
  if (key.startsWith('fk.lowerArm.')) return 'xzy';
  if (/^fk\.(hand|indexProximal)\./.test(key)) return 'xyz';
  if (/^fk\.(upperLeg|lowerLeg|foot|toes)\./.test(key)) return 'yzx';
  return 'zxy';
}

/** Size and offset group per §4.11.15 (synthetic approximation). */
function shapeOf(key, human, skeleton, worlds) {
  const flat = Rx(-90); // planar shapes lie in XY with normal +Z; this lays them on the floor (normal +Y)
  if (key === 'root') return shape('arrow4', 0.35 * HEIGHT, { t: [0, 0, 0], q: flat });
  if (key === 'cog') return shape('star', 0.18 * HEIGHT, { t: [0, 0, 0], q: flat });
  const node = skeleton.humanoid[human];
  const radius = skeleton.boneRadii[node];
  const childIndex = skeleton.nodes.findIndex((n) => n.parent === node);
  const here = worlds[node].t;
  let along;
  if (childIndex !== -1) {
    along = sub(worlds[childIndex].t, here);
  } else {
    const parent = skeleton.nodes[node].parent;
    along = scale(sub(here, worlds[parent].t), 0.5);
  }
  const boneLength = length(along);
  const dir = scale(along, 1 / boneLength);
  const normalAlongBone = qShortestArc([0, 0, 1], dir).map(clean);
  const offset = (fraction) => ({ t: scale(dir, fraction * boneLength).map(mm), q: normalAlongBone });
  const clamp = (r, lo, hi) => Math.min(Math.max(r, lo * HEIGHT), hi * HEIGHT);
  if (/^fk\.(hips|spine|chest|upperChest|neck|head|jaw)$/.test(key)) {
    return shape('circle', clamp(radius, 0.05, 0.25), offset(0.5));
  }
  if (key.startsWith('fk.shoulder.')) return shape('halfCircle', clamp(radius, 0.025, 0.1), offset(0.5));
  if (/^fk\.(upperArm|lowerArm|upperLeg|lowerLeg)\./.test(key)) {
    return shape('circle', clamp(radius, 0.025, 0.15), offset(0.25));
  }
  if (/^fk\.(hand|foot|toes)\./.test(key)) return shape('circle', clamp(radius, 0.03, 0.1), offset(0.4));
  return shape('lollipop', clamp(radius, 0.006, 0.01), { t: [0, 0, 0], q: [0, 0, 0, 1] });
}

function shape(kind, size, offset) {
  return {
    kind,
    size: Math.round(size * 1e6) / 1e6,
    offset: { t: offset.t, q: offset.q, s: [1, 1, 1] },
    custom: null,
    color: 'side',
    lineWidth: null,
  };
}

function buildWaveDoc(skeleton) {
  const worlds = restWorlds(skeleton);
  const controlId = (key) => `${IDS.rig}:${key}`;
  const siblings = new Map();
  const controls = {};
  for (const [key, name, side, group, parentKey, human] of CONTROLS) {
    const position = key === 'root' ? [0, 0, 0] : worlds[skeleton.humanoid[human ?? 'hips']].t;
    const siblingIndex = siblings.get(parentKey) ?? 0;
    siblings.set(parentKey, siblingIndex + 1);
    const spaceOnly = human === null;
    const mirrorKey = side === 'L' ? key.replace(/\.L$/, '.R') : side === 'R' ? key.replace(/\.R$/, '.L') : null;
    const id = controlId(key);
    controls[id] = {
      id,
      rig: IDS.rig,
      key,
      name,
      side,
      group,
      parent: parentKey === null ? null : controlId(parentKey),
      order: orderKey(siblingIndex),
      restWorld: { t: position.map(mm), q: [0, 0, 0, 1], s: [1, 1, 1] },
      rotateOrder: rotateOrderOf(key),
      keyable: { t: spaceOnly ? AXES_ALL : AXES_NONE, r: AXES_ALL, s: AXES_NONE },
      locked: { t: AXES_NONE, r: AXES_NONE, s: AXES_NONE },
      drives: spaceOnly ? null : { bone: { humanoid: human }, mode: key === 'fk.hips' ? 'translateRotate' : 'rotate' },
      mirror: mirrorKey === null ? null : controlId(mirrorKey),
      attrs: {},
      shape: shapeOf(key, human, skeleton, worlds),
      hiddenByDefault: false,
      deleted: null,
    };
  }

  const keyValues = [
    [0, 30 * DEG],
    [15, -30 * DEG],
    [30, 30 * DEG],
  ];
  const keys = {};
  keyValues.forEach(([t, v], i) => {
    const id = IDS.keys[i];
    keys[id] = {
      id,
      clip: IDS.clip,
      curve: IDS.curve,
      t,
      v,
      inType: 'auto',
      outType: 'auto',
      inHandle: { dt: 0, dv: 0 },
      outHandle: { dt: 0, dv: 0 },
      broken: false,
      weightLocked: true,
    };
  });

  const tables = {
    project: {
      project: {
        id: 'project',
        name: 'Wave (synthetic)',
        schemaVersion: 1,
        minWriterVersion: 1,
        sceneFps: FPS,
        sceneRange: { start: 0, end: 30 },
        units: 'm',
        upAxis: 'Y',
      },
    },
    assets: {
      [EMPTY_SHA256]: {
        id: EMPTY_SHA256,
        name: 'synthetic-humanoid.vrm',
        ext: 'vrm',
        mime: 'model/gltf-binary',
        size: 0,
        role: 'model',
      },
    },
    characters: {
      [IDS.character]: {
        id: IDS.character,
        name: 'Synthetic Humanoid',
        asset: EMPTY_SHA256,
        format: 'vrm1',
        rig: IDS.rig,
        placement: XF_IDENTITY,
        order: orderKey(0),
        deleted: null,
      },
    },
    rigs: {
      [IDS.rig]: {
        id: IDS.rig,
        character: IDS.character,
        format: 'ekza.rig',
        version: 1,
        generator: { name: 'ekza-autorig-humanoid', version: '0.2.0' },
        skeleton: { format: 'vrm1', fingerprint: skeleton.fingerprint, facing: skeleton.facing },
        deleted: null,
      },
    },
    controls,
    constraints: {},
    solvers: {},
    cameras: {},
    clips: {
      [IDS.clip]: {
        id: IDS.clip,
        character: IDS.character,
        name: 'wave',
        slot: null,
        fps: FPS,
        range: { start: 0, end: 30 },
        sceneStart: 0,
        loop: true,
        rootMotion: 'hips',
        contact: null,
        tags: ['synthetic'],
        provenance: { derivedFrom: [], redistributable: 'yes' },
        source: { kind: 'new' },
        order: orderKey(0),
        deleted: null,
      },
    },
    layers: {
      [IDS.layer]: {
        id: IDS.layer,
        clip: IDS.clip,
        name: 'Base',
        mode: 'override',
        weight: 1,
        mute: false,
        solo: false,
        owner: null,
        order: orderKey(0),
        deleted: null,
      },
    },
    curves: {
      [IDS.curve]: {
        id: IDS.curve,
        clip: IDS.clip,
        layer: IDS.layer,
        control: controlId('fk.lowerArm.L'),
        channel: 'rz',
        weighted: false,
        pre: 'constant',
        post: 'constant',
        staticValue: null,
        locked: false,
        muted: false,
        deleted: null,
      },
    },
    keys,
  };

  return {
    format: 'ekza-animator-doc',
    schemaVersion: 1,
    minWriterVersion: 1,
    tableVersions: Object.fromEntries(Object.keys(tables).map((name) => [name, 1])),
    tables,
  };
}

// ---------- output ----------

/** The fixture files as text, keyed by file name. */
export function buildSyntheticFixtures() {
  const skeleton = buildSkeleton();
  const files = {
    'humanoid-skeleton.json': skeleton,
    'wave-doc.json': buildWaveDoc(skeleton),
    'rest-pose.json': buildRestPose(skeleton),
  };
  return Object.fromEntries(Object.entries(files).map(([name, value]) => [name, `${formatJson(value, 0)}\n`]));
}

/** The binary fixtures, keyed by file name. */
export function buildSyntheticBinaries() {
  return { 'prohibited-modification.vrm': buildProhibitedVrm(buildSkeleton()) };
}

// ---------- prohibited-modification.vrm (M6a, B8) ----------

/**
 * A minimal VRM 1.0 on the synthetic skeleton: the bone nodes with their rest TRS, one mesh `Body` of an axis-aligned
 * box per bone (24 vertices, faceted, rigidly skinned to its bone), one material, the skin with exact inverse bind
 * matrices, and `VRMC_vrm` with the humanoid map and a meta that forbids modification.
 */
function buildProhibitedVrm(skeleton) {
  const worlds = restWorlds(skeleton);
  const joints = skeleton.nodes.filter((node) => node.parent !== -1).map((node) => node.index);
  const positions = [];
  const normals = [];
  const jointIds = [];
  const weights = [];
  const indices = [];
  const FACES = [
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [
      [-1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ],
    [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
    [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, -1],
      [0, 1, 0],
      [1, 0, 0],
    ],
  ];
  joints.forEach((node, slot) => {
    const centre = worlds[node].t;
    const half = Math.max(0.01, (BONES[node][5] ?? 0.02) * 0.6);
    for (const [n, u, v] of FACES) {
      const base = positions.length / 3;
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        for (let k = 0; k < 3; k++) positions.push(Math.fround(centre[k] + half * (n[k] + a * u[k] + b * v[k])));
        normals.push(...n);
        jointIds.push(slot, 0, 0, 0);
        weights.push(1, 0, 0, 0);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  });
  const ibm = [];
  for (const node of joints) {
    const w = worlds[node];
    const inv = qConj(w.q);
    const t = qRotate(inv, [-w.t[0], -w.t[1], -w.t[2]]);
    ibm.push(...mat4Compose(t, inv, [1, 1, 1]).map(clean));
  }

  const parts = [];
  const views = [];
  const accessors = [];
  let length = 0;
  const addView = (bytes, target) => {
    const pad = (4 - (length % 4)) % 4;
    if (pad > 0) parts.push(new Uint8Array(pad));
    length += pad;
    views.push({
      buffer: 0,
      byteOffset: length,
      byteLength: bytes.length,
      ...(target === undefined ? {} : { target }),
    });
    parts.push(bytes);
    length += bytes.length;
    return views.length - 1;
  };
  const addAccessor = (array, componentType, type, count, target, minMax) => {
    const bufferView = addView(new Uint8Array(array.buffer), target);
    const accessor = { bufferView, componentType, count, type };
    if (minMax) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < array.length; i++) {
        min[i % 3] = Math.min(min[i % 3], array[i]);
        max[i % 3] = Math.max(max[i % 3], array[i]);
      }
      Object.assign(accessor, { max, min });
    }
    accessors.push(accessor);
    return accessors.length - 1;
  };
  const vertexCount = positions.length / 3;
  const POSITION = addAccessor(new Float32Array(positions), 5126, 'VEC3', vertexCount, 34962, true);
  const NORMAL = addAccessor(new Float32Array(normals), 5126, 'VEC3', vertexCount, 34962, false);
  const JOINTS_0 = addAccessor(new Uint8Array(jointIds), 5121, 'VEC4', vertexCount, 34962, false);
  const WEIGHTS_0 = addAccessor(new Float32Array(weights), 5126, 'VEC4', vertexCount, 34962, false);
  const INDICES = addAccessor(new Uint16Array(indices), 5123, 'SCALAR', indices.length, 34963, false);
  const IBM = addAccessor(new Float32Array(ibm), 5126, 'MAT4', joints.length, undefined, false);
  const bin = new Uint8Array(length + ((4 - (length % 4)) % 4));
  let offset = 0;
  for (const part of parts) {
    bin.set(part, offset);
    offset += part.length;
  }

  const nodes = skeleton.nodes.map((node) => {
    const { t, q } = node.restLocal;
    const children = skeleton.nodes.filter((child) => child.parent === node.index).map((child) => child.index);
    return {
      name: node.name,
      ...(children.length > 0 ? { children } : {}),
      ...(t.some((c) => c !== 0) ? { translation: t } : {}),
      ...(q[0] !== 0 || q[1] !== 0 || q[2] !== 0 ? { rotation: q } : {}),
    };
  });
  nodes.push({ name: 'Body', mesh: 0, skin: 0 });
  const humanBones = {};
  for (const [bone, index] of Object.entries(skeleton.humanoid)) humanBones[bone] = { node: index };
  const json = {
    asset: { version: '2.0', generator: 'ekza-animator make-synthetic-fixtures' },
    extensionsUsed: ['VRMC_vrm'],
    extensions: {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: {
          name: 'Prohibited modification (synthetic)',
          version: '1',
          authors: ['Ekza Animator tests'],
          licenseUrl: 'https://vrm.dev/licenses/1.0/',
          avatarPermission: 'onlyAuthor',
          allowExcessivelyViolentUsage: false,
          allowExcessivelySexualUsage: false,
          commercialUsage: 'personalNonProfit',
          allowPoliticalOrReligiousUsage: false,
          allowAntisocialOrHateUsage: false,
          creditNotation: 'required',
          allowRedistribution: false,
          modification: 'prohibited',
        },
        humanoid: { humanBones },
      },
    },
    scene: 0,
    scenes: [{ nodes: [0, nodes.length - 1] }],
    nodes,
    meshes: [
      {
        name: 'Body',
        primitives: [{ attributes: { POSITION, NORMAL, JOINTS_0, WEIGHTS_0 }, indices: INDICES, material: 0 }],
      },
    ],
    materials: [{ name: 'Body', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0 } }],
    skins: [{ name: 'Body', inverseBindMatrices: IBM, joints, skeleton: 0 }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  return assembleGlb(JSON.stringify(json), bin);
}

/** glTF 2.0 binary: header, JSON chunk padded with spaces, BIN chunk padded with zeros. */
function assembleGlb(text, bin) {
  const jsonBytes = new TextEncoder().encode(text);
  const jsonLength = (jsonBytes.length + 3) & ~3;
  const total = 12 + 8 + jsonLength + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLength, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);
  dv.setUint32(20 + jsonLength, bin.length, true);
  dv.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(bin, 28 + jsonLength);
  return out;
}

const LINE_WIDTH = 120;

/**
 * JSON with two-space indentation that keeps a value on one line when it fits in the line width (stable and
 * diff-friendly). `column` is where the value starts on its line.
 */
function formatJson(value, indent, column = indent) {
  const inline = inlineJson(value);
  if (value === null || typeof value !== 'object' || column + inline.length <= LINE_WIDTH) return inline;
  const pad = ' '.repeat(indent + 2);
  const close = ' '.repeat(indent);
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => pad + formatJson(item, indent + 2)).join(',\n')}\n${close}]`;
  }
  const lines = Object.entries(value).map(([key, item]) => {
    const prefix = `${pad}${JSON.stringify(key)}: `;
    return prefix + formatJson(item, indent + 2, prefix.length);
  });
  return `{\n${lines.join(',\n')}\n${close}}`;
}

function inlineJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(inlineJson).join(', ')}]`;
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  return `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${inlineJson(item)}`).join(', ')} }`;
}

function main(argv) {
  const outIndex = argv.indexOf('--out');
  const outDir = outIndex === -1 ? SYNTHETIC_DIR : resolve(argv[outIndex + 1] ?? '');
  const check = argv.includes('--check');
  const files = buildSyntheticFixtures();
  const binaries = buildSyntheticBinaries();
  if (check) {
    const stale = [
      ...Object.entries(files)
        .filter(([name, text]) => {
          const file = join(outDir, name);
          return !existsSync(file) || readFileSync(file, 'utf8') !== text;
        })
        .map(([name]) => name),
      ...Object.entries(binaries)
        .filter(([name, bytes]) => {
          const file = join(outDir, name);
          return !existsSync(file) || Buffer.compare(readFileSync(file), Buffer.from(bytes)) !== 0;
        })
        .map(([name]) => name),
    ];
    if (stale.length > 0) {
      console.error(`Synthetic fixtures are stale: ${stale.join(', ')}. Run node tooling/make-synthetic-fixtures.mjs`);
      return 1;
    }
    console.log(
      `Synthetic fixtures are up to date (${Object.keys(files).length + Object.keys(binaries).length} files).`,
    );
    return 0;
  }
  mkdirSync(outDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(outDir, name), text);
  for (const [name, bytes] of Object.entries(binaries)) writeFileSync(join(outDir, name), bytes);
  console.log(`Wrote ${[...Object.keys(files), ...Object.keys(binaries)].join(', ')} to ${outDir}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
