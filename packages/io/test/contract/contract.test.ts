// CHARACTER-CONTRACT-SPEC §3, §8.1, §8.16 (C1): the contract layer. The bundled snapshot (fixtures/contracts, the same
// bytes as apps/web/public/contracts/omoba) parses strictly through its profile and maps to the game-agnostic model;
// broken copies are refused naming the field (unknown key, wrong revision, unknown rule id, higher schemaVersion,
// dangling view slot); canonical JSON follows the `omoba.asset-catalog.v1` rule; the parser's key sets equal the
// committed JSON Schema's (so the code and Appendix A cannot drift apart); the snapshot index parses.
import { readFileSync } from 'node:fs';
import { EkzaError } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_MAX_BYTES,
  CONTRACT_V1_KEYS,
  CONTRACT_V1_RULES,
  canonicalJson,
  contractCharacter,
  contractRevision,
  parseCharacterContractV1,
  parseContractIndex,
  readContract,
  readContractText,
} from '../../src/contract';

const read = (path: string): string => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');
const TEXT = read('fixtures/contracts/omoba.character-contract.v1.json');
type Doc = Record<string, unknown> & {
  revision: string;
  slots: Record<string, Record<string, unknown>>;
  heroes: Record<string, unknown>[];
  rules: Record<string, unknown>[];
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

describe('the bundled OMOBA contract', () => {
  it('parses strictly with its recomputed revision: 107 slots, 18 views, 101 custom-able', () => {
    const doc = clone();
    const contract = parseCharacterContractV1(doc);
    expect(contract.revision).toBe(doc.revision);
    expect(contractRevision(doc)).toBe(doc.revision);
    expect(Object.keys(contract.slots)).toHaveLength(107);
    expect(contract.heroes).toHaveLength(18);
    expect(Object.values(contract.slots).filter((slot) => slot.customizable)).toHaveLength(101);
    expect(contract.rules.map((rule) => rule.id)).toEqual(CONTRACT_V1_RULES);
  });

  it('is the same bytes Studio serves, listed by the index as the live channel', () => {
    const index = parseContractIndex(JSON.parse(read('apps/web/public/contracts/omoba/index.json')));
    expect(index.game).toBe('omoba');
    expect(index.contractSchema).toBe('omoba.character-contract.v1');
    expect(index.submit).toBe(false);
    const live = index.revisions.find((entry) => entry.revision === index.channels.live);
    expect(live?.slots).toBe(107);
    expect(read(`apps/web/public/contracts/omoba/${live?.file}`)).toBe(TEXT);
    expect(clone().revision).toBe(index.channels.live);
  });

  it('maps to the game-agnostic model: Wildspark in checklist order, every slot an animation slot', () => {
    const model = readContractText(TEXT);
    expect(model.game).toBe('omoba');
    expect(model.schema).toBe('omoba.character-contract.v1');
    expect(Object.values(model.slots).every((slot) => slot.kind === 'animation' && slot.animation !== null)).toBe(true);
    const wildspark = contractCharacter(model, 'wildspark');
    expect(wildspark?.sections.map((section) => [section.label, section.key])).toEqual([
      ['Base', null],
      ['Basic attack', null],
      ['Switchfire', 'Q'],
      ['Shockline', 'W'],
      ['Snapline', 'E'],
      ['Last Spark', 'R'],
    ]);
    expect(wildspark?.slots).toEqual([
      'base.idle',
      'base.run',
      'base.death',
      'basic.wildspark.0',
      'basic.wildspark.rockets.0',
      'skill.wild_switch.release',
      'skill.wild_zap.release',
      'skill.wild_traps.release',
      'skill.wild_rocket.release',
    ]);
    const any = contractCharacter(model, 'any');
    expect(any?.kind).toBe('any');
    expect(any?.slots).toEqual(['base.idle', 'base.run', 'base.death']);
    const zap = model.slots['skill.wild_zap.release'];
    expect(zap?.default).toEqual({ name: 'pistol_shoot', playSecs: 0.5682, contactSecs: 0.0379, loop: false });
    expect(zap?.animation?.contact).toEqual({ required: true, maxSecs: 0.15, targetSecs: 0.0379 });
    expect(model.slots['skill.dawn_ray.windup']?.customizable).toBe(false);
    expect(model.slots['skill.dawn_ray.windup']?.customizableFrom).toBe('1.1');
    // every view slot is in the model, sections hold each slot of the view once
    for (const character of model.characters) {
      expect(new Set(character.slots).size).toBe(character.slots.length);
      for (const slot of character.slots) expect(model.slots[slot]).toBeDefined();
    }
  });
});

describe('refusals', () => {
  it('an unknown key at any level names the field', () => {
    const root = clone();
    root['extra'] = 1;
    expect(field(refusal(() => parseCharacterContractV1(restamped(root))))).toBe('contract.extra');
    const slot = clone();
    (slot.slots['base.run'] as Record<string, unknown>)['speed'] = 2;
    expect(field(refusal(() => parseCharacterContractV1(restamped(slot))))).toBe("contract.slots['base.run'].speed");
    const hero = clone();
    (hero.heroes[0] as Record<string, unknown>)['icon'] = 'x';
    expect(field(refusal(() => parseCharacterContractV1(restamped(hero))))).toBe('contract.heroes[0].icon');
  });

  it('a changed value without a new revision is refused (the revision is recomputed)', () => {
    const doc = clone();
    (doc.slots['base.run'] as { label: string }).label = 'Sprint';
    const error = refusal(() => parseCharacterContractV1(doc));
    expect(error.code).toBe('invalid-input');
    expect(field(error)).toBe('contract.revision');
    expect(parseCharacterContractV1(doc, { verifyRevision: false }).slots['base.run']?.label).toBe('Sprint');
  });

  it('an unknown rule id fails closed: "needs a newer Ekza Studio"', () => {
    const doc = clone();
    doc.rules.push({ id: 'clip.foot-slide', severity: 'error', scope: 'clip', params: {} });
    const error = refusal(() => parseCharacterContractV1(restamped(doc)));
    expect(error.code).toBe('unsupported');
    expect(error.message).toContain('needs a newer Ekza Studio');
  });

  it('a higher schemaVersion or an unknown profile needs a newer Studio', () => {
    const doc = clone();
    doc['schemaVersion'] = 2;
    const error = refusal(() => readContract(restamped(doc)));
    expect(error.code).toBe('unsupported');
    expect(error.message).toBe('This contract needs a newer Ekza Studio');
    const other = { ...clone(), schema: 'acme.character-contract.v3' };
    expect(refusal(() => readContract(other)).code).toBe('unsupported');
    expect(refusal(() => readContract({ schema: 42 })).code).toBe('invalid-input');
  });

  it('cross-references: a view slot, a link or a basic slot that is not in the contract', () => {
    const view = clone();
    (view.heroes[1] as { slots: string[] }).slots.push('skill.nowhere.release');
    expect(field(refusal(() => parseCharacterContractV1(restamped(view))))).toMatch(/^contract\.heroes\[1\]\.slots\[/);
    const link = clone();
    (link.slots['base.run'] as { sharesDefaultWith: string[] }).sharesDefaultWith = ['base.walk', 'skill.gone.release'];
    expect(field(refusal(() => parseCharacterContractV1(restamped(link))))).toBe(
      "contract.slots['base.run'].sharesDefaultWith[1]",
    );
  });

  it('shape rules: slot id grammar, a loop slot that does not loop, a windup without a skill, a window upside down', () => {
    const id = clone();
    id.slots['base.swim'] = id.slots['base.run'] as Record<string, unknown>;
    expect(field(refusal(() => parseCharacterContractV1(restamped(id))))).toBe("contract.slots['base.swim']");
    const loop = clone();
    (loop.slots['base.idle'] as { loop: boolean }).loop = false;
    expect(field(refusal(() => parseCharacterContractV1(restamped(loop))))).toBe("contract.slots['base.idle'].loop");
    const skill = clone();
    delete (skill.slots['skill.dawn_ray.windup'] as Record<string, unknown>)['skill'];
    expect(field(refusal(() => parseCharacterContractV1(restamped(skill))))).toBe(
      "contract.slots['skill.dawn_ray.windup'].skill",
    );
    const window = clone();
    (window.slots['base.run'] as { window: { minSecs: number } }).window.minSecs = 5;
    expect(field(refusal(() => parseCharacterContractV1(restamped(window))))).toBe(
      "contract.slots['base.run'].window.minSecs",
    );
  });

  it('text over 1 MiB and text that is not JSON', () => {
    expect(refusal(() => readContractText(' '.repeat(CONTRACT_MAX_BYTES + 1))).message).toContain('at most');
    expect(refusal(() => readContractText('{')).message).toContain('valid JSON');
  });

  it('index: a channel naming an unlisted revision, an unknown key', () => {
    const index = JSON.parse(read('apps/web/public/contracts/omoba/index.json')) as Record<string, unknown> & {
      channels: Record<string, string>;
    };
    expect(
      field(
        refusal(() =>
          parseContractIndex({ ...index, channels: { ...index.channels, test: `sha256-${'0'.repeat(64)}` } }),
        ),
      ),
    ).toBe('index.channels.test');
    expect(field(refusal(() => parseContractIndex({ ...index, extra: true })))).toBe('index.extra');
  });
});

describe('canonical JSON (the omoba.asset-catalog.v1 rule)', () => {
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

describe('the parser and the committed JSON Schema (Appendix A) agree', () => {
  type Schema = { required?: string[]; properties?: Record<string, Schema>; $defs?: Record<string, Schema> };
  const schema = JSON.parse(read('fixtures/contracts/omoba.character-contract.v1.schema.json')) as Schema;
  const defs = schema.$defs as Record<string, Schema>;
  const props = (s: Schema | undefined): string[] => Object.keys(s?.properties ?? {}).sort();
  const oneOfObject = (s: Schema | undefined): Schema =>
    ((s as { oneOf?: Schema[] } | undefined)?.oneOf ?? []).find((o) => o.properties !== undefined) ?? (s as Schema);
  const sorted = (keys: readonly string[]): string[] => [...keys].sort();

  it('every object: the parser knows exactly the schema properties, and requires the schema required keys', () => {
    const p = schema.properties as Record<string, Schema>;
    const cases: [readonly string[], Schema | undefined][] = [
      [CONTRACT_V1_KEYS.root, schema],
      [CONTRACT_V1_KEYS.source, p['source']],
      [CONTRACT_V1_KEYS.motionLibrary, p['source']?.properties?.['motionLibrary']],
      [CONTRACT_V1_KEYS.package, p['package']],
      [CONTRACT_V1_KEYS.rendition, p['package']?.properties?.['rendition']],
      [CONTRACT_V1_KEYS.customPlayback, p['package']?.properties?.['customPlayback']],
      [CONTRACT_V1_KEYS.rig, p['rig']],
      [CONTRACT_V1_KEYS.timing, p['timing']],
      [CONTRACT_V1_KEYS.facingHoldSecs, p['timing']?.properties?.['facingHoldSecs']],
      [CONTRACT_V1_KEYS.default, defs['default']],
      [CONTRACT_V1_KEYS.window, defs['slot']?.properties?.['window']],
      [CONTRACT_V1_KEYS.contact, oneOfObject(defs['slot']?.properties?.['contact'])],
      [CONTRACT_V1_KEYS.telegraph, oneOfObject(defs['slot']?.properties?.['telegraph'])],
      [CONTRACT_V1_KEYS.slotHandheld, oneOfObject(defs['slot']?.properties?.['handheld'])],
      [CONTRACT_V1_KEYS.hero, defs['hero']],
      [CONTRACT_V1_KEYS.basicAttack, oneOfObject(defs['hero']?.properties?.['basicAttack'])],
      [CONTRACT_V1_KEYS.heroHandheld, oneOfObject(defs['hero']?.properties?.['handheld'])],
    ];
    for (const [keys, def] of cases) {
      expect(sorted(keys)).toEqual(props(def));
      expect(sorted(keys)).toEqual(sorted(def?.required ?? []));
    }
    const rule = (p['rules'] as { items: Schema }).items;
    expect(sorted(CONTRACT_V1_KEYS.rule)).toEqual(props(rule));
    const kit = (defs['hero']?.properties?.['kit'] as { items: Schema } | undefined)?.items;
    expect(sorted(CONTRACT_V1_KEYS.kit)).toEqual(props(kit));
    expect(sorted([...CONTRACT_V1_KEYS.slot, ...CONTRACT_V1_KEYS.slotOptional])).toEqual(props(defs['slot']));
    expect(sorted(CONTRACT_V1_KEYS.slot)).toEqual(sorted(defs['slot']?.required ?? []));
  });
});
