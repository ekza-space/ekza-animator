import { type LicensedFixture, readFixture } from '@ekza-animator/doc/testing';
import { describe, expect, it } from 'vitest';
import { checkInputBudget, MAX_BUDGET_ISSUES } from '../src/budget/check';
import { parseGlb } from '../src/glb/parse';
import { GltfBuilder, makeBudgetStressGlb, makeGlb, makeHostileGlb } from '../src/testing/glb';
import { DEFAULT_INPUT_BUDGET, type LintIssue } from '../src/types';

const errors = (issues: readonly LintIssue[]): LintIssue[] => issues.filter((i) => i.severity === 'error');

describe('checkInputBudget', () => {
  it.each<LicensedFixture>(['seed-san.vrm', 'polybot.vrm', 'quaternius-ual.glb', 'quaternius-idle-meshopt.glb'])(
    'passes %s',
    async (name) => {
      const issues = checkInputBudget(await parseGlb(readFixture(name)));
      expect(errors(issues)).toEqual([]);
    },
  );

  it('passes a 300k-vertex VRM-like file with 60 morph targets on a 20k-vertex face mesh', async () => {
    const c = await parseGlb(makeBudgetStressGlb());
    const accessors = c.json['accessors'] as { count: number }[];
    const vertices = accessors.filter((_, i) => i >= 0).reduce((max, a) => Math.max(max, a.count), 0);
    expect(vertices).toBeGreaterThanOrEqual(280_000 * 3);
    const meshes = c.json['meshes'] as { primitives: { targets?: unknown[] }[] }[];
    expect(meshes[1]?.primitives[0]?.targets).toHaveLength(60);
    expect(errors(checkInputBudget(c))).toEqual([]);
  });

  it('rejects an out-of-range bufferView, a 2^31 count and a node cycle, each on its own', async () => {
    const view = errors(checkInputBudget(await parseGlb(makeHostileGlb(['view-out-of-range']))));
    expect(view.map((i) => i.code)).toContain('malformed-gltf');
    expect(view.some((i) => i.pointer?.startsWith('/bufferViews/'))).toBe(true);

    const count = errors(checkInputBudget(await parseGlb(makeHostileGlb(['huge-count']))));
    expect(count.some((i) => i.code === 'budget-exceeded' && i.pointer?.endsWith('/count'))).toBe(true);
    expect(count.some((i) => i.code === 'malformed-gltf')).toBe(true);

    const cycle = errors(checkInputBudget(await parseGlb(makeHostileGlb(['cyclic-nodes']))));
    expect(cycle.some((i) => i.code === 'malformed-gltf' && /cycle|more than one parent/.test(i.message))).toBe(true);

    const all = errors(
      checkInputBudget(await parseGlb(makeHostileGlb(['view-out-of-range', 'huge-count', 'cyclic-nodes']))),
    );
    expect(new Set(all.map((i) => i.code))).toEqual(new Set(['malformed-gltf', 'budget-exceeded']));
  });

  it('enforces every budget of the given limits', async () => {
    const c = await parseGlb(readFixture('polybot.vrm'));
    const tiny = {
      maxFileBytes: 100,
      maxJsonBytes: 100,
      maxTotalAccessorCount: 10,
      maxAccessorCount: 5,
      maxDecodedBytes: 10,
      maxNodes: 3,
    };
    const issues = errors(checkInputBudget(c, tiny));
    expect(issues.every((i) => i.code === 'budget-exceeded')).toBe(true);
    const messages = issues.map((i) => i.message).join('\n');
    for (const fragment of ['The file is', 'JSON chunk', 'nodes', 'accessors[', 'in total', 'Decoding']) {
      expect(messages).toContain(fragment);
    }
    expect(DEFAULT_INPUT_BUDGET.maxNodes).toBe(65_536);
  });

  it('checks GLB layout, buffers, views, accessors, sparse indices, meshes, skins, nodes and animations', async () => {
    const b = new GltfBuilder();
    const json = b.json as Record<string, unknown>;
    const pos = b.accessor(new Float32Array(9), 'VEC3', { minMax: true });
    const times = b.accessor(new Float32Array([0, 1]), 'SCALAR', { minMax: true });
    const values = b.accessor(new Float32Array(6), 'VEC3');
    const idx = b.view(new Uint8Array(new Uint16Array([0, 7]).buffer));
    const vals = b.view(new Uint8Array(new Float32Array(6).buffer));
    b.json.accessors.push({
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      sparse: { count: 2, indices: { bufferView: idx, componentType: 5123 }, values: { bufferView: vals } },
    });
    json['meshes'] = [{ primitives: [{ attributes: { POSITION: pos, NORMAL: 99 }, material: 3 }] }];
    json['skins'] = [{ joints: [0, 42] }];
    json['nodes'] = [{ children: [1, 1] }, { mesh: 5 }];
    json['scenes'] = [{ nodes: [0, 9] }];
    json['scene'] = 4;
    json['animations'] = [
      {
        samplers: [
          { input: times, output: values, interpolation: 'BOUNCE' },
          { input: times, output: 77 },
        ],
        channels: [{ sampler: 3, target: { node: 12, path: 'rotation' } }],
      },
    ];
    const issues = errors(checkInputBudget(await parseGlb(b.build())));
    const pointers = issues.map((i) => i.pointer ?? '');
    expect(pointers).toEqual(
      expect.arrayContaining([
        '/accessors/3/sparse/indices',
        '/nodes/0/children',
        '/nodes/1/mesh',
        '/scenes/0/nodes',
        '/scene',
        '/meshes/0/primitives/0/attributes',
        '/meshes/0/primitives/0/material',
        '/skins/0/joints',
        '/animations/0/samplers/0/interpolation',
        '/animations/0/samplers/1',
        '/animations/0/channels/0/sampler',
        '/animations/0/channels/0/target/node',
      ]),
    );
  });

  it('reports header, chunk and buffer inconsistencies', async () => {
    const bytes = makeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 64 }] }, new Uint8Array(8));
    const issues = checkInputBudget(await parseGlb(bytes));
    expect(errors(issues).some((i) => i.pointer === '/buffers/0/byteLength')).toBe(true);

    const extra = new Uint8Array(bytes.length + 4);
    extra.set(bytes);
    const tail = checkInputBudget(await parseGlb(extra));
    expect(
      errors(tail)
        .map((i) => i.message)
        .join(),
    ).toMatch(/header declares/);

    const external = makeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4, uri: 'model.bin' }] }, null);
    expect(errors(checkInputBudget(await parseGlb(external)))[0]?.pointer).toBe('/buffers/0/uri');
  });

  it('caps the number of reported issues', async () => {
    const b = new GltfBuilder();
    for (let i = 0; i < MAX_BUDGET_ISSUES + 50; i++)
      b.json.accessors.push({ bufferView: 999, componentType: 5126, count: 1, type: 'SCALAR' });
    const issues = checkInputBudget(await parseGlb(b.build()));
    expect(issues).toHaveLength(MAX_BUDGET_ISSUES + 1);
    expect(issues.at(-1)?.message).toMatch(/more issues/);
  });
});
