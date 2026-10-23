// MCP-SPEC §5.2, §5.3 (P2): units at the tool boundary — degrees and stored radians, rounding, fps numbers, named
// directions in character space (+X the character's left), the named orientation angles relative to rest (pitch up,
// yaw toward the left, roll left side up; yaw, then pitch, then roll) and the radians warning.
import { DEG2RAD, quatRotateVec3, type Quat } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import { units } from '../src';

const close = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  a.every((value, i) => Math.abs(value - (b[i] ?? Number.NaN)) <= eps);

describe('units (MCP-SPEC §5.2)', () => {
  it('converts degrees to stored radians and back, rounding output per unit', () => {
    expect(units.toStoredValue('deg', 90)).toBeCloseTo(Math.PI / 2, 12);
    expect(units.toToolValue('deg', Math.PI)).toBeCloseTo(180, 12);
    expect(units.toStoredValue('m', 0.25)).toBe(0.25);
    expect(units.outValue('deg', 12.345_678)).toBe(12.35);
    expect(units.outValue('m', 0.123_456)).toBe(0.1235);
    expect(units.outValue('factor', 1.000_04)).toBe(1);
    expect(units.outValue('deg', 12.345_678, 'full')).toBe(12.345_678);
    expect(units.outFrame(10.000_4)).toBe(10);
    expect(units.roundTo(0.1 + 0.2, 0.01)).toBe(0.3);
    expect(Object.is(units.roundTo(-0.000_01, 0.01), 0)).toBe(true);
  });

  it('reads fps numbers, NTSC rates included, and refuses other fractions', () => {
    expect(units.fpsOf(30)).toEqual({ num: 30, den: 1 });
    expect(units.fpsOf(29.97)).toEqual({ num: 30_000, den: 1_001 });
    expect(units.fpsOf(23.976)).toEqual({ num: 24_000, den: 1_001 });
    expect(units.fpsOf(59.94)).toEqual({ num: 60_000, den: 1_001 });
    expect(units.fpsNumber({ num: 30_000, den: 1_001 })).toBe(29.97);
    expect(() => units.fpsOf(12.5)).toThrow(/whole number/);
  });

  it('names directions in character space: left is +X, forward +Z, sums normalised', () => {
    expect(units.directionOf('left', 'd')).toEqual([1, 0, 0]);
    expect(units.directionOf('right', 'd')).toEqual([-1, 0, 0]);
    expect(units.directionOf('forward', 'd')).toEqual([0, 0, 1]);
    expect(close(units.directionOf('up+left', 'd'), [Math.SQRT1_2, Math.SQRT1_2, 0])).toBe(true);
    expect(close(units.directionOf([0, 3, 4], 'd'), [0, 0.6, 0.8])).toBe(true);
    expect(() => units.directionOf('left+right', 'aims[0].direction')).toThrow(/no length/);
  });

  it('turns named angles into rotations: pitch lifts the tip, yaw turns toward the left, roll lifts the left side', () => {
    const forward = [0, 0, 1] as const;
    const left = [1, 0, 0] as const;
    const pitched = quatRotateVec3(units.orientDelta({ pitchDeg: 20 }), forward);
    expect(pitched[1]).toBeCloseTo(Math.sin(20 * DEG2RAD), 9); // toes up
    const yawed = quatRotateVec3(units.orientDelta({ yawDeg: 30 }), forward);
    expect(yawed[0]).toBeCloseTo(Math.sin(30 * DEG2RAD), 9); // toward the character's left (+X)
    const rolled = quatRotateVec3(units.orientDelta({ rollDeg: 15 }), left);
    expect(rolled[1]).toBeCloseTo(Math.sin(15 * DEG2RAD), 9); // left side up
  });

  it('reads named angles back from a rotation relative to rest (round trip)', () => {
    const rest: Quat = [0.1, 0.2, -0.3, Math.sqrt(1 - 0.14)];
    const orient = { pitchDeg: 12, yawDeg: -35, rollDeg: 7 };
    const turned = units.orientFromRest(rest, orient);
    const back = units.orientRelativeToRest(turned, rest);
    expect(back.pitchDeg).toBeCloseTo(12, 9);
    expect(back.yawDeg).toBeCloseTo(-35, 9);
    expect(back.rollDeg).toBeCloseTo(7, 9);
  });

  it('warns when degree values look like radians', () => {
    expect(units.looksLikeRadians([0.5, -1.2])).toBe(true);
    expect(units.looksLikeRadians([0, 0])).toBe(false);
    expect(units.looksLikeRadians([0.5, 45])).toBe(false);
    expect(units.looksLikeRadians([])).toBe(false);
  });
});
