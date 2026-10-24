// Health (STUDIO-TOUCH-SPEC §7.2, §7.3, §12.1, §15 rows 5.3, 5.14, 6.8): the sheet lists exactly the readiness rows of
// the destination (the status pill's number) grouped by stage; a Mesh Check problem shows a row whose Fix runs
// `mesh.cleanup` and fixes it; the Fixes group holds every fix operator the manifest places in Health, greyed with the
// poll's reason where it cannot run; the model check runs `autorig.inspect` and offers `autorig.fix` in Auto-Rig's
// fix order; the Rig checks' profile follows the destination (`rig.validation.profile`).
import type { MeshId } from '@ekza-studio/doc';
import { AUTORIG_FIX_ORDER, type EditorApp, type IntakeReport, rigValidation } from '@ekza-studio/editor-core';
import { describe, expect, it } from 'vitest';
import { DISCLOSURE } from '../../src/manifest/disclosure';
import { entriesOf } from '../../src/manifest/types';
import { DESTINATIONS } from '../../src/path/destinations';
import { readiness, statusText } from '../../src/path/readiness';
import {
  type HealthControl,
  type HealthModel,
  headerText,
  healthModel,
  profileSwitch,
  sectionTarget,
} from '../../src/sheets/health/model';
import { everyOperator, polybotApp, runOk } from '../support';

/** Every operator a control of the model runs (rows, model check, profile, Fixes and their choices). */
function operatorsOf(model: HealthModel): Set<string> {
  const ops = new Set<string>();
  const add = (control: HealthControl): void => {
    ops.add(control.op);
    for (const choice of control.choices ?? []) add(choice);
  };
  for (const group of model.groups) {
    for (const row of group.rows) {
      if (row.fix !== null) ops.add(row.fix.op);
      if (row.show !== null) ops.add(row.show.op);
    }
  }
  for (const row of model.beforeRigging) if (row.action !== null) add(row.action);
  add(model.inspect);
  add(model.profile.control);
  for (const fix of model.fixes) add(fix);
  return ops;
}

/** The operators the manifest places in a Health section (plain surfaces; the `workspace.showPanel` mapping aside). */
function manifestHealthOps(section: string): string[] {
  return Object.entries(DISCLOSURE)
    .filter(([, value]) =>
      entriesOf(value).some(
        (entry) =>
          'surfaces' in entry &&
          entry.when === undefined &&
          entry.surfaces.some((s) => 'sheet' in s && s.sheet === 'health' && s.section === section),
      ),
    )
    .map(([id]) => id);
}

/** A cube with one face turned the other way: Mesh Check's `inconsistent-winding`, fixed by `conform`. */
async function flippedCube(app: EditorApp): Promise<MeshId> {
  await runOk(app, 'workspace.set', { workspace: 'model' });
  const { mesh } = await runOk<{ mesh: MeshId }>(app, 'mesh.create.cube');
  await runOk(app, 'select.mode', { mode: 'face' });
  app.components.apply(mesh, 'face', [0], 'replace');
  await runOk(app, 'mesh.reverse');
  await runOk(app, 'select.mode', { mode: 'object' });
  return mesh;
}

describe('Health (§7.2)', () => {
  it('lists exactly the readiness rows of each destination, grouped by stage, with the pill’s number', async () => {
    const app = await everyOperator();
    await runOk(app, 'workspace.set', { workspace: 'model' });
    await runOk(app, 'mesh.create.cube');
    for (const destination of DESTINATIONS) {
      const r = readiness(app, destination.id);
      const model = healthModel(app, destination.id);
      expect(model.total).toBe(r.total);
      const listed = model.groups.flatMap((group) => group.rows.map((row) => row.id));
      expect(listed).toEqual(r.rows.map((row) => row.id));
      for (const group of model.groups) expect(group.rows.every((row) => row.stage === group.stage)).toBe(true);
      expect(model.groups.map((group) => group.stage).slice(0, 4)).toEqual(['make', 'paint', 'rig', 'animate']);
      expect(model.header).toBe(headerText(r.total, destination));
      expect(model.header).toBe(
        r.total > 0 ? `${statusText(r) ?? ''} · for ${destination.name}` : `Nothing to fix for ${destination.name}`,
      );
      expect(model.header).not.toMatch(/all good/i);
    }
    const omoba = healthModel(app, 'omoba');
    const rig = omoba.groups.find((group) => group.stage === 'rig');
    expect(rig?.glyph).toBe(`⚠${rig?.rows.length}`);
    expect(rig?.rows[0]?.fix).toMatchObject({ op: 'skel.quickRig.start', label: 'Fix', plain: 'Rig it for me' });
    expect(omoba.legend.map((entry) => entry.text)).toEqual(['○', '◐', '●', '⚠n', '·']);
    expect(omoba.destinations.map((d) => d.id)).toEqual(DESTINATIONS.map((d) => d.id));
  }, 60_000);

  it('shows a Mesh Check problem whose Fix runs mesh.cleanup and whose Show me selects it', async () => {
    const app = await everyOperator();
    const mesh = await flippedCube(app);
    const model = healthModel(app, 'exploring');
    const row = model.groups.find((group) => group.stage === 'make')?.rows.find((r) => r.ids.includes(mesh));
    expect(row).toMatchObject({ rule: 'inconsistent-winding', profile: null });
    expect(row?.fix).toMatchObject({
      op: 'mesh.cleanup',
      args: { meshes: [mesh], fix: 'conform', selectOnly: false },
      label: 'Fix',
      plain: 'Turn every face the same way',
    });
    expect(row?.show).toMatchObject({ op: 'select.mesh.matching', args: { mesh, code: 'inconsistent-winding' } });
    expect(model.total).toBe(readiness(app, 'exploring').total);
    expect(model.total).toBeGreaterThan(0);
    await runOk(app, row?.show?.op ?? '', row?.show?.args);
    expect(app.session.getState().model.hilite).toContain(mesh);
    await runOk(app, row?.fix?.op ?? '', row?.fix?.args);
    expect(
      healthModel(app, 'exploring')
        .groups.flatMap((g) => g.rows)
        .filter((r) => r.ids.includes(mesh)),
    ).toEqual([]);
  }, 60_000);

  it('reaches every fix operator the manifest places in Health, greyed with the poll’s reason when it cannot run', async () => {
    const app = await everyOperator();
    const empty = healthModel(app, 'exploring');
    const fixes = new Set(empty.fixes.map((fix) => fix.op));
    // Show me and the model check's fixes are per row (the other tests run them); every other one is in Fixes.
    const perRow = new Set(['select.mesh.matching', 'autorig.fix']);
    expect(manifestHealthOps('problems').filter((op) => !perRow.has(op) && !fixes.has(op))).toEqual([]);
    expect(manifestHealthOps('checks').filter((op) => !operatorsOf(empty).has(op))).toEqual([]);
    // Nothing to work on yet: every row is greyed with a reason.
    expect(empty.fixes.filter((fix) => fix.enabled || fix.reason === null).map((fix) => fix.op)).toEqual([]);
    // A shape: the cleanups and the placement fixes poll true.
    await flippedCube(app);
    const shaped = healthModel(app, 'exploring');
    const byOp = new Map(shaped.fixes.map((fix) => [fix.op, fix]));
    expect(byOp.get('mesh.cleanup')?.enabled).toBe(true);
    expect(byOp.get('mesh.cleanup')?.choices?.map((choice) => choice.args)).toContainEqual(
      expect.objectContaining({ fix: 'conform', selectOnly: false }),
    );
    expect(byOp.get('skel.quickRig.center')?.enabled).toBe(true);
    expect(byOp.get('skin.weights.normalize')?.enabled).toBe(false);
    expect(typeof byOp.get('skin.weights.normalize')?.reason).toBe('string');
    await runOk(app, 'skel.quickRig.center', byOp.get('skel.quickRig.center')?.args);
  }, 60_000);

  it('runs the model check (autorig.inspect) and offers autorig.fix in Auto-Rig’s fix order', async () => {
    const app = await everyOperator();
    await flippedCube(app);
    const before = healthModel(app, 'exploring');
    expect(before.modelCheck).toBeNull();
    expect(before.inspect).toMatchObject({ op: 'autorig.inspect', enabled: true, plain: 'Check the model' });
    // Move it off the centre so the check fails one row.
    const mesh = (before.inspect.args as { meshes: MeshId[] }).meshes[0] as MeshId;
    await runOk(app, 'scene.object.transform', {
      ids: [mesh],
      placements: [{ t: [3, 2, 0], q: [0, 0, 0, 1], s: [1, 1, 1] }],
    });
    const report = await runOk<IntakeReport>(app, 'autorig.inspect', before.inspect.args);
    const run = { report, meshes: (before.inspect.args as { meshes: MeshId[] }).meshes };
    const after = healthModel(app, 'exploring', run);
    expect(after.modelCheck?.map((row) => row.fix)).toEqual([...AUTORIG_FIX_ORDER]);
    expect(after.inspect.plain).toBe('Check again');
    const centre = after.beforeRigging.find((row) => row.fix === 'center');
    expect(centre?.action).toMatchObject({ op: 'autorig.fix', args: { fix: 'center', meshes: [mesh] }, enabled: true });
    expect(after.suggestions).toMatch(/before rigging/);
    expect(after.checks.find((check) => check.id === 'model')?.ran).toBe(true);
    await runOk(app, 'autorig.fix', centre?.action?.args);
    const again = await runOk<IntakeReport>(app, 'autorig.inspect', before.inspect.args);
    expect(again.checks.centred && again.checks.grounded).toBe(true);
  }, 60_000);

  it('keeps the Rig checks on the destination’s profile and scrolls to a stage', async () => {
    const { app } = await polybotApp();
    rigValidation(app).setProfile('local/generic');
    const omoba = healthModel(app, 'omoba');
    expect(omoba.profile).toMatchObject({ wanted: 'ekza/space-avatar-v1', current: 'local/generic' });
    expect(omoba.profile.control).toMatchObject({ op: 'rig.validation.profile', enabled: true });
    const call = profileSwitch(app, 'omoba');
    expect(call).toEqual({ op: 'rig.validation.profile', args: { profile: 'ekza/space-avatar-v1' } });
    await runOk(app, call?.op ?? '', call?.args);
    expect(rigValidation(app).profile).toBe('ekza/space-avatar-v1');
    expect(profileSwitch(app, 'omoba')).toBeNull();
    expect(healthModel(app, 'omoba').profile.control).toMatchObject({ enabled: false });
    expect(profileSwitch(app, 'exploring')).toBeNull();
    const rows = healthModel(app, 'omoba').groups.flatMap((group) => group.rows);
    expect(rows.length).toBe(readiness(app, 'omoba').total);
    for (const row of rows.filter((r) => r.stage !== 'make')) expect(row.profile).toBe('ekza/space-avatar-v1');
    expect(sectionTarget('rig')).toBe('stage-rig');
    expect(sectionTarget('checks')).toBe('checks');
    expect(sectionTarget('nowhere')).toBeNull();
  }, 60_000);
});
