import { describe, expect, it } from 'vitest';
import { parseGlb } from '../src/glb/parse';
import { lintExport, lintExportWithContext } from '../src/lint/lintExport';
import { LINT_RULES, ruleSeverity } from '../src/lint/rules';
import { BUILTIN_EXPORT_PROFILES, profilesForKind } from '../src/profiles/builtin';
import { GltfBuilder, makeGlb } from '../src/testing/glb';
import type { ExportProfileDef, LintIssue } from '../src/types';

type Json = Record<string, unknown>;

const profile = (id: string): ExportProfileDef => BUILTIN_EXPORT_PROFILES.find((p) => p.id === id) as ExportProfileDef;
const codes = (issues: readonly LintIssue[]) => issues.map((i) => i.code);
const find = (issues: readonly LintIssue[], code: string) => issues.filter((i) => i.code === code);

interface Spec {
  readonly names?: readonly string[];
  readonly rotation?: readonly number[];
  readonly translationNode?: number;
  readonly meta?: Json | null;
  readonly extra?: Json;
  readonly vrm?: 'vrm0' | 'vrm1' | null;
}

/** A small skinned VRM-like file (nodes hips/spine/head) with one animation per name. */
function build(spec: Spec = {}): Uint8Array {
  const b = new GltfBuilder();
  const json = b.json as Json;
  json['nodes'] = [
    { name: 'hips', children: [1] },
    { name: 'spine', children: [2] },
    { name: 'head' },
    { name: 'body', mesh: 0, skin: 0 },
  ];
  json['meshes'] = [
    { primitives: [{ attributes: { POSITION: b.accessor(new Float32Array(9), 'VEC3', { minMax: true }) } }] },
  ];
  json['skins'] = [{ joints: [0, 1, 2] }];
  json['scenes'] = [{ nodes: [0, 3] }];
  const times = b.accessor(new Float32Array([0, 1]), 'SCALAR', { minMax: true });
  const rotation = b.accessor(new Float32Array(spec.rotation ?? [0, 0, 0, 1, 0, 0, 0, 1]), 'VEC4');
  const translation = b.accessor(new Float32Array(6), 'VEC3');
  const names = spec.names ?? ['wave'];
  json['animations'] = names.map((name) => ({
    name,
    samplers: [
      { input: times, output: rotation },
      { input: times, output: translation },
    ],
    channels: [
      { sampler: 0, target: { node: 1, path: 'rotation' } },
      { sampler: 1, target: { node: spec.translationNode ?? 0, path: 'translation' } },
    ],
  }));
  if (spec.vrm !== null) {
    if (spec.vrm === 'vrm0') {
      json['extensions'] = {
        VRM: {
          humanoid: {
            humanBones: [
              { bone: 'hips', node: 0 },
              { bone: 'spine', node: 1 },
              { bone: 'head', node: 2 },
            ],
          },
        },
      };
    } else {
      json['extensions'] = {
        VRMC_vrm: {
          specVersion: '1.0',
          humanoid: { humanBones: { hips: { node: 0 }, spine: { node: 1 }, head: { node: 2 } } },
        },
      };
    }
  }
  const meta =
    spec.meta === undefined
      ? { schema: 1, clips: names.map((name, index) => ({ index, name, redistributable: 'yes' })) }
      : spec.meta;
  if (meta !== null) b.json.asset = { ...b.json.asset, extras: { ekza_animation_v1: meta } };
  Object.assign(json, spec.extra ?? {});
  return b.build();
}

describe('lintExport', () => {
  it('passes a clean file with no issues', async () => {
    expect(await lintExport('bake-into-model', build(), null)).toEqual([]);
    expect(await lintExport('bake-into-model', build(), profile('ekza/space-avatar-v1'))).toEqual([]);
  });

  it('finds a planted uri key anywhere, in any case', async () => {
    const issues = await lintExport(
      'bake-into-model',
      build({ extra: { extras: { deep: [{ URI: 'x' }] }, images: [{ uri: 'a.png' }] } }),
      null,
    );
    const uri = find(issues, 'rendition_external_data');
    expect(uri.map((i) => i.pointer ?? '').sort((a, b) => a.localeCompare(b))).toEqual([
      '/extras/deep/0/URI',
      '/images/0/uri',
    ]);
    expect(uri.every((i) => i.severity === 'error')).toBe(true);
  });

  it('maps slot-name and size rules to warnings locally and errors for Ekza profiles', async () => {
    const bytes = build({ names: ['Wave Hello'] });
    const local = await lintExport('bake-into-model', bytes, null);
    expect(find(local, 'ekza.slot-name')[0]?.severity).toBe('warning');
    const ekza = await lintExport('bake-into-model', bytes, profile('ekza/space-avatar-v1'));
    expect(find(ekza, 'ekza.slot-name')[0]?.severity).toBe('error');
    const tiny = { ...profile('ekza/space-avatar-v1'), maxBytes: 10 };
    expect(find(await lintExport('bake-into-model', bytes, tiny), 'source_too_large')[0]?.severity).toBe('error');
    const tinyLocal = { ...profile('local/generic'), maxBytes: 10 };
    expect(find(await lintExport('bake-into-model', bytes, tinyLocal), 'source_too_large')[0]?.severity).toBe(
      'warning',
    );
  });

  it('never exports tpose and requires unique names case-insensitively', async () => {
    const issues = await lintExport('bake-into-model', build({ names: ['tpose', 'idle', 'IDLE '] }), null);
    expect(find(issues, 'ekza.slot-name')[0]?.message).toMatch(/tpose/);
    expect(find(issues, 'ekza.unique-names')).toHaveLength(1);
    // §4.11.13: a warning locally, an error under Ekza profiles.
    expect(find(issues, 'ekza.unique-names')[0]?.severity).toBe('warning');
    const ekza = await lintExport(
      'bake-into-model',
      build({ names: ['idle', 'IDLE '] }),
      profile('ekza/space-avatar-v1'),
    );
    expect(find(ekza, 'ekza.unique-names')[0]?.severity).toBe('error');
  });

  it('checks provenance, the height scale and required extensions', async () => {
    const meta = {
      schema: 1,
      clips: [
        { index: 0, name: 'wave', redistributable: 'unknown' },
        { index: 1, name: 'walk', redistributable: 'no' },
      ],
    };
    const issues = await lintExport(
      'bake-into-model',
      build({
        names: ['wave', 'walk'],
        meta,
        extra: {
          extras: { ekza: { avatar: { heightScale: 3 } } },
          extensionsRequired: ['KHR_materials_unlit', 'EXT_meshopt_compression'],
        },
      }),
      profile('ekza/space-avatar-v1'),
    );
    expect(find(issues, 'ekza.provenance-unknown')[0]?.severity).toBe('warning');
    expect(find(issues, 'ekza.non-redistributable')[0]?.severity).toBe('error');
    expect(find(issues, 'ekza.height-scale-range')[0]?.severity).toBe('warning');
    expect(find(issues, 'ekza.extensions-required')[0]?.message).toMatch(/EXT_meshopt_compression/);
    expect(codes(await lintExport('bake-into-model', build({ meta: null }), null))).toContain(
      'ekza.provenance-unknown',
    );
  });

  it('checks the profile clips, skins, humanoid and hips-only translation', async () => {
    const omoba = await lintExport(
      'bake-into-model',
      build({ names: ['idle', 'walk'] }),
      profile('ekza/omoba-humanoid-v1'),
    );
    expect(
      find(omoba, 'rendition_animation')
        .map((i) => i.message)
        .join(),
    ).toMatch(/attack.*cast.*death|attack/);
    expect(find(await lintExport('bake-into-model', build({ names: ['idle'] }), null), 'rendition_animation')).toEqual(
      [],
    );
    const noSkin = await lintExport(
      'bake-into-model',
      build({ extra: { skins: undefined, nodes: [{ name: 'hips' }] } }),
      null,
    );
    expect(codes(noSkin)).toContain('rendition_skeleton');
    const noHumanoid = await lintExport('bake-into-model', build({ vrm: null }), profile('ekza/space-avatar-v1'));
    expect(codes(noHumanoid)).toContain('source_humanoid');
    const spine = await lintExport('bake-into-model', build({ translationNode: 1, vrm: 'vrm0' }), null);
    expect(find(spine, 'ekza.hips-only-translation')[0]?.message).toMatch(/spine/);
  });

  it('checks unit quaternions of the animator clips', async () => {
    const issues = await lintExport('bake-into-model', build({ rotation: [0, 0, 0, 1, 0, 0, 0, 1.01] }), null);
    expect(find(issues, 'ekza.unit-quaternions')[0]?.severity).toBe('error');
  });

  it('checks the container: chunk layout, single buffer and JSON size', async () => {
    const bytes = build();
    const broken = new Uint8Array(bytes.length + 4);
    broken.set(bytes);
    new DataView(broken.buffer).setUint32(8, broken.length, true);
    expect(codes(await lintExport('bake-into-model', broken, null))).toContain('ekza.chunk-alignment');
    expect(codes(await lintExport('bake-into-model', new Uint8Array(8), null))).toEqual(['ekza.chunk-alignment']);
    const two = build({
      extra: { buffers: [{}, { byteLength: 4, uri: 'data:application/octet-stream;base64,AAAAAA==' }] },
    });
    expect(codes(await lintExport('bake-into-model', two, null))).toEqual(
      expect.arrayContaining(['ekza.single-buffer', 'rendition_external_data']),
    );
    const small = { ...profile('ekza/omoba-humanoid-v1'), jsonMaxBytes: 100 };
    expect(find(await lintExport('bake-into-model', bytes, small), 'ekza.json-chunk-size')[0]?.severity).toBe('error');
    const huge = build({ extra: { extras: { blob: 'x'.repeat(8 * 1_048_576 + 10) } } });
    expect(find(await lintExport('bake-into-model', huge, null), 'ekza.json-chunk-size')[0]?.severity).toBe('error');
  });

  it('checks VRM formats and the source VRM block', async () => {
    const both = build({ extra: { extensions: { VRM: {}, VRMC_vrm: {} } } });
    expect(codes(await lintExport('bake-into-model', both, null))).toContain('rendition_format');
    const source = await parseGlb(build());
    const changed = build({
      vrm: 'vrm1',
      extra: { extensions: { VRMC_vrm: { specVersion: '1.0', humanoid: { humanBones: { hips: { node: 0 } } } } } },
    });
    const issues = await lintExportWithContext('bake-into-model', changed, null, { source });
    expect(find(issues, 'rendition_format')[0]?.pointer).toBe('/extensions/VRMC_vrm');
    expect(find(await lintExportWithContext('bake-into-model', build(), null, { source }), 'rendition_format')).toEqual(
      [],
    );
  });

  it('applies the VRMA rules', async () => {
    const vrma = (ext: Json, animations?: Json[]) =>
      makeGlb(
        {
          asset: {
            version: '2.0',
            extras: { ekza_animation_v1: { clips: [{ index: 0, name: 'wave', redistributable: 'yes' }] } },
          },
          nodes: [
            { name: 'hips', children: [1] },
            { name: 'spine', children: [2] },
            { name: 'leftEye' },
            { name: 'other' },
          ],
          extensionsUsed: ['VRMC_vrm_animation'],
          extensions: { VRMC_vrm_animation: ext },
          animations: animations ?? [{ name: 'wave', samplers: [], channels: [] }],
          buffers: [{ byteLength: 4 }],
        },
        new Uint8Array(4),
      );
    const good = { specVersion: '1.0', humanoid: { humanBones: { hips: { node: 0 }, spine: { node: 1 } } } };
    expect(await lintExport('vrma', vrma(good), null)).toEqual([]);
    const bad = await lintExport(
      'vrma',
      vrma({ specVersion: '0.9', humanoid: { humanBones: { spine: { node: 1 }, leftEye: { node: 2 } } } }, [
        {
          name: 'wave',
          samplers: [{ input: 0, output: 0 }],
          channels: [
            { sampler: 0, target: { node: 1, path: 'scale' } },
            { sampler: 0, target: { node: 1, path: 'translation' } },
            { sampler: 0, target: { node: 3, path: 'rotation' } },
          ],
        },
        { name: 'second', samplers: [], channels: [] },
      ]),
      null,
    );
    expect(new Set(codes(bad))).toEqual(
      new Set([
        'source_humanoid',
        'vrma.spec-version',
        'vrma.animation-count',
        'vrma.eyes',
        'vrma.no-scale',
        'vrma.non-hips-translation',
        'vrma.non-humanoid-channel',
      ]),
    );
    expect(bad.every((i) => i.severity === 'error')).toBe(true);
  });
});

describe('Bevy path lints (M1-stretch)', () => {
  const nodes = (overrides: Record<number, Json>, extra: Json[] = []): Json[] => {
    const base: Json[] = [
      { name: 'hips', children: [1] },
      { name: 'spine', children: [2] },
      { name: 'head' },
      { name: 'body', mesh: 0, skin: 0 },
      ...extra,
    ];
    return base.map((node, i) => ({ ...node, ...overrides[i] }));
  };

  it('warns about unnamed nodes on animated paths only', async () => {
    // hips (an ancestor of the animated spine) and the unanimated mesh node lose their names.
    const bytes = build({ extra: { nodes: nodes({ 0: { name: undefined }, 3: { name: '' } }) } });
    const issues = find(await lintExport('bake-into-model', bytes, null), 'bevy.unnamed-path-node');
    expect(issues.map((i) => [i.pointer, i.severity])).toEqual([['/nodes/0', 'warning']]);
    const ekza = find(
      await lintExport('bake-into-model', bytes, profile('ekza/space-avatar-v1')),
      'bevy.unnamed-path-node',
    );
    expect(ekza[0]?.severity).toBe('warning');
  });

  it('warns about sibling name clashes on animated paths, not elsewhere', async () => {
    // A second 'spine' under hips clashes with the animated spine; two unanimated 'prop' roots do not count.
    const bytes = build({
      extra: {
        nodes: nodes({ 0: { children: [1, 4] } }, [{ name: 'spine' }, { name: 'prop' }, { name: 'prop' }]),
        scenes: [{ nodes: [0, 3, 5, 6] }],
      },
    });
    const issues = find(await lintExport('animation-glb', bytes, null), 'bevy.duplicate-sibling-name');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ pointer: '/nodes/1', severity: 'warning' });
    expect(issues[0]?.message).toMatch(/nodes\[1\], nodes\[4\].*'spine'/);
  });

  it('checks scene roots as siblings and skips VRMA files', async () => {
    const bytes = build({
      extra: { nodes: nodes({}, [{ name: 'hips' }]), scenes: [{ nodes: [0, 3, 4] }] },
    });
    expect(find(await lintExport('bake-into-model', bytes, null), 'bevy.duplicate-sibling-name')).toHaveLength(1);
    const vrma = await lintExport('vrma', bytes, null);
    expect(vrma.filter((i) => i.code.startsWith('bevy.'))).toEqual([]);
  });
});

describe('profiles and rules', () => {
  it('ships the four ADR 0010 profiles as data', () => {
    expect(BUILTIN_EXPORT_PROFILES.map((p) => p.id)).toEqual([
      'ekza/space-avatar-v1',
      'ekza/omoba-humanoid-v1',
      'ekza/vrma-humanoid-v1',
      'local/generic',
    ]);
    expect(profile('ekza/omoba-humanoid-v1').requiredClips).toEqual(['idle', 'walk', 'attack', 'cast', 'death']);
    expect(profile('ekza/space-avatar-v1')).toMatchObject({
      platform: 'universal',
      profile: 'vrm-humanoid-v1',
      kind: 'bake-into-model',
      maxBytes: 50 * 1_048_576,
    });
    expect(profile('ekza/vrma-humanoid-v1')).toMatchObject({ kind: 'vrma', maxBytes: 8 * 1_048_576 });
    expect(profilesForKind('vrma').map((p) => p.id)).toEqual(['ekza/vrma-humanoid-v1', 'local/generic']);
    expect(profilesForKind('animation-glb').map((p) => p.id)).toEqual(['local/generic']);
    expect(JSON.stringify(BUILTIN_EXPORT_PROFILES)).not.toMatch(/"uri"/i);
  });

  it('resolves severities from overrides, then the Ekza/local columns', () => {
    const custom: ExportProfileDef = {
      ...profile('local/generic'),
      rules: [{ id: 'ekza.slot-name', severity: 'info' }],
    };
    expect(ruleSeverity('ekza.slot-name', custom)).toBe('info');
    expect(ruleSeverity('ekza.slot-name', null)).toBe('warning');
    expect(ruleSeverity('ekza.non-redistributable', profile('ekza/space-avatar-v1'))).toBe('error');
    expect(ruleSeverity('rendition_animation', null)).toBeNull();
    // M6A-SPEC §4.5 adds sub-namespaced codes (`mesh.budget.tris`, `ekza.handheld.grip`).
    expect(LINT_RULES.every((rule) => /^[a-z_]+$|^[a-z]+(\.[a-z-]+)+$/.test(rule.id))).toBe(true);
  });
});
