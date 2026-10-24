// CHARACTER-CONTRACT-SPEC §4.1, §5.1, §5.3, §8.16 and GAME-PROTOCOL-SPEC §5.2, §7.2, Appendix B (C2): the package
// manifest `ekza.package.v1` (strict reader, deterministic writer) and the TypeScript rule set on package bytes, run
// on OMOBA's conformance fixtures (`fixtures/contracts/omoba/v1`: C0, omoba-bevy PR #109 `c0fe23f`, copied by
// `tooling/sync-contract.mjs --fixtures` with SHA-256 pinning): every one of the 45 package cases gives its expected
// gate verdict (rule ids, warnings, per-slot verdicts and warnings) and every one of the 12 contract cases its reader
// verdict and reason code — except the two expectations listed in `C0_DRAFT_DIFFERENCES` (CC-C2-4).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { EkzaError } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import {
  type ContractModel,
  characterPackageManifest,
  checkCharacterPackage,
  contractRefusalReason,
  gateVerdict,
  packageManifestJson,
  readContractText,
  readPackageManifest,
  validationReport,
} from '../../src/contract';

const ROOT = new URL('../../../../', import.meta.url);
const DIR = new URL('fixtures/contracts/omoba/v1/', ROOT);
const bytesOf = (path: string): Uint8Array => new Uint8Array(readFileSync(new URL(path, DIR)));
const jsonOf = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, DIR), 'utf8')) as T;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

interface FixtureManifest {
  readonly contracts: readonly { readonly file: string; readonly revision: string; readonly status: string }[];
  readonly packageCases: readonly { readonly id: string; readonly file: string; readonly expected: string }[];
  readonly contractCases: readonly { readonly id: string; readonly file: string; readonly document: string }[];
  readonly files: Readonly<Record<string, { readonly sha256: string; readonly bytes: number }>>;
}
const MANIFEST = jsonOf<FixtureManifest>('manifest.json');
const COPY = jsonOf<{ readonly skipped: readonly { readonly file: string }[] }>('studio-copy.json');
const SKIPPED = new Set(COPY.skipped.map((entry) => entry.file));
const CONTRACTS = new Map<string, ContractModel>();
const RETIRED = new Set<string>();
for (const entry of MANIFEST.contracts) {
  const model = readContractText(readFileSync(new URL(entry.file, DIR), 'utf8'));
  CONTRACTS.set(model.revision, model);
  if (entry.status === 'retired') RETIRED.add(model.revision);
}
const OPTIONS = { contract: (revision: string) => CONTRACTS.get(revision), retired: (r: string) => RETIRED.has(r) };
/**
 * Two expected verdicts of C0 (`omoba-bevy` PR #109 @ c0fe23f, fixtures unchanged since f025981) disagree with the
 * rules as specified (§5.1), because the generator declares one rule per case instead of computing it; reported to C0
 * (CC-C2-4). `clip-too-short`: its manifest keeps the baseline contact 0.1 s while the clip's `ekza_animation_v1` says
 * 0.05 s (`clip.markers`: "equal to the per-clip metadata when both exist"). `ok-shared-animation`: the 0.5 s rocket
 * basic attack is longer than its `minIntervalSecs` 0.4375 s (warning `clip.min-interval`).
 */
const C0_DRAFT_DIFFERENCES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'clip-too-short': { slots: { 'basic.wildspark.0': ['clip.duration', 'clip.markers'] } },
  'ok-shared-animation': { slotWarnings: { 'basic.wildspark.rockets.0': ['clip.min-interval'] } },
};
const merged = (expected: Record<string, unknown>, change: Readonly<Record<string, unknown>> | undefined) => {
  const out: Record<string, unknown> = { ...expected };
  for (const [key, value] of Object.entries(change ?? {})) {
    out[key] = { ...(expected[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
  }
  return out;
};
const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? (value as string[]).toSorted((a, b) => a.localeCompare(b))
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sorted(v)]))
      : value;

describe('conformance fixtures (CC Appendix D, copied with SHA-256 pinning)', () => {
  it('every copied file matches the fixture manifest', () => {
    for (const [file, pin] of Object.entries(MANIFEST.files)) {
      if (SKIPPED.has(file)) continue;
      expect({ file, sha256: sha256(bytesOf(file)) }).toEqual({ file, sha256: pin.sha256 });
    }
    expect([...SKIPPED]).toEqual([]);
    expect(MANIFEST.packageCases).toHaveLength(45);
    expect(MANIFEST.contractCases).toHaveLength(12);
  });

  for (const testCase of MANIFEST.packageCases) {
    it.skipIf(SKIPPED.has(testCase.file))(`package ${testCase.id}`, () => {
      const expected = merged(jsonOf<Record<string, unknown>>(testCase.expected), C0_DRAFT_DIFFERENCES[testCase.id]);
      const verdict = gateVerdict(checkCharacterPackage(bytesOf(testCase.file), OPTIONS));
      expect(sorted(verdict)).toEqual(
        sorted({
          pack: expected['pack'],
          warnings: expected['warnings'],
          slots: expected['slots'],
          slotWarnings: expected['slotWarnings'],
        }),
      );
    });
  }

  it('the animation byte cap reads its parameter (a lower cap fails a small package)', () => {
    const model = CONTRACTS.get(MANIFEST.contracts[0]?.revision as string) as ContractModel;
    const low: ContractModel = {
      ...model,
      rules: model.rules.map((rule) =>
        rule.id === 'pack.bytes' ? { ...rule, params: { ...rule.params, maxAnimationBytes: 2000 } } : rule,
      ),
    };
    const bytes = bytesOf('packages/ok-vrm1-three-slots.glb');
    const verdict = gateVerdict(checkCharacterPackage(bytes, { contract: () => low }));
    expect(verdict.pack).toEqual(['pack.bytes']);
  });

  for (const testCase of MANIFEST.contractCases) {
    it(`contract ${testCase.id}: ${testCase.document}`, () => {
      const expected = jsonOf<{ readonly document: string }>(`expected/${testCase.id}.json`).document;
      expect(expected).toBe(testCase.document);
      let verdict = 'ok';
      try {
        readContractText(readFileSync(new URL(testCase.file, DIR), 'utf8'));
      } catch (error) {
        verdict = error instanceof EkzaError ? `refused: ${contractRefusalReason(error)}` : `crashed: ${String(error)}`;
      }
      expect(verdict).toBe(expected);
    });
  }
});

describe('package bytes: reports and measured values', () => {
  it('a passing package measures each custom slot and converts to ekza.validation-report.v1', () => {
    const bytes = bytesOf('packages/ok-vrm1-three-slots.glb');
    const report = checkCharacterPackage(bytes, OPTIONS);
    expect(report.ok).toBe(true);
    const run = report.slots['base.run'];
    expect(run?.verdict).toBe('pass');
    expect(run?.measured['durationSecs']).toBeCloseTo(0.6, 5);
    expect(run?.measured['loopSeamDeg']).toBe(0);
    expect(report.slots['basic.wildspark.0']?.measured['contactSecs']).toBe(0.1);
    expect(report.slots['base.idle']).toEqual({ mode: 'default', verdict: 'pass', issues: [], measured: {} });
    const json = validationReport(report, { sha256: sha256(bytes), validator: { name: 'ekza-studio', version: '0' } });
    expect(json).toMatchObject({ schema: 'ekza.validation-report.v1', stage: 'tool', verdict: 'pass' });
    expect(json?.['package']).toEqual({ sha256: sha256(bytes), bytes: bytes.byteLength, kind: 'character' });
  });

  it('hips drift is measured in leg lengths of the rig (hips height above the feet)', () => {
    const at = checkCharacterPackage(bytesOf('packages/clip-hips-drift-at-cap.glb'), OPTIONS);
    expect(at.slots['base.run']?.measured['hipsDrift']).toBeCloseTo(0.149, 3);
    const over = checkCharacterPackage(bytesOf('packages/clip-hips-drift-over.glb'), OPTIONS);
    expect(over.slots['base.run']?.issues.map((issue) => issue.rule)).toEqual(['clip.in-place']);
  });

  it('not a GLB, or no manifest: pack.manifest', () => {
    expect(gateVerdict(checkCharacterPackage(new Uint8Array([1, 2, 3]), OPTIONS)).pack).toEqual(['pack.manifest']);
    const verdict = gateVerdict(checkCharacterPackage(bytesOf('packages/pack-missing-manifest.glb'), OPTIONS));
    expect(verdict.pack).toEqual(['pack.manifest']);
  });
});

describe('the Studio-written package fixture for OMOBA (§5.3 item 4)', () => {
  it("passes every rule of the bundled contract and lists Wildspark's nine slots", () => {
    const bytes = new Uint8Array(readFileSync(new URL('fixtures/contracts/omoba-package/polybot-wildspark.vrm', ROOT)));
    const model = readContractText(readFileSync(new URL('fixtures/contracts/omoba.game-contract.json', ROOT), 'utf8'));
    const report = checkCharacterPackage(bytes, { contract: (r) => (r === model.revision ? model : undefined) });
    expect(gateVerdict(report)).toEqual({
      pack: 'ok',
      warnings: [],
      slots: { 'base.run': 'pass', 'skill.wild_zap.release': 'pass' },
      slotWarnings: {},
    });
    expect(Object.keys(report.manifest?.slots ?? {})).toHaveLength(9);
  });
});

describe('ekza.package.v1 manifest', () => {
  const MODEL = readContractText(readFileSync(new URL('fixtures/contracts/omoba.game-contract.json', ROOT), 'utf8'));

  it('writes every slot of the character offer once, custom or default, in the offer order', () => {
    const manifest = characterPackageManifest({
      model: MODEL,
      target: 'wildspark',
      fills: new Map([
        ['basic.wildspark.rockets.0', { animation: 1, markers: { contact: 0.1 } }],
        ['base.run', { animation: 0, markers: {} }],
        ['skill.wild_rocket.release', { animation: 1, markers: { contact: 0.1 } }],
      ]),
      tool: 'ekza-studio',
      toolVersion: '0.7.0',
    });
    expect(Object.keys(manifest.slots)).toEqual([
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
    expect(manifest.slots['base.idle']).toEqual({ mode: 'default' });
    expect(manifest.slots['skill.wild_rocket.release']).toEqual({
      mode: 'custom',
      animation: 1,
      markers: { contact: 0.1 },
    });
    expect(manifest.target).toEqual({ id: 'wildspark', requirementId: 'character.wildspark' });
    expect(manifest.contract).toEqual({ schema: 'ekza.game-contract.v1', game: 'omoba', revision: MODEL.revision });
    const json = packageManifestJson(manifest);
    expect(Object.keys(json)).toEqual([
      'schema',
      'schemaVersion',
      'kind',
      'contract',
      'target',
      'slots',
      'requires',
      'provenance',
    ]);
    expect(readPackageManifest(JSON.parse(JSON.stringify(json)))).toEqual(manifest);
    expect(JSON.stringify(packageManifestJson(manifest))).toBe(JSON.stringify(json));
  });

  it('refuses a slot outside the offer when writing', () => {
    expect(() =>
      characterPackageManifest({
        model: MODEL,
        target: 'wildspark',
        fills: new Map([['wildspark.handheld.repeater', { animation: 0, markers: {} }]]),
        tool: 'ekza-studio',
        toolVersion: '0',
      }),
    ).toThrow(/not a slot/);
  });

  it('reads strictly: unknown keys, a bad schema, a bad fill and markers are refused naming the field', () => {
    const good = packageManifestJson(
      characterPackageManifest({ model: MODEL, target: 'any', fills: new Map(), tool: 't', toolVersion: '1' }),
    ) as Record<string, unknown>;
    expect(() => readPackageManifest({ ...good, extra: 1 })).toThrow(/manifest\.extra/);
    expect(() => readPackageManifest({ ...good, schema: 'ekza.package.v2' })).toThrow(/schema/);
    expect(() => readPackageManifest({ ...good, slots: { 'base.run': { mode: 'custom' } } })).toThrow(/node/);
    expect(() =>
      readPackageManifest({ ...good, slots: { 'base.run': { mode: 'custom', animation: 0, markers: { Bad: 1 } } } }),
    ).toThrow(/markers/);
    expect(() => readPackageManifest({ ...good, slots: {} })).toThrow(/at least one slot/);
    // a newer minor reads with its unknown keys skipped
    expect(readPackageManifest({ ...good, schemaVersion: '1.1', extra: 1 }).schemaVersion).toBe('1.1');
  });

  it('the fixtures package manifests read', () => {
    for (const testCase of MANIFEST.packageCases) {
      if (SKIPPED.has(testCase.file) || !existsSync(new URL(testCase.file, DIR))) continue;
      const verdict = gateVerdict(checkCharacterPackage(bytesOf(testCase.file), OPTIONS));
      expect(verdict.pack === 'ok' || Array.isArray(verdict.pack)).toBe(true);
    }
  });
});
