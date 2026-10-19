// MCP-SPEC §4.10 (P1): `clip.makeLoop` — matchEnds, blend and cycleOnly close the seam in value (C0) and slope (C1)
// with cycle infinities; root travel is kept with cycleOffset, removed in place or left alone; a dry run measures and
// writes nothing (no history step). The Polybot walk of E2E-M2A-23 is in headless-tests (ops.agent.test.ts).
import type { CurveId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { internalsOf } from '../../src/app/internals';
import type { EditorApp } from '../../src/types';
import {
  agentOk,
  agentRefusal,
  asAgent,
  DEG,
  docJson,
  expectAgentUndoRedoExact,
  opsApp,
  seedUser,
  WAVE,
  waveCurve,
} from './support';

const ARM = WAVE.lowerArmL;

/** C0 and C1 of a committed curve at the wave clip's seam (0…30), from the compiled curve. */
function seam(app: EditorApp, curve: CurveId): { readonly c0: number; readonly c1: number } {
  const compiled = app.evaluation.compiledCurve(curve);
  const engine = internalsOf(app).deps.curves.engine;
  const n = compiled.keyCount;
  return {
    c0: Math.abs(engine.evaluate(compiled, 30) - engine.evaluate(compiled, 0)),
    c1: Math.abs((compiled.inSlope[n - 1] as number) - (compiled.outSlope[0] as number)),
  };
}

/** The wave with a broken seam: the arm ends at 40° (starts at 30°) and the cog travels 0.3 m in x. */
async function brokenWave(): Promise<EditorApp> {
  const app = opsApp();
  await agentOk(app, 'key.write', {
    clip: WAVE.clip,
    keys: [
      { control: ARM, channel: 'rz', frame: 30, value: 40 * DEG },
      { control: WAVE.cog, channel: 'tx', frame: 0, value: 0, inType: 'linear', outType: 'linear' },
      { control: WAVE.cog, channel: 'tx', frame: 30, value: 0.3, inType: 'linear', outType: 'linear' },
      { control: WAVE.cog, channel: 'ty', frame: 0, value: 0.1 },
      { control: WAVE.cog, channel: 'ty', frame: 10, value: 0.2 },
      { control: WAVE.cog, channel: 'ty', frame: 25, value: 0.05 },
    ],
  });
  return app;
}

describe('clip.makeLoop', () => {
  it('matchEnds closes every seam in value and slope and cycles the curves, one AI step', async () => {
    const app = await brokenWave();
    seedUser(app);
    const { value } = await expectAgentUndoRedoExact(app, 'clip.makeLoop', {
      clip: WAVE.clip,
      method: 'matchEnds',
      rootTravel: 'inPlace',
    });
    const result = value as {
      before: { maxC0: number };
      after: { maxC0: number; maxC1: number };
      curvesChanged: number;
    };
    expect(result.before.maxC0).toBeCloseTo(0.3, 9);
    expect(result.after.maxC0).toBeLessThan(1e-9);
    expect(result.after.maxC1).toBeLessThan(1e-9);
    expect(result.curvesChanged).toBe(3);
    for (const [control, channel] of [
      [ARM, 'rz'],
      [WAVE.cog, 'tx'],
      [WAVE.cog, 'ty'],
    ] as const) {
      const curve = waveCurve(app, control, channel) as CurveId;
      expect(app.store.get('curves', curve)).toMatchObject({ pre: 'cycle', post: 'cycle' });
      const { c0, c1 } = seam(app, curve);
      expect([channel, c0 < 1e-9, c1 < 1e-9]).toEqual([channel, true, true]);
    }
    expect(app.store.get('clips', WAVE.clip)?.loop).toBe(true);
    expect(app.history.peekUndo()?.label).toBe('AI: Make Loop "wave" (match ends)');
  });

  it('keeps root travel with cycleOffset infinities, or leaves it alone', async () => {
    const app = await brokenWave();
    await agentOk(app, 'clip.makeLoop', { clip: WAVE.clip, method: 'matchEnds', rootTravel: 'cycleOffset' });
    const tx = waveCurve(app, WAVE.cog, 'tx') as CurveId;
    expect(app.store.get('curves', tx)).toMatchObject({ pre: 'cycleOffset', post: 'cycleOffset' });
    expect(app.store.query.keysOfCurve(tx).map((key) => key.v)).toEqual([0, 0.3]);
    expect(seam(app, tx).c1).toBeLessThan(1e-9);
    const kept = await brokenWave();
    const keptTx = waveCurve(kept, WAVE.cog, 'tx') as CurveId;
    const before = { curve: kept.store.get('curves', keptTx), keys: kept.store.query.keysOfCurve(keptTx) };
    await agentOk(kept, 'clip.makeLoop', { clip: WAVE.clip, method: 'matchEnds', rootTravel: 'keep' });
    expect({ curve: kept.store.get('curves', keptTx), keys: kept.store.query.keysOfCurve(keptTx) }).toEqual(before);
  });

  it('blend cross-fades the tail toward the start and closes the seam', async () => {
    const app = await brokenWave();
    const value = (await agentOk(app, 'clip.makeLoop', {
      clip: WAVE.clip,
      method: 'blend',
      blendFrames: 6,
      rootTravel: 'inPlace',
    })) as { after: { maxC0: number; maxC1: number } };
    expect(value.after.maxC0).toBeLessThan(1e-9);
    expect(value.after.maxC1).toBeLessThan(1e-9);
    const arm = waveCurve(app, ARM, 'rz') as CurveId;
    // One key per frame over the last 6 frames; the keys before them are kept.
    expect(app.store.query.keysOfCurve(arm).map((key) => key.t)).toEqual([0, 15, 24, 25, 26, 27, 28, 29, 30]);
    expect(seam(app, arm).c0).toBeLessThan(1e-9);
  });

  it('cycleOnly sets the loop flag and the cycle infinities and leaves the keys', async () => {
    const app = opsApp();
    await app.runUntyped('clip.setSettings', { clip: WAVE.clip, loop: false });
    const arm = waveCurve(app, ARM, 'rz') as CurveId;
    const keys = app.store.query.keysOfCurve(arm);
    await agentOk(app, 'clip.makeLoop', { clip: WAVE.clip, method: 'cycleOnly', rootTravel: 'keep' });
    expect(app.store.query.keysOfCurve(arm)).toEqual(keys);
    expect(app.store.get('curves', arm)).toMatchObject({ pre: 'cycle', post: 'cycle' });
    expect(app.store.get('clips', WAVE.clip)?.loop).toBe(true);
  });

  it('dryRun reports before and after and writes nothing (no step)', async () => {
    const app = await brokenWave();
    const doc = docJson(app);
    const top = app.history.peekUndo()?.id;
    const value = (await agentOk(app, 'clip.makeLoop', {
      clip: WAVE.clip,
      method: 'matchEnds',
      rootTravel: 'inPlace',
      dryRun: true,
    })) as { before: { maxC0: number; worst: unknown[] }; after: { maxC0: number } };
    expect(value.before.maxC0).toBeGreaterThan(0.1);
    expect(value.before.worst[0]).toEqual({ control: WAVE.cog, channel: 'tx' });
    expect(value.after.maxC0).toBeLessThan(1e-9);
    expect(docJson(app)).toEqual(doc);
    expect(app.history.peekUndo()?.id).toBe(top);
  });

  it('polls the method, the root travel, blendFrames and the 100,000-frame span for agents', async () => {
    const app = opsApp();
    const base = { clip: WAVE.clip, rootTravel: 'keep' };
    expect(await agentRefusal(app, 'clip.makeLoop', { ...base, method: 'stitch' })).toMatch(/method/);
    expect(await agentRefusal(app, 'clip.makeLoop', { clip: WAVE.clip, method: 'blend' })).toMatch(/rootTravel/);
    expect(await agentRefusal(app, 'clip.makeLoop', { ...base, method: 'blend', blendFrames: 31 })).toMatch(
      /blendFrames/,
    );
    await app.runUntyped('clip.setSettings', { clip: WAVE.clip, range: { start: 0, end: 200_000 } });
    expect(await agentRefusal(app, 'clip.makeLoop', { ...base, method: 'matchEnds' }, asAgent())).toMatch(
      /100000 frames/,
    );
  });
});
