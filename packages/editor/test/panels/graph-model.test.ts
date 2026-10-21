import {
  type CompiledAnimCurve,
  EkzaError,
  type Fps,
  type Handle,
  type TangentFields,
  tangentFields,
} from '@ekza-studio/anim-core';
import { buildChannelTree, type ChannelTreeNode } from '@ekza-studio/curve-editor';
import type {
  CharacterId,
  ClipId,
  ControlId,
  CurveId,
  CurveRecord,
  DocSnapshot,
  KeyId,
  KeyRecord,
  LayerId,
} from '@ekza-studio/doc';
import { parseNumericInput } from '@ekza-studio/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-studio/editor-core/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  applyChannelSelection,
  common,
  FIELD_HINT,
  fieldArgs,
  flattenRows,
  formatField,
  frameValueFields,
  keyFieldValues,
  listedControls,
  MIXED_FIELD_HINT,
  MIXED_SCALE_ERROR,
  rowRefs,
  type SelectedKey,
  sameTree,
  selectedKeys,
  type TangentFieldSource,
  tangentFieldValues,
  toolbarState,
  visibleCurves,
} from '../../src/panels/graph/model';
import { readSynthetic } from '../render';

function implemented(probe: () => unknown): boolean {
  try {
    probe();
    return true;
  } catch (error) {
    return !(error instanceof EkzaError && error.code === 'not-implemented');
  }
}
/** WP-7a's numeric input parser evaluates field text. */
const NUMERIC_READY = implemented(() => parseNumericInput('1', 0));
const FPS30: Fps = { num: 30, den: 1 };
/** WP-1's tangent fields when landed, else the §4.11.4 formulas (enough for timing and index checks). */
const TANGENT_FIELDS_READY = implemented(() => tangentFields({ dt: 1, dv: 0 }, 'out', FPS30, 1));
const fieldsFormula = (h: Handle, side: 'in' | 'out', fps: Fps, k: number): TangentFields => {
  const fpsS = fps.num / fps.den;
  const sign = side === 'out' ? 1 : -1;
  return {
    angleDeg: (Math.atan2(sign * h.dv * k, (sign * h.dt) / fpsS) * 180) / Math.PI,
    weight: 3 * Math.hypot(Math.abs(h.dt) / fpsS, h.dv * k),
  };
};
const fieldsImpl = TANGENT_FIELDS_READY ? tangentFields : fieldsFormula;
/** Reports the handle's dt as the angle (×10 on the out side): shows which compiled index a key was read from. */
const handleProbe = (h: Handle, side: 'in' | 'out'): TangentFields =>
  side === 'in' ? { angleDeg: h.dt, weight: h.dv } : { angleDeg: h.dt * 10, weight: h.dv };

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

  it('refuses × and ÷ on mixed values instead of evaluating them against 0', () => {
    for (const text of ['*=2', '/=2', '*2', '/2', ' * 2', '=*2']) {
      expect(fieldArgs('value', text, null)).toEqual({ ok: false, error: MIXED_SCALE_ERROR });
      expect(fieldArgs('frame', text, null)).toEqual({ ok: false, error: MIXED_SCALE_ERROR });
    }
    // Operators left in a relative operand and empty input are refused before any parsing.
    for (const text of ['+=*2', '-=/2', '+=-=1', '-=', '', '  ', '=']) {
      expect(fieldArgs('value', text, null)).toEqual({ ok: false, error: MIXED_FIELD_HINT });
    }
    expect(fieldArgs('value', '', 1)).toEqual({ ok: false, error: FIELD_HINT });
    expect(MIXED_FIELD_HINT).not.toContain('*');
  });

  it.skipIf(!NUMERIC_READY)(
    '[needs WP-7a] evaluates field text against the common value, relatively when mixed',
    () => {
      expect(fieldArgs('value', '*2', 15)).toEqual({ ok: true, args: { value: 30 } });
      expect(fieldArgs('frame', '/=2', 15)).toEqual({ ok: true, args: { frame: 7.5 } });
      expect(fieldArgs('value', '+=10', 15)).toEqual({ ok: true, args: { value: 25 } });
      expect(fieldArgs('value', '=30', 15)).toEqual({ ok: true, args: { value: 30 } });
      expect(fieldArgs('value', '+=10', null)).toEqual({ ok: true, args: { value: 10, relative: true } });
      expect(fieldArgs('frame', '-= 4', null)).toEqual({ ok: true, args: { frame: -4, relative: true } });
      expect(fieldArgs('value', '-=-5', null)).toEqual({ ok: true, args: { value: 5, relative: true } });
      expect(fieldArgs('outAngleDeg', '45', null)).toEqual({ ok: true, args: { outAngleDeg: 45 } });
      expect(fieldArgs('value', 'abc', 1)).toEqual({ ok: false, error: FIELD_HINT });
      expect(fieldArgs('value', 'abc', null)).toEqual({ ok: false, error: MIXED_FIELD_HINT });
    },
  );

  it('reads tangent fields at each key’s own index, grouped per curve', () => {
    app = createFakeEditorApp({ snapshot });
    const compiled = app.evaluation.compiledCurve(CURVE);
    for (const index of [1, 2] as const) {
      const keys = selectedKeys(app.store, new Map([[KEYS[index], KEY_PART]]));
      expect(tangentFieldValues(app, keys, handleProbe)).toEqual({
        inAngle: compiled.inDt[index],
        outAngle: (compiled.outDt[index] as number) * 10,
        inWeight: null,
        outWeight: null,
        weighted: false,
      });
    }
    expect(tangentFieldValues(app, [], handleProbe)).toEqual({
      inAngle: null,
      outAngle: null,
      inWeight: null,
      outWeight: null,
      weighted: false,
    });
    // Different handles across keys and curves: every field is mixed.
    const varied = syntheticSource(2, 5, { weighted: true, flat: false });
    expect(tangentFieldValues(varied, varied.selected, fieldsFormula)).toEqual({
      inAngle: null,
      outAngle: null,
      inWeight: null,
      outWeight: null,
      weighted: true,
    });
  });

  it('shows weights only when every curve is weighted, and skips keys without a compiled handle', () => {
    const source = syntheticSource(3, 4, { weighted: true, flat: true });
    const keys = source.selected;
    // Flat handles of equal length: every field is common.
    const fields = tangentFieldValues(source, keys, fieldsFormula);
    expect(fields.weighted).toBe(true);
    expect(fields.inAngle).toBeCloseTo(0, 12);
    expect(fields.outAngle).toBeCloseTo(0, 12);
    expect(fields.inWeight).toBeCloseTo(3 * (1 / 30), 12);
    expect(fields.outWeight).toBeCloseTo(3 * (1 / 30), 12);
    // One non-weighted curve hides the weights.
    const mixedCurve = { ...keys[0], curve: { ...(keys[0] as SelectedKey).curve, weighted: false } } as SelectedKey;
    expect(tangentFieldValues(source, [mixedCurve, ...keys.slice(1)], fieldsFormula)).toMatchObject({
      weighted: false,
      inWeight: null,
      outWeight: null,
    });
    // A key that is not in its curve's projection (a hidden duplicate) contributes nothing.
    const ghost = {
      ...keys[0],
      key: { ...(keys[0] as SelectedKey).key, id: 'k_ghost0000000' as KeyId },
    } as SelectedKey;
    expect(tangentFieldValues(source, [ghost], fieldsFormula).inAngle).toBeNull();
  });

  it('derives every field value; a failing curve engine only hides the tangent fields', () => {
    app = createFakeEditorApp({ snapshot });
    const two = selectedKeys(
      app.store,
      new Map([
        [KEYS[1], KEY_PART],
        [KEYS[2], KEY_PART],
      ]),
    );
    const compiled = app.evaluation.compiledCurve(CURVE);
    expect(keyFieldValues(app, two, handleProbe)).toEqual({
      count: 2,
      frame: null,
      value: null,
      tangent: {
        inAngle: common([compiled.inDt[1] as number, compiled.inDt[2] as number]),
        outAngle: common([(compiled.outDt[1] as number) * 10, (compiled.outDt[2] as number) * 10]),
        inWeight: null,
        outWeight: null,
        weighted: false,
      },
    });
    expect(keyFieldValues(app, [], handleProbe)).toEqual({
      count: 0,
      frame: null,
      value: null,
      tangent: { inAngle: null, outAngle: null, inWeight: null, outWeight: null, weighted: false },
    });
    // Not implemented yet (WP-1): hidden quietly. Any other failure: hidden and reported.
    const stub = () => {
      throw new EkzaError('not-implemented', 'tangentFields');
    };
    const broken = () => {
      throw new Error('boom');
    };
    const warn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      expect(keyFieldValues(app, two, stub)).toMatchObject({ count: 2, tangent: null });
      expect(warnings).toHaveLength(0);
      expect(keyFieldValues(app, two, broken)).toMatchObject({ count: 2, tangent: null });
      expect(warnings).toHaveLength(1);
    } finally {
      console.warn = warn;
    }
  });

  it('computes tangent fields for 50k selected keys in under 20 ms', async ({ annotate }) => {
    // 50 curves × 1000 keys, all selected, flat weighted handles: every field stays common, so nothing exits early.
    const source = syntheticSource(50, 1000, { weighted: true, flat: true });
    const run = () => tangentFieldValues(source, source.selected, fieldsImpl);
    run();
    const samples: number[] = [];
    for (let i = 0; i < 9; i++) {
      const start = performance.now();
      const fields = run();
      samples.push(performance.now() - start);
      expect(fields.inWeight).not.toBeNull();
    }
    const ms = [...samples].sort((a, b) => a - b)[4] as number;
    await annotate(`tangent fields, 50k selected keys: ${ms.toFixed(2)} ms (median of 9)`);
    expect(ms).toBeLessThan(20);
  });
});

/**
 * A `TangentFieldSource` over `curves` × `keys` synthetic keys (one per frame, all selected), with indexed queries
 * like the real store's (the test kit's store scans every key per query).
 */
function syntheticSource(
  curves: number,
  keys: number,
  opts: { readonly weighted: boolean; readonly flat: boolean },
): TangentFieldSource & { readonly selected: SelectedKey[] } {
  const byCurve = new Map<CurveId, { record: CurveRecord; keys: KeyRecord[]; compiled: CompiledAnimCurve }>();
  const selected: SelectedKey[] = [];
  for (let c = 0; c < curves; c++) {
    const id = `crv_Bench${String(c).padStart(9, '0')}` as CurveId;
    const record = {
      id,
      clip: CLIP,
      layer: 'lyr_Bench00000001' as LayerId,
      control: LOWER_ARM,
      channel: `@c${c}`,
      weighted: opts.weighted,
      pre: 'constant',
      post: 'constant',
      locked: false,
    } as unknown as CurveRecord;
    const records: KeyRecord[] = [];
    const t = new Float64Array(keys);
    const v = new Float64Array(keys);
    const inDt = new Float64Array(keys).fill(-1);
    const outDt = new Float64Array(keys).fill(1);
    const inDv = new Float64Array(keys);
    const outDv = new Float64Array(keys);
    for (let i = 0; i < keys; i++) {
      t[i] = i;
      v[i] = Math.sin(i * 0.1);
      if (!opts.flat) {
        inDv[i] = -0.1 * Math.cos(i * 0.1);
        outDv[i] = 0.1 * Math.cos(i * 0.1);
      }
      const key = { id: `k_B${c}_${i}` as KeyId, curve: id, clip: CLIP, t: i, v: v[i] } as unknown as KeyRecord;
      records.push(key);
      selected.push({ key, curve: record, parts: KEY_PART, scale: 1, fps: FPS30 });
    }
    const compiled = {
      keyCount: keys,
      t,
      v,
      inSlope: new Float64Array(keys),
      outSlope: new Float64Array(keys),
      inDt,
      inDv,
      outDt,
      outDv,
      segment: new Uint8Array(Math.max(keys - 1, 0)),
      weighted: opts.weighted,
      pre: 'constant',
      post: 'constant',
    } as CompiledAnimCurve;
    byCurve.set(id, { record, keys: records, compiled });
  }
  const entry = (id: CurveId) => {
    const found = byCurve.get(id);
    if (found === undefined) throw new Error(`no curve ${id}`);
    return found;
  };
  return {
    selected,
    store: {
      query: {
        keysOfCurve: (id) => entry(id).keys,
        curveFor: (_clip, _layer, _control, channel) =>
          [...byCurve.values()].find((curve) => curve.record.channel === channel)?.record,
      },
    },
    evaluation: { compiledCurve: (id) => entry(id).compiled },
  };
}
