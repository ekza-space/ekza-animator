import { describe, expect, it } from 'vitest';
import { compileAnimCurve, evaluateAnimCurve, Segment } from '../../src';
import { goldenCurve, readAnimxGoldens } from './goldens';

const goldens = readAnimxGoldens();

describe('AnimX goldens (tooling/animx-oracle)', () => {
  it('cover every segment kind and infinity mode, with negative and multi-cycle times', () => {
    const kinds = new Set<number>();
    const modes = new Set<string>();
    let negative = 0;
    let multiCycle = 0;
    for (const g of goldens.curves) {
      const c = compileAnimCurve(goldenCurve(g));
      for (const kind of c.segment) kinds.add(kind);
      modes.add(g.pre);
      modes.add(g.post);
      const first = c.t[0] as number;
      const last = c.t[c.keyCount - 1] as number;
      for (const [t] of g.samples) {
        if (t < 0) negative++;
        if (t > last + 1.5 * (last - first) || t < first - 1.5 * (last - first)) multiCycle++;
      }
    }
    expect([...kinds].sort((a, b) => a - b)).toEqual(Object.values(Segment).sort((a, b) => a - b));
    expect([...modes].sort((a, b) => a.localeCompare(b))).toEqual([
      'constant',
      'cycle',
      'cycleOffset',
      'linear',
      'oscillate',
    ]);
    expect(negative).toBeGreaterThan(1000);
    expect(multiCycle).toBeGreaterThan(1000);
    expect(goldens.commit).toBe('11c31ac74e526b599031414866db639383c9a5e0');
  });

  it.each(goldens.curves.map((g) => [g.name, g] as const))('values match AnimX ≤ 1e-9: %s', (_name, g) => {
    const c = compileAnimCurve(goldenCurve(g));
    const misses = g.samples
      .map(([t, expected]) => ({ t, expected, actual: evaluateAnimCurve(c, t) }))
      .filter(({ expected, actual }) => !(Math.abs(actual - expected) <= 1e-9));
    expect(misses).toEqual([]);
  });

  it('auto / autoMix / autoEase slopes match AnimX ≤ 1e-12', () => {
    let checked = 0;
    const misses: string[] = [];
    for (const g of goldens.curves) {
      const c = compileAnimCurve(goldenCurve(g));
      for (const [index, side, expected] of g.autoSlopes) {
        const actual = (side === 'in' ? c.inSlope : c.outSlope)[index] as number;
        if (!(Math.abs(actual - expected) <= 1e-12))
          misses.push(`${g.name} key ${index} ${side}: ${actual} vs ${expected}`);
        checked++;
      }
    }
    expect(misses).toEqual([]);
    expect(checked).toBeGreaterThan(500);
  });
});
