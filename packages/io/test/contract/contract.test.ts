// GAME-PROTOCOL-SPEC §3.3, §3.5, §4, §8.10 and CHARACTER-CONTRACT-SPEC §8.16 (C1): the contract layer. The bundled
// OMOBA contract (`fixtures/contracts/omoba.game-contract.json`, the same bytes as apps/web/public/contracts/omoba)
// reads strictly as `ekza.game-contract.v1` with the `omoba.character.v1` profile; broken copies are refused naming the
// field (unknown key in the core and in a profile's `ext`, a changed value under an old revision, an unknown core rule,
// a newer `minReaderVersion`, a required unknown profile, dangling references); a newer minor is read leniently; an
// unknown namespaced rule is deferred; canonical JSON follows `ekza-canonical-json/1`; the reader's key sets equal the
// committed Appendix A schema's; the snapshot index parses.
import { readFileSync } from 'node:fs';
import { EkzaError } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_MAX_BYTES,
  canonicalJson,
  contractOffer,
  contractRevision,
  contractTarget,
  GAME_CONTRACT_KEYS,
  parseContractIndex,
  readContract,
  readContractText,
  readGameContract,
} from '../../src/contract';

const read = (path: string): string => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');
const TEXT = read('fixtures/contracts/omoba.game-contract.json');
type Obj = Record<string, unknown>;
type Doc = Obj & {
  revision: string;
  slots: Record<string, Obj & { ext: Record<string, Obj>; animation: Obj | null }>;
  targets: (Obj & { slots: string[]; accepts: (Obj & { slots: string[] })[]; ext: Record<string, Obj> })[];
  rules: Obj[];
  profiles: { used: string[]; required: string[] };
  ext: Record<string, Obj>;
};
const clone = (): Doc => JSON.parse(TEXT) as Doc;
/** A modified copy with its revision recomputed (so only the modification is wrong). */
const restamped = (doc: Doc): Doc => ({ ...doc, revision: contractRevision(doc) });

function refusal(run: () => unknown): EkzaError {
  try {
    run();
  } catch (error) {
    if (error instanceof EkzaError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}
const field = (error: EkzaError): unknown => (error.details as { field?: unknown } | undefined)?.field;
const OMOBA = 'omoba.character.v1';

describe('the bundled OMOBA contract', () => {
  it('reads strictly with its recomputed revision: 113 slots (107 animation, 6 asset), 18 targets', () => {
    const doc = clone();
    const model = readGameContract(doc);
    expect(model.revision).toBe(doc.revision);
    expect(contractRevision(doc)).toBe(doc.revision);
    expect(model.game).toBe('omoba');
    expect(model.gameName).toBe('OMOBA');
    expect(model.profiles).toEqual({ used: [OMOBA], required: [] });
    const slots = Object.values(model.slots);
    expect(slots).toHaveLength(113);
    expect(slots.filter((slot) => slot.kind === 'animation')).toHaveLength(107);
    expect(slots.filter((slot) => slot.kind === 'asset')).toHaveLength(6);
    expect(slots.filter((slot) => slot.kind === 'animation' && slot.customizable)).toHaveLength(101);
    expect(model.targets).toHaveLength(18);
    expect(model.ignoredKeys).toEqual([]);
    expect(model.rules.filter((rule) => rule.deferred).map((rule) => rule.id)).toEqual(['omoba.asset.grip']);
  });

  it('is the same bytes Studio serves, listed by the index as the live channel', () => {
    const index = parseContractIndex(JSON.parse(read('apps/web/public/contracts/omoba/index.json')));
    expect(index).toMatchObject({
      game: 'omoba',
      contractSchema: 'ekza.game-contract.v1',
      profiles: [OMOBA],
      submit: false,
    });
    const live = index.revisions.find((entry) => entry.revision === index.channels.live);
    expect(live).toMatchObject({ slots: 113, targets: 18 });
    expect(read(`apps/web/public/contracts/omoba/${live?.file}`)).toBe(TEXT);
    expect(clone().revision).toBe(index.channels.live);
  });

  it('Wildspark: sections mix kinds, two offers (the character and the gear set)', () => {
    const model = readContractText(TEXT);
    const wildspark = contractTarget(model, 'wildspark');
    expect(wildspark?.kind).toBe('character');
    expect(wildspark?.sections.map((section) => [section.id, section.key])).toEqual([
      ['base', null],
      ['basic', null],
      ['q', 'Q'],
      ['w', 'W'],
      ['e', 'E'],
      ['r', 'R'],
      ['gear', null],
    ]);
    expect(wildspark?.accepts.map((offer) => [offer.package, offer.requirementId, offer.listing])).toEqual([
      ['character', 'character.wildspark', 'every-customizable-slot'],
      ['asset-pack', 'wildspark.handheld.set', 'filled-slots-only'],
    ]);
    expect(wildspark === undefined ? [] : contractOffer(wildspark, 'character')?.slots).toHaveLength(9);
    const zap = model.slots['skill.wild_zap.release'];
    expect(zap?.default).toEqual({
      name: 'pistol_shoot',
      playSecs: 0.5682,
      loop: false,
      markers: { contact: 0.0379 },
      preview: null,
    });
    expect(zap?.animation?.markers).toEqual({ contact: { required: true, maxSecs: 0.15, targetSecs: 0.0379 } });
    const gun = model.slots['wildspark.handheld.repeater'];
    expect(gun?.kind).toBe('asset');
    expect(gun?.asset).toMatchObject({ role: 'handheld', socket: 'hand.right', rootName: 'WildsparkSetRepeater' });
    expect(model.slots['skill.dawn_ray.windup']).toMatchObject({ customizable: false, customizableFrom: '1.1' });
    const any = contractTarget(model, 'any');
    expect(any?.kind).toBe('any');
    expect(any?.slots).toEqual(['base.idle', 'base.run', 'base.death']);
  });
});

describe('refusals', () => {
  it('an unknown key in the core and in a known profile’s ext names the field', () => {
    const root = clone();
    root['extra'] = 1;
    expect(field(refusal(() => readGameContract(restamped(root))))).toBe('contract.extra');
    const slot = clone();
    (slot.slots['base.run'] as Obj)['speed'] = 2;
    expect(field(refusal(() => readGameContract(restamped(slot))))).toBe("contract.slots['base.run'].speed");
    const ext = clone();
    const run = ext.slots['base.run'] as Doc['slots'][string];
    (run.ext[OMOBA] as Obj)['colour'] = 'red';
    expect(field(refusal(() => readGameContract(restamped(ext))))).toBe(
      `contract.slots['base.run'].ext['${OMOBA}'].colour`,
    );
    const target = clone();
    const first = target.targets[0] as Doc['targets'][number];
    (first.ext[OMOBA] as Obj)['icon'] = 'x';
    expect(field(refusal(() => readGameContract(restamped(target))))).toBe(`contract.targets[0].ext['${OMOBA}'].icon`);
  });

  it('an unknown profile’s ext is ignored unless the profile is required', () => {
    const used = clone();
    (used.slots['base.run'] as { ext: Record<string, Obj> }).ext['acme.extra.v1'] = { anything: true };
    used.profiles.used.push('acme.extra.v1');
    expect(readGameContract(restamped(used)).slots['base.run']?.ext['acme.extra.v1']).toEqual({ anything: true });
    const required = clone();
    required.profiles.used.push('acme.extra.v1');
    required.profiles.required.push('acme.extra.v1');
    const error = refusal(() => readGameContract(restamped(required)));
    expect(error.code).toBe('unsupported');
    expect(error.message).toContain('needs a newer Ekza Studio');
  });

  it('a changed value under the old revision is refused (the revision is recomputed)', () => {
    const doc = clone();
    (doc.slots['base.run'] as unknown as { label: string }).label = 'Sprint';
    expect(field(refusal(() => readGameContract(doc)))).toBe('contract.revision');
    expect(readGameContract(doc, { verifyRevision: false }).slots['base.run']?.label).toBe('Sprint');
  });

  it('rules: an unknown core id fails closed, an unknown namespaced id is deferred, a tool-only one is invalid', () => {
    const core = clone();
    core.rules.push({ id: 'clip.foot-slide', severity: 'error', scope: 'animation', params: {}, checkedBy: ['tool'] });
    const error = refusal(() => readGameContract(restamped(core)));
    expect(error.code).toBe('unsupported');
    expect(error.message).toContain("unknown rule 'clip.foot-slide'");
    const rule = { id: 'acme.clip.flair', severity: 'warning', scope: 'animation', params: {} };
    const deferred = clone();
    deferred.rules.push({ ...rule, checkedBy: ['builder'] });
    expect(readGameContract(restamped(deferred)).rules.at(-1)).toMatchObject({ id: 'acme.clip.flair', deferred: true });
    const toolOnly = clone();
    toolOnly.rules.push({ ...rule, checkedBy: ['tool'] });
    expect(field(refusal(() => readGameContract(restamped(toolOnly))))).toMatch(/checkedBy$/);
  });

  it('versions: a newer minReaderVersion needs a newer Studio; a newer minor reads leniently', () => {
    const newer = clone();
    newer['minReaderVersion'] = '1.1';
    newer['schemaVersion'] = '1.1';
    const error = refusal(() => readContract(restamped(newer)));
    expect(error.code).toBe('unsupported');
    expect(error.message).toBe('This contract needs a newer Ekza Studio');
    const lenient = clone();
    lenient['schemaVersion'] = '1.3';
    (lenient.slots['base.run'] as Obj)['mood'] = 'happy';
    const model = readGameContract(restamped(lenient));
    expect(model.ignoredKeys).toEqual(["contract.slots['base.run'].mood"]);
    expect(refusal(() => readContract({ ...clone(), schema: 'ekza.game-contract.v2' })).code).toBe('unsupported');
    expect(refusal(() => readContract({ schema: 42 })).code).toBe('invalid-input');
  });

  it('cross-references: a target slot, an offer slot of the wrong kind, a link of another kind', () => {
    const view = clone();
    view.targets[1]?.slots.push('skill.nowhere.release');
    expect(field(refusal(() => readGameContract(restamped(view))))).toMatch(/^contract\.targets\[1\]\.slots\[/);
    const offer = clone();
    const wildspark = offer.targets.find((target) => target['id'] === 'wildspark');
    wildspark?.accepts[0]?.slots.push('wildspark.handheld.repeater');
    expect(field(refusal(() => readGameContract(restamped(offer))))).toMatch(/accepts\[0\]\.slots\[9\]$/);
    const link = clone();
    (link.slots['base.run'] as unknown as { sharesDefaultWith: string[] }).sharesDefaultWith = [
      'wildspark.handheld.repeater',
    ];
    expect(field(refusal(() => readGameContract(restamped(link))))).toBe(
      "contract.slots['base.run'].sharesDefaultWith[0]",
    );
  });

  it('shape: a kind whose spec is null, another kind’s spec set, a required slot with a default', () => {
    const missing = clone();
    (missing.slots['base.run'] as Obj)['animation'] = null;
    expect(field(refusal(() => readGameContract(restamped(missing))))).toBe("contract.slots['base.run'].animation");
    const both = clone();
    (both.slots['base.run'] as Obj)['socket'] = { socket: 'hand.right', maxOffsetM: 0.1, maxRotationDeg: 10 };
    expect(field(refusal(() => readGameContract(restamped(both))))).toBe("contract.slots['base.run'].socket");
    const required = clone();
    (required.slots['base.run'] as Obj)['required'] = true;
    expect(field(refusal(() => readGameContract(restamped(required))))).toBe("contract.slots['base.run'].default");
  });

  it('text over 1 MiB and text that is not JSON', () => {
    expect(refusal(() => readContractText(' '.repeat(CONTRACT_MAX_BYTES + 1))).message).toContain('at most');
    expect(refusal(() => readContractText('{')).message).toContain('valid JSON');
  });

  it('index: a channel naming an unlisted revision, an unknown key', () => {
    const index = JSON.parse(read('apps/web/public/contracts/omoba/index.json')) as Obj & {
      channels: Record<string, string>;
    };
    const unlisted = { ...index, channels: { ...index.channels, test: `sha256-${'0'.repeat(64)}` } };
    expect(field(refusal(() => parseContractIndex(unlisted)))).toBe('index.channels.test');
    expect(field(refusal(() => parseContractIndex({ ...index, extra: true })))).toBe('index.extra');
  });
});

describe('canonical JSON (ekza-canonical-json/1)', () => {
  it('sorts keys, prints integer-valued numbers as integers and decimals plainly', () => {
    expect(canonicalJson({ b: [1.0, 0.5, -0], a: { d: 0.000001, c: 'é"' }, z: null, t: true })).toBe(
      '{"a":{"c":"é\\"","d":0.000001},"b":[1,0.5,0],"t":true,"z":null}',
    );
    expect(canonicalJson({ big: 123456789.125, n: -2.5 })).toBe('{"big":123456789.125,"n":-2.5}');
  });

  it('refuses numbers it cannot print stably, and non-ASCII keys', () => {
    expect(() => canonicalJson({ x: 1e-7 })).toThrow(EkzaError);
    expect(() => canonicalJson({ x: Number.NaN })).toThrow(EkzaError);
    expect(() => canonicalJson({ x: 2 ** 60 })).toThrow(EkzaError);
    expect(() => canonicalJson({ é: 1 })).toThrow(EkzaError);
  });
});

describe('the reader and the committed JSON Schema (GAME-PROTOCOL-SPEC Appendix A) agree', () => {
  type Schema = {
    required?: string[];
    properties?: Record<string, Schema>;
    $defs?: Record<string, Schema>;
    items?: Schema;
    oneOf?: Schema[];
    additionalProperties?: Schema | boolean;
  };
  const schema = JSON.parse(read('fixtures/contracts/ekza.game-contract.v1.schema.json')) as Schema;
  const defs = schema.$defs as Record<string, Schema>;
  const p = schema.properties as Record<string, Schema>;
  const props = (s: Schema | undefined): string[] => Object.keys(s?.properties ?? {}).sort();
  const object = (s: Schema | undefined): Schema =>
    (s?.oneOf ?? []).find((o) => o.properties !== undefined) ?? (s as Schema);
  const sorted = (keys: readonly string[]): string[] => [...keys].sort();
  const req = (s: Schema | undefined): string[] => sorted(s?.required ?? []);
  const target = defs['target'];
  const animation = defs['animationSpec'];
  const asset = defs['assetSpec'];
  const cases: [string, readonly string[], string[], string[]][] = [
    ['root', GAME_CONTRACT_KEYS.root, props(schema), req(schema)],
    ['game', GAME_CONTRACT_KEYS.game, props(p['game']), req(p['game'])],
    ['source', GAME_CONTRACT_KEYS.source, props(p['source']), req(p['source'])],
    ['profiles', GAME_CONTRACT_KEYS.profiles, props(p['profiles']), req(p['profiles'])],
    ['retired', GAME_CONTRACT_KEYS.retired, props(p['retired']), req(p['retired'])],
    ['rig', GAME_CONTRACT_KEYS.rig, props(defs['rig']), req(defs['rig'])],
    ['lengthUnit', GAME_CONTRACT_KEYS.lengthUnit, props(defs['rig']?.properties?.['lengthUnit']), []],
    ['socket', GAME_CONTRACT_KEYS.socket, props(defs['socket']), req(defs['socket'])],
    ['packaging', GAME_CONTRACT_KEYS.packaging, props(defs['packaging']), req(defs['packaging'])],
    ['rendition', GAME_CONTRACT_KEYS.rendition, props(object(defs['packaging']?.properties?.['rendition'])), []],
    ['rule', GAME_CONTRACT_KEYS.rule, props(defs['rule']), req(defs['rule'])],
    ['default', GAME_CONTRACT_KEYS.default, props(defs['default']), req(defs['default'])],
    ['preview', GAME_CONTRACT_KEYS.preview, props(object(defs['default']?.properties?.['preview'])), []],
    ['animationSpec', GAME_CONTRACT_KEYS.animationSpec, props(animation), req(animation)],
    ['window', GAME_CONTRACT_KEYS.window, props(animation?.properties?.['window']), []],
    [
      'marker',
      GAME_CONTRACT_KEYS.marker,
      props(animation?.properties?.['markers']?.additionalProperties as Schema),
      [],
    ],
    ['assetSpec', GAME_CONTRACT_KEYS.assetSpec, props(asset), req(asset)],
    ['budget', GAME_CONTRACT_KEYS.budget, props(asset?.properties?.['budget']), []],
    ['materials', GAME_CONTRACT_KEYS.materials, props(asset?.properties?.['materials']), []],
    ['socketSpec', GAME_CONTRACT_KEYS.socketSpec, props(defs['socketSpec']), req(defs['socketSpec'])],
    ['slot', GAME_CONTRACT_KEYS.slot, sorted([...props(defs['slotBody']), ...props(defs['slot'])]), req(defs['slot'])],
    [
      'family',
      GAME_CONTRACT_KEYS.family,
      sorted([...new Set([...props(defs['slotBody']), ...props(defs['family'])])]),
      req(defs['family']),
    ],
    ['target', GAME_CONTRACT_KEYS.target, props(target), req(target)],
    ['section', GAME_CONTRACT_KEYS.section, props(target?.properties?.['sections']?.items), []],
    ['offer', GAME_CONTRACT_KEYS.offer, props(target?.properties?.['accepts']?.items), []],
  ];
  it.each(cases)(
    '%s: the reader knows exactly the schema properties and requires its required keys',
    (_, keys, properties, required) => {
      expect(sorted(keys)).toEqual(properties);
      // objects whose schema lists no `required` (nested shapes) are checked through their properties only
      expect(sorted(keys)).toEqual(required.length > 0 ? required : sorted(keys));
    },
  );
});
