import { RAD2DEG } from '@ekza-animator/anim-core';
import type { ChannelId } from '@ekza-animator/doc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatChannelValue, fromDisplayValue, parseNumericInput, toDisplayValue } from '../../src';

describe('parseNumericInput', () => {
  it.each([
    ['45', 10, 45],
    ['-5', 10, -5],
    ['+5', 10, 5],
    ['  7.25 ', 0, 7.25],
    ['.5', 0, 0.5],
    ['1e2', 0, 100],
    ['+=10', 45, 55],
    ['-=5', 45, 40],
    ['+= -2', 45, 43],
    ['*2', 3, 6],
    ['*=2', 3, 6],
    ['/2', 3, 1.5],
    ['/=4', 3, 0.75],
    ['90deg', 0, 90],
    ['90°', 0, 90],
    ['90 DEG', 0, 90],
    ['+=10deg', 5, 15],
    ['1,5', 0, 1.5],
    ['−3', 0, -3],
    // research 09 §6.4 expressions (v0.3 integration: one grammar for every numeric field)
    ['=5', 1, 5],
    ['=12.5', 0, 12.5],
    ['(1 + 2) * 3', 0, 9],
    ['2 * -3', 0, -6],
    ['1 - 2 - 3', 0, -4],
    ['8 / 2 / 2', 0, 2],
    ['+=(2+3)deg', 1, 6],
    ['*=1.5', 10, 15],
    ['-=2*3', 10, 4],
  ])('%j with current %d → %d', (text, current, expected) => {
    expect(parseNumericInput(text, current)).toBeCloseTo(expected, 12);
  });

  it('converts radians into display degrees', () => {
    expect(parseNumericInput('1.5rad', 0)).toBeCloseTo(1.5 * RAD2DEG, 12);
    expect(parseNumericInput('-=0.5rad', 90)).toBeCloseTo(90 - 0.5 * RAD2DEG, 12);
  });

  it.each([
    '',
    '   ',
    'abc',
    '4 5',
    '/0',
    '*=0rad',
    '2rad*',
    '--5',
    '1e400',
    '+',
    '5 meters',
    '1.2.3',
    '1/0',
    '/=0',
    '(1 + 2',
    '1 +',
    '45 deg deg',
    '++',
    '=',
  ])('rejects %j', (text) => {
    expect(parseNumericInput(text, 1)).toBeNull();
  });

  it('round-trips any formatted finite number', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (value) => {
        const parsed = parseNumericInput(String(value), 0);
        expect(parsed).not.toBeNull();
        expect(parsed).toBe(value === 0 ? 0 : value);
      }),
    );
  });
});

describe('display values', () => {
  it('shows rotations in degrees and everything else unchanged', () => {
    expect(toDisplayValue('rz', Math.PI / 4)).toBeCloseTo(45, 12);
    expect(fromDisplayValue('rx', 30)).toBeCloseTo(Math.PI / 6, 15);
    expect(toDisplayValue('tx', 0.5)).toBe(0.5);
    expect(fromDisplayValue('sy', 2)).toBe(2);
    expect(toDisplayValue('@weight', 0.25)).toBe(0.25);
  });

  it('round-trips display conversion for every TRS channel', () => {
    const channels: ChannelId[] = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'];
    fc.assert(
      fc.property(fc.constantFrom(...channels), fc.double({ min: -1e4, max: 1e4, noNaN: true }), (channel, value) => {
        expect(fromDisplayValue(channel, toDisplayValue(channel, value))).toBeCloseTo(value, 9);
      }),
    );
  });

  it('formats with 3 decimals and never shows -0.000', () => {
    expect(formatChannelValue('rz', 0.785398163)).toBe('45.000');
    expect(formatChannelValue('ty', -0.0004)).toBe('0.000');
    expect(formatChannelValue('ry', -1e-9)).toBe('0.000');
    expect(formatChannelValue('tx', 1.23456)).toBe('1.235');
    expect(formatChannelValue('sx', -2)).toBe('-2.000');
    expect(formatChannelValue('tx', Number.NaN)).toBe('NaN');
  });
});
