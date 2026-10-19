// M6A-SPEC §5.10 (B11): the numeric capture window. Armed (a) during a drag (the tool's NumericTarget) and (b) after a
// keyboard-invoked run with a primary param (the Last-op card); digits start an entry that applies only on Enter or
// Tab; an unfinished entry is discarded when (b) disarms ("Entry discarded"); Enter without an entry disarms (b) and
// changes nothing; modifier keys never disarm; `4` after a released drag reaches the keymap; `30%` and `0.3` are the
// same fraction; `T` opens the card with the primary field focused.
import type { ParamDef } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import * as kernel from '@ekza-animator/mesh-core';
import { describe, expect, it, vi } from 'vitest';
import {
  type CaptureMessage,
  ENTRY_DISCARDED,
  lastOpCardState,
  type NumericCapture,
  type NumericTarget,
  registeredMeshOperator,
  switchWorkspace,
} from '../../src';
import { createMesh, type MeshTestApp, meshTestApp, positionsOf } from '../mesh/support';
import { ADVANCE } from './support';

vi.mock('@ekza-animator/mesh-core', async (importOriginal) => {
  const actual = await importOriginal<typeof kernel>();
  const { makeAdvanceOp } = await import('./support');
  const advance = makeAdvanceOp(actual);
  return { ...actual, MESH_OPS: Object.freeze({ ...actual.MESH_OPS, [advance.id]: advance }) };
});

const key = (k: string, code?: string, mods: Partial<{ shift: boolean; mod: boolean; alt: boolean }> = {}) => ({
  key: k,
  code: code ?? (/^\d$/.test(k) ? `Digit${k}` : k === '.' ? 'Period' : k === '-' ? 'Minus' : `Key${k.toUpperCase()}`),
  shift: mods.shift ?? false,
  mod: mods.mod ?? false,
  alt: mods.alt ?? false,
});
const ENTER = { key: 'Enter', code: 'Enter', shift: false, mod: false, alt: false };
const TAB = { key: 'Tab', code: 'Tab', shift: false, mod: false, alt: false };
const SHIFT_TAB = { ...TAB, shift: true };
const ESC = { key: 'Escape', code: 'Escape', shift: false, mod: false, alt: false };
const BACKSPACE = { key: 'Backspace', code: 'Backspace', shift: false, mod: false, alt: false };
const SHIFT = { key: 'Shift', code: 'ShiftLeft', shift: true, mod: false, alt: false };

function type(capture: NumericCapture, text: string): boolean[] {
  return text.split('').map((ch) => capture.key(key(ch)));
}

/** A Model app, a cube with face 2 selected and hilited, then `mesh.test.advance` run from the keyboard. */
async function armedByKeyboard(): Promise<
  MeshTestApp & { readonly id: MeshId; readonly capture: NumericCapture; readonly messages: CaptureMessage[] }
> {
  const t = await meshTestApp();
  switchWorkspace(t.app, 'model');
  t.app.operators.register(registeredMeshOperator(ADVANCE));
  const id = createMesh(t, 'msh_Cube');
  t.app.session.setState({ model: { ...t.app.session.getState().model, componentMode: 'face', hilite: [id] } });
  t.meshes.select(id, kernel.selectionOf('face', [2], kernel.primitive('cube', {}).counts));
  await t.app.runUntyped('mesh.test.advance', { dy: 0.1 }, { source: 'keyboard' });
  const capture = t.app.capture as NumericCapture;
  const messages: CaptureMessage[] = [];
  capture.onMessage((m) => messages.push(m));
  return { ...t, id, capture, messages };
}

/** Lets the async edit.adjustLast run the capture started finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const undoLength = (t: MeshTestApp) =>
  (t.app.history as unknown as { labels(): { undo: readonly string[] } }).labels().undo.length;

const fractionParam: ParamDef = {
  name: 'weight',
  label: 'Weight',
  kind: 'fraction',
  bound: 'value',
  default: 0.5,
  min: 0,
  max: 1,
};
const countParam: ParamDef = {
  name: 'divisions',
  label: 'Divisions',
  kind: 'int',
  bound: 'value',
  default: 1,
  min: 1,
  max: 32,
};
const flagParam: ParamDef = { name: 'flag', label: 'Flag', kind: 'bool', bound: 'value', default: true };

function fakeTarget(): NumericTarget & { readonly values: Record<string, number>; readonly calls: string[] } {
  const values: Record<string, number> = { weight: 0.5, divisions: 1 };
  const calls: string[] = [];
  return {
    fields: [fractionParam, flagParam, countParam],
    active: 'weight',
    values,
    calls,
    value: (field) => values[field] ?? 0,
    set(field, v) {
      values[field] = v;
      calls.push(`set ${field} ${v}`);
    },
    confirm: () => calls.push('confirm'),
    cancel: () => calls.push('cancel'),
  };
}

describe('case (b): after a keyboard-invoked operation', () => {
  it('arms on the primary field; Enter applies through edit.adjustLast (history length kept) and disarms', async () => {
    const t = await armedByKeyboard();
    expect(t.capture.state).toEqual({ armed: 'keyboard-op', field: 'dy', text: null });
    const steps = undoLength(t);
    expect(type(t.capture, '0.5')).toEqual([true, true, true]);
    expect(t.capture.state.text).toBe('0.5');
    expect(t.capture.key(ENTER)).toBe(true);
    await settle();
    expect(t.app.session.getState().lastRun?.args['dy']).toBe(0.5);
    expect(undoLength(t)).toBe(steps);
    expect(t.capture.state.armed).toBeNull();
    // The committed value is announced on the help line (the polite live region, §5.10).
    expect(t.messages).toEqual([{ text: 'Advance Offset Y 0.500 m', tone: 'info' }]);
    const f = await armedByKeyboard();
    await f.app.run('edit.adjustLast', { args: { dy: 0.5 } });
    expect(positionsOf(t, t.id)).toEqual(positionsOf(f, f.id));
  });

  it('Tab applies the entry and moves to the next field; Shift+Tab back; units in the entry', async () => {
    const t = await armedByKeyboard();
    type(t.capture, '50cm');
    expect(t.capture.key(TAB)).toBe(true);
    await settle();
    expect(t.app.session.getState().lastRun?.args['dy']).toBe(0.5);
    expect(t.capture.state).toEqual({ armed: 'keyboard-op', field: 'steps', text: null });
    type(t.capture, '3');
    t.capture.key(ENTER);
    await settle();
    expect(t.app.session.getState().lastRun?.args).toMatchObject({ dy: 0.5, steps: 3 });
    const u = await armedByKeyboard();
    u.capture.key(SHIFT_TAB);
    expect(u.capture.state.field).toBe('steps');
  });

  it('an unfinished entry is discarded when the window disarms (pointer, click, another key)', async () => {
    const t = await armedByKeyboard();
    type(t.capture, '0.7');
    t.capture.disarm(); // the editor's bridge: a pointer move beyond 3 px or a click
    expect(t.capture.state).toEqual({ armed: null, field: null, text: null });
    expect(t.messages).toEqual([{ text: ENTRY_DISCARDED, tone: 'warning' }]);
    expect(t.app.session.getState().lastRun?.args['dy']).toBe(0.1);
    const u = await armedByKeyboard();
    type(u.capture, '2');
    expect(u.capture.key(key('w', 'KeyW'))).toBe(false); // reaches the keymap (the Move tool)
    expect(u.capture.state.armed).toBeNull();
    expect(u.messages.map((m) => m.text)).toEqual([ENTRY_DISCARDED]);
    await settle();
    expect(u.app.session.getState().lastRun?.args['dy']).toBe(0.1);
  });

  it('Enter without an entry disarms and changes nothing (the extrude session stays)', async () => {
    const t = await armedByKeyboard();
    const before = t.app.session.getState().lastRun;
    const steps = undoLength(t);
    expect(t.capture.key(ENTER)).toBe(true);
    await settle();
    expect(t.capture.state.armed).toBeNull();
    expect(t.app.session.getState().lastRun).toBe(before);
    expect(undoLength(t)).toBe(steps);
    expect(t.messages).toEqual([]);
  });

  it('a non-numeric key without an entry disarms silently and passes on; modifier keys never disarm', async () => {
    const t = await armedByKeyboard();
    expect(t.capture.key(SHIFT)).toBe(false);
    expect(t.capture.key({ ...key('Control', 'ControlLeft'), mod: true })).toBe(false);
    expect(t.capture.state.armed).toBe('keyboard-op');
    expect(t.capture.key(key('e', 'KeyE', { mod: true }))).toBe(false);
    expect(t.capture.state.armed).toBeNull();
    expect(t.messages).toEqual([]);
  });

  it('Backspace edits the entry; Esc cancels the entry, then disarms and passes on', async () => {
    const t = await armedByKeyboard();
    type(t.capture, '0.55');
    expect(t.capture.key(BACKSPACE)).toBe(true);
    expect(t.capture.state.text).toBe('0.5');
    expect(t.capture.key(ESC)).toBe(true);
    expect(t.capture.state).toEqual({ armed: 'keyboard-op', field: 'dy', text: null });
    expect(t.capture.key(ESC)).toBe(false);
    expect(t.capture.state.armed).toBeNull();
    // Without an entry Backspace is not part of one: it disarms and reaches the keymap (Maya's Delete).
    const u = await armedByKeyboard();
    expect(u.capture.key(BACKSPACE)).toBe(false);
    expect(u.capture.state.armed).toBeNull();
  });

  it('a refused re-run is reported, not announced: the entry stays for editing and nothing changes', async () => {
    const t = await armedByKeyboard();
    const before = positionsOf(t, t.id);
    const steps = undoLength(t);
    type(t.capture, '13');
    expect(t.capture.key(ENTER)).toBe(true);
    await settle();
    // The kernel refuses dy 13: the original step is back, the help line says why (a warning), no value is announced.
    expect(t.messages).toEqual([{ text: 'Advance: Thirteen is unlucky', tone: 'warning' }]);
    expect(t.capture.state).toEqual({ armed: 'keyboard-op', field: 'dy', text: '13' });
    expect(t.app.session.getState().lastRun).toMatchObject({ closed: null, args: { dy: 0.1 } });
    expect(positionsOf(t, t.id)).toEqual(before);
    expect(undoLength(t)).toBe(steps);
    // Corrected in place: Backspace, 2, Enter commits and is announced.
    t.capture.key(BACKSPACE);
    type(t.capture, '2');
    expect(t.capture.key(ENTER)).toBe(true);
    await settle();
    expect(t.messages.at(-1)).toEqual({ text: 'Advance Offset Y 12.000 m', tone: 'info' });
    expect(t.capture.state.armed).toBeNull();
    expect(t.app.session.getState().lastRun?.args['dy']).toBe(12);
    expect(undoLength(t)).toBe(steps);
    // Tab with a refused value stays on the field with the entry.
    const u = await armedByKeyboard();
    type(u.capture, '13');
    expect(u.capture.key(TAB)).toBe(true);
    await settle();
    expect(u.capture.state).toEqual({ armed: 'keyboard-op', field: 'dy', text: '13' });
    expect(u.messages.map((m) => m.tone)).toEqual(['warning']);
  });

  it('a text that does not parse keeps the entry with a message', async () => {
    const t = await armedByKeyboard();
    type(t.capture, '1-');
    expect(t.capture.key(ENTER)).toBe(true);
    expect(t.capture.state).toMatchObject({ armed: 'keyboard-op', text: '1-' });
    expect(t.messages).toEqual([{ text: 'Offset Y: type a number', tone: 'warning' }]);
  });

  it('the window closes with the card (another operation)', async () => {
    const t = await armedByKeyboard();
    await t.app.runUntyped('mesh.test.advance', { dy: 0.2 }, { source: 'menu' });
    expect(t.capture.state.armed).toBeNull();
  });

  it('T opens the card expanded with the primary field focused', async () => {
    const t = await armedByKeyboard();
    const seq = lastOpCardState(t.app).focusSeq;
    t.capture.openCard();
    expect(lastOpCardState(t.app)).toMatchObject({ expanded: true, dismissed: false, focusField: 'dy' });
    expect(lastOpCardState(t.app).focusSeq).toBe(seq + 1);
  });
});

describe('case (a): during a drag', () => {
  it('a digit starts an entry for the dragged field; Enter sets it and confirms; then nothing is armed', async () => {
    const t = await armedByKeyboard();
    const target = fakeTarget();
    t.capture.arm('drag', target);
    expect(t.capture.state).toEqual({ armed: 'drag', field: 'weight', text: null });
    type(t.capture, '30%');
    t.capture.key(ENTER);
    expect(target.calls).toEqual(['set weight 0.3', 'confirm']);
    expect(t.capture.state.armed).toBeNull();
    // `4` after the released drag is not captured: it reaches the keymap (shading).
    expect(t.capture.key(key('4'))).toBe(false);
  });

  it('30% and 0.3 give the same fraction; Tab skips non-numeric fields; Esc cancels the drag', async () => {
    const t = await armedByKeyboard();
    const a = fakeTarget();
    t.capture.arm('drag', a);
    type(t.capture, '0.3');
    t.capture.key(TAB);
    expect(t.capture.state.field).toBe('divisions');
    type(t.capture, '2');
    t.capture.key(ESC);
    expect(a.calls).toEqual(['set weight 0.3', 'cancel']);
    const b = fakeTarget();
    t.capture.arm('drag', b);
    type(t.capture, '30%');
    t.capture.key(TAB);
    expect(b.values['weight']).toBe(a.values['weight']);
  });

  it('other keys pass to the tool without disarming; explicit capture never arms', async () => {
    const t = await armedByKeyboard();
    t.capture.arm('drag', fakeTarget());
    expect(t.capture.key(key('x', 'KeyX'))).toBe(false);
    expect(t.capture.key(BACKSPACE)).toBe(false);
    expect(t.capture.state.armed).toBe('drag');
    t.capture.disarm();
    const modeling = t.app.prefs.getState().modeling;
    t.app.prefs.setState({ modeling: { ...modeling, numericCapture: 'explicit' } });
    t.capture.arm('drag', fakeTarget());
    expect(t.capture.state.armed).toBeNull();
  });
});
