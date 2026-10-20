// M6A-SPEC §4.1: ParamDef helpers — defaults, the JSON schema, coercion (clamp, half-away-from-zero rounding, enum
// and axis membership, data schemas, null handling, unknown keys dropped, `passThrough` keys untouched), stripping by
// bound, the primary param and the list assertions.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  assertParams,
  checkJsonSchema,
  coerceArgs,
  EkzaError,
  isJsonValue,
  type ParamDef,
  paramDefaults,
  paramSchema,
  primaryParam,
  stripBound,
} from '../../src';

const EXTRUDE: readonly ParamDef[] = [
  { name: 'localTranslateZ', label: 'Local Translate Z', kind: 'distance', bound: 'value', default: 0, primary: true },
  { name: 'localScaleX', label: 'Local Scale X', kind: 'number', bound: 'value', default: 1, min: 0 },
  { name: 'divisions', label: 'Divisions', kind: 'int', bound: 'value', default: 1, min: 1, max: 32 },
  { name: 'keepFacesTogether', label: 'Keep Faces Together', kind: 'bool', bound: 'value', default: true },
  {
    name: 'space',
    label: 'Space',
    kind: 'enum',
    bound: 'value',
    default: 'local',
    options: [
      { value: 'local', label: 'Local' },
      { value: 'world', label: 'World' },
    ],
  },
  { name: 'axis', label: 'Axis', kind: 'axis', bound: 'value', default: 'x' },
  { name: 'weight', label: 'Weight', kind: 'fraction', bound: 'value', default: 0.5 },
  { name: 'smoothingAngle', label: 'Smoothing Angle', kind: 'angle', bound: 'value', default: null, nullable: true },
  {
    name: 'seedEdge',
    label: 'Seed Edge',
    kind: 'int',
    bound: 'selection',
    default: null,
    nullable: true,
    hidden: true,
  },
  {
    name: 'points',
    label: 'Points',
    kind: 'data',
    bound: 'pointer',
    default: null,
    nullable: true,
    schema: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind'],
        properties: { kind: { enum: ['edge', 'vertex'] }, t: { type: 'number', minimum: 0, maximum: 1 } },
      },
    },
  },
];

describe('paramDefaults', () => {
  it('lists every param with its default (nullable params null)', () => {
    expect(paramDefaults(EXTRUDE)).toEqual({
      localTranslateZ: 0,
      localScaleX: 1,
      divisions: 1,
      keepFacesTogether: true,
      space: 'local',
      axis: 'x',
      weight: 0.5,
      smoothingAngle: null,
      seedEdge: null,
      points: null,
    });
    expect(Object.isFrozen(paramDefaults(EXTRUDE))).toBe(true);
  });
});

describe('paramSchema', () => {
  it('describes an object with one property per param and no required list', () => {
    const schema = paramSchema(EXTRUDE, { title: 'Extrude' }) as Record<string, unknown>;
    expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema['title']).toBe('Extrude');
    expect(schema['type']).toBe('object');
    expect(schema['required']).toBeUndefined();
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(props)).toEqual(EXTRUDE.map((p) => p.name));
    expect(props['divisions']).toMatchObject({ type: 'integer', minimum: 1, maximum: 32, default: 1 });
    expect(props['weight']).toMatchObject({ type: 'number', minimum: 0, maximum: 1 });
    expect(props['space']).toMatchObject({ type: 'string', enum: ['local', 'world'] });
    expect(props['axis']).toMatchObject({ enum: ['x', 'y', 'z'] });
    expect(props['smoothingAngle']).toMatchObject({ type: ['number', 'null'], default: null });
    expect(props['keepFacesTogether']).toMatchObject({ type: 'boolean', default: true });
    expect(props['points']).toHaveProperty('anyOf');
    expect(isJsonValue(schema)).toBe(true);
  });
});

describe('coerceArgs', () => {
  it('fills defaults without problems', () => {
    const { args, problems } = coerceArgs(EXTRUDE, {});
    expect(args).toEqual(paramDefaults(EXTRUDE));
    expect(problems).toEqual([]);
    expect(coerceArgs(EXTRUDE, undefined).problems).toEqual([]);
  });

  it('clamps into [min, max] and rounds ints half away from zero, naming each change', () => {
    expect(coerceArgs(EXTRUDE, { divisions: 40 })).toMatchObject({
      args: { divisions: 32 },
      problems: ['divisions clamped to 32'],
    });
    expect(coerceArgs(EXTRUDE, { divisions: 2.5 }).args['divisions']).toBe(3);
    expect(coerceArgs(EXTRUDE, { divisions: 2.5 }).problems).toEqual(['divisions rounded to 3']);
    expect(coerceArgs(EXTRUDE, { localScaleX: -1 }).args['localScaleX']).toBe(0);
    // a bare number is a fraction: 30 is clamped to the field's maximum (§1, §5.10)
    expect(coerceArgs(EXTRUDE, { weight: 30 })).toMatchObject({
      args: { weight: 1 },
      problems: ['weight clamped to 1'],
    });
    expect(Object.is(coerceArgs(EXTRUDE, { localTranslateZ: -0 }).args['localTranslateZ'], 0)).toBe(true);
  });

  it('replaces wrongly typed values by the default with a problem', () => {
    const { args, problems } = coerceArgs(EXTRUDE, {
      localTranslateZ: '0.5',
      keepFacesTogether: 1,
      space: 'object',
      axis: 'w',
      divisions: Number.NaN,
    });
    expect(args).toMatchObject({
      localTranslateZ: 0,
      keepFacesTogether: true,
      space: 'local',
      axis: 'x',
      divisions: 1,
    });
    expect(problems).toHaveLength(5);
    expect(problems[0]).toMatch(/^localTranslateZ: expected a number/);
  });

  it('accepts null only for nullable params', () => {
    expect(coerceArgs(EXTRUDE, { smoothingAngle: null })).toMatchObject({
      args: { smoothingAngle: null },
      problems: [],
    });
    expect(coerceArgs(EXTRUDE, { smoothingAngle: 0.5 }).args['smoothingAngle']).toBe(0.5);
    const { args, problems } = coerceArgs(EXTRUDE, { divisions: null });
    expect(args['divisions']).toBe(1);
    expect(problems).toEqual(['divisions: null is not allowed; using the default']);
  });

  it("checks 'data' params against their schema", () => {
    const good = [
      { kind: 'edge', edge: 3, t: 0.25 },
      { kind: 'vertex', vertex: 1 },
    ];
    expect(coerceArgs(EXTRUDE, { points: good })).toMatchObject({ args: { points: good }, problems: [] });
    const bad = coerceArgs(EXTRUDE, { points: [{ kind: 'face' }] });
    expect(bad.args['points']).toBeNull();
    expect(bad.problems[0]).toMatch(/^points: invalid data/);
    expect(coerceArgs(EXTRUDE, { points: [{ kind: 'edge', t: 2 }] }).problems).toHaveLength(1);
  });

  it('drops unknown keys and copies passThrough keys untouched (meshes and kind reach apply)', () => {
    const meshes = ['msh_A', 'msh_B'];
    const { args, problems } = coerceArgs(
      EXTRUDE,
      { meshes, kind: 'face', bogus: 1, divisions: 2 },
      { passThrough: ['meshes', 'kind'] },
    );
    expect(args['meshes']).toBe(meshes);
    expect(args['kind']).toBe('face');
    expect(args['bogus']).toBeUndefined();
    expect(args['divisions']).toBe(2);
    expect(problems).toEqual(["unknown argument 'bogus' dropped"]);
    // absent passThrough keys stay absent
    expect('meshes' in coerceArgs(EXTRUDE, {}, { passThrough: ['meshes'] }).args).toBe(false);
  });

  it('treats a non-object as no arguments, with a problem', () => {
    expect(coerceArgs(EXTRUDE, 42).problems).toEqual(['arguments: expected an object, got 42; using the defaults']);
    expect(coerceArgs(EXTRUDE, [1, 2]).args).toEqual(paramDefaults(EXTRUDE));
  });

  it('never throws, and its output coerces to itself without problems (property)', () => {
    fc.assert(
      fc.property(
        fc.anything(),
        fc.dictionary(fc.constantFrom(...EXTRUDE.map((p) => p.name)), fc.anything()),
        (raw, dict) => {
          for (const input of [raw, dict]) {
            const first = coerceArgs(EXTRUDE, input);
            const second = coerceArgs(EXTRUDE, first.args);
            expect(second.args).toEqual(first.args);
            expect(second.problems).toEqual([]);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('stripBound, primaryParam', () => {
  it('drops pointer- and selection-bound args and keeps everything else', () => {
    const { args } = coerceArgs(EXTRUDE, { seedEdge: 4, points: [], meshes: ['m'] }, { passThrough: ['meshes'] });
    const stripped = stripBound(EXTRUDE, args, ['pointer', 'selection']);
    expect('seedEdge' in stripped).toBe(false);
    expect('points' in stripped).toBe(false);
    expect(stripped['meshes']).toEqual(['m']);
    expect(stripped['divisions']).toBe(1);
  });

  it('finds the primary param or null', () => {
    expect(primaryParam(EXTRUDE)?.name).toBe('localTranslateZ');
    expect(primaryParam(EXTRUDE.filter((p) => p.primary !== true))).toBeNull();
  });
});

describe('assertParams', () => {
  const code = (fn: () => void): string | null => {
    try {
      fn();
      return null;
    } catch (error) {
      return error instanceof EkzaError ? error.code : 'other';
    }
  };

  it('accepts a valid list', () => {
    expect(code(() => assertParams(EXTRUDE))).toBeNull();
  });

  it('rejects duplicates, two primaries and unusable defaults', () => {
    const p = EXTRUDE[0] as ParamDef;
    expect(code(() => assertParams([p, p]))).toBe('invalid-params');
    expect(code(() => assertParams([p, { ...(EXTRUDE[2] as ParamDef), primary: true }]))).toBe('invalid-params');
    expect(code(() => assertParams([{ ...p, default: null }]))).toBe('invalid-params');
    expect(code(() => assertParams([{ ...(EXTRUDE[2] as ParamDef), default: 40 }]))).toBe('invalid-params');
    expect(code(() => assertParams([{ ...(EXTRUDE[4] as ParamDef), default: 'nope' }]))).toBe('invalid-params');
    expect(code(() => assertParams([{ ...(EXTRUDE[2] as ParamDef), min: 5, max: 1 }]))).toBe('invalid-params');
    expect(code(() => assertParams([{ ...(EXTRUDE[9] as ParamDef), primary: true }]))).toBe('invalid-params');
    expect(code(() => assertParams([{ ...p, name: '' }]))).toBe('invalid-params');
  });
});

describe('checkJsonSchema', () => {
  it('covers type, properties, items, required, enum, minimum and maximum', () => {
    const schema = {
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'integer', minimum: 0, maximum: 3 }, b: { type: 'array', items: { type: 'string' } } },
    } as const;
    expect(checkJsonSchema({ a: 2, b: ['x'] }, schema)).toBeNull();
    expect(checkJsonSchema({ b: [] }, schema)).toBe('a: required');
    expect(checkJsonSchema({ a: 4 }, schema)).toBe('a: above 3');
    expect(checkJsonSchema({ a: 1.5 }, schema)).toBe('a: expected integer');
    expect(checkJsonSchema({ a: 1, b: [1] }, schema)).toBe('b[0]: expected string');
    expect(checkJsonSchema(3, { enum: [1, 2] })).toBe('(value): not one of the allowed values');
    expect(checkJsonSchema(null, { type: ['number', 'null'] })).toBeNull();
  });
});
