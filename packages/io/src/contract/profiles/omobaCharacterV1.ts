// Profile `omoba.character.v1` (CHARACTER-CONTRACT-SPEC v0.2 §15, Appendix A; GAME-PROTOCOL-SPEC §11): the shape of
// `ext["omoba.character.v1"]` at each position of an `ekza.game-contract.v1` document, checked strictly — the document's
// engine timings and motion library, a target's hero kind, role, basic attack and Q/W/E/R kit, an animation slot's
// group, role, phase, row playback, telegraph and handheld, an asset slot's catalogue role, status, uses and baseline.
// OMOBA marks the profile used, not required: nothing here is needed to make a valid package, so Studio reads it for
// better previews and texts only.
import type { ContractSlotKind } from '../model';
import {
  bool,
  exactly,
  fail,
  isObject,
  type Json,
  list,
  nullableNum,
  nullableStr,
  num,
  oneOf,
  type ReadContext,
  range,
  record,
  str,
  stringMap,
  text,
} from '../strict';

export const OMOBA_CHARACTER_V1 = 'omoba.character.v1';

/** Where an `ext` object sits (§3.2). */
export type ExtPosition =
  | { readonly at: 'document' | 'rig' | 'socket' | 'packaging' | 'family' | 'target' }
  | { readonly at: 'slot'; readonly kind: ContractSlotKind };

/** A profile module: the profile id and the strict reader of its `ext` objects. */
export interface ContractProfileModule {
  readonly profile: string;
  readExt(ctx: ReadContext, position: ExtPosition, value: unknown, field: string): void;
}

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[a-z][a-z0-9_]{0,47}$/;
const ITEM = /^[a-z][a-z0-9-]{0,63}$/;
const MODE = /^[a-z][a-z0-9_]{0,15}$/;
const PHASE = /^[a-z][a-z_]{0,31}$/;
const SECS = { min: 0, max: 60 } as const;

function handheldRef(ctx: ReadContext, value: unknown, f: string): void {
  if (value === null) return;
  const json = record(ctx, value, f, ['item', 'byMode', 'bone', 'muzzleWindowSecs']);
  str(json, 'item', f, ITEM);
  stringMap(json, 'byMode', f, ITEM);
  oneOf(json, 'bone', f, ['rightHand', 'leftHand'] as const);
  if (json['muzzleWindowSecs'] !== null) range(json, 'muzzleWindowSecs', f);
}

function documentExt(ctx: ReadContext, value: unknown, f: string): void {
  const json = record(ctx, value, f, [
    'gameplayRevision',
    'presentationSha256',
    'motionLibrary',
    'protocolVersion',
    'timing',
    'customPlayback',
  ]);
  str(json, 'gameplayRevision', f, undefined, 64);
  str(json, 'presentationSha256', f, SHA256);
  const library = record(ctx, json['motionLibrary'], `${f}.motionLibrary`, ['schemaVersion', 'sha256', 'clips']);
  num(library, 'schemaVersion', `${f}.motionLibrary`, { integer: true, min: 1 });
  str(library, 'sha256', `${f}.motionLibrary`, SHA256);
  num(library, 'clips', `${f}.motionLibrary`, { integer: true, min: 1, max: 256 });
  num(json, 'protocolVersion', f, { integer: true, min: 1 });
  const tf = `${f}.timing`;
  const timing = record(ctx, json['timing'], tf, [
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
  ]);
  for (const key of ['blendSecs', 'idleGraceSecs', 'contactLimitSecs', 'unseenHoldSecs', 'freshSecs', 'maxGapSecs']) {
    num(timing, key, tf, SECS);
  }
  const facing = record(ctx, timing['facingHoldSecs'], `${tf}.facingHoldSecs`, ['basic', 'skill']);
  num(facing, 'basic', `${tf}.facingHoldSecs`, SECS);
  num(facing, 'skill', `${tf}.facingHoldSecs`, SECS);
  for (const key of ['rowRate', 'rowStart', 'fitRate']) range(timing, key, tf);
  exactly(timing, 'deathCut', tf, 'immediate');
  bool(timing, 'movementInterruptsAction', tf);
  bool(timing, 'newActionRestarts', tf);
  const playback = record(ctx, json['customPlayback'], `${f}.customPlayback`, ['rate', 'start']);
  exactly(playback, 'rate', `${f}.customPlayback`, 1);
  exactly(playback, 'start', `${f}.customPlayback`, 0);
}

function targetExt(ctx: ReadContext, value: unknown, f: string): void {
  const json = record(ctx, value, f, ['heroKind', 'role', 'basicAttack', 'kit', 'handheld']);
  oneOf(json, 'heroKind', f, ['class', 'any'] as const);
  nullableStr(json, 'role', f, undefined, 32);
  if (json['basicAttack'] !== null) {
    const bf = `${f}.basicAttack`;
    const basic = record(ctx, json['basicAttack'], bf, ['rangeM', 'cooldownSecs', 'attackRateCap', 'minIntervalSecs']);
    num(basic, 'rangeM', bf, { exclusiveMin: 0 });
    num(basic, 'cooldownSecs', bf, { exclusiveMin: 0 });
    num(basic, 'attackRateCap', bf, { min: 1 });
    num(basic, 'minIntervalSecs', bf, { exclusiveMin: 0 });
  }
  list(json, 'kit', f, { max: 4 }).forEach((item, i) => {
    const kf = `${f}.kit[${i}]`;
    const entry = record(ctx, item, kf, ['key', 'skill', 'name']);
    oneOf(entry, 'key', kf, ['q', 'w', 'e', 'r'] as const);
    str(entry, 'skill', kf, ID);
    text(entry, 'name', kf, 1, 64);
  });
  if (json['handheld'] !== null) {
    const hf = `${f}.handheld`;
    const handheld = record(ctx, json['handheld'], hf, ['default', 'byMode', 'bone']);
    str(handheld, 'default', hf, ITEM);
    stringMap(handheld, 'byMode', hf, ITEM);
    oneOf(handheld, 'bone', hf, ['rightHand', 'leftHand'] as const);
  }
}

function animationSlotExt(ctx: ReadContext, value: unknown, f: string): void {
  const json = record(
    ctx,
    value,
    f,
    ['group', 'role', 'phase', 'edgeReleased', 'row', 'telegraph', 'handheld'],
    ['skill', 'class', 'weaponMode'],
  );
  oneOf(json, 'group', f, ['base', 'basic', 'skill'] as const);
  oneOf(json, 'role', f, ['idle', 'run', 'walk', 'death', 'basic', 'release', 'recast', 'windup'] as const);
  oneOf(json, 'phase', f, ['locomotion', 'state', 'instant', 'warn_fire', 'fuse', 'parry'] as const);
  bool(json, 'edgeReleased', f);
  const rf = `${f}.row`;
  const row = record(ctx, json['row'], rf, [
    'motion',
    'durationSecs',
    'contactSecs',
    'rate',
    'start',
    'effectiveContactSecs',
    'standInFor',
  ]);
  str(row, 'motion', rf, ID);
  num(row, 'durationSecs', rf, { exclusiveMin: 0, max: 10 });
  nullableNum(row, 'contactSecs', rf, { min: 0 });
  num(row, 'rate', rf, { min: 0.5, max: 2 });
  num(row, 'start', rf, { min: 0, max: 0.8 });
  nullableNum(row, 'effectiveContactSecs', rf);
  nullableStr(row, 'standInFor', rf, undefined, 64);
  if (json['telegraph'] !== null) {
    const tf = `${f}.telegraph`;
    const telegraph = record(ctx, json['telegraph'], tf, ['secs', 'serverWindupSecs', 'fitWindup']);
    num(telegraph, 'secs', tf, { exclusiveMin: 0 });
    nullableNum(telegraph, 'serverWindupSecs', tf, { min: 0 });
    bool(telegraph, 'fitWindup', tf);
  }
  handheldRef(ctx, json['handheld'], `${f}.handheld`);
  if ('skill' in json) str(json, 'skill', f, ID);
  if ('class' in json) str(json, 'class', f, ID);
  if ('weaponMode' in json) str(json, 'weaponMode', f, MODE);
}

function assetSlotExt(ctx: ReadContext, value: unknown, f: string): void {
  const json = record(ctx, value, f, ['catalogRole', 'status', 'item', 'model', 'uses', 'baseline', 'gripMetadata']);
  oneOf(json, 'catalogRole', f, ['held_weapon', 'projectile', 'world_prop', 'engine_effect'] as const);
  oneOf(json, 'status', f, ['supported', 'planned', 'engine_owned'] as const);
  nullableStr(json, 'item', f, ITEM);
  if (json['model'] !== null) oneOf(json, 'model', f, ['rocket', 'trap', 'hook', 'lantern', 'orb'] as const);
  list(json, 'uses', f, { min: 1, max: 16 }).forEach((item, i) => {
    const uf = `${f}.uses[${i}]`;
    const use = record(ctx, item, uf, [], ['skillId', 'basicAttackId', 'phase', 'state']);
    const skill = 'skillId' in use;
    const basic = 'basicAttackId' in use;
    if (skill === basic) fail(uf, 'one of { skillId } or { basicAttackId }');
    if (skill) str(use, 'skillId', uf, ID);
    if (basic) str(use, 'basicAttackId', uf, ID);
    if ('phase' in use) str(use, 'phase', uf, PHASE);
    if ('state' in use) str(use, 'state', uf, PHASE);
  });
  const baseline = record(ctx, json['baseline'], `${f}.baseline`, ['kind', 'path']);
  oneOf(baseline, 'kind', `${f}.baseline`, ['model', 'reference', 'procedural'] as const);
  nullableStr(baseline, 'path', `${f}.baseline`, undefined, 200);
  if (json['gripMetadata'] !== null) exactly(json, 'gripMetadata', f, 'ekza_handheld_v1');
}

export const OMOBA_CHARACTER_V1_PROFILE: ContractProfileModule = {
  profile: OMOBA_CHARACTER_V1,
  readExt(ctx, position, value, field) {
    if (position.at === 'document') return documentExt(ctx, value, field);
    if (position.at === 'target') return targetExt(ctx, value, field);
    if (position.at === 'slot' && position.kind === 'animation') return animationSlotExt(ctx, value, field);
    if (position.at === 'slot' && position.kind === 'asset') return assetSlotExt(ctx, value, field);
    // The profile defines no data anywhere else (rigs, sockets, packaging, families, socket slots).
    if (!isObject(value) || Object.keys(value).length > 0) fail(field, 'absent (the profile defines none here)');
    return undefined;
  },
};

/** The OMOBA data of a slot (`ext["omoba.character.v1"]`), when present (read after the profile checked it). */
export function omobaSlotExt(ext: Readonly<Record<string, unknown>>): Json | null {
  const value = ext[OMOBA_CHARACTER_V1];
  return isObject(value) ? value : null;
}
