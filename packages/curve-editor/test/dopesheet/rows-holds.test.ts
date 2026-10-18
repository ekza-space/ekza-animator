// Dope Sheet rows and row data (M2A-SPEC §5.10, A3): Summary › Character › Body part › Control › Channel on the
// humanoid wave rig, expansion, Show, dimmed rows, glyph aggregation (key / breakdown / selected), the channel hold
// rule and the aggregate hold rule's cases.
import type { CurveId } from '@ekza-animator/doc';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDopeSheetRows, holdIntervals } from '../../src';
import {
  CONTROLS,
  dopeApp,
  keyCurve,
  type MountedSheet,
  mountSheet,
  selectControls,
  setKeySelection,
  WAVE,
} from './fixture';

let mounted: MountedSheet | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

/** The wave app with its wave curve's keys removed: only the keys a test sets animate. */
async function setUp(): Promise<MountedSheet> {
  mounted = mountSheet(await dopeApp());
  keyCurve(mounted.app, CONTROLS.lowerArmL, 'rz', []);
  return mounted;
}

const DEG = Math.PI / 180;

/** E2E-M2A-10's keys: the three arm controls' rz at 0/10/20 (0°/30°/60°); the wave curve keeps its rz keys. */
function armKeys(m: MountedSheet) {
  const points = [
    [0, 0],
    [10, 30 * DEG],
    [20, 60 * DEG],
  ] as const;
  return {
    upper: keyCurve(m.app, CONTROLS.upperArmL, 'rz', points),
    lower: keyCurve(m.app, CONTROLS.lowerArmL, 'rz', points),
    hand: keyCurve(m.app, CONTROLS.handL, 'rz', points),
  };
}

describe('rows (§5.10)', () => {
  it('lists Summary › Character › Body part › Control for the shown controls with keys, groups in body order', async () => {
    const m = await setUp();
    armKeys(m);
    keyCurve(m.app, CONTROLS.cog, 'ty', [[0, 0]]);
    keyCurve(m.app, CONTROLS.upperLegL, 'rx', [[5, 1]]);
    const rows = m.sheet.rows();
    expect(rows.map((row) => [row.id, row.kind, row.label, row.depth, row.expanded])).toEqual([
      ['summary', 'summary', 'Summary', 0, true],
      [`chr:${WAVE.character}`, 'character', 'Synthetic Humanoid', 1, true],
      [`grp:${WAVE.character}:torso`, 'group', 'Torso', 2, true],
      [CONTROLS.cog, 'control', 'COG', 3, false],
      [`grp:${WAVE.character}:arm.L`, 'group', 'Arm L', 2, true],
      [CONTROLS.upperArmL, 'control', 'L Upper Arm', 3, false],
      [CONTROLS.lowerArmL, 'control', 'L Lower Arm', 3, false],
      [CONTROLS.handL, 'control', 'L Hand', 3, false],
      [`grp:${WAVE.character}:leg.L`, 'group', 'Leg L', 2, true],
      [CONTROLS.upperLegL, 'control', 'L Upper Leg', 3, false],
    ]);
    expect(rows[0]?.curves).toHaveLength(5);
    expect(rows[4]?.group).toBe('arm.L');
    // Controls without keyed curves get no row (the hips are not keyed).
    expect(rows.some((row) => row.id === CONTROLS.hips)).toBe(false);
  });

  it('expands control rows into keyed channel rows; collapsing a parent hides its subtree', async () => {
    const m = await setUp();
    keyCurve(m.app, CONTROLS.handL, 'rz', [[0, 1]]);
    keyCurve(m.app, CONTROLS.handL, 'tx', [[0, 1]]);
    keyCurve(m.app, CONTROLS.handL, 'ry', []);
    m.sheet.setExpanded(CONTROLS.handL, true);
    const channels = m.sheet.rows().filter((row) => row.kind === 'channel');
    expect(channels.map((row) => [row.id, row.label, row.depth, row.channel])).toEqual([
      [`${CONTROLS.handL}/tx`, 'Translate X', 4, 'tx'],
      [`${CONTROLS.handL}/rz`, 'Rotate Z', 4, 'rz'],
    ]);
    m.sheet.setExpanded(`grp:${WAVE.character}:arm.L`, false);
    expect(m.sheet.rows().map((row) => row.kind)).toEqual(['summary', 'character', 'group']);
    m.sheet.setExpanded('summary', false);
    expect(m.sheet.rows().map((row) => row.id)).toEqual(['summary']);
    expect(m.sheet.expansionState()).toEqual({
      [CONTROLS.handL]: true,
      [`grp:${WAVE.character}:arm.L`]: false,
      summary: false,
    });
    m.sheet.restoreExpansion({});
    expect(m.sheet.rows().map((row) => row.kind)).toEqual(['summary', 'character', 'group', 'control']);
  });

  it('Show "Selected" lists the selected controls (all when none); "Character" every keyed control', async () => {
    const m = await setUp();
    armKeys(m);
    selectControls(m.app, [CONTROLS.handL, CONTROLS.upperArmL]);
    expect(m.sheet.show).toBe('selected');
    expect(
      m.sheet
        .rows()
        .filter((row) => row.kind === 'control')
        .map((row) => row.id),
    ).toEqual([CONTROLS.upperArmL, CONTROLS.handL]);
    m.sheet.setShow('character');
    expect(m.sheet.rows().filter((row) => row.kind === 'control')).toHaveLength(3);
    expect(m.sheet.shownControls()).toHaveLength(27);
    expect(() => m.sheet.setShow('nope' as 'character')).toThrow('Unknown show');
  });

  it('lists a hidden control dimmed', async () => {
    const m = await setUp();
    armKeys(m);
    m.app.session.setState({ hiddenControls: new Set([CONTROLS.handL]) });
    const hand = m.sheet.rows().find((row) => row.id === CONTROLS.handL);
    expect(hand?.dimmed).toBe(true);
    expect(m.sheet.rows().find((row) => row.id === CONTROLS.upperArmL)?.dimmed).toBe(false);
  });

  it('buildDopeSheetRows takes the expanded set and the controls; generic rigs have no groups', async () => {
    const m = await setUp();
    armKeys(m);
    const expanded = new Set(['summary', `chr:${WAVE.character}`]);
    const rows = buildDopeSheetRows(m.app, {
      clip: WAVE.clip,
      controls: [CONTROLS.handL],
      expanded,
      show: 'selected',
    });
    expect(rows.map((row) => [row.id, row.expanded])).toEqual([
      ['summary', true],
      [`chr:${WAVE.character}`, true],
      [`grp:${WAVE.character}:arm.L`, false],
    ]);
    expect(buildDopeSheetRows(m.app, { clip: null, controls: [], expanded, show: 'selected' })).toEqual([]);
    const rig = m.app.store.get('rigs', 'rig_SyntheticWave001' as never);
    m.app.store.transact({ label: 'Generic', undoable: false }, (tx) =>
      tx.patch('rigs', 'rig_SyntheticWave001' as never, { generator: { ...rig!.generator, name: 'ekza-autorig-generic' } }),
    );
    const generic = buildDopeSheetRows(m.app, {
      clip: WAVE.clip,
      controls: [CONTROLS.handL, CONTROLS.upperArmL],
      expanded,
      show: 'selected',
    });
    expect(generic.map((row) => [row.kind, row.depth])).toEqual([
      ['summary', 0],
      ['character', 1],
      ['control', 2],
      ['control', 2],
    ]);
  });
});

describe('glyphs (§5.10)', () => {
  it('aggregates key times; a breakdown glyph only when every key there is one; selected only when all are', async () => {
    const m = await setUp();
    const { upper, lower, hand } = armKeys(m);
    m.app.store.transact({ label: 'Breakdowns', undoable: false }, (tx) => {
      for (const curve of [upper, lower, hand]) tx.patch('keys', curve.keys[1]!, { breakdown: true });
      tx.patch('keys', hand.keys[2]!, { breakdown: true });
    });
    setKeySelection(m.app, [upper.keys[0]!, lower.keys[0]!, hand.keys[0]!, upper.keys[2]!]);
    const summary = m.sheet.rows()[0]!;
    expect(m.sheet.rowState(summary)).toEqual({ keys: [0, 10, 20], breakdowns: [10], selected: [0], holds: [] });
    const handRow = m.sheet.rows().find((row) => row.id === CONTROLS.handL)!;
    expect(m.sheet.rowState(handRow)).toMatchObject({ keys: [0, 10, 20], breakdowns: [10, 20], selected: [0] });
  });

  it('merges fractional key times closer than 1e-6', async () => {
    const m = await setUp();
    keyCurve(m.app, CONTROLS.handL, 'rz', [
      [2.5, 0],
      [7.25, 1],
    ]);
    keyCurve(m.app, CONTROLS.upperArmL, 'rz', [
      [2.5000001, 0],
      [7.3, 1],
    ]);
    expect(m.sheet.rowState(m.sheet.rows()[0]!).keys).toEqual([2.5, 7.25, 7.3]);
  });
});

describe('hold bars (§5.10)', () => {
  const holdsOf = (m: MountedSheet, id: string) => m.sheet.rowState(m.sheet.rows().find((row) => row.id === id)!).holds;

  it('channel rule: equal values with auto tangents hold; a spline overshoot does not', async () => {
    const m = await setUp();
    m.sheet.setExpanded(CONTROLS.handL, true);
    keyCurve(m.app, CONTROLS.handL, 'rz', [
      [0, 0],
      [10, 1],
      [20, 1],
      [30, 1],
    ]);
    expect(holdsOf(m, `${CONTROLS.handL}/rz`)).toEqual([
      [10, 20],
      [20, 30],
    ]);
    keyCurve(
      m.app,
      CONTROLS.handL,
      'rz',
      [
        [0, 0],
        [10, 1],
        [20, 1],
        [30, 0],
      ],
      { tangent: 'spline' },
    );
    expect(holdsOf(m, `${CONTROLS.handL}/rz`)).toEqual([]);
  });

  it('aggregate rule: a child interpolating through a sibling-keyed interval breaks the hold', async () => {
    const m = await setUp();
    keyCurve(m.app, CONTROLS.handL, 'rz', [
      [0, 1],
      [20, 1],
    ]);
    keyCurve(m.app, CONTROLS.upperArmL, 'rz', [
      [0, 2],
      [10, 2],
      [20, 2],
    ]);
    expect(holdsOf(m, CONTROLS.handL)).toEqual([[0, 20]]);
    expect(holdsOf(m, CONTROLS.upperArmL)).toEqual([
      [0, 10],
      [10, 20],
    ]);
    expect(holdsOf(m, 'summary')).toEqual([]);
  });

  it('aggregate rule: a child keyed at t_i only breaks it; a child with no key there and a constant infinity holds', async () => {
    const m = await setUp();
    keyCurve(m.app, CONTROLS.handL, 'rz', [
      [0, 1],
      [10, 1],
    ]);
    keyCurve(m.app, CONTROLS.upperArmL, 'rz', [
      [0, 2],
      [10, 2],
      [20, 2],
      [30, 2],
    ]);
    // [10, 20]: the hand is keyed at 10 but not at 20 (it stopped being keyed); [20, 30]: no hand key, constant post.
    expect(holdsOf(m, 'summary')).toEqual([
      [0, 10],
      [20, 30],
    ]);
    // A cycling post infinity is not constant (§5.10).
    keyCurve(
      m.app,
      CONTROLS.handL,
      'rz',
      [
        [0, 1],
        [10, 1],
      ],
      { curve: { post: 'cycle' } },
    );
    expect(holdsOf(m, 'summary')).toEqual([[0, 10]]);
  });

  it('E2E-M2A-10: a hold key on one child holds its row but not the summary (aggregate rule 2)', async () => {
    const m = await setUp();
    const points = [
      [0, 0],
      [20, 30 * DEG],
      [40, 60 * DEG],
    ] as const;
    keyCurve(m.app, CONTROLS.upperArmL, 'rz', points);
    keyCurve(m.app, CONTROLS.lowerArmL, 'rz', points);
    keyCurve(m.app, CONTROLS.handL, 'rz', [...points, [50, 60 * DEG]]);
    expect(holdsOf(m, CONTROLS.handL)).toContainEqual([40, 50]);
    expect(holdsOf(m, 'summary')).not.toContainEqual([40, 50]);
  });

  it('holdIntervals runs the aggregate rule over any curves and key times', async () => {
    const m = await setUp();
    const a = keyCurve(m.app, CONTROLS.handL, 'rz', [
      [0, 1],
      [10, 1],
    ]);
    const b = keyCurve(m.app, CONTROLS.upperArmL, 'rz', [
      [0, 2],
      [5, 2],
      [10, 2],
    ]);
    expect(holdIntervals(m.app, [a.curve], [0, 10])).toEqual([[0, 10]]);
    expect(holdIntervals(m.app, [a.curve, b.curve] as CurveId[], [10, 5, 0])).toEqual([]);
    expect(holdIntervals(m.app, [b.curve], [0, 5, 10])).toEqual([
      [0, 5],
      [5, 10],
    ]);
  });

  it('stepped spans of channel rows are reported for hatching', async () => {
    const m = await setUp();
    m.sheet.setExpanded(CONTROLS.handL, true);
    keyCurve(
      m.app,
      CONTROLS.handL,
      'rz',
      [
        [0, 0],
        [10, 1],
      ],
      { tangent: 'step' },
    );
    // A stepped span with different values: no hold (it is drawn hatched instead).
    expect(holdsOf(m, `${CONTROLS.handL}/rz`)).toEqual([]);
  });
});
