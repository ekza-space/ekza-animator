// T10's pure parts (STUDIO-TOUCH-SPEC §10.5, §6.2 "History step", §14, P-T7-8): the Curves layer's listing on
// Polybot (listed controls, channel chips in Pro's plain names, the curves shown, a chip's selection, the selected
// keys' numbers), the History ribbon's rows (selection steps folded, AI runs grouped and titled with their request,
// depths from Now), *Undo all*'s top-of-stack rule (M-AI-INT-7), and a frame-count chip in frames or seconds.
import type { ParamDef } from '@ekza-studio/anim-core';
import type { ChannelId, ControlId, CurveId } from '@ekza-studio/doc';
import type { HistoryStep } from '@ekza-studio/editor-core';
import { describe, expect, it } from 'vitest';
import { chipOf } from '../src/chips/EchoChips';
import { historyRows, requestTitle, topSuffix } from '../src/sheets/history/model';
import { threadContext } from '../src/thread/strip/model';
import {
  channelChips,
  chipSelection,
  type CurveRow,
  curveRows,
  keyNumbers,
  listedControls,
  shownCurves,
} from '../src/thread/curves/model';
import { polybotApp, runOk } from './support';

const row = (control: string, channel: ChannelId, keys = 3): CurveRow => ({
  id: `${control}/${channel}` as CurveId,
  control: control as ControlId,
  channel,
  keys,
});

describe('the Curves layer’s listing (§10.5)', () => {
  it('chips per channel across the listed parts; one tap shows that channel alone, Select more adds one', () => {
    const rows = [row('a', 'ty'), row('a', 'rx'), row('b', 'ty')];
    const none = shownCurves(rows, []);
    expect(none).toHaveLength(3);
    const y = shownCurves(rows, [
      { control: 'a' as ControlId, channel: 'ty' },
      { control: 'b' as ControlId, channel: 'ty' },
    ]);
    expect(y).toEqual(['a/ty', 'b/ty']);
    // a chip's selection: alone, then all again; with Select more: add, then remove
    const chip = {
      channel: 'ty' as ChannelId,
      label: 'Move Y',
      pro: 'Translate Y',
      refs: [{ control: 'a' as ControlId, channel: 'ty' as ChannelId }],
      chosen: false,
    };
    expect(chipSelection([], chip, [chip], false)).toEqual({ refs: chip.refs, mode: 'replace' });
    const chosen = { ...chip, chosen: true };
    expect(chipSelection(chip.refs, chosen, [chosen], false)).toEqual({ refs: [], mode: 'replace' });
    expect(chipSelection([], chip, [chip], true)).toEqual({ refs: chip.refs, mode: 'add' });
    expect(chipSelection(chip.refs, chosen, [chosen], true)).toEqual({ refs: chip.refs, mode: 'remove' });
  });

  it('on Polybot: the selected goal’s curves, its chips in plain words, the selected keys’ numbers', async () => {
    const { app, character } = await polybotApp();
    const clip = app.store.query.clipsOfCharacter(character)[0];
    if (clip === undefined) throw new Error('no clip');
    const goal = app.store.list('controls').find((c) => c.key === 'ik.leg.L')?.id as ControlId;
    await runOk(app, 'key.write', {
      clip: clip.id,
      keys: [0, 10, 20].flatMap((frame, i) => [
        { control: goal, channel: 'ty', frame, value: i * 0.1 },
        { control: goal, channel: 'rx', frame, value: 0.5 },
      ]),
    });
    await runOk(app, 'clip.setActive', { clip: clip.id });
    await runOk(app, 'select.controls', { ids: [goal], mode: 'replace' });
    const thread = threadContext(app);
    if (thread === null) throw new Error('no thread');
    expect(listedControls(app, thread)).toEqual([goal]);
    const rows = curveRows(app, thread, [goal]);
    expect(rows.map((r) => r.channel)).toEqual(['ty', 'rx']);
    const chips = channelChips(app, rows, []);
    expect(chips.map((c) => [c.label, c.pro])).toEqual([
      ['Move Y', 'Translate Y'],
      ['Bend', 'Rotate X'],
    ]);
    // two keys selected: their time differs (null), Bend's value is shown in degrees (Pro's number, P14)
    const rx = rows.find((r) => r.channel === 'rx')?.id as CurveId;
    const keys = app.store.query.keysOfCurve(rx);
    await runOk(app, 'select.keys', {
      items: keys.slice(0, 2).map((k) => ({ key: k.id, parts: { key: true, in: false, out: false } })),
      mode: 'replace',
    });
    const numbers = keyNumbers(app);
    expect(numbers.count).toBe(2);
    expect(numbers.frame).toBeNull();
    expect(numbers.value).toBeCloseTo((0.5 * 180) / Math.PI, 9);
    expect(numbers.unit).toBe('°');
    app.dispose();
  });
});

const step = (id: number, label: string, extra: Partial<HistoryStep> = {}): HistoryStep => ({
  id,
  label,
  docTxId: `tx${id}`,
  overrides: null,
  at: id * 1000,
  ...extra,
});
const PART = { kind: 'controls' } as unknown as NonNullable<HistoryStep['selection']>;
const select = (id: number): HistoryStep => step(id, 'Select', { docTxId: null, selection: PART });
const ai = (id: number, label: string): HistoryStep =>
  step(id, label, { actor: { kind: 'agent', id: 'agt_1', name: 'Claude Code' }, changes: [] });

describe('the History ribbon (§6.2, §14)', () => {
  it('newest first: redo on top, then Now; selections fold into the next step; an AI run is one group', () => {
    const undo = [
      step(1, 'Import'),
      select(2),
      select(3),
      step(4, 'Set Key'),
      ai(5, 'AI: New Clip'),
      ai(6, 'AI: Set pose'),
    ];
    const redo = [step(7, 'Move Keys'), step(8, 'Delete Keys')];
    const rows = historyRows({ undo, redo }, [{ text: 'make him wave twice', at: 4500 }]);
    expect(
      rows.map((r) => (r.kind === 'ai' ? `ai:${r.title}:${r.steps.length}` : `${r.side}:${r.step.label}`)),
    ).toEqual(['redo:Delete Keys', 'redo:Move Keys', 'ai:Make him wave twice:2', 'undo:Set Key', 'undo:Import']);
    const setKey = rows.find((r) => r.kind === 'step' && r.step.label === 'Set Key');
    expect(setKey?.kind === 'step' ? setKey.folded : -1).toBe(2);
    // depths: undos from Now (the group is two, Set Key three, Import six: through the folded selections)
    expect(rows.filter((r) => r.side === 'undo').map((r) => r.depth)).toEqual([2, 3, 6]);
    // without a request the agent's name titles the group
    const plain = historyRows({ undo, redo: [] });
    expect(plain.find((r) => r.kind === 'ai')).toMatchObject({ title: 'Claude Code' });
    expect(requestTitle('  make   him wave ')).toBe('Make him wave');
  });

  it('Undo all undoes an AI group on top of the stack and reverts one below the user’s steps (M-AI-INT-7)', () => {
    const undo = [step(1, 'Import'), ai(2, 'AI: a'), ai(3, 'AI: b')];
    expect(topSuffix(undo, [2, 3])).toEqual([
      { id: 2, revertable: true },
      { id: 3, revertable: true },
    ]);
    expect(topSuffix([...undo, step(4, 'Mine')], [2, 3])).toBeNull();
  });
});

describe('a frame-count chip (P-T7-8)', () => {
  const frames: ParamDef = { name: 'frames', label: 'Frames', kind: 'int', bound: 'value', default: 1, time: 'frames' };
  it('reads frames by default and seconds under Settings › Time, and runs whole frames', () => {
    const f = chipOf(frames, { units: 'frames', fps: { num: 30, den: 1 } });
    expect([f.unit, f.step, f.toShown(15), f.toStored(15.4)]).toEqual(['f', 1, 15, 15]);
    const s = chipOf(frames, { units: 'seconds', fps: { num: 30, den: 1 } });
    expect([s.unit, s.toShown(15), s.toStored(0.5), s.toStored(0.51)]).toEqual(['s', 0.5, 15, 15]);
    // a plain int stays a count
    expect(chipOf({ ...frames, time: undefined } as unknown as ParamDef).unit).toBeUndefined();
  });
});
