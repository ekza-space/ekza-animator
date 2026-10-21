// Fixtures of the C4 bind tests (M6B-SPEC §9.0 C4, §5.26 P-S4/P-S5/P-S7): the generated humanoid body (smooth and
// segmented) with a Standard-33-like skeleton on its proportions, the Cube Lad from its truth boxes and joints, and
// helpers that build `SkinSkeleton`s from plain joint tables. Pure (no file access): the Chromium run imports it too.
import { humanoidBody, type MeshData, type SkinSkeleton } from '../../src';
import { EDGE_HARD } from '../../src/descriptors';
import { buildMeshData } from '../../src/testing';

export type Vec3 = readonly [number, number, number];

export interface JointRow {
  readonly key: string;
  readonly parent: string | null;
  readonly head: Vec3;
  /** Leaf tail (else the humanoid-chain child or the first child). */
  readonly tail?: Vec3 | null;
  readonly deform?: boolean;
  readonly humanBone?: string | null;
}

/** The humanoid chain child of a bone (the `SkinSkeleton.tail` rule). */
const CHAIN: Readonly<Record<string, readonly string[]>> = {
  hips: ['spine'],
  spine: ['chest'],
  chest: ['upperChest', 'neck'],
  upperChest: ['neck'],
  neck: ['head'],
  leftShoulder: ['leftUpperArm'],
  rightShoulder: ['rightUpperArm'],
  leftUpperArm: ['leftLowerArm'],
  rightUpperArm: ['rightLowerArm'],
  leftLowerArm: ['leftHand'],
  rightLowerArm: ['rightHand'],
  leftHand: ['leftMiddleProximal'],
  rightHand: ['rightMiddleProximal'],
  leftUpperLeg: ['leftLowerLeg'],
  rightUpperLeg: ['rightLowerLeg'],
  leftLowerLeg: ['leftFoot'],
  rightLowerLeg: ['rightFoot'],
  leftFoot: ['leftToes'],
  rightFoot: ['rightToes'],
};

const swapSide = (name: string): string | null => {
  const swaps: readonly (readonly [RegExp, string])[] = [
    [/^left/, 'right'],
    [/^right/, 'left'],
    [/Left/, 'Right'],
    [/Right/, 'Left'],
    [/\.L$/, '.R'],
    [/\.R$/, '.L'],
  ];
  for (const [re, to] of swaps) if (re.test(name)) return name.replace(re, to);
  return null;
};

/** A SkinSkeleton from joint rows (rows must list parents first). Mirror by the L/R name swap, side by sign of x. */
export function skeletonOf(rows: readonly JointRow[]): SkinSkeleton {
  const index = new Map(rows.map((row, i) => [row.key, i]));
  const J = rows.length;
  const parent = new Int32Array(J).fill(-1);
  const head = new Float64Array(3 * J);
  const tail = new Float64Array(3 * J);
  const mirror = new Int32Array(J).fill(-1);
  const side = new Uint8Array(J);
  const deform = new Uint8Array(J);
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  rows.forEach((row, j) => {
    parent[j] = row.parent === null ? -1 : (index.get(row.parent) ?? -1);
    head.set(row.head, 3 * j);
    deform[j] = row.deform === false ? 0 : 1;
    side[j] = row.head[0] > 1e-6 ? 1 : row.head[0] < -1e-6 ? 2 : 0;
    const other = swapSide(row.key);
    if (other !== null && index.has(other)) mirror[j] = index.get(other) as number;
    minY = Math.min(minY, row.head[1], row.tail?.[1] ?? row.head[1]);
    maxY = Math.max(maxY, row.head[1], row.tail?.[1] ?? row.head[1]);
  });
  const children: number[][] = Array.from({ length: J }, () => []);
  for (let j = 0; j < J; j++) if ((parent[j] as number) >= 0) (children[parent[j] as number] as number[]).push(j);
  rows.forEach((row, j) => {
    const chain = (CHAIN[row.key] ?? []).map((key) => index.get(key)).find((c) => c !== undefined);
    const first = (children[j] as number[])[0];
    let t: Vec3;
    if (chain !== undefined) t = rows[chain]?.head as Vec3;
    else if (first !== undefined) t = rows[first]?.head as Vec3;
    else if (row.tail !== undefined && row.tail !== null) t = row.tail;
    else {
      const p = parent[j] as number;
      const from = p >= 0 ? (rows[p]?.head as Vec3) : ([row.head[0], row.head[1] - 1, row.head[2]] as Vec3);
      const d = [row.head[0] - from[0], row.head[1] - from[1], row.head[2] - from[2]];
      const len = Math.hypot(d[0] as number, d[1] as number, d[2] as number) || 1;
      const h = maxY - minY || 1;
      t = [
        row.head[0] + ((0.05 * h) / len) * (d[0] as number),
        row.head[1] + ((0.05 * h) / len) * (d[1] as number),
        row.head[2] + ((0.05 * h) / len) * (d[2] as number),
      ];
    }
    tail.set(t, 3 * j);
  });
  return {
    keys: rows.map((row) => row.key),
    parent,
    head,
    tail,
    mirror,
    side,
    deform,
    humanBone: rows.map((row) => row.humanBone ?? null),
    height: maxY - minY,
  };
}

/** Both sides of a right-side joint table: `right*` rows mirrored to `left*` (x negated). */
function bothSides(rows: readonly JointRow[]): JointRow[] {
  const out: JointRow[] = [];
  for (const row of rows) {
    out.push(row);
    if (!row.key.startsWith('right')) continue;
    const swap = (key: string | null): string | null => (key?.startsWith('right') ? `left${key.slice(5)}` : key);
    const flip = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
    out.push({
      key: swap(row.key) as string,
      parent: swap(row.parent),
      head: flip(row.head),
      tail: row.tail === undefined || row.tail === null ? null : flip(row.tail),
    });
  }
  return out;
}

/** A Standard-33-like skeleton (no fingers) on the generated body's proportions at 1.6 m; `root` a helper. */
export function bodySkeletonRows(): JointRow[] {
  return bothSides([
    { key: 'root', parent: null, head: [0, 0, 0], deform: false },
    { key: 'hips', parent: 'root', head: [0, 0.82, 0] },
    { key: 'spine', parent: 'hips', head: [0, 0.97, 0] },
    { key: 'chest', parent: 'spine', head: [0, 1.13, 0] },
    { key: 'neck', parent: 'chest', head: [0, 1.38, 0] },
    { key: 'head', parent: 'neck', head: [0, 1.45, 0], tail: [0, 1.6, 0] },
    { key: 'rightShoulder', parent: 'chest', head: [-0.06, 1.3, 0] },
    { key: 'rightUpperArm', parent: 'rightShoulder', head: [-0.2, 1.25, 0] },
    { key: 'rightLowerArm', parent: 'rightUpperArm', head: [-0.475, 1.25, -0.002] },
    { key: 'rightHand', parent: 'rightLowerArm', head: [-0.7, 1.25, 0], tail: [-0.8, 1.25, 0] },
    { key: 'rightUpperLeg', parent: 'hips', head: [-0.09, 0.78, 0] },
    { key: 'rightLowerLeg', parent: 'rightUpperLeg', head: [-0.09, 0.47, 0.002] },
    { key: 'rightFoot', parent: 'rightLowerLeg', head: [-0.09, 0.08, 0] },
    { key: 'rightToes', parent: 'rightFoot', head: [-0.09, 0.02, 0.09], tail: [-0.09, 0.02, 0.13] },
  ]).map((row) => ({ ...row, humanBone: row.key === 'root' ? null : row.key }));
}

/** The generated body as MeshData. */
export function body(style: 'smooth' | 'segmented'): MeshData {
  return humanoidBody({ style, height: 1.6 });
}

// ---------- Cube Lad (fixtures/models/cube-lad-truth.json; M6B-C0-1: 16 boxes) ----------

export interface CubeLadTruth {
  readonly height: number;
  readonly boxes: readonly { readonly name: string; readonly center: Vec3; readonly size: Vec3 }[];
  readonly joints: Readonly<
    Record<string, { readonly position: Vec3; readonly parent: string | null; readonly tail: Vec3 | null }>
  >;
}

/** The Cube Lad as one MeshData (box i = points 8i…8i+7, faces 6i…6i+5) and the box of every point. */
export function cubeLad(truth: CubeLadTruth): { readonly mesh: MeshData; readonly boxOf: readonly string[] } {
  const positions: number[] = [];
  const faces: number[][] = [];
  const boxOf: string[] = [];
  truth.boxes.forEach((box, b) => {
    const [cx, cy, cz] = box.center;
    const [sx, sy, sz] = box.size;
    for (const [x, y, z] of [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
    ] as const) {
      positions.push(cx + (x * sx) / 2, cy + (y * sy) / 2, cz + (z * sz) / 2);
      boxOf.push(box.name);
    }
    const o = 8 * b;
    faces.push(
      [o, o + 1, o + 2, o + 3],
      [o + 3, o + 2, o + 6, o + 7],
      [o + 7, o + 6, o + 5, o + 4],
      [o + 4, o + 5, o + 1, o],
      [o + 1, o + 5, o + 6, o + 2],
      [o + 4, o, o + 3, o + 7],
    );
  });
  return { mesh: buildMeshData({ positions, faces, edgeFlags: EDGE_HARD }), boxOf };
}

/** The Cube Lad's truth joints as rows (parents first); `root` a helper. */
export function cubeLadRows(truth: CubeLadTruth): JointRow[] {
  const keys = Object.keys(truth.joints);
  const rows: JointRow[] = [];
  const placed = new Set<string>();
  while (rows.length < keys.length) {
    for (const key of keys) {
      const joint = truth.joints[key];
      if (joint === undefined || placed.has(key)) continue;
      if (joint.parent !== null && !placed.has(joint.parent)) continue;
      rows.push({
        key,
        parent: joint.parent,
        head: joint.position,
        tail: joint.tail,
        deform: key !== 'root',
        humanBone: key === 'root' ? null : key,
      });
      placed.add(key);
    }
  }
  return rows;
}

// ---------- tubes (bench and stress meshes) ----------

/** A closed tube along a polyline: `rings` rings of `sides` points, evenly by arc length, capped with two n-gons. */
export function tube(
  path: readonly Vec3[],
  radius: number,
  sides: number,
  rings: number,
): { positions: number[]; faces: number[][] } {
  const lengths = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Vec3;
    const b = path[i] as Vec3;
    lengths.push((lengths[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = lengths[lengths.length - 1] as number;
  const positions: number[] = [];
  const faces: number[][] = [];
  for (let r = 0; r < rings; r++) {
    const s = (total * r) / (rings - 1);
    let i = 1;
    while (i < path.length - 1 && (lengths[i] as number) < s) i++;
    const a = path[i - 1] as Vec3;
    const b = path[i] as Vec3;
    const seg = (lengths[i] as number) - (lengths[i - 1] as number) || 1;
    const t = (s - (lengths[i - 1] as number)) / seg;
    const c = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
    const d = [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg, (b[2] - a[2]) / seg];
    // A frame perpendicular to d: u = normalize(d × z) (or d × x when d ∥ z), w = d × u.
    let u = [d[1] as number, -(d[0] as number), 0];
    if (Math.hypot(u[0] as number, u[1] as number) < 1e-9) u = [0, d[2] as number, -(d[1] as number)];
    const ul = Math.hypot(u[0] as number, u[1] as number, u[2] as number);
    u = u.map((x) => x / ul);
    const w = [
      (d[1] as number) * (u[2] as number) - (d[2] as number) * (u[1] as number),
      (d[2] as number) * (u[0] as number) - (d[0] as number) * (u[2] as number),
      (d[0] as number) * (u[1] as number) - (d[1] as number) * (u[0] as number),
    ];
    for (let k = 0; k < sides; k++) {
      const ang = (2 * Math.PI * k) / sides;
      const cs = Math.cos(ang) * radius;
      const sn = Math.sin(ang) * radius;
      for (let e = 0; e < 3; e++) positions.push((c[e] as number) + cs * (u[e] as number) + sn * (w[e] as number));
    }
  }
  for (let r = 0; r + 1 < rings; r++) {
    for (let k = 0; k < sides; k++) {
      const a = r * sides + k;
      const b = r * sides + ((k + 1) % sides);
      faces.push([a, b, b + sides, a + sides]);
    }
  }
  faces.push(Array.from({ length: sides }, (_, k) => sides - 1 - k));
  faces.push(Array.from({ length: sides }, (_, k) => (rings - 1) * sides + k));
  return { positions, faces };
}

/** Tubes combined into one MeshData (each tube an island). */
export function tubes(parts: readonly { positions: number[]; faces: number[][] }[]): MeshData {
  const positions: number[] = [];
  const faces: number[][] = [];
  for (const part of parts) {
    const base = positions.length / 3;
    positions.push(...part.positions);
    for (const f of part.faces) faces.push(f.map((v) => v + base));
  }
  return buildMeshData({ positions, faces });
}

/** A vertical worm of `rings × sides` points along +Y (3 m) with a chain of `joints` deforming joints. */
export function worm(rings: number, sides: number, joints: number): { mesh: MeshData; skeleton: SkinSkeleton } {
  const mesh = tubes([
    tube(
      [
        [0, 0, 0],
        [0, 3, 0],
      ],
      0.12,
      sides,
      rings,
    ),
  ]);
  const rows: JointRow[] = [];
  for (let j = 0; j < joints; j++) {
    rows.push({
      key: `seg${j}`,
      parent: j === 0 ? null : `seg${j - 1}`,
      head: [0, (3 * j) / joints, 0],
      tail: j === joints - 1 ? [0, 3, 0] : null,
    });
  }
  return { mesh, skeleton: skeletonOf(rows) };
}

/** A ≈3k-point low-poly character of tubes on the body skeleton plus middle and thumb fingers (34 joints). */
export function tubeCharacter(): { mesh: MeshData; skeleton: SkinSkeleton } {
  const rows = bodySkeletonRows();
  const fingers: JointRow[] = [];
  for (const [side, sx] of [
    ['right', -1],
    ['left', 1],
  ] as const) {
    fingers.push(
      { key: `${side}MiddleProximal`, parent: `${side}Hand`, head: [sx * 0.8, 1.25, 0] },
      { key: `${side}MiddleIntermediate`, parent: `${side}MiddleProximal`, head: [sx * 0.84, 1.25, 0] },
      {
        key: `${side}MiddleDistal`,
        parent: `${side}MiddleIntermediate`,
        head: [sx * 0.87, 1.25, 0],
        tail: [sx * 0.9, 1.25, 0],
      },
      { key: `${side}ThumbMetacarpal`, parent: `${side}Hand`, head: [sx * 0.72, 1.24, 0.03] },
      { key: `${side}ThumbProximal`, parent: `${side}ThumbMetacarpal`, head: [sx * 0.75, 1.24, 0.06] },
      {
        key: `${side}ThumbDistal`,
        parent: `${side}ThumbProximal`,
        head: [sx * 0.77, 1.24, 0.08],
        tail: [sx * 0.79, 1.24, 0.1],
      },
    );
  }
  const all = [...rows, ...fingers];
  const at = (key: string): Vec3 => (all.find((row) => row.key === key) as JointRow).head;
  const parts = [tube([at('hips'), at('spine'), at('chest'), at('neck'), at('head'), [0, 1.6, 0]], 0.12, 24, 30)];
  for (const side of ['right', 'left'] as const) {
    const sx = side === 'right' ? -1 : 1;
    parts.push(
      tube(
        [at(`${side}Shoulder`), at(`${side}UpperArm`), at(`${side}LowerArm`), at(`${side}Hand`), [sx * 0.8, 1.25, 0]],
        0.045,
        16,
        30,
      ),
      tube(
        [at(`${side}UpperLeg`), at(`${side}LowerLeg`), at(`${side}Foot`), at(`${side}Toes`), [sx * 0.09, 0.02, 0.13]],
        0.06,
        16,
        30,
      ),
      tube(
        [at(`${side}MiddleProximal`), at(`${side}MiddleIntermediate`), at(`${side}MiddleDistal`), [sx * 0.9, 1.25, 0]],
        0.012,
        8,
        10,
      ),
      tube(
        [at(`${side}ThumbMetacarpal`), at(`${side}ThumbProximal`), at(`${side}ThumbDistal`), [sx * 0.79, 1.24, 0.1]],
        0.012,
        8,
        10,
      ),
    );
  }
  return { mesh: tubes(parts), skeleton: skeletonOf(all) };
}
