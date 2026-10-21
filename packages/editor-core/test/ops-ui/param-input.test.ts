// M6A-SPEC §1, §5.10, §8.6 (B11): typed values of operator parameters. `30%` and `0.3` are the same fraction and a
// bare number is a fraction (clamped with a problem); distances take m/cm/mm; angles are typed in degrees; ints
// round half away from zero; nullable params take "auto"; the shipped grammar (relative entries, expressions, a
// decimal comma) is unchanged; display texts are Maya's (`0.500 m`, `0.300`).
import { DEG2RAD, type ParamDef, primaryParam } from '@ekza-studio/anim-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatParamValue,
  numericParams,
  paramEditText,
  paramSliderRate,
  parseParamInput,
  primaryVisibleParam,
  visibleParams,
} from '../../src';

const fraction: ParamDef = {
  name: 'weight',
  label: 'Weight',
  kind: 'fraction',
  bound: 'value',
  default: 0.5,
  min: 0,
  max: 1,
};
const distance: ParamDef = { name: 'offset', label: 'Offset', kind: 'distance', bound: 'value', default: 0.05, min: 0 };
const signed: ParamDef = { name: 'tz', label: 'Local Translate Z', kind: 'distance', bound: 'value', default: 0 };
const angle: ParamDef = {
  name: 'angle',
  label: 'Angle',
  kind: 'angle',
  bound: 'value',
  default: Math.PI / 6,
  min: 0,
  max: Math.PI,
};
const int: ParamDef = {
  name: 'divisions',
  label: 'Divisions',
  kind: 'int',
  bound: 'value',
  default: 1,
  min: 1,
  max: 32,
};
const auto: ParamDef = {
  name: 'smoothingAngle',
  label: 'Smoothing Angle',
  kind: 'angle',
  bound: 'value',
  default: null,
  nullable: true,
};
const bool: ParamDef = { name: 'clamp', label: 'Clamp', kind: 'bool', bound: 'value', default: true };
const mode: ParamDef = {
  name: 'mode',
  label: 'Mode',
  kind: 'enum',
  bound: 'value',
  default: 'relative',
  options: [
    { value: 'relative', label: 'Relative' },
    { value: 'multiple', label: 'Multiple' },
  ],
};
const data: ParamDef = {
  name: 'points',
  label: 'Points',
  kind: 'data',
  bound: 'pointer',
  default: null,
  hidden: true,
  nullable: true,
};

const value = (text: string, def: ParamDef, current?: number) => {
  const out = parseParamInput(text, current, def);
  return 'error' in out ? out.error : out.value;
};

describe('parseParamInput (§5.10)', () => {
  it('fractions: 30% and 0.3 are the same value; a bare number is a fraction, clamped with a problem', () => {
    expect(value('30%', fraction)).toBeCloseTo(0.3, 15);
    expect(value('0.3', fraction)).toBe(0.3);
    expect(value('30%', fraction)).toBe(value('0.3', fraction));
    expect(parseParamInput('30', 0.5, fraction)).toEqual({ value: 1, problem: 'Weight clamped to 1.000' });
    expect(value('+=10%', fraction, 0.5)).toBeCloseTo(0.6, 12);
    expect(parseParamInput('-5%', 0.5, fraction)).toEqual({ value: 0, problem: 'Weight clamped to 0.000' });
  });

  it('distances: metres, with m / cm / mm; relative entries and expressions', () => {
    expect(value('0.5', distance)).toBe(0.5);
    expect(value('50cm', distance)).toBe(0.5);
    expect(value('25 mm', distance)).toBe(0.025);
    expect(value('1m', distance)).toBe(1);
    expect(value('+=0.1', signed, 0.4)).toBeCloseTo(0.5, 15);
    expect(value('=2*0.25', signed)).toBe(0.5);
    expect(value('1,5', signed)).toBe(1.5);
    expect(value('-0.2', signed)).toBe(-0.2);
    expect(value('30deg', distance)).toBe('Offset: type a number');
    expect(parseParamInput('-1', 0, distance)).toEqual({ value: 0, problem: 'Offset clamped to 0.000' });
  });

  it('angles: typed in degrees, stored in radians; deg / rad / °', () => {
    expect(value('30', angle)).toBeCloseTo(30 * DEG2RAD, 15);
    expect(value('30deg', angle)).toBeCloseTo(30 * DEG2RAD, 15);
    expect(value('45°', angle)).toBeCloseTo(45 * DEG2RAD, 15);
    expect(value('1rad', angle)).toBeCloseTo(1, 12);
    expect(parseParamInput('270', 0, angle)).toEqual({ value: Math.PI, problem: 'Angle clamped to 180.000' });
  });

  it('ints round half away from zero and clamp; nullable "auto"; bools; enums by value or label; data refuses', () => {
    expect(value('2.5', int)).toBe(3);
    expect(value('40', int)).toBe(32);
    expect(value('', auto)).toBeNull();
    expect(value('auto', auto)).toBeNull();
    expect(value('15', auto)).toBeCloseTo(15 * DEG2RAD, 15);
    expect(value('off', bool)).toBe(false);
    expect(value('yes', bool)).toBe(true);
    expect(value('maybe', bool)).toBe('Clamp: type on or off');
    expect(value('Multiple', mode)).toBe('multiple');
    expect(value('relative', mode)).toBe('relative');
    expect(value('loop', mode)).toBe('Mode: one of Relative, Multiple');
    expect(value('1', data)).toBe('Points cannot be typed');
    expect(value('', int)).toBe('Divisions: type a number');
    expect(value('2x', int)).toBe('Divisions: type a number');
  });

  it('property: a displayed fraction or distance parses back to the value (3 decimals)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), (k) => {
        const v = k / 1000;
        expect(value(formatParamValue(fraction, v), fraction)).toBeCloseTo(v, 12);
        expect(value(paramEditText(signed, v - 0.5), signed)).toBeCloseTo(v - 0.5, 12);
        expect(value(`${k / 10}%`, fraction)).toBeCloseTo(v, 12);
      }),
    );
  });

  it('property: a percent entry equals the fraction entry; distances in cm equal metres / 100', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e3, max: 1e3, noNaN: true, noDefaultInfinity: true }), (x) => {
        const text = x.toFixed(4);
        const asPercent = value(`${text}%`, fraction);
        const asFraction = value(String(Number(text) / 100), fraction);
        expect(asPercent).toBeCloseTo(asFraction as number, 12);
        expect(value(`${text}cm`, signed)).toBeCloseTo(Number(text) / 100, 9);
      }),
    );
  });
});

describe('display (§8.6)', () => {
  it("Maya's texts: 0.500 m, 0.300, degrees, ints, on/off, option labels, auto", () => {
    expect(formatParamValue(signed, 0.5)).toBe('0.500 m');
    expect(formatParamValue(fraction, 0.3)).toBe('0.300');
    expect(formatParamValue(angle, Math.PI / 6)).toBe('30.000°');
    expect(formatParamValue(int, 2)).toBe('2');
    expect(formatParamValue(bool, false)).toBe('off');
    expect(formatParamValue(mode, 'multiple')).toBe('Multiple');
    expect(formatParamValue(auto, null)).toBe('auto');
    expect(formatParamValue(signed, -0.0001)).toBe('0.000 m');
    expect(paramEditText(signed, 0.5)).toBe('0.500');
    expect(paramEditText(auto, null)).toBe('');
  });

  it('visible fields: value-bound, shown, not data; the primary first', () => {
    const params = [int, { ...signed, primary: true }, data, mode, { ...fraction, bound: 'selection' as const }];
    expect(visibleParams(params).map((d) => d.name)).toEqual(['tz', 'divisions', 'mode']);
    expect(numericParams(params).map((d) => d.name)).toEqual(['tz', 'divisions']);
    expect(primaryVisibleParam(params)?.name).toBe('tz');
    expect(primaryVisibleParam([int])).toBeNull();
    expect(primaryParam(visibleParams([]))).toBeNull();
  });

  it('virtual-slider rates: the shipped per-pixel rates; ranged params over 200 px', () => {
    const rates = { degPerPx: 0.5, metresPerPx: 0.01, unitsPerPx: 0.01 };
    expect(paramSliderRate(signed, rates)).toBe(0.01);
    expect(paramSliderRate(angle, rates)).toBeCloseTo(0.5 * DEG2RAD, 15);
    expect(paramSliderRate(fraction, rates)).toBe(1 / 200);
    expect(paramSliderRate(int, rates)).toBe(0.1);
  });
});
