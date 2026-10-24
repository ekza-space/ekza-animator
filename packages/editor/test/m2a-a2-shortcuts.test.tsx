// M2A-SPEC §5.17 (A2): the arrow keys always run select.pickWalk, which runs the time operators when
// prefs.arrowKeys is 'frames'; the shortcut sheet labels the arrows with the behaviour that is active.
import { pickWalkDispatch, registerBuiltinOperators } from '@ekza-studio/editor-core';
import { describe, expect, it } from 'vitest';
import { shortcutRows } from '../src/dialogs/ShortcutsDialog';
import { createTestShell } from './shell-helpers';

const arrowRows = (rows: ReturnType<typeof shortcutRows>) =>
  rows.filter((row) => /Arrow|[←↑→↓]/.test(row.keys)).map((row) => `${row.scope} ${row.keys}: ${row.label}`);

describe('shortcut sheet: arrow keys (§5.17)', () => {
  it("shows Pick Walk by default and the time operators with prefs.arrowKeys 'frames'", async () => {
    // The fake app contributes the `dcc` keymap; the built-in operators give the rows their labels.
    const { app } = createTestShell({ platform: 'other' });
    registerBuiltinOperators(app);
    // M6A-SPEC §3 rule 9 literal update (§7 arrows in `model.viewport.component`): the control pick-walk rows are
    // `Pick Walk (…)`; Model's component pick-walk rows are 'Pick Walk Components (…)'.
    const controlWalk = (label: string): boolean => label.startsWith('Pick Walk (');
    const walk = shortcutRows(app).filter((row) => controlWalk(row.label));
    // ↑ ↓ ← → and their Shift forms, in the viewport and Channel Box scopes.
    expect(walk.map((row) => row.label).sort()).toEqual(
      [
        ...['up', 'down', 'left', 'right'].map((direction) => `Pick Walk (${direction})`),
        ...['up', 'down', 'left', 'right'].map((direction) => `Pick Walk (${direction}, true)`),
      ]
        .flatMap((label) => [label, label])
        .sort(),
    );
    expect(walk.every((row) => row.available)).toBe(true);
    expect(new Set(walk.map((row) => row.scope))).toEqual(new Set(['viewport', 'channelBox']));

    const before = arrowRows(shortcutRows(app));
    await app.run('prefs.set', { patch: { arrowKeys: 'frames' } });
    const rows = shortcutRows(app);
    expect(rows.some((row) => controlWalk(row.label))).toBe(false);
    const labels = (scope: string) =>
      rows
        .filter((row) => row.scope === scope && before.some((line) => line.startsWith(`${scope} ${row.keys}:`)))
        .map((row) => row.label);
    for (const scope of ['viewport', 'channelBox']) {
      expect(new Set(labels(scope))).toEqual(
        new Set(['Next Key', 'Previous Key', 'Step Frames (-1)', 'Step Frames (1)']),
      );
    }
  });

  it('pickWalkDispatch: null while walking; the §5.17 time operator per direction with frames', async () => {
    const { app } = createTestShell();
    expect(pickWalkDispatch(app, { direction: 'up' })).toBeNull();
    await app.run('prefs.set', { patch: { arrowKeys: 'frames' } });
    expect(pickWalkDispatch(app, { direction: 'up' })).toEqual({ op: 'time.nextKey' });
    expect(pickWalkDispatch(app, { direction: 'down' })).toEqual({ op: 'time.prevKey' });
    expect(pickWalkDispatch(app, { direction: 'left', add: true })).toEqual({ op: 'time.step', args: { delta: -1 } });
    expect(pickWalkDispatch(app, { direction: 'right' })).toEqual({ op: 'time.step', args: { delta: 1 } });
    expect(pickWalkDispatch(app, { direction: 'sideways' })).toBeNull();
    expect(pickWalkDispatch(app, undefined)).toBeNull();
  });
});
