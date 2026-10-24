// OMOBA's rest facing for local avatars (CHARACTER-CONTRACT-SPEC §11 P-4; C-pre). The game renders every avatar resting
// toward −Z, as VRM 0.x does; a VRM 1.0 rests toward +Z, so OMOBA's local import (`scripts/convert_vrm_to_glb.py`) and
// its rendition builder turn a VRM 1.0's scene roots 180° about Y first (`retarget_animations.normalize_vrm1_rest_facing`
// in omoba-bevy, recorded as `asset.extras.omoba_rest_yaw180`); the client itself never turns a model. This is that
// helper in TypeScript, so the local test kit's `<slug>.glb` is what OMOBA's own staging writes: VRM 0.x and a rest that
// already faces −Z are left byte for byte; only the JSON chunk changes (the BIN chunk is copied as is).
import { isGlb, parseGlbSync, readGlbLayout } from '../glb/parse';
import { assembleGlb } from '../glb/write';

/** `asset.extras` key OMOBA records the turn under (`retarget_animations.FACING_MARKER_KEY`). */
export const OMOBA_FACING_MARKER = 'omoba_rest_yaw180';

type Json = Record<string, unknown>;
type Vec3 = [number, number, number];
type Mat4 = number[];

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const numbers = (value: unknown, length: number): number[] | null =>
  Array.isArray(value) && value.length === length && value.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (value as number[])
    : null;
const vec3 = (value: unknown): Vec3 | null => numbers(value, 3) as Vec3 | null;
const quat = (value: unknown): [number, number, number, number] | null =>
  numbers(value, 4) as [number, number, number, number] | null;

/** Column-major 4×4 of a node's local transform (matrix, or T·R·S). */
function localMatrix(node: Json): Mat4 {
  const matrix = numbers(node['matrix'], 16);
  if (matrix !== null) return matrix;
  const [tx, ty, tz] = vec3(node['translation']) ?? [0, 0, 0];
  const [x, y, z, w] = quat(node['rotation']) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = vec3(node['scale']) ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out: number[] = Array.from({ length: 16 }, () => 0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** World positions of the rest pose (the document's node transforms), by node index. */
function restWorldPositions(nodes: readonly Json[]): Map<number, Vec3> {
  const parent = new Map<number, number>();
  nodes.forEach((node, index) => {
    const children = node['children'];
    if (Array.isArray(children)) for (const child of children) if (typeof child === 'number') parent.set(child, index);
  });
  const world = new Map<number, Mat4>();
  const worldOf = (index: number, depth = 0): Mat4 => {
    const known = world.get(index);
    if (known !== undefined) return known;
    const node = nodes[index] ?? {};
    const up = parent.get(index);
    const matrix =
      up === undefined || depth > nodes.length
        ? localMatrix(node)
        : multiply(worldOf(up, depth + 1), localMatrix(node));
    world.set(index, matrix);
    return matrix;
  };
  const out = new Map<number, Vec3>();
  nodes.forEach((_, index) => {
    const m = worldOf(index);
    out.set(index, [m[12] as number, m[13] as number, m[14] as number]);
  });
  return out;
}

/** `rest_faces_plus_z`: the left-to-right hand span crossed with up (hips → head) points toward +Z. */
function restFacesPlusZ(positions: Map<number, Vec3>, bones: Readonly<Record<string, number>>): boolean {
  const at = (bone: string): Vec3 => positions.get(bones[bone] as number) ?? [0, 0, 0];
  const [hips, head, left, right] = [at('hips'), at('head'), at('leftHand'), at('rightHand')];
  const up = [head[0] - hips[0], head[1] - hips[1], head[2] - hips[2]];
  const across = [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
  return (across[0] as number) * (up[1] as number) - (across[1] as number) * (up[0] as number) > 0;
}

/** Yaws a root 180° about +Y: rotation `Y·q`, translation `(−x, y, −z)`; a matrix root is pre-multiplied. */
function turnRoot(node: Json): void {
  const matrix = numbers(node['matrix'], 16);
  if (matrix !== null) {
    node['matrix'] = matrix.map((value, i) => (i % 4 === 0 || i % 4 === 2 ? -value : value));
    return;
  }
  const [x, y, z, w] = quat(node['rotation']) ?? [0, 0, 0, 1];
  const turned = [z, w, -x, -y];
  const length = Math.hypot(...turned) || 1;
  node['rotation'] = turned.map((value) => value / length);
  const translation = vec3(node['translation']);
  if (translation !== null) node['translation'] = [-translation[0], translation[1], -translation[2]];
}

/**
 * The bytes OMOBA's local import stages for an avatar file: a VRM 1.0 whose rest faces +Z with its scene roots turned
 * 180° about Y and `asset.extras.omoba_rest_yaw180: true`; anything else (VRM 0.x, a plain GLB, a rest that already
 * faces −Z, a file without the four bones the check needs, bytes that are no GLB) unchanged.
 */
export function stageVrmForOmoba(bytes: Uint8Array): { readonly bytes: Uint8Array; readonly turned: boolean } {
  const unchanged = { bytes, turned: false } as const;
  if (!isGlb(bytes)) return unchanged;
  let json: Json;
  let bin: Uint8Array | null;
  try {
    readGlbLayout(bytes);
    const parsed = parseGlbSync(bytes);
    json = parsed.json;
    bin = parsed.bin;
  } catch {
    return unchanged;
  }
  const extensions = json['extensions'];
  const vrm = isObject(extensions) ? extensions['VRMC_vrm'] : undefined;
  const humanoid = isObject(vrm) ? vrm['humanoid'] : undefined;
  const humanBones = isObject(humanoid) ? humanoid['humanBones'] : undefined;
  const rawNodes: readonly unknown[] = Array.isArray(json['nodes']) ? json['nodes'] : [];
  const nodes = rawNodes.filter(isObject);
  if (!isObject(humanBones) || nodes.length === 0 || nodes.length !== rawNodes.length) return unchanged;
  const bones: Record<string, number> = {};
  for (const [name, bone] of Object.entries(humanBones)) {
    const node = isObject(bone) ? bone['node'] : undefined;
    if (typeof node === 'number' && Number.isInteger(node) && node >= 0 && node < nodes.length) bones[name] = node;
  }
  if (!['hips', 'head', 'leftHand', 'rightHand'].every((bone) => bone in bones)) return unchanged;
  if (!restFacesPlusZ(restWorldPositions(nodes), bones)) return unchanged;
  const children = new Set<number>();
  for (const node of nodes) {
    const list = node['children'];
    if (Array.isArray(list)) for (const child of list) if (typeof child === 'number') children.add(child);
  }
  nodes.forEach((node, index) => {
    if (!children.has(index)) turnRoot(node);
  });
  const asset = isObject(json['asset']) ? json['asset'] : (json['asset'] = {});
  const extras = isObject(asset['extras']) ? asset['extras'] : (asset['extras'] = {});
  extras[OMOBA_FACING_MARKER] = true;
  return { bytes: assembleGlb(JSON.stringify(json), bin === null ? null : [bin]), turned: true };
}
