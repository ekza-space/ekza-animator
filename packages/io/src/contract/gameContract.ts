// The strict reader of `ekza.game-contract.v1` (GAME-PROTOCOL-SPEC §3.3, §3.5, §4, Appendix A; C1). What a reader must
// do: check the schema id and the minors (`minReaderVersion` above this reader's minor → "needs a newer Ekza Studio";
// a document of a minor it implements parses strictly — unknown keys are errors at every level; a newer minor it may
// read has its unknown keys skipped and recorded), every Appendix A check in code (no schema library in the bundle),
// the cross-references, the rule table (an unknown core id refuses the document: fail closed; an unknown namespaced id
// is kept and *deferred*), the profiles (a required profile this build does not know refuses the document; a known
// one's `ext` objects are checked strictly by its module; an unknown, not required one is ignored), and the recomputed
// canonical revision over the document as received.
import { EkzaError } from '@ekza-studio/anim-core';
import { contractRevision } from './canonical';
import {
  type AnimationSlotSpec,
  type AssetSlotSpec,
  type ContractExt,
  type ContractFamily,
  type ContractModel,
  type ContractPackageKind,
  type ContractPackaging,
  type ContractRig,
  type ContractRuleSpec,
  type ContractSlotBody,
  type ContractSlotDefault,
  type ContractSlotKind,
  type ContractSlotSpec,
  type ContractSocket,
  type ContractTarget,
  GAME_CONTRACT_READER_VERSION,
  GAME_CONTRACT_SCHEMA,
  type SocketSlotSpec,
} from './model';
import { type ContractProfileModule, type ExtPosition, OMOBA_CHARACTER_V1_PROFILE } from './profiles/omobaCharacterV1';
import {
  bool,
  enums,
  exactly,
  fail,
  isObject,
  type Json,
  list,
  map,
  nullableNum,
  nullableStr,
  num,
  oneOf,
  type ReadContext,
  record,
  str,
  strings,
  text,
  vec3,
} from './strict';

/** The profile modules this build reads (`ext` checked strictly). */
export const CONTRACT_PROFILE_MODULES: readonly ContractProfileModule[] = [OMOBA_CHARACTER_V1_PROFILE];

/** The core rule vocabulary of protocol 1.0 (§7.2): an id outside it, without a namespace, refuses the document. */
export const CORE_RULE_IDS: readonly string[] = [
  'pack.manifest',
  'pack.contract',
  'pack.target',
  'pack.slot-known',
  'pack.ref',
  'pack.unreferenced',
  'pack.bytes',
  'pack.requires',
  'rig.humanoid',
  'clip.channels',
  'clip.sampler',
  'clip.keys',
  'clip.duration',
  'clip.in-place',
  'clip.loop-closure',
  'clip.markers',
  'clip.min-interval',
  'asset.container',
  'asset.nodes',
  'asset.budget',
  'asset.bounds',
  'asset.anchors',
  'asset.materials',
  'asset.motion',
  'socket.node',
  'rights.license',
  'rights.derivation',
];

/** Namespaced rules this build implements (none in C1: Studio checks OMOBA's grip with GP6). */
export const KNOWN_NAMESPACED_RULE_IDS: readonly string[] = [];

/** Appendix A key sets per object (exported for the schema cross-check test). */
export const GAME_CONTRACT_KEYS = {
  root: [
    'schema',
    'schemaVersion',
    'minReaderVersion',
    'game',
    'revision',
    'previousRevision',
    'license',
    'source',
    'profiles',
    'rigs',
    'sockets',
    'packaging',
    'rules',
    'slots',
    'families',
    'targets',
    'retired',
    'ext',
  ],
  game: ['id', 'name'],
  source: ['commit', 'exporter', 'inputsSha256'],
  profiles: ['used', 'required'],
  rig: [
    'kind',
    'sourceFormats',
    'restPose',
    'facing',
    'requiredBones',
    'requiredBonesVrm0',
    'drivenBones',
    'maxHumanoidBones',
    'maxNodes',
    'uniformScale',
    'fingers',
    'thumbsRecommended',
    'lengthUnit',
    'ext',
  ],
  lengthUnit: ['name', 'from', 'referenceM'],
  socket: ['label', 'rig', 'bone', 'frame', 'fillable', 'ext'],
  packaging: [
    'containers',
    'manifestKey',
    'slotKinds',
    'maxBytes',
    'maxJsonBytes',
    'maxFills',
    'binding',
    'rendition',
    'ext',
  ],
  rendition: ['platform', 'profile', 'version'],
  rule: ['id', 'severity', 'scope', 'params', 'checkedBy'],
  default: ['name', 'playSecs', 'loop', 'markers', 'preview'],
  preview: ['sha256', 'bytes', 'format', 'license'],
  animationSpec: ['rig', 'playback', 'loop', 'inPlace', 'window', 'markers', 'minIntervalSecs', 'leadInSecs'],
  window: ['minSecs', 'targetSecs', 'maxSecs'],
  marker: ['required', 'maxSecs', 'targetSecs'],
  assetSpec: ['role', 'socket', 'rootName', 'nodes', 'anchors', 'axes', 'sizeM', 'budget', 'materials', 'motion'],
  nodes: ['required', 'optional'],
  anchor: ['required', 'default', 'boxM'],
  box: ['min', 'max'],
  axes: ['origin', 'up', 'forward'],
  sizeM: ['boxMin', 'boxMax'],
  budget: ['maxTriangles', 'maxNodes', 'maxMeshes', 'maxMaterials', 'maxImages', 'maxTextureSize', 'maxTexturePixels'],
  materials: ['extensionsAllowed', 'imageFormats', 'maxEmissiveStrength'],
  socketSpec: ['socket', 'maxOffsetM', 'maxRotationDeg'],
  slot: [
    'kind',
    'label',
    'description',
    'customizable',
    'customizableFrom',
    'reserved',
    'required',
    'default',
    'animation',
    'asset',
    'socket',
    'sharesDefaultWith',
    'alternatesWith',
    'usedBy',
    'ext',
  ],
  family: [
    'kind',
    'label',
    'description',
    'customizable',
    'customizableFrom',
    'reserved',
    'required',
    'default',
    'animation',
    'asset',
    'socket',
    'idPrefix',
    'minFills',
    'maxFills',
    'usedBy',
    'ext',
  ],
  target: ['id', 'kind', 'name', 'subtitle', 'sections', 'slots', 'families', 'accepts', 'ext'],
  section: ['id', 'label', 'key', 'slots'],
  offer: ['package', 'requirementId', 'label', 'slots', 'families', 'listing', 'mustFill'],
  retired: ['slots', 'targets', 'families'],
} as const;

const VERSION = /^1\.(0|[1-9][0-9]{0,3})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REVISION = /^sha256-[0-9a-f]{64}$/;
const GAME = /^[a-z][a-z0-9-]{1,62}$/;
const TARGET = /^[a-z][a-z0-9_-]{0,47}$/;
const SHORT = /^[a-z][a-z0-9_-]{0,31}$/;
/** The core slot id grammar (§3.4): 1–8 dot-separated segments, ≤ 96 characters. */
export const CONTRACT_SLOT_ID = /^[a-z][a-z0-9_-]{0,47}(\.[a-z0-9][a-z0-9_-]{0,47}){0,7}$/;
const SOCKET = /^[a-z][a-z0-9_-]{0,31}(\.[a-z0-9][a-z0-9_-]{0,31}){0,3}$/;
const PROFILE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\.v[0-9]+$/;
const RULE = /^([a-z][a-z0-9-]{1,31}\.)?(pack|clip|rig|asset|socket|rights)\.[a-z][a-z0-9-]{1,40}$/;
const REQUIREMENT = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const MARKER = /^[a-z][a-z0-9_]{0,31}$/;
const BONE = /^[a-z][A-Za-z]{1,31}$/;
const COMMIT = /^[0-9a-f]{7,64}$/;
const VERSION_FROM = /^[0-9]+(\.[0-9]+)?$/;
const EXTENSION = /^[A-Z0-9]+_[A-Za-z0-9_]+$/;
const AXES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as const;
const PACKAGE_KINDS: readonly ContractPackageKind[] = ['character', 'animation-pack', 'asset-pack', 'accessory'];
const SLOT_KINDS: readonly ContractSlotKind[] = ['animation', 'asset', 'socket'];
const SECS = { min: 0, max: 600 } as const;

/** Minor number of a `1.<n>` version. */
const minor = (version: string): number => Number(version.slice(2));

interface Reader extends ReadContext {
  readonly profiles: ReadonlyMap<string, ContractProfileModule>;
}

const slotIdOk = (id: string): boolean => id.length <= 96 && CONTRACT_SLOT_ID.test(id);

function slotIds(json: Json, key: string, field: string, opts: { max?: number; min?: number; unique?: boolean } = {}) {
  const ids = strings(json, key, field, CONTRACT_SLOT_ID, opts);
  ids.forEach((id, i) => {
    if (id.length > 96) fail(`${field}.${key}[${i}]`, 'at most 96 characters');
  });
  return ids;
}

function readExt(r: Reader, value: unknown, field: string, position: ExtPosition): ContractExt {
  const ext = map(value, field, PROFILE, 16);
  const out: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [profile, data] of Object.entries(ext)) {
    if (profile.length > 64) fail(`${field}['${profile}']`, 'a profile id of at most 64 characters');
    if (!isObject(data)) fail(`${field}['${profile}']`, 'an object');
    r.profiles.get(profile)?.readExt(r, position, data, `${field}['${profile}']`);
    out[profile] = data;
  }
  return out;
}

function readDefault(r: Reader, value: unknown, f: string): ContractSlotDefault | null {
  if (value === null) return null;
  const json = record(r, value, f, GAME_CONTRACT_KEYS.default);
  const loop = json['loop'];
  if (loop !== null && typeof loop !== 'boolean') fail(`${f}.loop`, 'a boolean or null');
  const markersJson = map(json['markers'], `${f}.markers`, MARKER, 8);
  const markers: Record<string, number> = {};
  for (const name of Object.keys(markersJson)) markers[name] = num(markersJson, name, `${f}.markers`, SECS);
  let preview: ContractSlotDefault['preview'] = null;
  if (json['preview'] !== null) {
    const p = record(r, json['preview'], `${f}.preview`, GAME_CONTRACT_KEYS.preview);
    preview = {
      sha256: str(p, 'sha256', `${f}.preview`, SHA256),
      bytes: num(p, 'bytes', `${f}.preview`, { integer: true, min: 1, max: 268435456 }),
      format: oneOf(p, 'format', `${f}.preview`, ['vrma', 'glb', 'png'] as const),
      license: text(p, 'license', `${f}.preview`, 1, 64),
    };
  }
  return {
    name: text(json, 'name', f, 1, 64),
    playSecs: nullableNum(json, 'playSecs', f, SECS),
    loop,
    markers,
    preview,
  };
}

function readAnimation(r: Reader, value: unknown, f: string): AnimationSlotSpec {
  const json = record(r, value, f, GAME_CONTRACT_KEYS.animationSpec);
  const wf = `${f}.window`;
  const window = record(r, json['window'], wf, GAME_CONTRACT_KEYS.window);
  const windowSpec = {
    minSecs: num(window, 'minSecs', wf, { exclusiveMin: 0, max: 600 }),
    targetSecs: num(window, 'targetSecs', wf, { exclusiveMin: 0, max: 600 }),
    maxSecs: num(window, 'maxSecs', wf, { exclusiveMin: 0, max: 600 }),
  };
  if (windowSpec.minSecs > windowSpec.maxSecs) fail(`${wf}.minSecs`, '≤ maxSecs');
  const markersJson = map(json['markers'], `${f}.markers`, MARKER, 8);
  const markers: Record<string, AnimationSlotSpec['markers'][string]> = {};
  for (const [name, marker] of Object.entries(markersJson)) {
    const mf = `${f}.markers.${name}`;
    const m = record(r, marker, mf, GAME_CONTRACT_KEYS.marker);
    markers[name] = {
      required: bool(m, 'required', mf),
      maxSecs: nullableNum(m, 'maxSecs', mf, SECS),
      targetSecs: nullableNum(m, 'targetSecs', mf, SECS),
    };
  }
  const playback = oneOf(json, 'playback', f, ['loop', 'action', 'hold'] as const);
  const loop = bool(json, 'loop', f);
  return {
    rig: str(json, 'rig', f, SHORT),
    playback,
    loop,
    inPlace: bool(json, 'inPlace', f),
    window: windowSpec,
    markers,
    minIntervalSecs: nullableNum(json, 'minIntervalSecs', f, SECS),
    leadInSecs: nullableNum(json, 'leadInSecs', f, SECS),
  };
}

function nullableVec3(value: unknown, field: string) {
  return value === null ? null : vec3(value, field);
}

function readAsset(r: Reader, value: unknown, f: string): AssetSlotSpec {
  const json = record(r, value, f, GAME_CONTRACT_KEYS.assetSpec);
  const nodes = record(r, json['nodes'], `${f}.nodes`, GAME_CONTRACT_KEYS.nodes);
  const anchorsJson = map(json['anchors'], `${f}.anchors`, MARKER, 8);
  const anchors: Record<string, AssetSlotSpec['anchors'][string]> = {};
  for (const [name, anchor] of Object.entries(anchorsJson)) {
    const af = `${f}.anchors.${name}`;
    const a = record(r, anchor, af, GAME_CONTRACT_KEYS.anchor);
    let boxM: AssetSlotSpec['anchors'][string]['boxM'] = null;
    if (a['boxM'] !== null) {
      const box = record(r, a['boxM'], `${af}.boxM`, GAME_CONTRACT_KEYS.box);
      boxM = { min: vec3(box['min'], `${af}.boxM.min`), max: vec3(box['max'], `${af}.boxM.max`) };
    }
    anchors[name] = { required: bool(a, 'required', af), default: nullableVec3(a['default'], `${af}.default`), boxM };
  }
  const axes = record(r, json['axes'], `${f}.axes`, GAME_CONTRACT_KEYS.axes);
  const size = record(r, json['sizeM'], `${f}.sizeM`, GAME_CONTRACT_KEYS.sizeM);
  const bf = `${f}.budget`;
  const budget = record(r, json['budget'], bf, GAME_CONTRACT_KEYS.budget);
  const nullableInt = (key: string, rule: { min: number; max?: number }) =>
    budget[key] === null ? null : num(budget, key, bf, { integer: true, ...rule });
  const mf = `${f}.materials`;
  const materials = record(r, json['materials'], mf, GAME_CONTRACT_KEYS.materials);
  return {
    role: oneOf(json, 'role', f, [
      'handheld',
      'projectile',
      'throwable',
      'deployable',
      'attachment',
      'effect',
    ] as const),
    socket: nullableStr(json, 'socket', f, SOCKET, 64),
    rootName: nullableStr(json, 'rootName', f, NAME),
    nodes: {
      required: strings(nodes, 'required', `${f}.nodes`, NAME, { max: 32, unique: true }),
      optional: strings(nodes, 'optional', `${f}.nodes`, NAME, { max: 32, unique: true }),
    },
    anchors,
    axes: {
      origin: oneOf(axes, 'origin', `${f}.axes`, ['grip', 'center', 'base', 'socket'] as const),
      up: oneOf(axes, 'up', `${f}.axes`, AXES),
      forward: oneOf(axes, 'forward', `${f}.axes`, AXES),
    },
    sizeM: {
      boxMin: nullableVec3(size['boxMin'], `${f}.sizeM.boxMin`),
      boxMax: nullableVec3(size['boxMax'], `${f}.sizeM.boxMax`),
    },
    budget: {
      maxTriangles: nullableInt('maxTriangles', { min: 1 }),
      maxNodes: num(budget, 'maxNodes', bf, { integer: true, min: 1, max: 4096 }),
      maxMeshes: num(budget, 'maxMeshes', bf, { integer: true, min: 1, max: 1024 }),
      maxMaterials: nullableInt('maxMaterials', { min: 1, max: 256 }),
      maxImages: num(budget, 'maxImages', bf, { integer: true, min: 0, max: 256 }),
      maxTextureSize: num(budget, 'maxTextureSize', bf, { integer: true, min: 0, max: 16384 }),
      maxTexturePixels: num(budget, 'maxTexturePixels', bf, { integer: true, min: 0 }),
    },
    materials: {
      extensionsAllowed: strings(materials, 'extensionsAllowed', mf, EXTENSION, { unique: true }),
      imageFormats: enums(materials, 'imageFormats', mf, ['png', 'jpeg', 'webp', 'ktx2'] as const),
      maxEmissiveStrength: nullableNum(materials, 'maxEmissiveStrength', mf, { min: 0 }),
    },
    motion: oneOf(json, 'motion', f, ['static', 'named-parts', 'node-animation', 'skinned'] as const),
  };
}

function readSocketSpec(r: Reader, value: unknown, f: string): SocketSlotSpec {
  const json = record(r, value, f, GAME_CONTRACT_KEYS.socketSpec);
  return {
    socket: str(json, 'socket', f, SOCKET, 64),
    maxOffsetM: num(json, 'maxOffsetM', f, { min: 0, max: 10 }),
    maxRotationDeg: num(json, 'maxRotationDeg', f, { min: 0, max: 360 }),
  };
}

function usedBy(json: Json, f: string): string[] {
  return list(json, 'usedBy', f, { min: 1, unique: true }).map((item, i) => {
    if (item !== '*' && (typeof item !== 'string' || !TARGET.test(item)))
      fail(`${f}.usedBy[${i}]`, "'*' or a target id");
    return item;
  });
}

function readBody(r: Reader, json: Json, f: string): ContractSlotBody {
  const kind = oneOf(json, 'kind', f, SLOT_KINDS);
  const customizable = bool(json, 'customizable', f);
  const from = json['customizableFrom'];
  if (from !== null && (typeof from !== 'string' || !VERSION_FROM.test(from))) {
    fail(`${f}.customizableFrom`, 'null or a version such as "1" or "1.1"');
  }
  if (customizable && from === null) fail(`${f}.customizableFrom`, 'a version when customizable');
  const required = bool(json, 'required', f);
  const fallback = readDefault(r, json['default'], `${f}.default`);
  if (required && fallback !== null) fail(`${f}.default`, 'null for a required slot');
  const description = json['description'];
  if (description !== null && (typeof description !== 'string' || description.length > 2000)) {
    fail(`${f}.description`, 'null or text of at most 2000 characters');
  }
  // exactly the spec object of the kind is non-null
  const spec = (key: ContractSlotKind) => (kind === key ? json[key] : null);
  for (const other of SLOT_KINDS) {
    if (other !== kind && json[other] !== null) fail(`${f}.${other}`, `null for a slot of kind '${kind}'`);
  }
  return {
    kind,
    label: text(json, 'label', f, 1, 80),
    description,
    customizable,
    customizableFrom: from,
    reserved: bool(json, 'reserved', f),
    required,
    default: fallback,
    animation: kind === 'animation' ? readAnimation(r, spec('animation'), `${f}.animation`) : null,
    asset: kind === 'asset' ? readAsset(r, spec('asset'), `${f}.asset`) : null,
    socket: kind === 'socket' ? readSocketSpec(r, spec('socket'), `${f}.socket`) : null,
    usedBy: usedBy(json, f),
    ext: readExt(r, json['ext'], `${f}.ext`, { at: 'slot', kind }),
  };
}

function readSlot(r: Reader, id: string, value: unknown): ContractSlotSpec {
  const f = `contract.slots['${id}']`;
  const json = record(r, value, f, GAME_CONTRACT_KEYS.slot);
  return {
    id,
    ...readBody(r, json, f),
    sharesDefaultWith: slotIds(json, 'sharesDefaultWith', f, { max: 64, unique: true }),
    alternatesWith: slotIds(json, 'alternatesWith', f, { max: 1, unique: true }),
  };
}

function readFamily(r: Reader, id: string, value: unknown): ContractFamily {
  const f = `contract.families['${id}']`;
  const json = record(r, value, f, GAME_CONTRACT_KEYS.family);
  const body = readBody(r, json, f);
  const family = {
    id,
    ...body,
    idPrefix: str(json, 'idPrefix', f, CONTRACT_SLOT_ID, 96),
    minFills: num(json, 'minFills', f, { integer: true, min: 0, max: 64 }),
    maxFills: num(json, 'maxFills', f, { integer: true, min: 1, max: 64 }),
  };
  if (family.required) fail(`${f}.required`, 'false (a family instance is never required)');
  if (family.minFills > family.maxFills) fail(`${f}.minFills`, '≤ maxFills');
  return family;
}

function readRig(r: Reader, id: string, value: unknown): ContractRig {
  const f = `contract.rigs['${id}']`;
  const json = record(r, value, f, GAME_CONTRACT_KEYS.rig);
  const unit = record(r, json['lengthUnit'], `${f}.lengthUnit`, GAME_CONTRACT_KEYS.lengthUnit);
  const bones = (key: string) => strings(json, key, f, BONE, { max: 64, unique: true });
  return {
    kind: exactly(json, 'kind', f, 'vrm-humanoid'),
    sourceFormats: enums(json, 'sourceFormats', f, ['vrm1', 'vrm0'] as const, 1),
    restPose: oneOf(json, 'restPose', f, ['t-pose', 'a-pose', 'any'] as const),
    facing: exactly(json, 'facing', f, 'as-vrm-spec'),
    requiredBones: bones('requiredBones'),
    requiredBonesVrm0: bones('requiredBonesVrm0'),
    drivenBones: bones('drivenBones'),
    maxHumanoidBones: num(json, 'maxHumanoidBones', f, { integer: true, min: 15, max: 64 }),
    maxNodes: num(json, 'maxNodes', f, { integer: true, min: 1, max: 65536 }),
    uniformScale: oneOf(json, 'uniformScale', f, ['humanoid-bones-and-ancestors', 'none'] as const),
    fingers: oneOf(json, 'fingers', f, ['optional', 'required'] as const),
    thumbsRecommended: bool(json, 'thumbsRecommended', f),
    lengthUnit: {
      name: exactly(unit, 'name', `${f}.lengthUnit`, 'legLength'),
      from: exactly(unit, 'from', `${f}.lengthUnit`, 'hips-to-feet'),
      referenceM: num(unit, 'referenceM', `${f}.lengthUnit`, { exclusiveMin: 0, max: 10 }),
    },
    ext: readExt(r, json['ext'], `${f}.ext`, { at: 'rig' }),
  };
}

function readSocket(r: Reader, id: string, value: unknown): ContractSocket {
  const f = `contract.sockets['${id}']`;
  const json = record(r, value, f, GAME_CONTRACT_KEYS.socket);
  return {
    label: text(json, 'label', f, 1, 80),
    rig: str(json, 'rig', f, SHORT),
    bone: str(json, 'bone', f, BONE),
    frame: oneOf(json, 'frame', f, ['bone', 'palm', 'authored'] as const),
    fillable: bool(json, 'fillable', f),
    ext: readExt(r, json['ext'], `${f}.ext`, { at: 'socket' }),
  };
}

function readPackaging(r: Reader, kind: string, value: unknown): ContractPackaging {
  const f = `contract.packaging['${kind}']`;
  const json = record(r, value, f, GAME_CONTRACT_KEYS.packaging);
  let rendition: ContractPackaging['rendition'] = null;
  if (json['rendition'] !== null) {
    const rf = `${f}.rendition`;
    const rj = record(r, json['rendition'], rf, GAME_CONTRACT_KEYS.rendition);
    rendition = {
      platform: str(rj, 'platform', rf, /^[a-z][a-z0-9-]{1,62}$/),
      profile: str(rj, 'profile', rf, /^[a-z][a-z0-9-]{1,62}$/),
      version: num(rj, 'version', rf, { integer: true, min: 1 }),
    };
  }
  return {
    containers: enums(json, 'containers', f, ['vrm1', 'vrm0', 'glb', 'vrma'] as const, 1),
    manifestKey: exactly(json, 'manifestKey', f, 'ekza_package_v1'),
    slotKinds: enums(json, 'slotKinds', f, SLOT_KINDS, 1),
    maxBytes: num(json, 'maxBytes', f, { integer: true, min: 20, max: 268435456 }),
    maxJsonBytes: num(json, 'maxJsonBytes', f, { integer: true, min: 1024, max: 16777216 }),
    maxFills: num(json, 'maxFills', f, { integer: true, min: 1, max: 512 }),
    binding: oneOf(json, 'binding', f, ['manifest', 'manifest-or-names'] as const),
    rendition,
    ext: readExt(r, json['ext'], `${f}.ext`, { at: 'packaging' }),
  };
}

function readRules(r: Reader, value: unknown): ContractRuleSpec[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) fail('contract.rules', '1–256 rules');
  const seen = new Set<string>();
  return (value as readonly unknown[]).map((item, i) => {
    const f = `contract.rules[${i}]`;
    const json = record(r, item, f, GAME_CONTRACT_KEYS.rule);
    const id = str(json, 'id', f, RULE, 80);
    if (seen.has(id)) fail(`${f}.id`, `unique ('${id}' repeats)`);
    seen.add(id);
    const namespaced = id.split('.').length === 3;
    if (!namespaced && !CORE_RULE_IDS.includes(id)) {
      throw new EkzaError('unsupported', `This contract needs a newer Ekza Studio (unknown rule '${id}')`, {
        field: `${f}.id`,
        rule: id,
      });
    }
    const checkedBy = enums(json, 'checkedBy', f, ['tool', 'hub', 'builder', 'game'] as const, 1);
    if (namespaced && checkedBy.every((stage) => stage === 'tool')) {
      fail(`${f}.checkedBy`, 'a stage besides tool (a namespaced rule checked only by tools is never enforced)');
    }
    const params = json['params'];
    if (!isObject(params)) fail(`${f}.params`, 'an object');
    return {
      id,
      severity: oneOf(json, 'severity', f, ['error', 'warning'] as const),
      scope: oneOf(json, 'scope', f, ['package', 'animation', 'asset', 'socket', 'rig', 'rights'] as const),
      params,
      checkedBy,
      deferred: namespaced && !KNOWN_NAMESPACED_RULE_IDS.includes(id),
    };
  });
}

function readTarget(r: Reader, value: unknown, i: number): ContractTarget {
  const f = `contract.targets[${i}]`;
  const json = record(r, value, f, GAME_CONTRACT_KEYS.target);
  const subtitle = json['subtitle'];
  if (subtitle !== null && (typeof subtitle !== 'string' || subtitle.length > 64)) {
    fail(`${f}.subtitle`, 'null or a short string');
  }
  const sections = list(json, 'sections', f, { min: 1, max: 32 }).map((item, k) => {
    const sf = `${f}.sections[${k}]`;
    const section = record(r, item, sf, GAME_CONTRACT_KEYS.section);
    const key = section['key'];
    if (key !== null && (typeof key !== 'string' || key.length > 8)) fail(`${sf}.key`, 'null or a short input hint');
    return {
      id: str(section, 'id', sf, SHORT),
      label: text(section, 'label', sf, 1, 80),
      key,
      slots: slotIds(section, 'slots', sf, { unique: true }),
    };
  });
  const accepts = list(json, 'accepts', f, { min: 1, max: 16 }).map((item, k) => {
    const of = `${f}.accepts[${k}]`;
    const offer = record(r, item, of, GAME_CONTRACT_KEYS.offer);
    return {
      package: oneOf(offer, 'package', of, PACKAGE_KINDS),
      requirementId: str(offer, 'requirementId', of, REQUIREMENT, 128),
      label: text(offer, 'label', of, 1, 80),
      slots: slotIds(offer, 'slots', of, { unique: true }),
      families: strings(offer, 'families', of, SHORT, { unique: true }),
      listing: oneOf(offer, 'listing', of, ['every-customizable-slot', 'filled-slots-only'] as const),
      mustFill: slotIds(offer, 'mustFill', of, { unique: true }),
    };
  });
  return {
    id: str(json, 'id', f, TARGET),
    kind: oneOf(json, 'kind', f, ['character', 'any', 'item', 'vehicle', 'prop'] as const),
    name: text(json, 'name', f, 1, 64),
    subtitle,
    sections,
    slots: slotIds(json, 'slots', f, { min: 1, max: 512, unique: true }),
    families: strings(json, 'families', f, SHORT, { max: 16, unique: true }),
    accepts,
    ext: readExt(r, json['ext'], `${f}.ext`, { at: 'target' }),
  };
}

function retiredMap(r: Reader, json: Json, key: string, pattern: RegExp): Readonly<Record<string, string>> {
  const f = `contract.retired.${key}`;
  const m = map(json[key], f, pattern);
  const out: Record<string, string> = {};
  for (const id of Object.keys(m)) out[id] = str(m, id, f, REVISION);
  return out;
}

/** §3.5 step 3: the cross-references. */
function crossCheck(model: ContractModel): void {
  const { slots, families, targets } = model;
  const slot = (id: string, field: string): void => {
    if (slots[id] === undefined) fail(field, `a slot of the contract ('${id}')`);
  };
  const family = (id: string, field: string): void => {
    if (families[id] === undefined) fail(field, `a family of the contract ('${id}')`);
  };
  const targetIds = new Set<string>();
  targets.forEach((target, i) => {
    const f = `contract.targets[${i}]`;
    if (targetIds.has(target.id)) fail(`${f}.id`, `unique ('${target.id}' repeats)`);
    targetIds.add(target.id);
    target.slots.forEach((id, k) => slot(id, `${f}.slots[${k}]`));
    target.families.forEach((id, k) => family(id, `${f}.families[${k}]`));
    target.sections.forEach((section, k) =>
      section.slots.forEach((id, n) => slot(id, `${f}.sections[${k}].slots[${n}]`)),
    );
    target.accepts.forEach((offer, k) => {
      const kinds = model.packaging[offer.package]?.slotKinds;
      if (kinds === undefined)
        fail(`${f}.accepts[${k}].package`, `a package kind of contract.packaging ('${offer.package}')`);
      offer.slots.forEach((id, n) => {
        slot(id, `${f}.accepts[${k}].slots[${n}]`);
        if (!kinds.includes(slots[id]?.kind as ContractSlotKind)) {
          fail(
            `${f}.accepts[${k}].slots[${n}]`,
            `a slot of a kind ${offer.package} packages take (${kinds.join(', ')})`,
          );
        }
      });
      offer.mustFill.forEach((id, n) => slot(id, `${f}.accepts[${k}].mustFill[${n}]`));
      offer.families.forEach((id, n) => family(id, `${f}.accepts[${k}].families[${n}]`));
    });
  });
  const usedBy = (list: readonly string[], field: string): void =>
    list.forEach((id, i) => {
      if (id !== '*' && !targetIds.has(id)) fail(`${field}.usedBy[${i}]`, `'*' or a target of the contract ('${id}')`);
    });
  for (const [id, spec] of Object.entries(slots)) {
    const f = `contract.slots['${id}']`;
    usedBy(spec.usedBy, f);
    for (const [key, links] of [
      ['sharesDefaultWith', spec.sharesDefaultWith],
      ['alternatesWith', spec.alternatesWith],
    ] as const) {
      links.forEach((link, i) => {
        if (slots[link]?.kind !== spec.kind) fail(`${f}.${key}[${i}]`, `a slot of the same kind ('${link}')`);
      });
    }
    if (spec.animation !== null && model.rigs[spec.animation.rig] === undefined) {
      fail(`${f}.animation.rig`, `a rig of the contract ('${spec.animation.rig}')`);
    }
    const socket = spec.asset?.socket ?? spec.socket?.socket ?? null;
    if (socket !== null && model.sockets[socket] === undefined) fail(f, `a socket of the contract ('${socket}')`);
    if (model.retired.slots[id] !== undefined) fail(f, 'not both live and retired');
  }
  for (const [id, spec] of Object.entries(families)) usedBy(spec.usedBy, `contract.families['${id}']`);
  for (const [id, socket] of Object.entries(model.sockets)) {
    if (model.rigs[socket.rig] === undefined)
      fail(`contract.sockets['${id}'].rig`, `a rig of the contract ('${socket.rig}')`);
  }
  model.profiles.required.forEach((id, i) => {
    if (!model.profiles.used.includes(id))
      fail(`contract.profiles.required[${i}]`, `a profile of profiles.used ('${id}')`);
  });
}

/**
 * Reads an `ekza.game-contract.v1` document (parsed JSON). Throws `EkzaError('invalid-input')` naming the field, or
 * `EkzaError('unsupported', 'This contract needs a newer Ekza Studio …')` for a newer `minReaderVersion`, an unknown
 * core rule id or a required profile this build does not know. `verifyRevision` (default true) recomputes the
 * canonical revision.
 */
export function readGameContract(json: unknown, opts: { readonly verifyRevision?: boolean } = {}): ContractModel {
  if (!isObject(json)) fail('contract', 'an object');
  if (json['schema'] !== GAME_CONTRACT_SCHEMA) fail('contract.schema', `'${GAME_CONTRACT_SCHEMA}'`);
  const schemaVersion = str(json, 'schemaVersion', 'contract', VERSION);
  const minReaderVersion = str(json, 'minReaderVersion', 'contract', VERSION);
  const reader = minor(GAME_CONTRACT_READER_VERSION);
  if (minor(minReaderVersion) > reader) {
    throw new EkzaError('unsupported', 'This contract needs a newer Ekza Studio', {
      field: 'contract.minReaderVersion',
      minReaderVersion,
    });
  }
  const profilesJson = isObject(json['profiles']) ? json['profiles'] : {};
  const required = Array.isArray(profilesJson['required']) ? (profilesJson['required'] as unknown[]) : [];
  for (const profile of required) {
    if (typeof profile === 'string' && !CONTRACT_PROFILE_MODULES.some((module) => module.profile === profile)) {
      throw new EkzaError('unsupported', `This game needs a newer Ekza Studio (profile ${profile})`, {
        field: 'contract.profiles.required',
        profile,
      });
    }
  }
  const r: Reader = {
    lenient: minor(schemaVersion) > reader,
    ignored: [],
    profiles: new Map(CONTRACT_PROFILE_MODULES.map((module) => [module.profile, module])),
  };
  const root = record(r, json, 'contract', GAME_CONTRACT_KEYS.root);
  const game = record(r, root['game'], 'contract.game', GAME_CONTRACT_KEYS.game);
  const source = record(r, root['source'], 'contract.source', GAME_CONTRACT_KEYS.source);
  const commit = source['commit'];
  if (commit !== null && (typeof commit !== 'string' || !COMMIT.test(commit))) {
    fail('contract.source.commit', 'null or a commit hash');
  }
  const profiles = record(r, root['profiles'], 'contract.profiles', GAME_CONTRACT_KEYS.profiles);
  const previous = root['previousRevision'];
  if (previous !== null && (typeof previous !== 'string' || !REVISION.test(previous))) {
    fail('contract.previousRevision', 'null or sha256-<64 hex>');
  }
  const rigsJson = map(root['rigs'], 'contract.rigs', SHORT, 8);
  const socketsJson = map(root['sockets'], 'contract.sockets', SOCKET, 64);
  const packagingJson = map(
    root['packaging'],
    'contract.packaging',
    /^(character|animation-pack|asset-pack|accessory)$/,
  );
  if (Object.keys(packagingJson).length === 0) fail('contract.packaging', 'at least one package kind');
  const slotsJson = map(root['slots'], 'contract.slots', CONTRACT_SLOT_ID, 4096);
  if (Object.keys(slotsJson).length === 0) fail('contract.slots', 'at least one slot');
  const familiesJson = map(root['families'], 'contract.families', SHORT, 64);
  const retired = record(r, root['retired'], 'contract.retired', GAME_CONTRACT_KEYS.retired);
  const rigs: Record<string, ContractRig> = {};
  for (const [id, value] of Object.entries(rigsJson)) rigs[id] = readRig(r, id, value);
  const sockets: Record<string, ContractSocket> = {};
  for (const [id, value] of Object.entries(socketsJson)) sockets[id] = readSocket(r, id, value);
  const packaging: Partial<Record<ContractPackageKind, ContractPackaging>> = {};
  for (const [kind, value] of Object.entries(packagingJson)) {
    packaging[kind as ContractPackageKind] = readPackaging(r, kind, value);
  }
  const slots: Record<string, ContractSlotSpec> = {};
  for (const [id, value] of Object.entries(slotsJson)) {
    if (!slotIdOk(id)) fail(`contract.slots['${id}']`, 'keyed by a slot id of at most 96 characters');
    slots[id] = readSlot(r, id, value);
  }
  const families: Record<string, ContractFamily> = {};
  for (const [id, value] of Object.entries(familiesJson)) families[id] = readFamily(r, id, value);
  const targets = list(root, 'targets', 'contract', { min: 1, max: 1024 }).map((value, i) => readTarget(r, value, i));
  const model: ContractModel = {
    schema: GAME_CONTRACT_SCHEMA,
    schemaVersion,
    minReaderVersion,
    game: str(game, 'id', 'contract.game', GAME),
    gameName: text(game, 'name', 'contract.game', 1, 64),
    revision: str(root, 'revision', 'contract', REVISION),
    previousRevision: previous,
    license: text(root, 'license', 'contract', 1, 64),
    source: {
      commit,
      exporter: text(source, 'exporter', 'contract.source', 1, 200),
      inputsSha256: str(source, 'inputsSha256', 'contract.source', SHA256),
    },
    profiles: {
      used: strings(profiles, 'used', 'contract.profiles', PROFILE, { max: 16, unique: true }),
      required: strings(profiles, 'required', 'contract.profiles', PROFILE, { max: 16, unique: true }),
    },
    rigs,
    sockets,
    packaging,
    rules: readRules(r, root['rules']),
    slots,
    families,
    targets,
    retired: {
      slots: retiredMap(r, retired, 'slots', CONTRACT_SLOT_ID),
      targets: retiredMap(r, retired, 'targets', TARGET),
      families: retiredMap(r, retired, 'families', SHORT),
    },
    ext: readExt(r, root['ext'], 'contract.ext', { at: 'document' }),
    ignoredKeys: r.ignored,
  };
  crossCheck(model);
  if (opts.verifyRevision !== false) {
    const computed = contractRevision(json);
    if (computed !== model.revision) {
      throw new EkzaError(
        'invalid-input',
        `game contract: revision ${model.revision} does not match its content (${computed})`,
        { field: 'contract.revision', expected: computed },
      );
    }
  }
  return model;
}
