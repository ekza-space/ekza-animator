// M6B-SPEC §0.4.6 (C10): the `vrm.*` lints mirror OMOBA's runtime admission (`omoba-bevy/passport/src/humanoid.rs`)
// check for check, for VRM 0.x and 1.0 by the file's version — one failing fixture per rule, each failing only its
// own rule, with OMOBA's message; severities per profile; the meta rows on VRM 1.0 files.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lintExport } from '../../src/lint/lintExport';
import { LINT_RULES, ruleSeverity } from '../../src/lint/rules';
import {
  checkVrmRuntime,
  semanticParent,
  VRM_LINT_RULES,
  VRM_META_RULE_IDS,
  VRM_RUNTIME_RULE_IDS,
} from '../../src/lint/vrm';
import {
  BONES_V0,
  BONES_V1,
  codesOf,
  glb,
  type Json,
  jsonChunk,
  LOCAL,
  mutated,
  nodeOf,
  OMOBA_GLB,
  rawGlb,
  SPACE,
  vrmDocument,
  vrmIssues,
} from './support';

const nodesOf = (json: Json) => json['nodes'] as Json[];
const vrmc = (json: Json) => (json['extensions'] as Json)['VRMC_vrm'] as Json;
const humanBones = (json: Json) => (vrmc(json)['humanoid'] as Json)['humanBones'] as Json;

const RUNTIME = new Set<string>(VRM_RUNTIME_RULE_IDS);
const META = new Set<string>(VRM_META_RULE_IDS);

/**
 * The single rule a fixture fails, with its first message. Runtime fixtures are judged on the runtime rows (a broken
 * container also hides the thumbnail from the meta rows), meta fixtures on every row.
 */
function only(bytes: Uint8Array): { code: string; message: string } {
  const all = vrmIssues(bytes);
  const issues = all.some((i) => RUNTIME.has(i.code)) ? all.filter((i) => RUNTIME.has(i.code)) : all;
  expect(all.filter((i) => !RUNTIME.has(i.code) && !META.has(i.code))).toEqual([]);
  expect(codesOf(issues)).toHaveLength(1);
  return { code: issues[0]?.code ?? '', message: issues[0]?.message ?? '' };
}

describe('the clean fixtures', () => {
  it('a VRM 1.0 and a VRM 0.x humanoid pass every vrm.* rule', () => {
    expect(vrmIssues(glb(vrmDocument()))).toEqual([]);
    expect(vrmIssues(glb(vrmDocument({ version: 'vrm0' })))).toEqual([]);
    const report = checkVrmRuntime(glb(vrmDocument()), () => {});
    expect(report).toMatchObject({ version: 'vrm1', nodes: 16, sceneRoots: [0, 15] });
    expect(report?.bones.size).toBe(15);
  });

  it('the shipped VRM fixtures as OMOBA judges them: Polybot (VRM 0.x) passes, Seed-san fails its scales', () => {
    const fixture = (name: string) =>
      new Uint8Array(readFileSync(new URL(`../../../../fixtures/models/${name}`, import.meta.url)));
    expect(vrmIssues(fixture('polybot.vrm'))).toEqual([]);
    // OMOBA's validate-runtime-vrm: "VRM node 6 requires positive uniform scale in 0.000001..=1000000" (its first
    // error; bag_rope_L carries [0.99975, 1, 0.99968]). The lints list every such node.
    const seed = vrmIssues(fixture('seed-san.vrm'));
    expect(codesOf(seed)).toEqual(['vrm.uniform-scale']);
    expect(seed[0]?.message).toBe('VRM node 6 requires positive uniform scale in 0.000001..=1000000');
  });
});

describe('one failing fixture per OMOBA rule', () => {
  it('vrm.spec-version: neither, both, a wrong 1.0 or 0.x specVersion, glTF not 2.0', () => {
    const neither = only(mutated((json) => delete json['extensions']));
    expect(neither).toEqual({ code: 'vrm.spec-version', message: 'Model has no VRM0 or VRM1 humanoid metadata' });
    const both = mutated((json) => {
      (json['extensions'] as Json)['VRM'] = { specVersion: '0.0', humanoid: { humanBones: [] } };
    });
    expect(vrmIssues(both).map((i) => i.message)).toContain('Model declares conflicting VRM0 and VRM1 extensions');
    expect(only(mutated((json) => (vrmc(json)['specVersion'] = '0.9'))).message).toBe(
      'Unsupported VRM1 specVersion; expected 1.0',
    );
    const v0 = mutated((json) => (((json['extensions'] as Json)['VRM'] as Json)['specVersion'] = '1.0'), {
      version: 'vrm0',
    });
    expect(only(v0).message).toBe('Unsupported VRM 0.x specVersion');
    expect(only(mutated((json) => (json['asset'] = { version: '1.0' }))).message).toBe(
      'Humanoid runtime requires glTF 2.0',
    );
  });

  it('vrm.container: chunk order, buffer count and length, uris, no BIN', () => {
    const doc = vrmDocument();
    expect(
      only(
        rawGlb([
          { type: 'BIN', data: doc.bin },
          { type: 'JSON', data: jsonChunk(doc.json) },
        ]),
      ).code,
    ).toBe('vrm.container');
    const twoJson = rawGlb([
      { type: 'JSON', data: jsonChunk(doc.json) },
      { type: 'JSON', data: jsonChunk(doc.json) },
    ]);
    expect(only(twoJson)).toEqual({
      code: 'vrm.container',
      message: 'VRM GLB requires one JSON chunk followed by at most one BIN chunk',
    });
    const twoBuffers = mutated((json) => (json['buffers'] = [...(json['buffers'] as Json[]), { byteLength: 4 }]));
    expect(only(twoBuffers).message).toBe('VRM GLB must contain exactly one embedded buffer');
    const short = mutated((json) => (json['buffers'] = [{ byteLength: 8 }]));
    expect(only(short).message).toBe('VRM embedded buffer length does not match its BIN chunk');
    const uri = mutated((json) => (json['images'] = [{ uri: 'thumb.png' }]));
    expect(only(uri).message).toBe('VRM images must be embedded; external/data URIs are unsupported');
    expect(only(glb({ json: doc.json, bin: null })).message).toBe('VRM GLB has no BIN chunk');
    const wrongLength = glb(doc);
    new DataView(wrongLength.buffer).setUint32(8, wrongLength.length + 4, true);
    expect(only(wrongLength).message).toBe('VRM must have an exact-length glTF 2.0 binary container');
  });

  it('vrm.glb-size: more than 50 MiB', () => {
    const doc = vrmDocument();
    const bin = new Uint8Array(50 * 1_048_576 + 4);
    bin.set(doc.bin);
    doc.json['buffers'] = [{ byteLength: bin.length }];
    expect(only(glb({ json: doc.json, bin }))).toEqual({
      code: 'vrm.glb-size',
      message: `VRM GLB must be between 20 bytes and 50 MiB (it is ${50 * 1_048_576 + 4 + 12 + 8 + 8 + jsonChunk(doc.json).length} bytes)`,
    });
  });

  it('vrm.json-size: a JSON chunk over 4 MiB', () => {
    const big = mutated((json) => (json['extras'] = { pad: 'x'.repeat(4 * 1_048_576) }));
    expect(only(big)).toEqual({ code: 'vrm.json-size', message: 'VRM JSON exceeds the 4 MiB runtime limit' });
  });

  it('vrm.node-count: more than 4,096 nodes', () => {
    const many = mutated((json) => {
      const nodes = nodesOf(json);
      while (nodes.length < 4097) nodes.push({ name: `extra ${nodes.length}` });
    });
    expect(only(many)).toEqual({ code: 'vrm.node-count', message: 'VRM requires 1..=4096 nodes (it has 4097)' });
  });

  it('vrm.humanoid-bone-count: more than 64 mapped bones', () => {
    const many = mutated((json) => {
      for (let i = 0; i < 50; i++) humanBones(json)[`extra${i}`] = { node: 0 };
    });
    expect(only(many)).toEqual({ code: 'vrm.humanoid-bone-count', message: 'VRM humanoid map exceeds 64 bones' });
  });

  it('vrm.bone-names: an unknown name, the wrong thumb names per version, a node mapped twice', () => {
    const tail = mutated((json) => {
      const nodes = nodesOf(json);
      nodes.push({ name: 'tail' });
      ((nodes[0] as Json)['children'] as number[]).push(nodes.length - 1);
      humanBones(json)['tail'] = { node: nodes.length - 1 };
    });
    expect(only(tail)).toEqual({ code: 'vrm.bone-names', message: 'Unsupported humanoid bone tail' });
    // VRM 1.0 has no ThumbIntermediate; VRM 0 has no ThumbMetacarpal.
    expect(semanticParent('leftThumbIntermediate', 'vrm1')).toBeNull();
    expect(semanticParent('leftThumbMetacarpal', 'vrm0')).toBeNull();
    expect(semanticParent('leftThumbProximal', 'vrm0')).toBe('leftHand');
    expect(semanticParent('leftThumbProximal', 'vrm1')).toBe('leftThumbMetacarpal');
    const thumb = mutated((json) => {
      humanBones(json)['leftThumbIntermediate'] = { node: nodeOf('leftHand') };
    });
    expect(vrmIssues(thumb).map((i) => i.message)).toContain('Unsupported humanoid bone leftThumbIntermediate');
    const twice = mutated((json) => {
      humanBones(json)['leftToes'] = { node: nodeOf('leftFoot') };
    });
    expect(only(twice)).toEqual({ code: 'vrm.bone-names', message: 'VRM humanoid assignment leftToes is duplicated' });
  });

  it('vrm.required-bones: 15 for VRM 1.0, chest and neck too for VRM 0', () => {
    const noFoot = mutated((json) => delete humanBones(json)['leftFoot']);
    expect(only(noFoot)).toEqual({
      code: 'vrm.required-bones',
      message: 'VRM humanoid map is missing required bone leftFoot',
    });
    const v0 = glb(vrmDocument({ version: 'vrm0', mapped: BONES_V0.map(([b]) => b).filter((b) => b !== 'neck') }));
    expect(only(v0)).toEqual({ code: 'vrm.required-bones', message: 'VRM humanoid map is missing required bone neck' });
    // The same skeleton without neck is admitted as VRM 1.0.
    const v1 = glb(vrmDocument({ bones: BONES_V0, mapped: BONES_V0.map(([b]) => b).filter((b) => b !== 'neck') }));
    expect(vrmIssues(v1)).toEqual([]);
  });

  it('vrm.parent-map: a wrong humanoid parent, upperChest without chest, a finger without its preceding segment', () => {
    const swapped = mutated((json) => {
      // leftLowerArm under the right upper arm.
      const nodes = nodesOf(json);
      const left = nodes[nodeOf('leftUpperArm')] as Json;
      const right = nodes[nodeOf('rightUpperArm')] as Json;
      left['children'] = [];
      right['children'] = [...(right['children'] as number[]), nodeOf('leftLowerArm')];
    });
    const issue = only(swapped);
    expect(issue.code).toBe('vrm.parent-map');
    expect(issue.message).toBe(
      'VRM bone leftLowerArm has incompatible parent Some("rightUpperArm"); expected Some("leftUpperArm")',
    );
    // upperChest between spine and the head and arms, no chest.
    const bones = [
      ...BONES_V1.slice(0, 2),
      ['upperChest', 'spine'] as const,
      ...BONES_V1.slice(2).map(([b, p]) => [b, p === 'spine' ? 'upperChest' : p] as const),
    ];
    const upper = only(glb(vrmDocument({ bones })));
    expect(upper).toEqual({ code: 'vrm.parent-map', message: 'VRM upperChest requires chest' });
    const finger = glb(vrmDocument({ bones: [...BONES_V1, ['leftIndexIntermediate', 'leftHand']] }));
    expect(only(finger)).toEqual({
      code: 'vrm.parent-map',
      message: 'VRM finger bone leftIndexIntermediate requires its preceding segment',
    });
  });

  it('vrm.node-tree: two parents, a cycle, a duplicate scene root, a skin listing a joint twice', () => {
    const twoParents = mutated((json) => {
      const nodes = nodesOf(json);
      (nodes[nodeOf('rightFoot')] as Json)['children'] = [nodeOf('leftFoot')];
    });
    expect(vrmIssues(twoParents).map((i) => i.message)).toContain(
      `VRM node ${nodeOf('leftFoot')} has multiple parents or duplicate child references`,
    );
    expect(codesOf(vrmIssues(twoParents))).toEqual(['vrm.node-tree']);
    const cycle = mutated((json) => {
      const nodes = nodesOf(json);
      nodes.push({ name: 'a', children: [nodes.length + 1] }, { name: 'b', children: [nodes.length] });
    });
    expect(only(cycle)).toEqual({ code: 'vrm.node-tree', message: 'VRM node hierarchy contains a cycle' });
    const dupRoot = mutated((json) => (json['scenes'] = [{ nodes: [0, 15, 0] }]));
    expect(only(dupRoot)).toEqual({
      code: 'vrm.node-tree',
      message: 'VRM scene 0 contains duplicate or non-root nodes',
    });
    const dupJoint = mutated((json) => (json['skins'] = [{ joints: [...BONES_V1.map((_, i) => i), 0] }]));
    expect(only(dupJoint)).toEqual({ code: 'vrm.node-tree', message: 'VRM skin 0 contains duplicate joints' });
  });

  it('vrm.trs-only: a matrix node', () => {
    const matrix = mutated((json) => {
      const node = nodesOf(json)[nodeOf('head')] as Json;
      delete node['translation'];
      delete node['rotation'];
      node['matrix'] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.1, 0, 1];
    });
    expect(only(matrix)).toEqual({
      code: 'vrm.trs-only',
      message: `VRM node ${nodeOf('head')} uses a matrix; export explicit TRS transforms`,
    });
  });

  it('vrm.unit-rotation: a non-unit and a zero quaternion', () => {
    const long = mutated((json) => ((nodesOf(json)[1] as Json)['rotation'] = [0, 0, 0, 1.01]));
    expect(only(long)).toEqual({
      code: 'vrm.unit-rotation',
      message: 'VRM node 1 requires a unit rotation quaternion; normalize the source model before importing',
    });
    // Within 1e-4 of unit length (float roundoff) is accepted, as OMOBA does.
    expect(vrmIssues(mutated((json) => ((nodesOf(json)[1] as Json)['rotation'] = [0, 0, 0, 1.00005])))).toEqual([]);
    const zero = mutated((json) => ((nodesOf(json)[1] as Json)['rotation'] = [0, 0, 0, 0]));
    expect(only(zero)).toEqual({ code: 'vrm.unit-rotation', message: 'VRM node 1 has a zero rotation quaternion' });
  });

  it('vrm.translation-range: a translation beyond 1e6', () => {
    const far = mutated((json) => ((nodesOf(json)[2] as Json)['translation'] = [0, 2e6, 0]));
    expect(only(far)).toEqual({
      code: 'vrm.translation-range',
      message: 'VRM node 2 translation exceeds the supported range',
    });
  });

  it('vrm.uniform-scale: non-uniform, negative and out-of-range scales', () => {
    for (const scale of [
      [1, 2, 1],
      [-1, -1, -1],
      [1e-7, 1e-7, 1e-7],
    ]) {
      const bytes = mutated((json) => ((nodesOf(json)[3] as Json)['scale'] = scale));
      expect(only(bytes)).toEqual({
        code: 'vrm.uniform-scale',
        message: 'VRM node 3 requires positive uniform scale in 0.000001..=1000000',
      });
    }
    // Uniform within s0 · 1e-5 passes.
    expect(vrmIssues(mutated((json) => ((nodesOf(json)[3] as Json)['scale'] = [2, 2.00001, 2])))).toEqual([]);
  });

  it('vrm.extensions-required: only KHR_materials_unlit and KHR_texture_transform', () => {
    expect(vrmIssues(mutated((json) => (json['extensionsRequired'] = ['KHR_materials_unlit'])))).toEqual([]);
    const draco = mutated((json) => (json['extensionsRequired'] = ['KHR_draco_mesh_compression']));
    expect(only(draco)).toEqual({
      code: 'vrm.extensions-required',
      message:
        'Required extension KHR_draco_mesh_compression is unsupported by the current renderer; use a compatible export or a renderer adapter that implements this extension',
    });
  });

  it('vrm.bones-skinned: a mapped bone outside the skin, no skin, a bone not under scene 0', () => {
    const unweighted = mutated(
      (json) => (json['skins'] = [{ joints: BONES_V1.map((_, i) => i).filter((i) => i !== 2) }]),
    );
    expect(only(unweighted)).toEqual({
      code: 'vrm.bones-skinned',
      message: 'VRM bone head is not a skin joint in scene 0; unweighted humanoid nodes are unsupported',
    });
    const noSkin = mutated((json) => {
      delete json['skins'];
      delete (nodesOf(json)[15] as Json)['skin'];
    });
    expect(only(noSkin)).toEqual({
      code: 'vrm.bones-skinned',
      message: 'VRM runtime requires a skinned humanoid mesh',
    });
    const offScene = mutated((json) => (json['scenes'] = [{ nodes: [15] }]));
    expect(vrmIssues(offScene).map((i) => i.message)).toContain('VRM bone hips is not instantiated in scene 0');
    expect(codesOf(vrmIssues(offScene))).toEqual(['vrm.bones-skinned']);
  });

  it('every runtime rule has a fixture above, and every rule is in the rule table', () => {
    const ids = LINT_RULES.map((rule) => rule.id);
    for (const rule of VRM_LINT_RULES) expect(ids).toContain(rule.id);
    expect(VRM_RUNTIME_RULE_IDS).toHaveLength(16);
  });
});

describe('the VRM 1.0 meta rows', () => {
  it('vrm.meta-required: a name and at least one author', () => {
    expect(only(mutated(() => {}, { meta: { authors: [] } }))).toEqual({
      code: 'vrm.meta-required',
      message: 'The VRM meta needs at least one author',
    });
    expect(only(mutated(() => {}, { meta: { name: ' ' } })).code).toBe('vrm.meta-required');
  });

  it('vrm.licence-unset: a licenseUrl', () => {
    expect(only(mutated(() => {}, { meta: { licenseUrl: '' } })).code).toBe('vrm.licence-unset');
  });

  it('vrm.thumbnail-square: present and square (a warning)', () => {
    const missing = vrmIssues(mutated(() => {}, { thumbnail: null }));
    expect(missing.map((i) => [i.code, i.severity])).toEqual([['vrm.thumbnail-square', 'warning']]);
    const wide = vrmIssues(mutated(() => {}, { thumbnail: { width: 16, height: 8 } }));
    expect(wide.map((i) => i.message)).toEqual(['The thumbnail is 16 × 8; it must be square']);
  });

  it('a missing meta fails all three; a VRM 0.x meta is never judged (asset bakes keep the asset meta)', () => {
    expect(codesOf(vrmIssues(mutated(() => {}, { meta: null })))).toEqual([...VRM_META_RULE_IDS].sort());
    const v0 = mutated((json) => delete ((json['extensions'] as Json)['VRM'] as Json)['meta'], { version: 'vrm0' });
    expect(vrmIssues(v0)).toEqual([]);
  });
});

describe('severities per profile and when the rules run', () => {
  const broken = mutated((json) => (json['extensionsRequired'] = ['KHR_draco_mesh_compression']), { meta: null });

  it('errors for the Space profile, warnings for local/generic, absent for the other Ekza profiles', () => {
    expect(ruleSeverity('vrm.extensions-required', SPACE)).toBe('error');
    expect(ruleSeverity('vrm.extensions-required', LOCAL)).toBe('warning');
    expect(ruleSeverity('vrm.extensions-required', OMOBA_GLB)).toBeNull();
    expect(ruleSeverity('vrm.meta-required', SPACE)).toBe('error');
    expect(ruleSeverity('vrm.thumbnail-square', SPACE)).toBe('warning');
    expect(ruleSeverity('vrm.meta-required', LOCAL)).toBeNull();
    expect(SPACE.jsonMaxBytes).toBe(4 * 1_048_576);
    expect(SPACE.label).toBe('Ekza avatar — Space and OMOBA (VRM 1.0)');
  });

  it('lintExport runs them on VRM files with a profile and on any file for the Space profile', async () => {
    const vrmRows = (issues: readonly { code: string; severity: string }[]) =>
      issues.filter((i) => i.code.startsWith('vrm.')).map((i) => `${i.code}:${i.severity}`);
    expect(vrmRows(await lintExport('bake-into-model', broken, SPACE))).toEqual([
      'vrm.extensions-required:error',
      'vrm.meta-required:error',
      'vrm.licence-unset:error',
      'vrm.thumbnail-square:warning',
    ]);
    expect(vrmRows(await lintExport('bake-into-model', broken, LOCAL))).toEqual(['vrm.extensions-required:warning']);
    expect(vrmRows(await lintExport('bake-into-model', broken, OMOBA_GLB))).toEqual([]);
    // No profile: the generic lints only.
    expect(vrmRows(await lintExport('bake-into-model', broken, null))).toEqual([]);
    // A plain GLB: none through local/generic; vrm.spec-version through the Space profile.
    const plain = mutated((json) => {
      delete json['extensions'];
      delete json['extensionsUsed'];
    });
    expect(vrmRows(await lintExport('bake-into-model', plain, LOCAL))).toEqual([]);
    expect(vrmRows(await lintExport('bake-into-model', plain, SPACE))).toEqual(['vrm.spec-version:error']);
    // VRMA files never get them.
    expect(vrmRows(await lintExport('vrma', broken, SPACE))).toEqual([]);
  });
});
