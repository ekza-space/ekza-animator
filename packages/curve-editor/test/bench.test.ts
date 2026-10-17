// Redraw benchmark (ADR 0007 §9, ARCHITECTURE §14): reported as test annotations, not a CI gate. The bounds asserted
// here only catch order-of-magnitude regressions on slow shared runners.
import type { KeyData } from '@ekza-animator/anim-core';
import type { ControlId, KeyId } from '@ekza-animator/doc';
import { afterEach, describe, expect, it } from 'vitest';
import { addCurve, key, type Mounted, mount, selectKeys, waveApp } from './support/app';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

const CONTROLS = [
  'rig_SyntheticWave001:fk.upperArm.L',
  'rig_SyntheticWave001:fk.lowerArm.L',
  'rig_SyntheticWave001:fk.hand.L',
  'rig_SyntheticWave001:fk.upperArm.R',
  'rig_SyntheticWave001:fk.lowerArm.R',
] as unknown as readonly ControlId[];
const CHANNELS = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz', '@extra'] as const;

/** `curves` curves with `keys` keys each (auto tangents, varied shapes), every channel kind. */
async function bigScene(curves: number, keys: number) {
  const app = await waveApp();
  const ids = [];
  for (let c = 0; c < curves; c++) {
    const data: KeyData[] = [];
    for (let i = 0; i < keys; i++)
      data.push(key(i * 2, Math.sin(i * 0.37 + c) * (1 + (c % 4)) + 0.2 * Math.cos(i * 1.7)));
    const control = CONTROLS[c % CONTROLS.length] as ControlId;
    const channel = CHANNELS[Math.floor(c / CONTROLS.length) % CHANNELS.length] ?? 'tx';
    ids.push(addCurve(app, { control, channel: c >= 50 ? `@c${c}` : channel, keys: data }));
  }
  return { app, ids };
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

describe('Graph Editor redraw benchmark (ADR 0007 §9, reported)', () => {
  it('50 curves × 200 keys: full redraw', async ({ annotate }) => {
    const { app, ids } = await bigScene(50, 200);
    mounted = mount(app, { width: 1440, height: 400, dpr: 2, curves: ids.map((entry) => entry.curve) });
    const { controller } = mounted;
    selectKeys(
      app,
      ids.slice(0, 5).flatMap((entry) => entry.keys.slice(0, 20).map((k) => [k, { key: true }] as const)),
    );
    controller.redraw(true); // warm-up: builds the curve set
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      controller.redraw(true);
      samples.push(performance.now() - start);
    }
    const ms = median(samples);
    await annotate(
      `50 curves × 200 keys, 1440×400 @2x: full redraw median ${ms.toFixed(2)} ms (budget 4 ms)`,
      'notice',
    );
    expect(ms).toBeLessThan(100);
  });

  it('50k keys loaded, 10k visible: pan and zoom redraws', async ({ annotate }) => {
    const { app, ids } = await bigScene(50, 1000);
    mounted = mount(app, { width: 1440, height: 400, dpr: 2, curves: ids.map((entry) => entry.curve) });
    const { controller } = mounted;
    // Keys span frames 0…1998: show a fifth of them (≈ 10k visible keys).
    controller.setView({ ...controller.view, f0: 800, sx: 1440 / 400 });
    controller.redraw(true);
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const view = controller.view;
      const start = performance.now();
      controller.setView(i % 2 === 0 ? { ...view, f0: view.f0 + 3 } : { ...view, sy: view.sy * 1.01 });
      controller.redraw();
      samples.push(performance.now() - start);
    }
    const ms = median(samples);
    await annotate(
      `50k keys / ~10k visible, 1440×400 @2x: pan/zoom redraw median ${ms.toFixed(2)} ms (budget 8 ms)`,
      'notice',
    );
    expect(ms).toBeLessThan(200);
    expect(controller.stats.baseRedraws).toBeGreaterThanOrEqual(31);
  });

  it('50k keys loaded: an edit of one curve (a drag update) redraws without rebuilding the others', async ({
    annotate,
  }) => {
    const { app, ids } = await bigScene(50, 1000);
    mounted = mount(app, { width: 1440, height: 400, dpr: 2, curves: ids.map((entry) => entry.curve) });
    const { controller } = mounted;
    controller.setView({ ...controller.view, f0: 800, sx: 1440 / 400 });
    controller.redraw(true);
    const edited = ids[7]?.keys[450] as KeyId;
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      app.store.transact({ label: 'Nudge' }, (tx) => tx.patch('keys', edited, { v: 0.01 * i }));
      controller.redraw();
      samples.push(performance.now() - start);
    }
    const ms = median(samples);
    // The test kit's naive store scans every key per query; WP-2's indexed store and WP-3's curve cache are faster.
    await annotate(
      `50k keys, one curve edited (naive test store): commit + redraw median ${ms.toFixed(2)} ms`,
      'notice',
    );
    expect(ms).toBeLessThan(200);
  });

  it('hit-tests and keyPoint stay cheap on 50k keys', async ({ annotate }) => {
    const { app, ids } = await bigScene(50, 1000);
    mounted = mount(app, { width: 1440, height: 400, dpr: 1, curves: ids.map((entry) => entry.curve) });
    const { controller } = mounted;
    controller.hitTest(10, 10);
    const start = performance.now();
    for (let i = 0; i < 200; i++) controller.hitTest((i * 7) % 1440, (i * 13) % 400);
    const ms = (performance.now() - start) / 200;
    await annotate(`hit-test on 50k keys: ${ms.toFixed(3)} ms per call`, 'notice');
    expect(ms).toBeLessThan(20);
    expect(controller.keyPoint(ids[0]?.keys[0] as KeyId)).not.toBeNull();
  });
});
