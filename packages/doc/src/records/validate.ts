// Structural validation of the built-in record types (MVP-SPEC §4.2). Validators return human-readable problems
// ('field: expected …'); an empty list means valid. Unknown extra fields are allowed: records written by newer apps
// or extensions keep them (ADR 0011). The key validator is hand-written because it runs on every key write.
import type { InfinityMode, RotateOrder, TangentType } from '@ekza-animator/anim-core';
import type {
  BudgetPresetId,
  BuiltinTableName,
  ChannelId,
  ColourOutput,
  HumanBoneName,
  ModelFormat,
  OrthoCamera,
  PrimitiveKind,
  Side,
} from '../records';

type Problems = string[];
type Obj = Readonly<Record<string, unknown>>;
type Check = (value: unknown, path: string, out: Problems) => void;

export const TANGENT_TYPES = [
  'auto',
  'autoEase',
  'autoMix',
  'spline',
  'clamped',
  'plateau',
  'linear',
  'flat',
  'step',
  'stepNext',
  'fixed',
] as const satisfies readonly TangentType[];
export const INFINITY_MODES = [
  'constant',
  'linear',
  'cycle',
  'cycleOffset',
  'oscillate',
] as const satisfies readonly InfinityMode[];
export const ROTATE_ORDERS = ['xyz', 'yzx', 'zxy', 'xzy', 'yxz', 'zyx'] as const satisfies readonly RotateOrder[];
const MODEL_FORMATS = ['vrm0', 'vrm1', 'gltf'] as const satisfies readonly ModelFormat[];
const SIDES = ['L', 'R', 'C'] as const satisfies readonly Side[];
// ---------- M6a vocabularies (M6A-SPEC §4.2) ----------
export const PRIMITIVE_KINDS = [
  'cube',
  'sphere',
  'cylinder',
  'cone',
  'plane',
  'torus',
  'humanoidBody',
] as const satisfies readonly PrimitiveKind[];
export const COLOUR_OUTPUTS = [
  'palette-texture',
  'vertex-colour',
  'material-per-colour',
] as const satisfies readonly ColourOutput[];
export const BUDGET_PRESETS = [
  'hero',
  'npc',
  'boss',
  'handheld',
  'small-prop',
  'medium-prop',
  'building',
] as const satisfies readonly BudgetPresetId[];
export const ORTHO_CAMERAS = ['front', 'side', 'top'] as const satisfies readonly OrthoCamera[];
export const SKELETON_PRESETS = ['lite17', 'core21', 'standard33', 'full52', 'custom'] as const;
export const GROUP_TEMPLATES = ['prop', 'handheld', 'humanoid'] as const;
/** VRM 1.0 humanoid bone names (doc keeps its own list: it cannot import rig). */
export const HUMAN_BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftEye',
  'rightEye',
  'jaw',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftThumbMetacarpal',
  'leftThumbProximal',
  'leftThumbDistal',
  'leftIndexProximal',
  'leftIndexIntermediate',
  'leftIndexDistal',
  'leftMiddleProximal',
  'leftMiddleIntermediate',
  'leftMiddleDistal',
  'leftRingProximal',
  'leftRingIntermediate',
  'leftRingDistal',
  'leftLittleProximal',
  'leftLittleIntermediate',
  'leftLittleDistal',
  'rightThumbMetacarpal',
  'rightThumbProximal',
  'rightThumbDistal',
  'rightIndexProximal',
  'rightIndexIntermediate',
  'rightIndexDistal',
  'rightMiddleProximal',
  'rightMiddleIntermediate',
  'rightMiddleDistal',
  'rightRingProximal',
  'rightRingIntermediate',
  'rightRingDistal',
  'rightLittleProximal',
  'rightLittleIntermediate',
  'rightLittleDistal',
] as const satisfies readonly HumanBoneName[];
/** Handheld grip bounds (M6A-SPEC §4.2 `HandheldGrip`). */
export const HANDHELD_LIMITS = { offset: 0.3, rotationDegrees: 360, scaleMin: 0.25, scaleMax: 2 } as const;
/** Mesh and group names: at most this many characters (M6A-SPEC §4.2 `MeshRecord.name`). */
export const MESH_NAME_MAX = 64;
/** Swatch slots are u16 0…65534 (65535 is reserved). */
export const SWATCH_SLOT_MAX = 65_534;
const TRS = new Set<string>(['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz']);

// Compile-time exhaustiveness: every member of the unions above is listed.
type Missing<Union, List extends readonly unknown[]> = Exclude<Union, List[number]>;
const _exhaustive: [
  Missing<TangentType, typeof TANGENT_TYPES>,
  Missing<InfinityMode, typeof INFINITY_MODES>,
  Missing<RotateOrder, typeof ROTATE_ORDERS>,
  Missing<PrimitiveKind, typeof PRIMITIVE_KINDS>,
  Missing<ColourOutput, typeof COLOUR_OUTPUTS>,
  Missing<BudgetPresetId, typeof BUDGET_PRESETS>,
  Missing<OrthoCamera, typeof ORTHO_CAMERAS>,
  Missing<HumanBoneName, typeof HUMAN_BONE_NAMES>,
] = [] as unknown as [never, never, never, never, never, never, never, never];
void _exhaustive;

const TANGENT_SET = new Set<unknown>(TANGENT_TYPES);

/** Clip display names: ≤ 64 characters of [A-Za-z0-9 _.-] (MVP-SPEC §4.2 `ClipRecord.name`). */
export const CLIP_NAME_PATTERN = /^[A-Za-z0-9 _.-]{1,64}$/;
/** Clip tags: lowercase [a-z0-9_-], at most 8 per clip. */
export const CLIP_TAG_PATTERN = /^[a-z0-9_-]{1,32}$/;
export const MAX_CLIP_TAGS = 8;

// ---------- primitive checks ----------

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const str: Check = (v, p, out) => {
  if (typeof v !== 'string') out.push(`${p}: expected a string`);
};
const nonEmpty: Check = (v, p, out) => {
  if (typeof v !== 'string' || v.length === 0) out.push(`${p}: expected a non-empty string`);
};
const bool: Check = (v, p, out) => {
  if (typeof v !== 'boolean') out.push(`${p}: expected a boolean`);
};
const num: Check = (v, p, out) => {
  if (!isFiniteNumber(v)) out.push(`${p}: expected a finite number`);
};
const positive: Check = (v, p, out) => {
  if (!isFiniteNumber(v) || v <= 0) out.push(`${p}: expected a positive number`);
};
const nonNegative: Check = (v, p, out) => {
  if (!isFiniteNumber(v) || v < 0) out.push(`${p}: expected a non-negative number`);
};
const int =
  (min = Number.MIN_SAFE_INTEGER): Check =>
  (v, p, out) => {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) out.push(`${p}: expected an integer ≥ ${min}`);
  };
const literal =
  (expected: unknown): Check =>
  (v, p, out) => {
    if (v !== expected) out.push(`${p}: expected ${JSON.stringify(expected)}`);
  };
const oneOf = (values: readonly unknown[]): Check => {
  const set = new Set(values);
  return (v, p, out) => {
    if (!set.has(v)) out.push(`${p}: expected one of ${values.map((x) => JSON.stringify(x)).join(', ')}`);
  };
};
const nullable =
  (check: Check): Check =>
  (v, p, out) => {
    if (v !== null) check(v, p, out);
  };
const optional =
  (check: Check): Check =>
  (v, p, out) => {
    if (v !== undefined) check(v, p, out);
  };
const tuple =
  (length: number, item: Check): Check =>
  (v, p, out) => {
    if (!Array.isArray(v) || v.length !== length) {
      out.push(`${p}: expected an array of length ${length}`);
      return;
    }
    for (let i = 0; i < length; i++) item(v[i], `${p}[${i}]`, out);
  };
const array =
  (item: Check, max = Number.POSITIVE_INFINITY): Check =>
  (v, p, out) => {
    if (!Array.isArray(v)) {
      out.push(`${p}: expected an array`);
      return;
    }
    if (v.length > max) out.push(`${p}: expected at most ${max} items`);
    for (let i = 0; i < v.length; i++) item(v[i], `${p}[${i}]`, out);
  };
const shape =
  (fields: Readonly<Record<string, Check>>): Check =>
  (v, p, out) => {
    if (!isObj(v)) {
      out.push(`${p}: expected an object`);
      return;
    }
    for (const [name, check] of Object.entries(fields)) check(v[name], p === '' ? name : `${p}.${name}`, out);
  };
const map =
  (item: Check): Check =>
  (v, p, out) => {
    if (!isObj(v)) {
      out.push(`${p}: expected an object`);
      return;
    }
    for (const [name, value] of Object.entries(v)) item(value, `${p}.${name}`, out);
  };
const plainObject: Check = (v, p, out) => {
  if (!isObj(v)) out.push(`${p}: expected an object`);
};
const pattern =
  (re: RegExp, what: string): Check =>
  (v, p, out) => {
    if (typeof v !== 'string' || !re.test(v)) out.push(`${p}: expected ${what}`);
  };

// ---------- shared value shapes ----------

const vec3 = tuple(3, num);
const quat = tuple(4, num);
const xf = shape({ t: vec3, q: quat, s: vec3 });
const axes = tuple(3, bool);
const trsAxes = shape({ t: axes, r: axes, s: axes });
const tombstone = nullable(shape({ by: str, at: num }));
const fps: Check = (v, p, out) => {
  shape({ num: int(1), den: int(1) })(v, p, out);
};
const boneRef: Check = (v, p, out) => {
  if (!isObj(v)) {
    out.push(`${p}: expected a bone reference`);
    return;
  }
  if ('humanoid' in v) {
    nonEmpty(v['humanoid'], `${p}.humanoid`, out);
    return;
  }
  nonEmpty(v['name'], `${p}.name`, out);
  nullable(str)(v['parentName'], `${p}.parentName`, out);
  optional(int(0))(v['occurrence'], `${p}.occurrence`, out);
};
const order = nonEmpty;
const id = nonEmpty;
const splineSet: Check = (v, p, out) => {
  shape({ v: literal(1), splines: array(plainObject) })(v, p, out);
};
const controlShape = shape({
  kind: nonEmpty,
  size: nonNegative,
  offset: xf,
  custom: nullable(splineSet),
  color: pattern(/^(side|#[0-9A-Fa-f]{3,8})$/, "'side' or a #hex colour"),
  lineWidth: nullable(positive),
});
const attrDef = shape({
  type: oneOf(['float', 'bool', 'enum']),
  default: num,
  min: optional(num),
  max: optional(num),
  enumLabels: optional(array(str)),
  keyable: bool,
  stepped: optional(bool),
  label: optional(str),
  unit: optional(oneOf(['angle', 'distance'])),
  mirror: optional(oneOf(['copy', 'negate'])),
  keyAll: optional(bool),
});
const spaceTarget: Check = (v, p, out) => {
  if (!isObj(v)) {
    out.push(`${p}: expected a space target`);
    return;
  }
  switch (v['kind']) {
    case 'world':
      return;
    case 'control':
      nonEmpty(v['id'], `${p}.id`, out);
      return;
    case 'bone':
      boneRef(v['bone'], `${p}.bone`, out);
      return;
    default:
      out.push(`${p}.kind: expected 'world', 'control' or 'bone'`);
  }
};
const clipSource: Check = (v, p, out) => {
  if (!isObj(v)) {
    out.push(`${p}: expected a clip source`);
    return;
  }
  switch (v['kind']) {
    case 'new':
      return;
    case 'embedded':
      nonEmpty(v['asset'], `${p}.asset`, out);
      int(0)(v['animationIndex'], `${p}.animationIndex`, out);
      str(v['animationName'], `${p}.animationName`, out);
      return;
    case 'imported':
      str(v['fileName'], `${p}.fileName`, out);
      nullable(nonEmpty)(v['asset'], `${p}.asset`, out);
      return;
    default:
      out.push(`${p}.kind: expected 'new', 'embedded' or 'imported'`);
  }
};
const provenance = shape({
  derivedFrom: array(
    shape({ title: str, author: str, license: nonEmpty, sourceSha256: nullable(pattern(/^[0-9a-f]{64}$/, 'SHA-256')) }),
  ),
  redistributable: oneOf(['yes', 'no', 'unknown']),
});
const channel: Check = (v, p, out) => {
  if (typeof v !== 'string' || !(TRS.has(v) || (v.length > 1 && v.startsWith('@')))) {
    out.push(`${p}: expected a TRS channel or '@<attribute>'`);
  }
};

// ---------- tables ----------

const projectShape = shape({
  id: literal('project'),
  name: str,
  schemaVersion: int(1),
  minWriterVersion: int(1),
  sceneFps: fps,
  sceneRange: shape({ start: num, end: num }),
  units: literal('m'),
  upAxis: literal('Y'),
});

const sha256Id = pattern(/^[0-9a-f]{64}$/, 'a lowercase SHA-256 hex string');

/** M6a (ADR 0017 §7): `GeneratorProvenance`, stored and validated, filled by M7. */
const generatorProvenance = shape({
  kind: literal('ai'),
  digitalSourceType: nonEmpty,
  service: nonEmpty,
  model: nonEmpty,
  op: nonEmpty,
  params: plainObject,
  inputSha256: array(str),
  termsSnapshot: nullable(plainObject),
  rawSha256: str,
  postSteps: array(shape({ op: str, aiMarksMayBeAltered: bool })),
  promptSha256: nullable(str),
  prompt: nullable(str),
  tier: oneOf(['paid', 'free', 'unknown']),
  taskId: nullable(str),
});
const assetProvenance = shape({
  origin: oneOf(['imported', 'generated', 'authored']),
  derivedFrom: array(
    shape({ title: str, author: str, license: nonEmpty, sourceSha256: nullable(pattern(/^[0-9a-f]{64}$/, 'SHA-256')) }),
  ),
  redistributable: oneOf(['yes', 'no', 'unknown']),
  generator: nullable(generatorProvenance),
});

const assetShape = shape({
  id: sha256Id,
  name: str,
  ext: oneOf(['glb', 'vrm', 'vrma', 'png', 'jpg']),
  mime: oneOf(['model/gltf-binary', 'image/png', 'image/jpeg']),
  size: int(0),
  role: oneOf(['model', 'animation-source', 'reference-image']),
  provenance: nullable(assetProvenance),
});

const characterSource: Check = (v, p, out) => {
  if (!isObj(v)) {
    out.push(`${p}: expected a character source`);
    return;
  }
  switch (v['kind']) {
    case 'asset':
      nonEmpty(v['asset'], `${p}.asset`, out);
      return;
    case 'model':
      nonEmpty(v['skeleton'], `${p}.skeleton`, out);
      return;
    default:
      out.push(`${p}.kind: expected 'asset' or 'model'`);
  }
};

const characterShape = shape({
  id,
  name: str,
  asset: nullable(nonEmpty),
  source: characterSource,
  format: oneOf(MODEL_FORMATS),
  rig: nonEmpty,
  placement: xf,
  order,
  deleted: tombstone,
});

const rigShape = shape({
  id,
  character: nonEmpty,
  format: literal('ekza.rig'),
  version: literal(1),
  generator: shape({ name: oneOf(['ekza-autorig-humanoid', 'ekza-autorig-generic']), version: str }),
  skeleton: shape({ format: oneOf(MODEL_FORMATS), fingerprint: str, facing: quat }),
  deleted: tombstone,
});

const controlShapeCheck = shape({
  id,
  rig: nonEmpty,
  key: nonEmpty,
  name: str,
  side: oneOf(SIDES),
  group: oneOf(['body', 'fingers', 'face', 'secondary']),
  parent: nullable(nonEmpty),
  order,
  restWorld: xf,
  rotateOrder: oneOf(ROTATE_ORDERS),
  keyable: trsAxes,
  locked: trsAxes,
  drives: nullable(shape({ bone: boneRef, mode: oneOf(['rotate', 'translateRotate', 'full']) })),
  mirror: nullable(nonEmpty),
  attrs: map(attrDef),
  shape: controlShape,
  hiddenByDefault: bool,
  deleted: tombstone,
});

const constraintShape = shape({
  id,
  rig: nonEmpty,
  type: oneOf(['parent', 'point', 'orient', 'aim']),
  driven: (v, p, out) => {
    if (isObj(v) && 'control' in v) nonEmpty(v['control'], `${p}.control`, out);
    else if (isObj(v) && 'bone' in v) boneRef(v['bone'], `${p}.bone`, out);
    else out.push(`${p}: expected {control} or {bone}`);
  },
  targets: map(shape({ target: spaceTarget, weight: num, offset: optional(xf) })),
  maintainOffset: bool,
  params: plainObject,
  enabled: bool,
  deleted: tombstone,
});

const solverShape = shape({
  id,
  rig: nonEmpty,
  type: oneOf(['ik2', 'footRoll', 'chain']),
  params: plainObject,
  enabled: bool,
  deleted: tombstone,
});

const cameraShape = shape({
  id,
  name: str,
  projection: oneOf(['perspective', 'orthographic']),
  fovY: positive,
  orthoHeight: positive,
  near: positive,
  far: positive,
  transform: xf,
  target: vec3,
  aspect: nullable(positive),
  locked: bool,
  order,
  deleted: tombstone,
});

const clipShape = shape({
  id,
  character: nonEmpty,
  name: pattern(CLIP_NAME_PATTERN, '1–64 characters of [A-Za-z0-9 _.-]'),
  slot: nullable(str),
  fps,
  range: shape({ start: int(), end: int() }),
  sceneStart: num,
  loop: bool,
  rootMotion: oneOf(['hips', 'in-place']),
  contact: nullable(num),
  tags: array(pattern(CLIP_TAG_PATTERN, 'a lowercase tag of [a-z0-9_-]'), MAX_CLIP_TAGS),
  provenance,
  source: clipSource,
  order,
  deleted: tombstone,
});

const layerShape = shape({
  id,
  clip: nonEmpty,
  name: str,
  mode: oneOf(['override', 'additive']),
  weight: num,
  mute: bool,
  solo: bool,
  owner: nullable(str),
  order,
  deleted: tombstone,
});

const curveShape = shape({
  id,
  clip: nonEmpty,
  layer: nonEmpty,
  control: nonEmpty,
  channel,
  weighted: bool,
  pre: oneOf(INFINITY_MODES),
  post: oneOf(INFINITY_MODES),
  staticValue: nullable(num),
  locked: bool,
  muted: bool,
  deleted: tombstone,
});

/** Keys are the hot table (thousands per commit): checked without the combinator overhead. */
function validateKey(record: Obj, out: Problems): void {
  if (typeof record['id'] !== 'string' || record['id'].length === 0) out.push('id: expected a non-empty string');
  if (typeof record['clip'] !== 'string' || record['clip'].length === 0) out.push('clip: expected a non-empty string');
  if (typeof record['curve'] !== 'string' || record['curve'].length === 0) {
    out.push('curve: expected a non-empty string');
  }
  if (!isFiniteNumber(record['t'])) out.push('t: expected a finite number');
  if (!isFiniteNumber(record['v'])) out.push('v: expected a finite number');
  if (!TANGENT_SET.has(record['inType'])) out.push('inType: expected a tangent type');
  if (!TANGENT_SET.has(record['outType'])) out.push('outType: expected a tangent type');
  checkHandle(record['inHandle'], 'inHandle', -1, out);
  checkHandle(record['outHandle'], 'outHandle', 1, out);
  if (typeof record['broken'] !== 'boolean') out.push('broken: expected a boolean');
  if (typeof record['weightLocked'] !== 'boolean') out.push('weightLocked: expected a boolean');
  const breakdown = record['breakdown'];
  if (breakdown !== undefined && typeof breakdown !== 'boolean') out.push('breakdown: expected a boolean');
}

function checkHandle(value: unknown, path: string, sign: -1 | 1, out: Problems): void {
  if (!isObj(value) || !isFiniteNumber(value['dt']) || !isFiniteNumber(value['dv'])) {
    out.push(`${path}: expected {dt, dv} with finite numbers`);
    return;
  }
  // in handles point backwards in time (dt ≤ 0), out handles forwards (dt ≥ 0).
  if (value['dt'] * sign < 0) out.push(`${path}.dt: expected ${sign < 0 ? '≤ 0' : '≥ 0'}`);
}

// ---------- M6a tables (M6A-SPEC §4.2) ----------

const scalarMap = map((v, p, out) => {
  if (typeof v !== 'string' && typeof v !== 'boolean' && !isFiniteNumber(v)) {
    out.push(`${p}: expected a number, boolean or string`);
  }
});
const meshOwner: Check = (v, p, out) => {
  if (isObj(v) && 'character' in v) nonEmpty(v['character'], `${p}.character`, out);
  else if (isObj(v) && v['scene'] === true) return;
  else out.push(`${p}: expected {character} or {scene: true}`);
};
const meshBudget: Check = (v, p, out) => {
  if (v === null) return;
  if (isObj(v) && 'preset' in v) oneOf(BUDGET_PRESETS)(v['preset'], `${p}.preset`, out);
  else if (isObj(v) && 'tris' in v) int(1)(v['tris'], `${p}.tris`, out);
  else out.push(`${p}: expected null, {preset} or {tris}`);
};
const bounded =
  (limit: number): Check =>
  (v, p, out) => {
    if (!isFiniteNumber(v) || Math.abs(v) > limit) out.push(`${p}: expected a number with |value| ≤ ${limit}`);
  };
const handheldGrip = nullable(
  shape({
    bone: oneOf(['rightHand', 'leftHand']),
    offset: tuple(3, bounded(HANDHELD_LIMITS.offset)),
    rotationDegrees: tuple(3, bounded(HANDHELD_LIMITS.rotationDegrees)),
    scale: (v, p, out) => {
      if (!isFiniteNumber(v) || v < HANDHELD_LIMITS.scaleMin || v > HANDHELD_LIMITS.scaleMax) {
        out.push(`${p}: expected a number in ${HANDHELD_LIMITS.scaleMin}…${HANDHELD_LIMITS.scaleMax}`);
      }
    },
  }),
);
const meshName: Check = (v, p, out) => {
  if (typeof v !== 'string' || v.length === 0 || v.length > MESH_NAME_MAX) {
    out.push(`${p}: expected a non-empty string of at most ${MESH_NAME_MAX} characters`);
  }
};
const meshRef = shape({
  manifest: sha256Id,
  rev: int(1),
  base: nullable(sha256Id),
  joints: array(str),
});
const meshMaterial: Check = (v, p, out) => {
  if (isObj(v) && 'preset' in v) oneOf(['unlit', 'toon', 'lit'])(v['preset'], `${p}.preset`, out);
  else if (isObj(v) && 'assetSlots' in v) {
    array(shape({ asset: sha256Id, material: int(0) }))(v['assetSlots'], `${p}.assetSlots`, out);
  } else out.push(`${p}: expected {preset} or {assetSlots}`);
};
const meshSkin: Check = (v, p, out) => {
  if (v === null) return;
  if (isObj(v) && 'skeleton' in v) {
    nonEmpty(v['skeleton'], `${p}.skeleton`, out);
    nullable(plainObject)(v['bind'], `${p}.bind`, out);
  } else if (isObj(v) && 'asset' in v) {
    sha256Id(v['asset'], `${p}.asset`, out);
    int(0)(v['skin'], `${p}.skin`, out);
  } else out.push(`${p}: expected null, {skeleton, bind} or {asset, skin}`);
};

const meshShape = shape({
  id,
  name: meshName,
  owner: meshOwner,
  parent: nullable(nonEmpty),
  order,
  placement: xf,
  pivot: vec3,
  source: nullable(shape({ asset: sha256Id, mesh: int(0) })),
  data: nullable(meshRef),
  faceted: bool,
  generator: nullable(shape({ kind: oneOf(PRIMITIVE_KINDS), params: scalarMap, version: literal(1) })),
  palette: nullable(nonEmpty),
  material: meshMaterial,
  colourOutput: oneOf(COLOUR_OUTPUTS),
  skin: meshSkin,
  budget: meshBudget,
  handheld: handheldGrip,
  deleted: tombstone,
});

const groupShape = shape({
  id,
  name: meshName,
  owner: meshOwner,
  parent: nullable(nonEmpty),
  order,
  placement: xf,
  pivot: vec3,
  template: nullable(shape({ kind: oneOf(GROUP_TEMPLATES), params: scalarMap })),
  budget: meshBudget,
  handheld: handheldGrip,
  deleted: tombstone,
});

const paletteShape = shape({ id, name: nonEmpty, order, deleted: tombstone });

const byte: Check = (v, p, out) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255) out.push(`${p}: expected an integer 0…255`);
};
const srgb = tuple(3, byte);
const swatchShape = shape({
  id,
  palette: nonEmpty,
  slot: (v, p, out) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > SWATCH_SLOT_MAX) {
      out.push(`${p}: expected an integer 0…${SWATCH_SLOT_MAX}`);
    }
  },
  order,
  name: str,
  srgb,
  kind: oneOf(['flat', 'ramp']),
  ramp: nullable(tuple(2, srgb)),
  deleted: tombstone,
});

const imagePlaneShape = shape({
  id,
  name: str,
  camera: oneOf(ORTHO_CAMERAS),
  asset: sha256Id,
  offset: tuple(2, num),
  size: positive,
  opacity: (v, p, out) => {
    if (!isFiniteNumber(v) || v < 0 || v > 1) out.push(`${p}: expected a number in 0…1`);
  },
  depth: oneOf(['behind', 'front']),
  locked: bool,
  visible: bool,
  order,
  deleted: tombstone,
});

const skeletonShape = shape({
  id,
  character: nonEmpty,
  template: oneOf(['vrm-humanoid', 'generic']),
  templateVersion: str,
  preset: oneOf(SKELETON_PRESETS),
  symmetry: bool,
  deleted: tombstone,
});

const jointShape = shape({
  id,
  skeleton: nonEmpty,
  parent: nullable(nonEmpty),
  order,
  name: str,
  humanBone: nullable(oneOf(HUMAN_BONE_NAMES)),
  restPosition: vec3,
  restRotation: quat,
  tail: nullable(vec3),
  side: oneOf(SIDES),
  mirror: nullable(nonEmpty),
  deleted: tombstone,
});

/** Cross-field rules the structural checks cannot express. */
const RULES: Partial<Record<BuiltinTableName, (record: Obj, out: Problems) => void>> = {
  project(record, out) {
    const range = record['sceneRange'];
    if (
      isObj(range) &&
      isFiniteNumber(range['start']) &&
      isFiniteNumber(range['end']) &&
      range['start'] > range['end']
    ) {
      out.push('sceneRange: expected start ≤ end');
    }
  },
  controls(record, out) {
    if (record['parent'] === record['id']) out.push('parent: a control cannot be its own parent');
    if (record['mirror'] === record['id']) out.push('mirror: a control cannot mirror itself');
  },
  cameras(record, out) {
    if (isFiniteNumber(record['near']) && isFiniteNumber(record['far']) && record['far'] <= record['near']) {
      out.push('far: expected far > near');
    }
  },
  assets(record, out) {
    const mime = record['mime'];
    const ext = record['ext'];
    const expected = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'model/gltf-binary';
    if (typeof ext === 'string' && typeof mime === 'string' && mime !== expected) {
      out.push(`mime: expected '${expected}' for ext '${ext}'`);
    }
  },
  characters(record, out) {
    const source = record['source'];
    if (!isObj(source)) return;
    if (source['kind'] === 'asset' && record['asset'] !== source['asset']) {
      out.push('asset: expected asset === source.asset for an asset-sourced character');
    }
    if (source['kind'] === 'model' && record['asset'] !== null) {
      out.push('asset: expected null for a model-sourced character');
    }
  },
  meshes(record, out) {
    if (record['parent'] === record['id']) out.push('parent: a mesh cannot be its own parent');
  },
  groups(record, out) {
    if (record['parent'] === record['id']) out.push('parent: a group cannot be its own parent');
  },
  joints(record, out) {
    if (record['parent'] === record['id']) out.push('parent: a joint cannot be its own parent');
    if (record['mirror'] === record['id']) out.push('mirror: a joint cannot mirror itself');
  },
  clips(record, out) {
    const range = record['range'];
    if (
      isObj(range) &&
      isFiniteNumber(range['start']) &&
      isFiniteNumber(range['end']) &&
      range['start'] >= range['end']
    ) {
      out.push('range: expected start < end');
    }
  },
};

const SHAPES: Readonly<Record<Exclude<BuiltinTableName, 'keys'>, Check>> = {
  project: projectShape,
  assets: assetShape,
  characters: characterShape,
  rigs: rigShape,
  controls: controlShapeCheck,
  constraints: constraintShape,
  solvers: solverShape,
  cameras: cameraShape,
  clips: clipShape,
  layers: layerShape,
  curves: curveShape,
  meshes: meshShape,
  groups: groupShape,
  palettes: paletteShape,
  swatches: swatchShape,
  imagePlanes: imagePlaneShape,
  skeletons: skeletonShape,
  joints: jointShape,
};

/** Problems of a built-in record ([] = valid). */
export function validateBuiltin(table: BuiltinTableName, record: unknown): readonly string[] {
  if (!isObj(record)) return ['expected a record object'];
  const out: Problems = [];
  if (table === 'keys') validateKey(record, out);
  else SHAPES[table](record, '', out);
  RULES[table]?.(record, out);
  return out;
}

/** True for a TRS channel or a custom `@attribute` channel. */
export function isChannelId(value: unknown): value is ChannelId {
  const out: Problems = [];
  channel(value, '', out);
  return out.length === 0;
}
