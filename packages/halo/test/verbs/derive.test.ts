// ⋯ More and search, derived (STUDIO-TOUCH-SPEC §6.3, §8, §20.5 test 10): rows read `plain · Pro name · hotkey`,
// failing polls stay listed with their reason, per-argument entries give one row per value, ⚙ marks option boxes and
// forms, the filter narrows by plain or Pro words, nouns resolve from the selection, and search lists every operator
// with an entry in every stage.
import type { ControlId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import { DISCLOSURE } from '../../src/manifest/disclosure';
import { STAGES } from '../../src/manifest/types';
import { fixFor, moreGroups, searchEntries } from '../../src/verbs/derive';
import { EMPTY_NOUN, resolveNoun } from '../../src/verbs/nouns';
import { everyOperator, polybotApp, runOk } from '../support';

describe('More (§6.3)', () => {
  it('lists a face’s petals first, then its groups, each with plain · Pro name · hotkey', async () => {
    const app = await everyOperator();
    await runOk(app, 'workspace.set', { workspace: 'model' });
    const groups = moreGroups(app, 'faces', 'make');
    expect(groups[0]?.title).toBe('On the Halo');
    const pull = groups[0]?.rows.find((row) => row.op === 'mesh.extrude');
    expect(pull).toMatchObject({ plain: 'Pull', pro: 'Extrude', petal: true, options: true });
    expect(groups.map((g) => g.title)).toEqual(expect.arrayContaining(['Shape', 'Select', 'Colour & surface']));
    const bridge = groups.flatMap((g) => g.rows).find((row) => row.op === 'mesh.bridge');
    // Nothing is selected: the poll fails and the row stays, greyed, with its reason.
    expect(bridge?.enabled).toBe(false);
    expect(bridge?.reason).toEqual(expect.any(String));
  });

  it('gives one row per argument value and labels them', async () => {
    const app = await everyOperator();
    const rings = moreGroups(app, 'mesh', 'make')
      .flatMap((g) => g.rows)
      .filter((row) => row.op === 'view.tool');
    expect(rings.map((row) => row.plain)).toEqual(['Move ring', 'Turn ring', 'Scale ring']);
    expect(rings.map((row) => (row.args as { tool: string }).tool)).toEqual(['move', 'rotate', 'scale']);
  });

  it('narrows by plain and Pro words, and shows only the rows of the stage', async () => {
    const app = await everyOperator();
    const filtered = moreGroups(app, 'faces', 'make', { filter: 'extrude' }).flatMap((g) => g.rows);
    expect(filtered.map((row) => row.op)).toEqual(['mesh.extrude']);
    const animate = moreGroups(app, 'empty', 'animate').flatMap((g) => g.rows);
    expect(animate.some((row) => row.op === 'mesh.create.cube')).toBe(false);
    expect(animate.some((row) => row.op === 'clip.new')).toBe(true);
  });

  it('offers a one-tap fix for reasons an operator removes', () => {
    expect(fixFor('Needs a bound skin')).toMatchObject({ op: 'skin.bind' });
    expect(fixFor('Something else')).toBeNull();
  });
});

describe('nouns (§6.1)', () => {
  it('resolves the empty space, a selected control in Animate and a selected mesh in Make', async () => {
    const { app, character } = await polybotApp();
    expect(resolveNoun(app, 'animate')).toEqual(EMPTY_NOUN);
    const control = app.store.list('controls').find((c) => c.deleted === null && c.key.startsWith('fk.')) as {
      id: ControlId;
    };
    await runOk(app, 'select.controls', { ids: [control.id], mode: 'replace' });
    expect(resolveNoun(app, 'animate')).toMatchObject({ id: control.id, character });
    const model = await everyOperator();
    await runOk(model, 'workspace.set', { workspace: 'model' });
    const { mesh } = await runOk<{ mesh: string }>(model, 'mesh.create.cube');
    await runOk(model, 'select.objects', { ids: [mesh], mode: 'replace' });
    expect(resolveNoun(model, 'make')).toMatchObject({ kind: 'mesh', id: mesh });
  }, 60_000);
});

describe('search (§8, §20.5 test 10)', () => {
  it('lists every operator that has a non-plumbing entry, with the stages that show it', async () => {
    const app = await everyOperator();
    const entries = searchEntries(app);
    const listed = new Set(entries.map((e) => e.op));
    const expected = Object.entries(DISCLOSURE)
      .filter(([, value]) =>
        (Array.isArray(value) ? value : [value]).some((entry) => !('plumbing' in entry) && !('wraps' in entry)),
      )
      .map(([id]) => id);
    expect(expected.filter((id) => !listed.has(id))).toEqual([]);
    for (const entry of entries) expect(entry.stages.every((stage) => STAGES.includes(stage))).toBe(true);
    expect(entries.find((e) => e.op === 'workspace.preset.apply')?.proOnly).toBe(true);
  });
});
