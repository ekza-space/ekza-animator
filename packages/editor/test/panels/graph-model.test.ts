import { buildChannelTree, type ChannelTreeNode } from '@ekza-animator/curve-editor';
import type { CharacterId, ClipId, ControlId, CurveId, DocSnapshot, KeyId } from '@ekza-animator/doc';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  applyChannelSelection,
  common,
  flattenRows,
  formatField,
  frameValueFields,
  listedControls,
  rowRefs,
  sameTree,
  selectedKeys,
  toolbarState,
  visibleCurves,
} from '../../src/panels/graph/model';
import { readSynthetic } from '../render';

const CHARACTER = 'chr_SyntheticWave001' as CharacterId;
const CLIP = 'clp_SyntheticWave001' as ClipId;
const CURVE = 'crv_SyntheticWave001' as CurveId;
const LOWER_ARM = 'rig_SyntheticWave001:fk.lowerArm.L' as ControlId;
const UPPER_ARM = 'rig_SyntheticWave001:fk.upperArm.L' as ControlId;
const ROOT = 'rig_SyntheticWave001:root' as ControlId;
const KEYS = ['k_SynthWave001', 'k_SynthWave002', 'k_SynthWave003'] as unknown as readonly [KeyId, KeyId, KeyId];
const KEY_PART = { key: true, in: false, out: false };

let snapshot: DocSnapshot;
let app: FakeEditorApp;
beforeAll(async () => {
  snapshot = (await readSynthetic('wave-doc.json')) as DocSnapshot;
});
afterEach(() => app.dispose());

const tree = (controls: readonly ControlId[]): ChannelTreeNode[] => buildChannelTree(app, { clip: CLIP, controls });

describe('Graph panel model', () => {
  it('compares channel trees by what they show, so key edits keep the rendered tree', () => {
    app = createFakeEditorApp({ snapshot });
    const before = tree([LOWER_ARM, UPPER_ARM]);
    app.store.transact({ label: 'Nudge' }, (tx) => tx.patch('keys', KEYS[1], { v: -0.2 }));
    const after = tree([LOWER_ARM, UPPER_ARM]);
    expect(after).not.toBe(before);
    expect(sameTree(before, after)).toBe(true);
    expect(sameTree(before, tree([LOWER_ARM]))).toBe(false);
    expect(sameTree(before, tree([UPPER_ARM, LOWER_ARM]))).toBe(false);
    expect(sameTree(before, buildChannelTree(app, { clip: CLIP, controls: [LOWER_ARM, UPPER_ARM], filter: 'x' }))).toBe(
      false,
    );
    // A curve appearing on a channel changes the row (its curve id).
    expect(sameTree(before, buildChannelTree(app, { clip: null, controls: [LOWER_ARM, UPPER_ARM] }))).toBe(false);
  });

  it('lists the selected controls of the active character, else its animated controls', () => {
    app = createFakeEditorApp({ snapshot });
    const context = { character: CHARACTER, clip: CLIP, selectedControls: [] as ControlId[] };
    expect(listedControls(app.store, context)).toEqual([LOWER_ARM]);
    expect(listedControls(app.store, { ...context, selectedControls: [ROOT, UPPER_ARM] })).toEqual([ROOT, UPPER_ARM]);
    expect(listedControls(app.store, { ...context, character: null })).toEqual([]);
    expect(listedControls(app.store, { ...context, clip: null })).toEqual([]);
    expect(
      listedControls(app.store, { ...context, selectedControls: ['rig_Other000000000:root' as ControlId] }),
    ).toEqual([LOWER_ARM]);
  });

  it('shows the selected channels with curves, else every listed curve, minus hidden ones', () => {
    app = createFakeEditorApp({ snapshot });
    const nodes = tree([LOWER_ARM, ROOT]);
    expect(visibleCurves(nodes, [], new Set())).toEqual([CURVE]);
    expect(visibleCurves(nodes, [{ control: LOWER_ARM, channel: 'rz' }], new Set())).toEqual([CURVE]);
    expect(visibleCurves(nodes, [{ control: ROOT, channel: 'tx' }], new Set())).toEqual([CURVE]);
    expect(visibleCurves(nodes, [], new Set([`${LOWER_ARM}/rz`]))).toEqual([]);
  });

  it('flattens rows depth-first and hides the children of collapsed rows', () => {
    app = createFakeEditorApp({ snapshot });
    const nodes = tree([LOWER_ARM]);
    expect(flattenRows(nodes, new Set()).map((row) => [row.node.id, row.depth])).toEqual([
      [CHARACTER, 0],
      [LOWER_ARM, 1],
      [`${LOWER_ARM}/rx`, 2],
      [`${LOWER_ARM}/ry`, 2],
      [`${LOWER_ARM}/rz`, 2],
    ]);
    const collapsed = flattenRows(nodes, new Set([LOWER_ARM]));
    expect(collapsed.map((row) => row.node.id)).toEqual([CHARACTER, LOWER_ARM]);
    expect(collapsed[1]?.expanded).toBe(false);
    const control = nodes[0]?.children[0] as ChannelTreeNode;
    expect(rowRefs(control)).toEqual([{ control: LOWER_ARM, channel: 'rz' }]);
    expect(rowRefs(control.children[0] as ChannelTreeNode)).toEqual([{ control: LOWER_ARM, channel: 'rx' }]);
  });

  it('applies channel selection modes', () => {
    const a = { control: LOWER_ARM, channel: 'rx' as const };
    const b = { control: LOWER_ARM, channel: 'rz' as const };
    expect(applyChannelSelection([a], [b], 'replace')).toEqual([b]);
    expect(applyChannelSelection([a], [b], 'add')).toEqual([a, b]);
    expect(applyChannelSelection([a, b], [b], 'remove')).toEqual([a]);
    expect(applyChannelSelection([a], [a, b], 'toggle')).toEqual([a, b]);
    expect(applyChannelSelection([a, b], [a, b], 'toggle')).toEqual([]);
  });

  it('derives the frame/value fields, common values and their text', () => {
    app = createFakeEditorApp({ snapshot });
    const one = selectedKeys(app.store, new Map([[KEYS[1], KEY_PART]]));
    expect(frameValueFields(one)).toEqual({ count: 1, frame: 15, value: expect.closeTo(-30, 9) as number });
    const two = selectedKeys(
      app.store,
      new Map([
        [KEYS[0], KEY_PART],
        [KEYS[2], { key: false, in: false, out: true }],
        ['k_missing00000' as KeyId, KEY_PART],
      ]),
    );
    expect(two).toHaveLength(2);
    expect(frameValueFields(two)).toEqual({ count: 2, frame: null, value: expect.closeTo(30, 9) as number });
    expect(common([])).toBeNull();
    expect(common([1, 1 + 1e-12])).toBe(1);
    expect(formatField(null, 'value')).toBe('');
    expect(formatField(15, 'frame')).toBe('15');
    expect(formatField(15.25, 'frame')).toBe('15.250');
    expect(formatField(-1e-7, 'value')).toBe('0.000');
  });

  it('targets curve-level toolbar actions at the selected keys’ curves, else channels, else visible curves', () => {
    app = createFakeEditorApp({ snapshot });
    const none = toolbarState(app.store, [], [], [CURVE]);
    expect(none).toMatchObject({
      hasKeys: false,
      weighted: false,
      weightLocked: null,
      pre: 'constant',
      post: 'constant',
    });
    expect(none.curves.map((curve) => curve.id)).toEqual([CURVE]);
    const keys = selectedKeys(app.store, new Map([[KEYS[0], KEY_PART]]));
    expect(toolbarState(app.store, keys, [], [])).toMatchObject({ hasKeys: true, weightLocked: true });
    expect(toolbarState(app.store, [], [], []).curves).toEqual([]);
  });
});
