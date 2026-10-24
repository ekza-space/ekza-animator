// Readiness (STUDIO-TOUCH-SPEC §7.2, ST-36): one list of problem rows for the destination; the status pill shows the
// total (never a per-stage filter, never "All good" while a row exists); glyphs per stage; the budget ring only with a
// budget; the Next chip follows the document; the Path's names carry shape and count.
import { describe, expect, it, vi } from 'vitest';
import { destinationOf } from '../../src/path/destinations';
import { nextChip } from '../../src/path/nextChip';
import { glyphText, stageName, stageSwitch } from '../../src/path/Path';
import { readiness, statusText } from '../../src/path/readiness';
import { everyOperator, polybotApp, runOk } from '../support';

// Headless apps with every chunk load slowly on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

describe('readiness (§7.2)', () => {
  it('is untouched and quiet for an empty project, with no Next chip and no budget', async () => {
    const app = await everyOperator();
    const r = readiness(app, 'exploring');
    expect(r.rows).toEqual([]);
    expect(r.total).toBe(0);
    expect(statusText(r)).toBeNull();
    expect(r.budget).toBeNull();
    expect(r.stages.make.glyph).toBe('untouched');
    expect(nextChip(app, r)).toBeNull();
  });

  it('suggests Rig it for me for a mesh, and asks for a skeleton only where the destination needs one', async () => {
    const app = await everyOperator();
    await runOk(app, 'workspace.set', { workspace: 'model' });
    await runOk(app, 'mesh.create.cube');
    const exploring = readiness(app, 'exploring');
    expect(exploring.rows).toEqual([]);
    expect(nextChip(app, exploring)).toMatchObject({ id: 'rigIt', stage: 'rig' });
    const omoba = readiness(app, 'omoba');
    expect(omoba.rows.map((row) => row.code)).toContain('no-skeleton');
    expect(omoba.total).toBe(omoba.rows.length);
    expect(statusText(omoba)).toBe(`${omoba.total} to fix`);
    expect(omoba.stages.rig.glyph).toBe('warn');
    const prop = readiness(app, 'prop');
    expect(prop.budget?.limit).toBe(600);
    expect(prop.budget?.tris).toBeGreaterThan(0);
  });

  it('counts every row in the total whatever the stage, and suggests animations for a rigged character', async () => {
    const { app } = await polybotApp();
    const r = readiness(app, 'omoba');
    const byStage = Object.values(r.stages).reduce((sum, stage) => sum + stage.count, 0);
    const share = r.rows.filter((row) => row.stage === 'share').length;
    expect(r.total).toBe(byStage + share);
    expect(nextChip(app, readiness(app, 'exploring'))?.id).toBe('share');
    expect(destinationOf('nowhere').id).toBe('exploring');
  }, 60_000);
});

describe('the Path (§7.1, §18)', () => {
  it('names each stage with its glyph meaning and count', () => {
    expect(glyphText({ glyph: 'warn', count: 2 })).toBe('⚠2');
    expect(glyphText({ glyph: 'ready', count: 0 })).toBe('●');
    expect(stageName('rig', { glyph: 'warn', count: 2 })).toBe('Rig, 2 things to fix');
    expect(stageName('paint', { glyph: 'untouched', count: 0 })).toBe('Paint, untouched');
  });

  it('switches the workspace only when it changes, after ending the tool session', async () => {
    const app = await everyOperator();
    await runOk(app, 'workspace.set', { workspace: 'model' });
    expect(stageSwitch(app, 'paint')).toEqual([{ op: 'edit.escape' }]);
    expect(stageSwitch(app, 'rig')).toEqual([
      { op: 'edit.escape' },
      { op: 'workspace.set', args: { workspace: 'rig' } },
    ]);
  });
});
