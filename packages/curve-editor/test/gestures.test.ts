import type { CurveId, KeyId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import {
  AXIS_LOCK_PX,
  type HandleTarget,
  handleFromPointer,
  keyDragDelta,
  lockedOffset,
  MIN_HANDLE_DT,
  resolveAxisLock,
} from '../src/graph/gestures';
import { applyKeySelection, selectModeFor } from '../src/graph/selection';

const view = { f0: 0, v0: 0, sx: 10, sy: 4 };

describe('key drag math (MVP-SPEC §4.11.3)', () => {
  it('locks to the dominant axis once Shift is held and the pointer moved 4 px', () => {
    expect(resolveAxisLock(null, false, 50, 1)).toBeNull();
    expect(resolveAxisLock(null, true, AXIS_LOCK_PX - 1, 0)).toBeNull();
    expect(resolveAxisLock(null, true, AXIS_LOCK_PX, 1)).toBe('time');
    expect(resolveAxisLock(null, true, 2, -AXIS_LOCK_PX - 1)).toBe('value');
    // The lock holds while Shift stays down, and is released with it.
    expect(resolveAxisLock('time', true, 0, 80)).toBe('time');
    expect(resolveAxisLock('time', false, 0, 80)).toBeNull();
  });

  it('turns pointer offsets into frame and display-value offsets', () => {
    expect(keyDragDelta(view, 25, -8, null)).toEqual({ dFrames: 2.5, dValue: 2 });
    expect(keyDragDelta(view, 25, -8, 'time')).toEqual({ dFrames: 2.5, dValue: 0 });
    expect(keyDragDelta(view, 25, -8, 'value')).toEqual({ dFrames: 0, dValue: 2 });
  });

  it('zeroes the locked axis of a pointer offset (keys and handle ends)', () => {
    expect(lockedOffset(null, 7, -3)).toEqual({ dx: 7, dy: -3 });
    expect(lockedOffset('time', 7, -3)).toEqual({ dx: 7, dy: 0 });
    expect(lockedOffset('value', 7, -3)).toEqual({ dx: 0, dy: -3 });
  });
});

describe('handle drag math (MVP-SPEC §4.11.4)', () => {
  const target = (over: Partial<HandleTarget>): HandleTarget => ({
    key: 'k_000000000001' as KeyId,
    curve: 'crv_0000000000000001' as CurveId,
    side: 'out',
    keyX: 100,
    keyY: 200,
    handleX: 140,
    handleY: 200,
    scale: 1,
    weighted: false,
    weightLocked: true,
    dt: 5,
    span: 15,
    ...over,
  });

  it('non-weighted handles keep their resolved dt and take the angle of the pointer', () => {
    // Pointer 40 px right, 20 px up: slope (20/4) / (40/10) = 1.25 value per frame.
    const handle = handleFromPointer(target({}), view, 140, 180);
    expect(handle.dt).toBe(5);
    expect(handle.dv).toBeCloseTo(6.25, 12);
    // In handle pulled down-left: the curve rises into the key (slope +1.25), so the in side has dv < 0.
    const inner = handleFromPointer(target({ side: 'in', dt: -5, handleX: 60 }), view, 60, 220);
    expect(inner.dt).toBe(-5);
    expect(inner.dv).toBeCloseTo(-6.25, 12);
  });

  it('weight-locked handles on weighted curves change angle only as well', () => {
    const handle = handleFromPointer(target({ weighted: true, weightLocked: true, dt: 3 }), view, 300, 120);
    expect(handle.dt).toBe(3);
    expect(handle.dv / handle.dt).toBeCloseTo(20 / 20, 12);
  });

  it('free weighted handles take angle and length, with dt clamped into the span', () => {
    const free = target({ weighted: true, weightLocked: false });
    expect(handleFromPointer(free, view, 180, 160)).toEqual({ dt: 8, dv: 10 });
    expect(handleFromPointer(free, view, 400, 160)).toEqual({ dt: 15, dv: 10 });
  });

  it('keeps a handle on its own side of the key (vertical at most)', () => {
    const crossed = handleFromPointer(target({ weighted: true, weightLocked: false }), view, 60, 160);
    expect(crossed.dt).toBe(MIN_HANDLE_DT);
    const inner = handleFromPointer(target({ side: 'in', dt: -5 }), view, 160, 200);
    expect(inner.dt).toBe(-5);
    expect(Math.abs(inner.dv)).toBeLessThan(1e-9);
  });
});

describe('key-part selection rules', () => {
  const a = 'k_00000000000a' as KeyId;
  const b = 'k_00000000000b' as KeyId;
  const key = { key: true, in: false, out: false };
  const out = { key: false, in: false, out: true };

  it('maps modifiers to modes: click replace, Shift toggle, Mod remove, Mod+Shift add', () => {
    expect(selectModeFor({ shift: false, mod: false })).toBe('replace');
    expect(selectModeFor({ shift: true, mod: false })).toBe('toggle');
    expect(selectModeFor({ shift: false, mod: true })).toBe('remove');
    expect(selectModeFor({ shift: true, mod: true })).toBe('add');
  });

  it('applies replace, add, remove and toggle per part', () => {
    const current = new Map([[a, key]]);
    expect([...applyKeySelection(current, [{ key: b, parts: key }], 'replace')]).toEqual([[b, key]]);
    expect([...applyKeySelection(current, [{ key: a, parts: out }], 'add')]).toEqual([[a, { ...key, out: true }]]);
    expect([...applyKeySelection(current, [{ key: a, parts: key }], 'remove')]).toEqual([]);
    expect([
      ...applyKeySelection(
        current,
        [
          { key: a, parts: key },
          { key: b, parts: key },
        ],
        'toggle',
      ),
    ]).toEqual([[b, key]]);
  });

  it('toggles a group as a whole when asked (double-clicked curves)', () => {
    const current = new Map([[a, key]]);
    const items = [
      { key: a, parts: key },
      { key: b, parts: key },
    ];
    expect([...applyKeySelection(current, items, 'toggle', { group: true })]).toEqual([
      [a, key],
      [b, key],
    ]);
    expect([
      ...applyKeySelection(
        new Map([
          [a, key],
          [b, key],
        ]),
        items,
        'toggle',
        { group: true },
      ),
    ]).toEqual([]);
  });
});
