import { type AnimCurve, type CompiledAnimCurve, compileAnimCurve, type KeyData, type TangentType } from '../../src';

/** Deterministic pseudo-random numbers (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A scene-sized workload for the §6.3 bench: 2,200 curves (≈ 3 humanoids × 55 bones × ~13 channels) of 8–40 keys over
 * a 120-frame clip; 80 % auto, 10 % weighted with fixed handles, 5 % linear, 5 % stepped; mixed infinities.
 */
export function benchScene(count = 2200): CompiledAnimCurve[] {
  const rnd = random(20261017);
  const curves: CompiledAnimCurve[] = [];
  for (let c = 0; c < count; c++) {
    const n = 8 + Math.floor(rnd() * 33);
    const roll = rnd();
    const type: TangentType = roll < 0.8 ? 'auto' : roll < 0.9 ? 'fixed' : roll < 0.95 ? 'linear' : 'step';
    const weighted = type === 'fixed';
    const keys: KeyData[] = [];
    let t = 0;
    for (let i = 0; i < n; i++) {
      keys.push({
        t,
        v: Math.sin(t / 9 + c) * 0.8 + rnd() * 0.1,
        inType: type === 'step' ? 'flat' : type,
        outType: type,
        inHandle: { dt: -1 - rnd(), dv: rnd() - 0.5 },
        outHandle: { dt: 1 + rnd(), dv: rnd() - 0.5 },
        broken: false,
        weightLocked: true,
      });
      t += 1 + Math.floor(rnd() * 5);
    }
    const modes = ['constant', 'cycle', 'linear', 'cycleOffset', 'oscillate'] as const;
    const anim: AnimCurve = { keys, weighted, pre: modes[c % 5]!, post: modes[(c + 2) % 5]! };
    curves.push(compileAnimCurve(anim));
  }
  return curves;
}
