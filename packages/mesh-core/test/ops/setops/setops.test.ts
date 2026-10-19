// M6A-SPEC §5.13 MeshSetOps (B4): Combine (pivots, material union, the mirrored-duplicate golden with reversed winding,
// Merge by Distance through B3 when READY.b3), Separate (shells), Extract and Duplicate Faces (separate or in place,
// offset), refusals (palettes, skeletons, asset-backed inputs, one shell, all faces), and the runner contract: the op
// runs inside transactions the caller aborts, so inputs are unchanged and every output is a valid stored mesh — on
// fixed cases and as a property over random primitives and soups, face sets, offsets and placements (det < 0 included):
// faces are conserved and the closed volumes of Combine's inputs add up.
import type { ParamValues, ReadonlyXf } from '@ekza-animator/anim-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  type ComponentSelection,
  type EditMesh,
  editMeshFrom,
  isRefusal,
  MESH_OPS,
  MESH_SET_OPS,
  type MeshData,
  type MeshSetInput,
  type MeshSetOp,
  type MeshSetResult,
  morphLayer,
  primitive,
  selectionOf,
  topologyStats,
  validateMesh,
} from '../../../src';
import { removeFaces } from '../../../src/subset/setops';
import { scopeFaces } from '../../../src/subset/support';
import { arbPrimitive, arbSoup, buildMeshData, diffStored, signedVolume, vef } from '../../../src/testing';
import { READY } from '../../ready';
import { context, facesWhere, position } from '../harness';

const IDENTITY: ReadonlyXf = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
const set = (id: string): MeshSetOp => MESH_SET_OPS[id] as MeshSetOp;

interface Input {
  readonly key: string;
  readonly mesh: EditMesh;
  readonly selection?: ComponentSelection | null;
  readonly placement?: ReadonlyXf;
  readonly palette?: string | null;
  readonly skeleton?: string | null;
  readonly assetBacked?: boolean;
  readonly materials?: readonly string[];
}

/** Runs a set-op the way the B7 runner does: transactions opened on every input and aborted afterwards. */
function runSet(
  op: MeshSetOp,
  list: readonly Input[],
  args: ParamValues = {},
): MeshSetResult | ReturnType<typeof isRefusal> | never {
  const inputs: MeshSetInput[] = list.map((i) => ({
    key: i.key,
    mesh: i.mesh,
    selection: i.selection ?? null,
    placement: i.placement ?? IDENTITY,
    palette: i.palette ?? null,
    skeleton: i.skeleton ?? null,
    assetBacked: i.assetBacked ?? false,
    materials: i.materials ?? ['preset:unlit'],
  }));
  const before = inputs.map((i) => i.mesh.snapshot());
  const verdict = op.poll(inputs, args);
  for (const input of inputs) input.mesh.begin(op.id);
  let result;
  try {
    result = op.run(inputs, args, { hidden: null, faceted: true, curves: context().curves, epsilon: 1e-9 });
  } finally {
    for (const input of inputs) input.mesh.abort();
  }
  inputs.forEach((input, i) => expect(diffStored(input.mesh, before[i] as MeshData)).toBeNull());
  // poll and run agree: a refusal of the run is the poll's (menus disable what would refuse).
  expect(verdict === true ? null : verdict.code).toBe(isRefusal(result) ? result.code : null);
  const outputs = isRefusal(result) ? [] : result.outputs;
  for (const output of outputs) {
    expect(validateMesh(output.data)).toEqual([]);
    expect(editMeshFrom(output.data).counts).toEqual(output.data.counts);
    expect(output.selection?.faces.size ?? output.data.counts.faces).toBe(output.data.counts.faces);
  }
  return result as never;
}

function ok(result: unknown): MeshSetResult {
  if (isRefusal(result)) throw new Error(`refused: ${result.code} — ${result.reason}`);
  return result as MeshSetResult;
}

function code(result: unknown): string {
  if (!isRefusal(result)) throw new Error('ran; a refusal was expected');
  return result.code;
}

const cube = () => editMeshFrom(primitive('cube', {}));
const at = (x: number, y = 0, z = 0): ReadonlyXf => ({ t: [x, y, z], q: [0, 0, 0, 1], s: [1, 1, 1] });

/** The golden's input: a half cube spanning x ∈ [0, 1] (the −X face removed: an open box facing −X). */
function halfCube(): EditMesh {
  const m = editMeshFrom(primitive('cube', {}));
  m.begin('half');
  removeFaces(
    m,
    facesWhere(m, (c) => c[0] === -0.5),
  );
  for (let v = 0; v < m.counts.points; v++) {
    const p = position(m, v);
    m.setPosition(v, p[0] + 0.5, p[1], p[2]);
  }
  m.end();
  return m;
}

/** The golden: a half cube Combined with its X −1 duplicate (the mirrored placement reverses its winding). */
function combinedHalves(): MeshData {
  return (
    ok(
      runSet(set('mesh.combine'), [
        { key: 'a', mesh: halfCube() },
        { key: 'b', mesh: halfCube(), placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [-1, 1, 1] } },
      ]),
    ).outputs[0] as { data: MeshData }
  ).data;
}

describe('mesh.combine', () => {
  it('two cubes → one 16/24/12 mesh at the centre of their bounds; the second input is removed', () => {
    const result = ok(
      runSet(set('mesh.combine'), [
        { key: 'a', mesh: cube(), placement: at(-1) },
        { key: 'b', mesh: cube(), placement: at(3), materials: ['preset:lit'] },
      ]),
    );
    expect(result.removed).toEqual(['b']);
    expect(result.outputs).toHaveLength(1);
    const out = result.outputs[0] as (typeof result.outputs)[number];
    expect(out.key).toBe('a');
    expect(out.from).toEqual(['a', 'b']);
    expect(vef(out.data)).toBe('16/24/12');
    expect(out.placement.t).toEqual([1, 0, 0]);
    // World positions are kept: local = world − centre.
    const xs = Array.from({ length: 16 }, (_, v) => position(out.data, v)[0]).sort((p, q) => p - q);
    expect(xs[0]).toBe(-2.5);
    expect(xs[15]).toBe(2.5);
    // Material slots unite by identity key.
    expect(out.materials).toEqual(['preset:unlit', 'preset:lit']);
    const slots = new Set(Array.from(out.data.faceMaterial));
    expect([...slots].sort((x, y) => x - y)).toEqual([0, 1]);
    expect(signedVolume(out.data)).toBeCloseTo(2, 6);
  });

  it('pivot first keeps the lead untouched; origin is identity', () => {
    const lead = cube();
    const leadData = lead.snapshot();
    const first = ok(
      runSet(
        set('mesh.combine'),
        [
          { key: 'a', mesh: lead, placement: at(5) },
          { key: 'b', mesh: cube(), placement: at(7) },
        ],
        { pivot: 'first' },
      ),
    ).outputs[0];
    expect(first?.placement.t).toEqual([5, 0, 0]);
    expect(Array.from(first?.data.position.subarray(0, 24) ?? [])).toEqual(Array.from(leadData.position));
    const origin = ok(
      runSet(
        set('mesh.combine'),
        [
          { key: 'a', mesh: cube(), placement: at(5) },
          { key: 'b', mesh: cube(), placement: at(7) },
        ],
        { pivot: 'origin' },
      ),
    ).outputs[0];
    expect(origin?.placement.t).toEqual([0, 0, 0]);
    expect(position(origin?.data as MeshData, 0)[0]).toBe(4.5);
  });

  it('golden: a half cube and its X −1 duplicate combine with reversed winding (16/24/10, outward)', () => {
    const golden = combinedHalves();
    expect(vef(golden)).toBe('16/24/10');
    // Both halves face outward: the unwelded surface encloses the 2 × 1 × 1 box positively.
    expect(signedVolume(golden)).toBeCloseTo(2, 6);
  });

  it.skipIf(!READY.b3)('golden, then Merge by Distance (B3): 12/20/10, closed, consistent winding', () => {
    const m = editMeshFrom(combinedHalves());
    const merge = MESH_OPS['mesh.mergeByDistance'] as NonNullable<(typeof MESH_OPS)[string]>;
    m.begin('merge');
    const merged = merge.run(m, null, { distance: 0.001 }, context());
    m.end();
    expect(isRefusal(merged)).toBe(false);
    expect(vef(m)).toBe('12/20/10');
    expect(topologyStats(m).boundaryLoops).toBe(0);
    expect(signedVolume(m)).toBeCloseTo(2, 6);
  });

  it('unites morph layers in the lead’s order (missing deltas zero) and refuses mismatches', () => {
    const a = cube();
    a.begin('morph');
    a.addLayer(morphLayer('smile'));
    a.end();
    const b = cube();
    b.begin('morph');
    const blink = b.addLayer(morphLayer('blink'));
    blink.set(0, 1, 0.5);
    b.end();
    const out = ok(
      runSet(set('mesh.combine'), [
        { key: 'a', mesh: a },
        { key: 'b', mesh: b },
      ]),
    ).outputs[0] as { data: MeshData };
    expect([...out.data.layers.keys()].filter((name) => name.startsWith('morph:'))).toEqual([
      'morph:smile',
      'morph:blink',
    ]);
    expect(out.data.layers.get('morph:blink')?.data[8 * 3 + 1]).toBe(0.5);
    expect(out.data.layers.get('morph:blink')?.data[1]).toBe(0);
    expect(code(runSet(set('mesh.combine'), [{ key: 'a', mesh: cube() }]))).toBe('combine.needs-two');
    expect(
      code(
        runSet(set('mesh.combine'), [
          { key: 'a', mesh: cube(), palette: 'p1' },
          { key: 'b', mesh: cube(), palette: 'p2' },
        ]),
      ),
    ).toBe('combine.palette-mismatch');
    ok(
      runSet(set('mesh.combine'), [
        { key: 'a', mesh: cube(), palette: 'p1' },
        { key: 'b', mesh: cube() },
      ]),
    );
    expect(
      code(
        runSet(set('mesh.combine'), [
          { key: 'a', mesh: cube(), skeleton: 's1' },
          { key: 'b', mesh: cube() },
        ]),
      ),
    ).toBe('combine.skeleton-mismatch');
    expect(
      code(
        runSet(set('mesh.combine'), [
          { key: 'a', mesh: cube(), assetBacked: true },
          { key: 'b', mesh: cube() },
        ]),
      ),
    ).toBe('combine.asset-backed');
  });
});

describe('mesh.separate', () => {
  it('one output per shell: the first stays, the others are new records', () => {
    const both = ok(
      runSet(set('mesh.combine'), [
        { key: 'a', mesh: cube() },
        { key: 'b', mesh: editMeshFrom(primitive('cylinder', {})), placement: at(3) },
      ]),
    ).outputs[0] as { data: MeshData };
    const result = ok(runSet(set('mesh.separate'), [{ key: 'm', mesh: editMeshFrom(both.data), placement: at(1) }]));
    expect(result.outputs.map((o) => [o.key, vef(o.data)])).toEqual([
      ['m', '8/12/6'],
      ['new:0', '16/24/10'],
    ]);
    expect(result.outputs.every((o) => o.placement.t[0] === 1)).toBe(true);
    expect(code(runSet(set('mesh.separate'), [{ key: 'm', mesh: cube() }]))).toBe('separate.single-shell');
    expect(code(runSet(set('mesh.separate'), [{ key: 'm', mesh: cube(), assetBacked: true }]))).toBe(
      'separate.asset-backed',
    );
  });
});

describe('mesh.extract / mesh.duplicateFaces', () => {
  const top = (m: EditMesh) => facesWhere(m, (c) => c[1] === 0.5);

  it('extract (separate): the input loses the face, a new record holds it; offset insets its boundary', () => {
    const m = cube();
    const result = ok(
      runSet(set('mesh.extract'), [{ key: 'm', mesh: m, selection: selectionOf('face', top(m), m.counts) }], {
        offset: 0.1,
      }),
    );
    expect(result.outputs.map((o) => [o.key, vef(o.data)])).toEqual([
      ['m', '8/12/5'],
      ['new:0', '4/4/1'],
    ]);
    const shell = (result.outputs[1] as { data: MeshData }).data;
    for (let v = 0; v < 4; v++) {
      const p = position(shell, v);
      expect(Math.abs(p[0])).toBeCloseTo(0.4, 6);
      expect(Math.abs(p[2])).toBeCloseTo(0.4, 6);
      expect(p[1]).toBe(0.5);
    }
  });

  it('extract in place: the faces become their own shell and the new selection (12/16/6)', () => {
    const m = cube();
    const result = ok(
      runSet(set('mesh.extract'), [{ key: 'm', mesh: m, selection: selectionOf('face', top(m), m.counts) }], {
        separate: false,
      }),
    );
    expect(result.outputs).toHaveLength(1);
    const out = result.outputs[0] as (typeof result.outputs)[number];
    expect(vef(out.data)).toBe('12/16/6');
    expect(topologyStats(out.data).shells).toBe(2);
    expect(out.selection?.faces.toArray()).toEqual(Uint32Array.of(5));
  });

  it('extract refuses all faces with separate, no faces and asset-backed meshes', () => {
    const m = cube();
    expect(
      code(
        runSet(set('mesh.extract'), [
          { key: 'm', mesh: m, selection: selectionOf('face', [0, 1, 2, 3, 4, 5], m.counts) },
        ]),
      ),
    ).toBe('extract.all-faces');
    expect(
      code(runSet(set('mesh.extract'), [{ key: 'm', mesh: m, selection: selectionOf('face', [], m.counts) }])),
    ).toBe('extract.no-faces');
    expect(
      code(
        runSet(set('mesh.extract'), [
          { key: 'm', mesh: m, assetBacked: true, selection: selectionOf('face', [0], m.counts) },
        ]),
      ),
    ).toBe('extract.asset-backed');
    // A second input without faces (nothing to give up) does not count as "all faces".
    const empty = editMeshFrom(buildMeshData({ positions: [0, 0, 0], faces: [] }));
    const both = ok(
      runSet(set('mesh.extract'), [
        { key: 'm', mesh: cube(), selection: selectionOf('face', [0], m.counts) },
        { key: 'e', mesh: empty, selection: selectionOf('face', [], empty.counts) },
      ]),
    );
    expect(both.outputs.map((o) => [o.key, vef(o.data)])).toEqual([
      ['m', '8/12/5'],
      ['new:0', '4/4/1'],
    ]);
  });

  it('duplicate faces: a new record (input unchanged) or a new shell in place', () => {
    const m = cube();
    const sel = selectionOf('face', top(m), m.counts);
    const copy = ok(runSet(set('mesh.duplicateFaces'), [{ key: 'm', mesh: m, selection: sel }]));
    expect(copy.outputs.map((o) => [o.key, vef(o.data)])).toEqual([['new:0', '4/4/1']]);
    const inPlace = ok(
      runSet(set('mesh.duplicateFaces'), [{ key: 'm', mesh: m, selection: sel }], { separate: false }),
    );
    expect(inPlace.outputs.map((o) => [o.key, vef(o.data)])).toEqual([['m', '12/16/7']]);
  });

  it('duplicate faces of an asset-backed mesh: a static copy without skin and morphs; in place refused', () => {
    const m = cube();
    m.begin('skin');
    m.addLayer(BUILTIN_LAYERS.skinJoints);
    m.addLayer(BUILTIN_LAYERS.skinWeights);
    m.addLayer(morphLayer('blink'));
    m.end();
    const sel = selectionOf('face', [0], m.counts);
    const result = ok(runSet(set('mesh.duplicateFaces'), [{ key: 'm', mesh: m, selection: sel, assetBacked: true }]));
    expect(result.warnings.map((w) => w.code)).toEqual(['duplicate.static-copy']);
    const layers = [...(result.outputs[0] as { data: MeshData }).data.layers.keys()];
    expect(layers.some((name) => name.startsWith('skin.') || name.startsWith('morph:'))).toBe(false);
    expect(layers).toContain('uv0');
    expect(
      code(
        runSet(set('mesh.duplicateFaces'), [{ key: 'm', mesh: m, selection: sel, assetBacked: true }], {
          separate: false,
        }),
      ),
    ).toBe('duplicate.asset-backed');
  });
});

describe('MeshSetOps property (random inputs)', () => {
  const tenths = (min: number, max: number) => fc.integer({ min, max }).map((x) => x / 10);
  const arbScale = fc.tuple(tenths(5, 20), fc.boolean()).map(([x, negative]) => (negative ? -x : x));
  const arbPlacement: fc.Arbitrary<ReadonlyXf> = fc.record({
    t: fc.tuple(tenths(-30, 30), tenths(-30, 30), tenths(-30, 30)),
    q: fc
      .tuple(tenths(-10, 10), tenths(-10, 10), tenths(-10, 10), tenths(-10, 10))
      .filter((q) => Math.hypot(...q) > 0.2)
      .map((q) => {
        const n = Math.hypot(...q);
        return [q[0] / n, q[1] / n, q[2] / n, q[3] / n] as [number, number, number, number];
      }),
    s: fc.tuple(arbScale, arbScale, arbScale),
  });
  const arbData = fc.oneof(
    arbPrimitive().map(({ kind, params }) => primitive(kind, params)),
    arbSoup(),
  );
  const arbInput = fc.record({
    data: arbData,
    kind: fc.constantFrom('vertex', 'edge', 'face', 'none'),
    picks: fc.array(fc.nat(), { maxLength: 8 }),
    placement: arbPlacement,
  });
  const arbCase = fc.record({
    op: fc.constantFrom('mesh.combine', 'mesh.separate', 'mesh.extract', 'mesh.duplicateFaces'),
    inputs: fc.array(arbInput, { minLength: 1, maxLength: 3 }),
    separate: fc.boolean(),
    offset: fc.constantFrom(0, 0, 0.05, 0.3, 2),
    pivot: fc.constantFrom('center', 'first', 'origin'),
  });

  const det = (xf: ReadonlyXf) => xf.s[0] * xf.s[1] * xf.s[2];
  const closed = (m: EditMesh) => {
    const stats = topologyStats(m);
    return (
      m.counts.faces > 0 && stats.boundaryLoops === 0 && stats.nonManifoldEdges === 0 && stats.nonManifoldVerts === 0
    );
  };

  type Case = typeof arbCase extends fc.Arbitrary<infer T> ? T : never;

  /** Runs one case through `runSet` (inputs bit-identical after the abort, poll = run, valid outputs) and checks face
   *  conservation and, for a Combine of closed meshes, the volume. */
  function checkCase(c: Case): 'refused' | 'ran' | 'volume' {
    const list: Input[] = c.inputs.map((input, i) => {
      const mesh = editMeshFrom(input.data);
      const counts = mesh.counts;
      const n = input.kind === 'vertex' ? counts.points : input.kind === 'edge' ? counts.edges : counts.faces;
      const selection =
        input.kind === 'none' || n === 0
          ? null
          : selectionOf(
              input.kind,
              input.picks.map((p) => p % n),
              counts,
            );
      return { key: `k${i}`, mesh, selection, placement: input.placement };
    });
    const faces = list.map((input) => input.mesh.counts.faces);
    const picked = list.map((input) =>
      input.selection === null || input.selection === undefined
        ? 0
        : scopeFaces(input.mesh, input.selection, null).length,
    );
    const volume = list.map((input) => (closed(input.mesh) ? signedVolume(input.mesh) : null));
    const args: ParamValues = c.op === 'mesh.combine' ? { pivot: c.pivot } : { separate: c.separate, offset: c.offset };
    // runSet: inputs bit-identical after the abort, poll = run, every output valid.
    const result = runSet(set(c.op), list, args);
    if (isRefusal(result)) return 'refused';
    const { outputs } = result as MeshSetResult;
    const total = outputs.reduce((sum, o) => sum + o.data.counts.faces, 0);
    const sum = (pick: (i: number) => number) => list.reduce((acc, _, i) => acc + pick(i), 0);
    const touched = (i: number) => (picked[i] as number) > 0;
    const expected =
      c.op === 'mesh.combine'
        ? sum((i) => faces[i] as number)
        : c.op === 'mesh.separate'
          ? sum((i) => (outputs.some((o) => o.from[0] === `k${i}`) ? (faces[i] as number) : 0))
          : c.op === 'mesh.extract'
            ? sum((i) => (touched(i) ? (faces[i] as number) : 0))
            : c.separate
              ? sum((i) => picked[i] as number)
              : sum((i) => (touched(i) ? (faces[i] as number) + (picked[i] as number) : 0));
    expect([c.op, total]).toEqual([c.op, expected]);
    // Combine of closed inputs: the volumes add up (transformed by each placement, reversed when det < 0).
    const closedCombine = c.op === 'mesh.combine' && volume.every((v) => v !== null);
    const out = outputs[0] as (typeof outputs)[number];
    const want = closedCombine
      ? sum((i) => Math.abs(det(list[i]?.placement ?? IDENTITY)) * (volume[i] as number)) / Math.abs(det(out.placement))
      : 0;
    const got = closedCombine ? signedVolume(out.data) : 0;
    expect([c.op, Math.abs(got - want) / Math.max(1, Math.abs(want)) < 1e-4]).toEqual([c.op, true]);
    return closedCombine ? 'volume' : 'ran';
  }

  it('valid outputs, inputs unchanged, poll = run, faces conserved, Combine adds closed volumes', () => {
    const seen = { refused: 0, ran: 0, volume: 0 };
    fc.assert(
      fc.property(arbCase, (c) => {
        seen[checkCase(c)]++;
      }),
      { numRuns: 400, seed: 41 },
    );
    expect(seen.ran + seen.volume).toBeGreaterThan(150);
  });

  it('Combine of closed primitives under random placements (det < 0 included) adds their volumes', () => {
    const arbClosed = fc
      .constantFrom('cube', 'sphere', 'cylinder', 'cone', 'torus')
      .chain((kind) => arbPrimitive().filter((p) => p.kind === kind))
      .map(({ kind, params }) => primitive(kind, params));
    const arbCombine = fc.record({
      op: fc.constant('mesh.combine' as const),
      inputs: fc.array(
        fc.record({
          data: arbClosed,
          kind: fc.constant('none' as const),
          picks: fc.constant<number[]>([]),
          placement: arbPlacement,
        }),
        { minLength: 2, maxLength: 3 },
      ),
      separate: fc.constant(true),
      offset: fc.constant(0),
      pivot: fc.constantFrom('center', 'first', 'origin'),
    });
    let volumes = 0;
    fc.assert(
      fc.property(arbCombine, (c) => {
        if (checkCase(c) === 'volume') volumes++;
      }),
      { numRuns: 150, seed: 42 },
    );
    expect(volumes).toBe(150);
  });
});
