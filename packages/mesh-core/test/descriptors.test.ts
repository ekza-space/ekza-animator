// M6A-SPEC §6.1, §6.3, §3 rules 1–2 and §2 (B0a): every kernel op has its final descriptor (id, label, kinds, params,
// flags, symmetry class) in `ops/<dir>/descriptor.ts`, checked against a hand transcription of the §6.1 table; every
// param list passes `assertParams`; `MESH_OPS`/`MESH_SET_OPS` hold a stub object per descriptor whose `run` refuses
// `not-implemented`; the eager descriptors barrel carries no kernel code (no kernel marker in its module graph).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertParams, coerceArgs, type ParamDef, paramDefaults, primaryParam } from '@ekza-animator/anim-core';
import { describe, expect, it } from 'vitest';
import {
  MAYA_PRIMITIVE_DEFAULTS,
  MESH_OP_DESCRIPTORS,
  MESH_SET_OP_DESCRIPTORS,
  PRIMITIVE_PARAMS,
} from '../src/descriptors';
import { emptyMesh, isRefusal, KERNEL_MARKER, MESH_OPS, MESH_SET_OPS } from '../src';
import { SPEC_6_1 } from './fixtures/spec-6-1';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

const shape = (params: readonly ParamDef[]) =>
  params.map((param) => ({
    name: param.name,
    kind: param.kind,
    ...(param.primary === true ? { primary: true } : {}),
    ...(param.bound === 'value' ? {} : { bound: param.bound }),
  }));

describe('§6.1 operator table', () => {
  it('has exactly the rows of the spec, MeshOps and set-ops apart', () => {
    expect(Object.keys(MESH_OP_DESCRIPTORS).sort()).toEqual(
      SPEC_6_1.filter((row) => row.setOp !== true)
        .map((row) => row.id)
        .sort(),
    );
    expect(Object.keys(MESH_SET_OP_DESCRIPTORS).sort()).toEqual(
      SPEC_6_1.filter((row) => row.setOp === true)
        .map((row) => row.id)
        .sort(),
    );
  });

  it.each(SPEC_6_1.filter((row) => row.setOp !== true).map((row) => [row.id, row] as const))(
    '%s matches its §6.1 row',
    (id, row) => {
      const desc = MESH_OP_DESCRIPTORS[id];
      expect({
        label: desc?.label,
        AR: [desc?.flags.adjustable, desc?.flags.repeatable],
        params: shape(desc?.params ?? []),
        kinds: desc?.kinds,
        symmetry: desc?.symmetry,
        whole: desc?.flags.whole === true,
      }).toEqual({
        label: row.label,
        AR: [row.A, row.R],
        params: row.params,
        kinds: row.modes,
        symmetry: row.sym,
        whole: row.modes === 'object',
      });
      // The descriptor lives in the §6.1 Kernel directory.
      expect(readFileSync(join(SRC, 'ops', row.dir, 'descriptor.ts'), 'utf8')).toContain(`id: '${id}'`);
    },
  );

  it.each(SPEC_6_1.filter((row) => row.setOp === true).map((row) => [row.id, row] as const))(
    '%s (set-op) matches its §6.1 row',
    (id, row) => {
      const desc = MESH_SET_OP_DESCRIPTORS[id];
      expect({
        label: desc?.label,
        AR: [desc?.flags.adjustable, desc?.flags.repeatable],
        params: shape(desc?.params ?? []),
        arity: desc?.arity,
      }).toEqual({
        label: row.label,
        AR: [row.A, row.R],
        params: row.params,
        arity: id === 'mesh.combine' ? 'many' : 'one',
      });
      expect(readFileSync(join(SRC, 'ops', row.dir, 'descriptor.ts'), 'utf8')).toContain(`id: '${id}'`);
    },
  );

  it('every param list passes assertParams; defaults coerce without problems; bound and data params are hidden', () => {
    const all = [...Object.values(MESH_OP_DESCRIPTORS), ...Object.values(MESH_SET_OP_DESCRIPTORS)];
    const problems: string[] = [];
    for (const desc of all) {
      try {
        assertParams(desc.params);
      } catch (error) {
        problems.push(`${desc.id}: ${String(error)}`);
      }
      for (const problem of coerceArgs(desc.params, paramDefaults(desc.params)).problems) {
        problems.push(`${desc.id}: ${problem}`);
      }
      for (const param of desc.params) {
        if ((param.bound !== 'value' || param.kind === 'data') && param.hidden !== true) {
          problems.push(`${desc.id}.${param.name} is not hidden`);
        }
      }
      // An op with a required pointer-bound param is never repeatable (§4.1 ParamBound 'pointer'); `mesh.paint`'s
      // `faces` is optional (null = the selection).
      const pointer = desc.params.some((param) => param.bound === 'pointer' && param.name !== 'faces');
      if (pointer && desc.flags.repeatable) problems.push(`${desc.id} is repeatable with a pointer-bound param`);
    }
    expect(problems).toEqual([]);
  });

  it('smoothingAngle is the nullable "auto" angle of every op that creates side or strip edges (§5.3)', () => {
    const params = ['mesh.extrude', 'mesh.inset', 'mesh.bevel', 'mesh.mirror'].map((id) =>
      MESH_OP_DESCRIPTORS[id]?.params.find((p) => p.name === 'smoothingAngle'),
    );
    for (const param of params) expect(param).toMatchObject({ kind: 'angle', default: null, nullable: true });
  });

  it('angles are stored in radians and fractions 0…1 (§1)', () => {
    expect(MESH_OP_DESCRIPTORS['mesh.quadrangulate']?.params[0]?.default).toBeCloseTo(Math.PI / 6, 15);
    expect(MESH_OP_DESCRIPTORS['mesh.setNormalAngle']?.params[0]).toMatchObject({ min: 0, max: Math.PI });
    const offset = MESH_OP_DESCRIPTORS['mesh.offsetLoop']?.params[0];
    expect(offset).toMatchObject({ kind: 'fraction', default: 0.25, min: 0.01, max: 0.49 });
    expect(MESH_OP_DESCRIPTORS['mesh.extrude']?.params.find((p) => p.name === 'divisions')).toMatchObject({
      min: 1,
      max: 32,
    });
  });
});

describe('§6.3 primitive parameters', () => {
  const PRIMARY: Readonly<Record<string, string>> = {
    cube: 'subdivisionsWidth',
    sphere: 'subdivisionsAxis',
    cylinder: 'subdivisionsAxis',
    cone: 'subdivisionsAxis',
    plane: 'subdivisionsWidth',
    torus: 'subdivisionsAxis',
    humanoidBody: 'height',
  };
  it.each(Object.entries(PRIMITIVE_PARAMS))('%s: valid list, primary and low-poly/Maya defaults', (kind, params) => {
    assertParams(params);
    expect(primaryParam(params)?.name).toBe(PRIMARY[kind]);
    expect(params.every((param) => param.bound === 'value')).toBe(true);
    const maya = MAYA_PRIMITIVE_DEFAULTS[kind as keyof typeof MAYA_PRIMITIVE_DEFAULTS];
    expect(Object.keys(maya)).toEqual(params.map((param) => param.name));
    expect(coerceArgs(params, maya).problems).toEqual([]);
  });
  it('has the §6.3 low-poly defaults', () => {
    expect(paramDefaults(PRIMITIVE_PARAMS.cube)).toEqual({
      width: 1,
      height: 1,
      depth: 1,
      subdivisionsWidth: 1,
      subdivisionsHeight: 1,
      subdivisionsDepth: 1,
    });
    expect(paramDefaults(PRIMITIVE_PARAMS.sphere)).toEqual({
      radius: 0.5,
      subdivisionsAxis: 12,
      subdivisionsHeight: 8,
    });
    expect(paramDefaults(PRIMITIVE_PARAMS.cylinder)).toEqual({
      radius: 0.5,
      height: 1,
      subdivisionsAxis: 8,
      subdivisionsHeight: 1,
      subdivisionsCaps: 0,
    });
    expect(paramDefaults(PRIMITIVE_PARAMS.plane)).toEqual({
      width: 1,
      height: 1,
      subdivisionsWidth: 1,
      subdivisionsHeight: 1,
    });
    expect(paramDefaults(PRIMITIVE_PARAMS.torus)).toEqual({
      radius: 0.5,
      sectionRadius: 0.2,
      subdivisionsAxis: 12,
      subdivisionsHeight: 6,
    });
    expect(paramDefaults(PRIMITIVE_PARAMS.humanoidBody)).toEqual({ height: 1.6, style: 'smooth' });
  });
});

/** Kernel ops whose owners have landed them (B3: M6A-SPEC §9 B3). */
const LANDED: ReadonlySet<string> = new Set([
  'mesh.extrude',
  'mesh.inset',
  'mesh.insertLoop',
  'mesh.offsetLoop',
  'mesh.connect',
  'mesh.bridge',
  'mesh.fillHole',
  'mesh.merge',
  'mesh.mergeToCenter',
  'mesh.mergeByDistance',
  'mesh.targetWeld',
  'mesh.collapse',
  'mesh.delete',
  'mesh.deleteEdgeVertex',
]);

describe('MESH_OPS / MESH_SET_OPS (B0a stubs)', () => {
  it('hold one op per descriptor with the same descriptor fields', () => {
    expect(Object.keys(MESH_OPS).sort()).toEqual(Object.keys(MESH_OP_DESCRIPTORS).sort());
    expect(Object.keys(MESH_SET_OPS).sort()).toEqual(Object.keys(MESH_SET_OP_DESCRIPTORS).sort());
    for (const [id, op] of Object.entries(MESH_OPS)) {
      const desc = MESH_OP_DESCRIPTORS[id];
      expect({
        id: op.id,
        label: op.label,
        kinds: op.kinds,
        params: op.params,
        flags: op.flags,
        symmetry: op.symmetry,
      }).toEqual(desc);
    }
  });

  it('poll true and run refuses not-implemented until the owner lands the op', () => {
    const mesh = emptyMesh();
    const ctx = {
      symmetry: null,
      hidden: null,
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      faceted: true,
      soft: null,
      curves: { compile: () => ({}) as never, evaluate: () => 0 },
      epsilon: 1e-9,
    } as const;
    // Ops their owners have landed (B3, M6A-B3-12) poll and run on an empty mesh without a selection without throwing,
    // and never refuse `not-implemented`; every other op is still B0a's stub.
    const outcomes = Object.values(MESH_OPS)
      .filter((op) => !LANDED.has(op.id))
      .map((op) => {
        const result = op.run(mesh, null, {}, ctx);
        return [op.id, op.poll(mesh, null, ctx), isRefusal(result) ? result.code : 'ran'];
      });
    expect(outcomes).toEqual(
      Object.keys(MESH_OPS)
        .filter((id) => !LANDED.has(id))
        .map((id) => [id, true, 'not-implemented']),
    );
    const landed = [...LANDED].map((id) => {
      const op = MESH_OPS[id];
      const result = op?.run(mesh, null, {}, ctx);
      const verdict = op?.poll(mesh, null, ctx);
      return {
        id,
        defined: op !== undefined,
        stub: isRefusal(result) && result.code === 'not-implemented',
        poll: verdict === true || isRefusal(verdict),
      };
    });
    expect(landed).toEqual([...LANDED].map((id) => ({ id, defined: true, stub: false, poll: true })));
    const setOutcomes = Object.values(MESH_SET_OPS).map((op) => {
      const result = op.run([], {}, { hidden: null, faceted: true, curves: ctx.curves, epsilon: 1e-9 });
      return [op.id, op.poll([], {}), isRefusal(result) ? result.code : 'ran'];
    });
    expect(setOutcomes).toEqual(Object.keys(MESH_SET_OPS).map((id) => [id, true, 'not-implemented']));
  });
});

describe('eager/lazy split (§2)', () => {
  /** Relative imports of a module, resolved to files. */
  const graph = (entry: string): string[] => {
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/from '(\.[^']+)'/g)) {
        const target = resolve(dirname(file), match[1] as string);
        const candidates = [`${target}.ts`, join(target, 'index.ts')];
        const found = candidates.find((candidate) => {
          try {
            readFileSync(candidate);
            return true;
          } catch {
            return false;
          }
        });
        if (found !== undefined) visit(found);
      }
    };
    visit(entry);
    return [...seen];
  };

  it('the descriptors barrel and everything it imports hold no kernel code (no marker, no earcut)', () => {
    const files = graph(join(SRC, 'descriptors.ts'));
    expect(files.length).toBeGreaterThan(30);
    const offenders = files.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return (
        text.includes(KERNEL_MARKER) ||
        /from '\.{1,2}\/(\.\.\/)*kernel'/.test(text) ||
        text.includes("from 'earcut'") ||
        text.includes("from 'robust-predicates'")
      );
    });
    expect(offenders).toEqual([]);
  });

  it('every kernel entry module references the marker (registry, kernel modules, op stubs)', () => {
    expect(KERNEL_MARKER).toBe('ekza-mesh-kernel');
    expect(Object.getOwnPropertyDescriptor(MESH_OPS, '__kernel')?.value).toBe(KERNEL_MARKER);
    // B1 replaced B0a's reference/** with these module directories (literal update of this scan).
    const dirs = [
      'core',
      'layers',
      'log',
      'euler',
      'validate',
      'revision',
      'triangulate',
      'normals',
      'primitives',
      'predicates',
    ];
    const silent = dirs.flatMap((dir) =>
      readdirSync(join(SRC, dir))
        .filter((name) => name.endsWith('.ts'))
        .filter(
          (name) =>
            !/kernelError|notImplemented|KERNEL_MARKER|editMeshFrom|isKernelDebug/.test(
              readFileSync(join(SRC, dir, name), 'utf8'),
            ),
        )
        .map((name) => `${dir}/${name}`),
    );
    expect(silent).toEqual([]);
  });
});
