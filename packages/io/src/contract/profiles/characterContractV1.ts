// Profile `omoba.character-contract.v1` (CHARACTER-CONTRACT-SPEC §3, §8.1, Appendix A; C1): the strict parser — the JSON Schema
// of Appendix A checked in code (no schema library in the bundle) — unknown keys are errors at every level — plus the
// cross-references the schema cannot express (every view slot exists, links point at slots, unique ids), the
// recomputed canonical revision and the rule table: a rule id this build does not know refuses the contract (fail
// closed, §5.3 rule 2). A higher `schemaVersion` says "This contract needs a newer Ekza Studio" — and the mapping of the
// document to the game-agnostic `ContractModel` (`characterContractV1Model`). The style of `library/manifest.ts`.
import { EkzaError } from '@ekza-studio/anim-core';
import { contractRevision } from '../canonical';
import {
  CHARACTER_CONTRACT_V1_SCHEMA,
  type CharacterContractV1,
  type ContractV1Default,
  type ContractV1Hero,
  type ContractV1Package,
  type ContractV1Range,
  type ContractV1Rig,
  type ContractV1Rule,
  type ContractV1Slot,
  type ContractV1Source,
  type ContractV1Timing,
} from './characterContractV1Types';
import type { ContractCharacter, ContractModel, ContractSection, ContractSlotSpec } from '../model';

/**
 * The rule ids of the v1 table (§5.1) this build knows. A contract listing any other id is refused; C2 implements
 * their checks on the written bytes, C1 the document-level parts (`slotIssues`).
 */
export const CONTRACT_V1_RULES: readonly string[] = [
  'pack.extras',
  'pack.contract',
  'pack.slot-known',
  'pack.animation-ref',
  'pack.unreferenced',
  'pack.bytes',
  'clip.channels',
  'clip.sampler',
  'clip.keys',
  'clip.duration',
  'clip.in-place',
  'clip.loop-closure',
  'clip.contact',
  'clip.basic-interval',
];

/** Appendix A key sets per object (required, then optional), exported for the schema cross-check test. */
export const CONTRACT_V1_KEYS = {
  root: [
    'schema',
    'schemaVersion',
    'projectId',
    'revision',
    'previousRevision',
    'license',
    'source',
    'package',
    'rig',
    'timing',
    'rules',
    'slots',
    'heroes',
  ],
  source: [
    'commit',
    'exporter',
    'inputsSha256',
    'gameplayRevision',
    'presentationSha256',
    'motionLibrary',
    'protocolVersion',
  ],
  motionLibrary: ['schemaVersion', 'sha256', 'clips'],
  package: ['extrasKey', 'sourceFormats', 'rendition', 'slotNaming', 'customPlayback'],
  rendition: ['platform', 'profile', 'version'],
  customPlayback: ['rate', 'start'],
  rig: [
    'kind',
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
    'legLengthFrom',
    'referenceLegLengthM',
  ],
  timing: [
    'blendSecs',
    'idleGraceSecs',
    'facingHoldSecs',
    'contactLimitSecs',
    'rowRate',
    'rowStart',
    'fitRate',
    'unseenHoldSecs',
    'freshSecs',
    'maxGapSecs',
    'deathCut',
    'movementInterruptsAction',
    'newActionRestarts',
  ],
  facingHoldSecs: ['basic', 'skill'],
  rule: ['id', 'severity', 'scope', 'params'],
  default: [
    'motion',
    'durationSecs',
    'looping',
    'contactSecs',
    'rate',
    'start',
    'playSecs',
    'effectiveContactSecs',
    'standInFor',
  ],
  slot: [
    'group',
    'role',
    'label',
    'kind',
    'phase',
    'edgeReleased',
    'customizable',
    'customizableFrom',
    'reserved',
    'required',
    'default',
    'window',
    'inPlace',
    'loop',
    'contact',
    'telegraph',
    'handheld',
    'sharesDefaultWith',
    'alternatesWith',
    'usedBy',
  ],
  slotOptional: ['skill', 'class', 'minIntervalSecs', 'weaponMode'],
  window: ['minSecs', 'targetSecs', 'maxSecs'],
  contact: ['required', 'maxSecs', 'targetSecs'],
  telegraph: ['secs', 'serverWindupSecs', 'fitWindup'],
  slotHandheld: ['item', 'byMode', 'bone', 'muzzleWindowSecs'],
  hero: ['id', 'kind', 'name', 'role', 'requirementId', 'basicAttack', 'kit', 'handheld', 'slots'],
  basicAttack: ['rangeM', 'cooldownSecs', 'attackRateCap', 'minIntervalSecs', 'slots'],
  kit: ['key', 'skill', 'name', 'slots'],
  heroHandheld: ['default', 'byMode', 'bone'],
} as const;

const SHA256 = /^[0-9a-f]{64}$/;
const REVISION = /^sha256-[0-9a-f]{64}$/;
const ID = /^[a-z][a-z0-9_]{0,47}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const PROFILE = /^[a-z][a-z0-9-]{1,62}$/;
const BONE = /^[a-z][A-Za-z]{1,31}$/;
const RULE_ID = /^(pack|clip)\.[a-z][a-z0-9-]{1,40}$/;
const VERSION_FROM = /^[0-9]+(\.[0-9]+)?$/;
const HANDHELD_ITEM = /^[a-z][a-z0-9-]{0,63}$/;
const MODE = /^[a-z][a-z0-9_]{0,15}$/;
const USED_BY = /^(\*|[a-z][a-z0-9_]{0,31})$/;
const REQUIREMENT = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
/** The slot id grammar (§3.6). */
export const CONTRACT_V1_SLOT_ID =
  /^(base\.(idle|run|walk|death)|basic\.[a-z][a-z0-9_]{0,31}\.([0-9]|[a-z][a-z0-9_]{0,15}\.[0-9])|skill\.[a-z][a-z0-9_]{0,47}\.(release|recast|windup))$/;

type Json = Readonly<Record<string, unknown>>;

function fail(field: string, expected: string): never {
  throw new EkzaError('invalid-input', `character contract: ${field} must be ${expected}`, { field });
}

function record(value: unknown, field: string, keys: readonly string[], optional: readonly string[] = []): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(field, 'an object');
  const json = value as Json;
  for (const key of Object.keys(json)) {
    if (!keys.includes(key) && !optional.includes(key)) fail(`${field}.${key}`, 'absent (unknown key)');
  }
  for (const key of keys) if (!(key in json)) fail(`${field}.${key}`, 'present');
  return json;
}

function str(json: Json, key: string, field: string, pattern?: RegExp, max = Number.POSITIVE_INFINITY): string {
  const value = json[key];
  if (typeof value !== 'string') fail(`${field}.${key}`, 'a string');
  if (value.length > max) fail(`${field}.${key}`, `at most ${max} characters`);
  if (pattern !== undefined && !pattern.test(value)) fail(`${field}.${key}`, `a string matching ${pattern.source}`);
  return value;
}

function text(json: Json, key: string, field: string, min: number, max: number): string {
  const value = str(json, key, field, undefined, max);
  if (value.length < min) fail(`${field}.${key}`, `at least ${min} character(s)`);
  return value;
}

function oneOf<T extends string>(json: Json, key: string, field: string, values: readonly T[]): T {
  const value = json[key];
  if (!values.includes(value as T)) fail(`${field}.${key}`, `one of ${values.map((v) => `'${v}'`).join(', ')}`);
  return value as T;
}

function exactly<T extends string | number>(json: Json, key: string, field: string, expected: T): T {
  if (json[key] !== expected) fail(`${field}.${key}`, JSON.stringify(expected));
  return expected;
}

function bool(json: Json, key: string, field: string): boolean {
  const value = json[key];
  if (typeof value !== 'boolean') fail(`${field}.${key}`, 'a boolean');
  return value;
}

interface NumberRule {
  readonly integer?: boolean;
  readonly min?: number;
  readonly exclusiveMin?: number;
  readonly max?: number;
}

function numberAt(value: unknown, field: string, rule: NumberRule = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(field, 'a finite number');
  if (rule.integer === true && !Number.isInteger(value)) fail(field, 'an integer');
  if (rule.min !== undefined && value < rule.min) fail(field, `≥ ${rule.min}`);
  if (rule.exclusiveMin !== undefined && value <= rule.exclusiveMin) fail(field, `> ${rule.exclusiveMin}`);
  if (rule.max !== undefined && value > rule.max) fail(field, `≤ ${rule.max}`);
  return value;
}

function num(json: Json, key: string, field: string, rule: NumberRule = {}): number {
  return numberAt(json[key], `${field}.${key}`, rule);
}

function nullableNum(json: Json, key: string, field: string, rule: NumberRule = {}): number | null {
  return json[key] === null ? null : num(json, key, field, rule);
}

const SECS: NumberRule = { min: 0, max: 60 };

function list(json: Json, key: string, field: string, opts: { min?: number; max?: number; unique?: boolean } = {}) {
  const value = json[key];
  if (!Array.isArray(value)) fail(`${field}.${key}`, 'an array');
  const items = value as readonly unknown[];
  if (opts.min !== undefined && items.length < opts.min) fail(`${field}.${key}`, `at least ${opts.min} item(s)`);
  if (opts.max !== undefined && items.length > opts.max) fail(`${field}.${key}`, `at most ${opts.max} item(s)`);
  if (opts.unique === true) {
    const seen = new Set<string>();
    for (const item of items) {
      const k = JSON.stringify(item);
      if (seen.has(k)) fail(`${field}.${key}`, `unique (${k} repeats)`);
      seen.add(k);
    }
  }
  return items;
}

function strings(
  json: Json,
  key: string,
  field: string,
  pattern: RegExp,
  opts: { min?: number; max?: number; unique?: boolean } = {},
): string[] {
  return list(json, key, field, opts).map((item, i) => {
    if (typeof item !== 'string' || !pattern.test(item))
      fail(`${field}.${key}[${i}]`, `a string matching ${pattern.source}`);
    return item;
  });
}

function range(json: Json, key: string, field: string): ContractV1Range {
  const items = list(json, key, field, { min: 2, max: 2 });
  return [numberAt(items[0], `${field}.${key}[0]`), numberAt(items[1], `${field}.${key}[1]`)];
}

function stringMap(json: Json, key: string, field: string): Readonly<Record<string, string>> {
  const value = json[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${field}.${key}`, 'an object');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Json)) {
    if (typeof v !== 'string') fail(`${field}.${key}.${k}`, 'a string');
    out[k] = v;
  }
  return out;
}

function parseSource(value: unknown): ContractV1Source {
  const f = 'contract.source';
  const json = record(value, f, CONTRACT_V1_KEYS.source);
  const ml = record(json['motionLibrary'], `${f}.motionLibrary`, CONTRACT_V1_KEYS.motionLibrary);
  return {
    commit: str(json, 'commit', f, COMMIT),
    exporter: str(json, 'exporter', f, undefined, 200),
    inputsSha256: str(json, 'inputsSha256', f, SHA256),
    gameplayRevision: str(json, 'gameplayRevision', f, undefined, 64),
    presentationSha256: str(json, 'presentationSha256', f, SHA256),
    motionLibrary: {
      schemaVersion: num(ml, 'schemaVersion', `${f}.motionLibrary`, { integer: true, min: 1 }),
      sha256: str(ml, 'sha256', `${f}.motionLibrary`, SHA256),
      clips: num(ml, 'clips', `${f}.motionLibrary`, { integer: true, min: 1, max: 256 }),
    },
    protocolVersion: num(json, 'protocolVersion', f, { integer: true, min: 1 }),
  };
}

function parsePackage(value: unknown): ContractV1Package {
  const f = 'contract.package';
  const json = record(value, f, CONTRACT_V1_KEYS.package);
  const formats = list(json, 'sourceFormats', f, { min: 1, unique: true }).map((item, i) => {
    if (item !== 'vrm1' && item !== 'vrm0') fail(`${f}.sourceFormats[${i}]`, "'vrm1' or 'vrm0'");
    return item;
  });
  const rendition = record(json['rendition'], `${f}.rendition`, CONTRACT_V1_KEYS.rendition);
  const playback = record(json['customPlayback'], `${f}.customPlayback`, CONTRACT_V1_KEYS.customPlayback);
  return {
    extrasKey: exactly(json, 'extrasKey', f, 'ekza_animation_set_v1'),
    sourceFormats: formats,
    rendition: {
      platform: str(rendition, 'platform', `${f}.rendition`, PROFILE),
      profile: str(rendition, 'profile', `${f}.rendition`, PROFILE),
      version: num(rendition, 'version', `${f}.rendition`, { integer: true, min: 1 }),
    },
    slotNaming: exactly(json, 'slotNaming', f, 'animation-name-equals-slot-id'),
    customPlayback: {
      rate: exactly(playback, 'rate', `${f}.customPlayback`, 1),
      start: exactly(playback, 'start', `${f}.customPlayback`, 0),
    },
  };
}

function parseRig(value: unknown): ContractV1Rig {
  const f = 'contract.rig';
  const json = record(value, f, CONTRACT_V1_KEYS.rig);
  const bones = (key: string): string[] => strings(json, key, f, BONE, { max: 64, unique: true });
  return {
    kind: exactly(json, 'kind', f, 'vrm-humanoid'),
    restPose: exactly(json, 'restPose', f, 't-pose'),
    facing: exactly(json, 'facing', f, 'as-vrm-spec'),
    requiredBones: bones('requiredBones'),
    requiredBonesVrm0: bones('requiredBonesVrm0'),
    drivenBones: bones('drivenBones'),
    maxHumanoidBones: num(json, 'maxHumanoidBones', f, { integer: true, min: 15, max: 64 }),
    maxNodes: num(json, 'maxNodes', f, { integer: true, min: 1, max: 4096 }),
    uniformScale: oneOf(json, 'uniformScale', f, ['humanoid-bones-and-ancestors', 'none'] as const),
    fingers: oneOf(json, 'fingers', f, ['optional', 'required'] as const),
    thumbsRecommended: bool(json, 'thumbsRecommended', f),
    legLengthFrom: exactly(json, 'legLengthFrom', f, 'hips-to-feet'),
    referenceLegLengthM: num(json, 'referenceLegLengthM', f, { exclusiveMin: 0 }),
  };
}

function parseTiming(value: unknown): ContractV1Timing {
  const f = 'contract.timing';
  const json = record(value, f, CONTRACT_V1_KEYS.timing);
  const facing = record(json['facingHoldSecs'], `${f}.facingHoldSecs`, CONTRACT_V1_KEYS.facingHoldSecs);
  return {
    blendSecs: num(json, 'blendSecs', f, SECS),
    idleGraceSecs: num(json, 'idleGraceSecs', f, SECS),
    facingHoldSecs: {
      basic: num(facing, 'basic', `${f}.facingHoldSecs`, SECS),
      skill: num(facing, 'skill', `${f}.facingHoldSecs`, SECS),
    },
    contactLimitSecs: num(json, 'contactLimitSecs', f, SECS),
    rowRate: range(json, 'rowRate', f),
    rowStart: range(json, 'rowStart', f),
    fitRate: range(json, 'fitRate', f),
    unseenHoldSecs: num(json, 'unseenHoldSecs', f, SECS),
    freshSecs: num(json, 'freshSecs', f, SECS),
    maxGapSecs: num(json, 'maxGapSecs', f, SECS),
    deathCut: exactly(json, 'deathCut', f, 'immediate'),
    movementInterruptsAction: bool(json, 'movementInterruptsAction', f),
    newActionRestarts: bool(json, 'newActionRestarts', f),
  };
}

function parseRules(value: unknown): ContractV1Rule[] {
  if (!Array.isArray(value) || value.length === 0) fail('contract.rules', 'a non-empty array');
  const seen = new Set<string>();
  return (value as readonly unknown[]).map((item, i) => {
    const f = `contract.rules[${i}]`;
    const json = record(item, f, CONTRACT_V1_KEYS.rule);
    const id = str(json, 'id', f, RULE_ID);
    if (!CONTRACT_V1_RULES.includes(id)) {
      throw new EkzaError('unsupported', `This contract needs a newer Ekza Studio (unknown rule '${id}')`, {
        field: `${f}.id`,
        rule: id,
      });
    }
    if (seen.has(id)) fail(`${f}.id`, `unique ('${id}' repeats)`);
    seen.add(id);
    const params = json['params'];
    if (typeof params !== 'object' || params === null || Array.isArray(params)) fail(`${f}.params`, 'an object');
    return {
      id,
      severity: oneOf(json, 'severity', f, ['error', 'warning'] as const),
      scope: oneOf(json, 'scope', f, ['pack', 'clip'] as const),
      params: params as Json,
    };
  });
}

function parseDefault(value: unknown, f: string): ContractV1Default {
  const json = record(value, f, CONTRACT_V1_KEYS.default);
  const standIn = json['standInFor'];
  if (standIn !== null && (typeof standIn !== 'string' || standIn.length > 64)) {
    fail(`${f}.standInFor`, 'null or a string of at most 64 characters');
  }
  return {
    motion: str(json, 'motion', f, ID),
    durationSecs: num(json, 'durationSecs', f, { exclusiveMin: 0, max: 10 }),
    looping: bool(json, 'looping', f),
    contactSecs: nullableNum(json, 'contactSecs', f, { min: 0 }),
    rate: num(json, 'rate', f, { min: 0.5, max: 2 }),
    start: num(json, 'start', f, { min: 0, max: 0.8 }),
    playSecs: num(json, 'playSecs', f, { exclusiveMin: 0 }),
    effectiveContactSecs: nullableNum(json, 'effectiveContactSecs', f),
    standInFor: standIn,
  };
}

function parseSlot(id: string, value: unknown): ContractV1Slot {
  const f = `contract.slots['${id}']`;
  if (id.length > 64 || !CONTRACT_V1_SLOT_ID.test(id)) fail(f, 'keyed by a slot id (base.*, basic.*, skill.*)');
  const json = record(value, f, CONTRACT_V1_KEYS.slot, CONTRACT_V1_KEYS.slotOptional);
  const group = oneOf(json, 'group', f, ['base', 'basic', 'skill'] as const);
  const kind = oneOf(json, 'kind', f, ['loop', 'action', 'hold'] as const);
  const customizable = bool(json, 'customizable', f);
  const from = json['customizableFrom'];
  if (from !== null && (typeof from !== 'string' || !VERSION_FROM.test(from))) {
    fail(`${f}.customizableFrom`, 'null or a version such as "1" or "1.1"');
  }
  if (customizable && from === null) fail(`${f}.customizableFrom`, 'a version when customizable');
  const window = record(json['window'], `${f}.window`, CONTRACT_V1_KEYS.window);
  const contactValue = json['contact'];
  let contact: ContractV1Slot['contact'] = null;
  if (contactValue !== null) {
    const c = record(contactValue, `${f}.contact`, CONTRACT_V1_KEYS.contact);
    contact = {
      required: bool(c, 'required', `${f}.contact`),
      maxSecs: nullableNum(c, 'maxSecs', `${f}.contact`, { min: 0 }),
      targetSecs: nullableNum(c, 'targetSecs', `${f}.contact`, { min: 0 }),
    };
  }
  const telegraphValue = json['telegraph'];
  let telegraph: ContractV1Slot['telegraph'] = null;
  if (telegraphValue !== null) {
    const t = record(telegraphValue, `${f}.telegraph`, CONTRACT_V1_KEYS.telegraph);
    telegraph = {
      secs: num(t, 'secs', `${f}.telegraph`, { exclusiveMin: 0 }),
      serverWindupSecs: nullableNum(t, 'serverWindupSecs', `${f}.telegraph`, { min: 0 }),
      fitWindup: bool(t, 'fitWindup', `${f}.telegraph`),
    };
  }
  const handheldValue = json['handheld'];
  let handheld: ContractV1Slot['handheld'] = null;
  if (handheldValue !== null) {
    const h = record(handheldValue, `${f}.handheld`, CONTRACT_V1_KEYS.slotHandheld);
    handheld = {
      item: str(h, 'item', `${f}.handheld`, HANDHELD_ITEM),
      byMode: stringMap(h, 'byMode', `${f}.handheld`),
      bone: str(h, 'bone', `${f}.handheld`),
      muzzleWindowSecs: h['muzzleWindowSecs'] === null ? null : range(h, 'muzzleWindowSecs', `${f}.handheld`),
    };
  }
  const loop = bool(json, 'loop', f);
  if (kind === 'loop' && !loop) fail(`${f}.loop`, 'true for a loop slot');
  const slot: ContractV1Slot = {
    group,
    role: oneOf(json, 'role', f, ['idle', 'run', 'walk', 'death', 'basic', 'release', 'recast', 'windup'] as const),
    label: text(json, 'label', f, 1, 80),
    kind,
    phase: oneOf(json, 'phase', f, ['locomotion', 'state', 'instant', 'warn_fire', 'fuse', 'parry'] as const),
    edgeReleased: bool(json, 'edgeReleased', f),
    customizable,
    customizableFrom: from,
    reserved: bool(json, 'reserved', f),
    required: bool(json, 'required', f),
    default: parseDefault(json['default'], `${f}.default`),
    window: {
      minSecs: num(window, 'minSecs', `${f}.window`, { exclusiveMin: 0 }),
      targetSecs: num(window, 'targetSecs', `${f}.window`, { exclusiveMin: 0 }),
      maxSecs: num(window, 'maxSecs', `${f}.window`, { exclusiveMin: 0, max: 10 }),
    },
    inPlace: bool(json, 'inPlace', f),
    loop,
    contact,
    telegraph,
    handheld,
    sharesDefaultWith: strings(json, 'sharesDefaultWith', f, CONTRACT_V1_SLOT_ID, { unique: true }),
    alternatesWith: strings(json, 'alternatesWith', f, CONTRACT_V1_SLOT_ID, { max: 1, unique: true }),
    usedBy: strings(json, 'usedBy', f, USED_BY, { min: 1, unique: true }),
    ...('skill' in json ? { skill: str(json, 'skill', f, ID) } : {}),
    ...('class' in json ? { class: str(json, 'class', f, ID) } : {}),
    ...('minIntervalSecs' in json ? { minIntervalSecs: num(json, 'minIntervalSecs', f, { exclusiveMin: 0 }) } : {}),
    ...('weaponMode' in json ? { weaponMode: str(json, 'weaponMode', f, MODE) } : {}),
  };
  if (group === 'skill' && slot.skill === undefined) fail(`${f}.skill`, 'present on a skill slot');
  if (group === 'basic' && (slot.class === undefined || slot.minIntervalSecs === undefined)) {
    fail(`${f}.class`, 'present (with minIntervalSecs) on a basic slot');
  }
  if (slot.window.minSecs > slot.window.maxSecs) fail(`${f}.window.minSecs`, '≤ maxSecs');
  return slot;
}

function parseHero(value: unknown, i: number): ContractV1Hero {
  const f = `contract.heroes[${i}]`;
  const json = record(value, f, CONTRACT_V1_KEYS.hero);
  const role = json['role'];
  if (role !== null && (typeof role !== 'string' || role.length > 32)) fail(`${f}.role`, 'null or a short string');
  let basicAttack: ContractV1Hero['basicAttack'] = null;
  if (json['basicAttack'] !== null) {
    const b = record(json['basicAttack'], `${f}.basicAttack`, CONTRACT_V1_KEYS.basicAttack);
    basicAttack = {
      rangeM: num(b, 'rangeM', `${f}.basicAttack`, { exclusiveMin: 0 }),
      cooldownSecs: num(b, 'cooldownSecs', `${f}.basicAttack`, { exclusiveMin: 0 }),
      attackRateCap: num(b, 'attackRateCap', `${f}.basicAttack`, { min: 1 }),
      minIntervalSecs: num(b, 'minIntervalSecs', `${f}.basicAttack`, { exclusiveMin: 0 }),
      slots: strings(b, 'slots', `${f}.basicAttack`, CONTRACT_V1_SLOT_ID, { min: 1 }),
    };
  }
  const kit = list(json, 'kit', f, { max: 4 }).map((item, k) => {
    const kf = `${f}.kit[${k}]`;
    const entry = record(item, kf, CONTRACT_V1_KEYS.kit);
    return {
      key: oneOf(entry, 'key', kf, ['q', 'w', 'e', 'r'] as const),
      skill: str(entry, 'skill', kf, ID),
      name: text(entry, 'name', kf, 1, 64),
      slots: strings(entry, 'slots', kf, CONTRACT_V1_SLOT_ID, { min: 1 }),
    };
  });
  let handheld: ContractV1Hero['handheld'] = null;
  if (json['handheld'] !== null) {
    const h = record(json['handheld'], `${f}.handheld`, CONTRACT_V1_KEYS.heroHandheld);
    handheld = {
      default: str(h, 'default', `${f}.handheld`),
      byMode: stringMap(h, 'byMode', `${f}.handheld`),
      bone: str(h, 'bone', `${f}.handheld`),
    };
  }
  return {
    id: str(json, 'id', f, ID),
    kind: oneOf(json, 'kind', f, ['class', 'any'] as const),
    name: text(json, 'name', f, 1, 64),
    role,
    requirementId: str(json, 'requirementId', f, REQUIREMENT, 128),
    basicAttack,
    kit,
    handheld,
    slots: strings(json, 'slots', f, CONTRACT_V1_SLOT_ID, { min: 3, unique: true }),
  };
}

/** Cross-references the schema cannot express (Appendix A preamble). */
function crossCheck(contract: CharacterContractV1): void {
  const slots = contract.slots;
  for (const [id, slot] of Object.entries(slots)) {
    for (const [key, links] of [
      ['sharesDefaultWith', slot.sharesDefaultWith],
      ['alternatesWith', slot.alternatesWith],
    ] as const) {
      links.forEach((link, i) => {
        if (slots[link] === undefined)
          fail(`contract.slots['${id}'].${key}[${i}]`, `a slot of the contract ('${link}')`);
      });
    }
  }
  const heroIds = new Set<string>();
  contract.heroes.forEach((hero, i) => {
    const f = `contract.heroes[${i}]`;
    if (heroIds.has(hero.id)) fail(`${f}.id`, `unique ('${hero.id}' repeats)`);
    heroIds.add(hero.id);
    const view = new Set(hero.slots);
    hero.slots.forEach((slot, k) => {
      if (slots[slot] === undefined) fail(`${f}.slots[${k}]`, `a slot of the contract ('${slot}')`);
    });
    const inView = (list: readonly string[], field: string): void =>
      list.forEach((slot, k) => {
        if (!view.has(slot)) fail(`${field}[${k}]`, `a slot of the view ('${slot}')`);
      });
    if (hero.basicAttack !== null) inView(hero.basicAttack.slots, `${f}.basicAttack.slots`);
    hero.kit.forEach((entry, k) => inView(entry.slots, `${f}.kit[${k}].slots`));
  });
}

/**
 * Parses a contract document strictly. Throws `EkzaError('invalid-input')` naming the field, or
 * `EkzaError('unsupported', 'This contract needs a newer Ekza Studio …')` for a higher `schemaVersion` or an unknown
 * rule id. `verifyRevision` (default true) recomputes the canonical revision and refuses a mismatch.
 */
export function parseCharacterContractV1(
  json: unknown,
  opts: { readonly verifyRevision?: boolean } = {},
): CharacterContractV1 {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) fail('contract', 'an object');
  const raw = json as Json;
  if (raw['schema'] !== CHARACTER_CONTRACT_V1_SCHEMA) fail('contract.schema', `'${CHARACTER_CONTRACT_V1_SCHEMA}'`);
  const version = raw['schemaVersion'];
  if (typeof version === 'number' && Number.isInteger(version) && version > 1) {
    throw new EkzaError('unsupported', 'This contract needs a newer Ekza Studio', {
      field: 'contract.schemaVersion',
      schemaVersion: version,
    });
  }
  const root = record(raw, 'contract', CONTRACT_V1_KEYS.root);
  const slotsValue = root['slots'];
  if (typeof slotsValue !== 'object' || slotsValue === null || Array.isArray(slotsValue)) {
    fail('contract.slots', 'an object');
  }
  const slotEntries = Object.entries(slotsValue as Json);
  if (slotEntries.length < 3) fail('contract.slots', 'at least 3 slots');
  const slots: Record<string, ContractV1Slot> = {};
  for (const [id, value] of slotEntries) slots[id] = parseSlot(id, value);
  const heroes = list(root, 'heroes', 'contract', { min: 1 }).map((hero, i) => parseHero(hero, i));
  const previous = root['previousRevision'];
  if (previous !== null && (typeof previous !== 'string' || !REVISION.test(previous))) {
    fail('contract.previousRevision', 'null or sha256-<64 hex>');
  }
  const contract: CharacterContractV1 = {
    schema: CHARACTER_CONTRACT_V1_SCHEMA,
    schemaVersion: exactly(root, 'schemaVersion', 'contract', 1),
    projectId: exactly(root, 'projectId', 'contract', 'omoba'),
    revision: str(root, 'revision', 'contract', REVISION),
    previousRevision: previous,
    license: text(root, 'license', 'contract', 1, 64),
    source: parseSource(root['source']),
    package: parsePackage(root['package']),
    rig: parseRig(root['rig']),
    timing: parseTiming(root['timing']),
    rules: parseRules(root['rules']),
    slots,
    heroes,
  };
  crossCheck(contract);
  if (opts.verifyRevision !== false) {
    const computed = contractRevision(raw);
    if (computed !== contract.revision) {
      throw new EkzaError(
        'invalid-input',
        `character contract: revision ${contract.revision} does not match its content (${computed})`,
        { field: 'contract.revision', expected: computed },
      );
    }
  }
  return contract;
}

const GROUP_LABEL: Readonly<Record<string, string>> = { base: 'Base', basic: 'Basic attack' };

/** A slot of the v1 document as the game-agnostic model has it (every v1 slot is an animation slot). */
function slotSpec(id: string, slot: ContractV1Slot): ContractSlotSpec {
  const fallback = slot.default;
  return {
    id,
    kind: 'animation',
    label: slot.label,
    customizable: slot.customizable,
    customizableFrom: slot.customizableFrom,
    reserved: slot.reserved,
    required: slot.required,
    default: {
      name: fallback.motion,
      playSecs: fallback.playSecs,
      contactSecs: fallback.effectiveContactSecs,
      loop: fallback.looping,
    },
    animation: {
      loop: slot.loop,
      playback: slot.kind,
      inPlace: slot.inPlace,
      window: slot.window,
      // the contact limit applies to edge-released slots only (§3.7: `maxSecs` is null otherwise)
      contact: slot.contact,
      minIntervalSecs: slot.minIntervalSecs ?? null,
      telegraphSecs: slot.telegraph?.secs ?? null,
    },
    sharesDefaultWith: slot.sharesDefaultWith,
    alternatesWith: slot.alternatesWith,
  };
}

/** A hero view as a model character: Base, Basic attack, then Q W E R in kit order (§3.8). */
function character(hero: ContractV1Hero): ContractCharacter {
  const placed = new Set<string>();
  const sections: ContractSection[] = [];
  const add = (section: ContractSection): void => {
    const slots = section.slots.filter((slot) => !placed.has(slot));
    for (const slot of slots) placed.add(slot);
    if (slots.length > 0) sections.push({ ...section, slots });
  };
  add({
    id: 'base',
    label: GROUP_LABEL['base'] as string,
    key: null,
    slots: hero.slots.filter((s) => s.startsWith('base.')),
  });
  if (hero.basicAttack !== null) {
    add({ id: 'basic', label: GROUP_LABEL['basic'] as string, key: null, slots: hero.basicAttack.slots });
  }
  for (const entry of hero.kit)
    add({ id: entry.key, label: entry.name, key: entry.key.toUpperCase(), slots: entry.slots });
  add({ id: 'other', label: 'Other', key: null, slots: hero.slots });
  return {
    id: hero.id,
    name: hero.name,
    kind: hero.kind === 'any' ? 'any' : 'character',
    subtitle: hero.role,
    requirementId: hero.requirementId,
    sections,
    slots: sections.flatMap((section) => section.slots),
  };
}

/** The game-agnostic model of a parsed v1 document. */
export function characterContractV1Model(contract: CharacterContractV1): ContractModel {
  const slots: Record<string, ContractSlotSpec> = {};
  for (const [id, slot] of Object.entries(contract.slots)) slots[id] = slotSpec(id, slot);
  return {
    game: contract.projectId,
    gameName: 'OMOBA',
    schema: contract.schema,
    revision: contract.revision,
    previousRevision: contract.previousRevision,
    license: contract.license,
    characters: contract.heroes.map(character),
    slots,
    rules: contract.rules,
  };
}
