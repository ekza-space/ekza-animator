// MVP-SPEC §6.3 anim-core bench: "evaluate 2,200 curves ≤ 0.3 ms (report)". Run: pnpm exec vitest bench --run
import { bench, describe } from 'vitest';
import { compileAnimCurve, evaluateAnimCurve, reduceKeys } from '../../src';
import { benchScene } from './scene';

const scene = benchScene();
let frame = 0;
let sink = 0;

describe('anim-core', () => {
  bench('evaluate 2,200 curves at one frame (playback step)', () => {
    frame = (frame + 1.37) % 200;
    for (const c of scene) sink += evaluateAnimCurve(c, frame);
  });

  bench('evaluate 2,200 curves at a random frame incl. infinities', () => {
    const f = Math.random() * 400 - 100;
    for (const c of scene) sink += evaluateAnimCurve(c, f);
  });

  bench('compile one 40-key curve', () => {
    sink += compileAnimCurve({
      keys: Array.from({ length: 40 }, (_, i) => ({
        t: i * 3,
        v: Math.sin(i),
        inType: 'auto' as const,
        outType: 'auto' as const,
        inHandle: { dt: 0, dv: 0 },
        outHandle: { dt: 0, dv: 0 },
        broken: false,
        weightLocked: true,
      })),
      weighted: false,
      pre: 'constant',
      post: 'constant',
    }).keyCount;
  });

  bench('reduce a 1,000-key dense import (0.1°)', () => {
    const keys = Array.from({ length: 1000 }, (_, i) => ({
      t: i,
      v: 0.3 * Math.sin(i / 20) + 0.05 * Math.sin(i / 7),
      inType: 'auto' as const,
      outType: 'auto' as const,
      inHandle: { dt: 0, dv: 0 },
      outHandle: { dt: 0, dv: 0 },
      broken: false,
      weightLocked: true,
    }));
    sink += reduceKeys(
      { keys, weighted: false, pre: 'constant', post: 'constant' },
      { tolerance: 0.0017453292519943296 },
    ).removed;
  });
});

export { sink };
