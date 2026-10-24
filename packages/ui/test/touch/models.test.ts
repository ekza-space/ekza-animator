// The touch kit's pure models (STUDIO-TOUCH-SPEC §5.2–§5.6, §6.1, T4): press recognition, distance scrub, the
// numpad, the Halo's geometry, the Thumb key, toasts, the scope helpers and the no-pan policy.
import { describe, expect, it, vi } from 'vitest';
import {
  arcLayout,
  boxAt,
  clampUiScale,
  createPressRecognizer,
  createScrub,
  createToastStore,
  decimalsOf,
  evaluateExpression,
  fitRow,
  formatValue,
  installTouchPolicy,
  keyStep,
  nextDetent,
  numpadInit,
  type NumpadKey,
  numpadReduce,
  prefersReducedMotion,
  ringLayout,
  ringSlots,
  rovingIndex,
  scrubFactor,
  slopFor,
  slotToward,
  snapDetent,
  THUMB_INITIAL,
  type ThumbEvent,
  thumbReduce,
  TOUCH,
  TOUCH_POLICY_CLASS,
  touchScopeProps,
} from '../../src/touch';

describe('press recogniser (LongPress)', () => {
  it('a lift before the slop and 450 ms is a tap; a quick second tap counts two', () => {
    const r = createPressRecognizer();
    r.down(100, 100, 0);
    expect(r.move(104, 103, 50)).toEqual([]);
    expect(r.up(104, 103, 120)).toEqual([{ kind: 'tap', x: 104, y: 103, count: 1 }]);
    r.down(110, 100, 300);
    expect(r.up(110, 100, 380)).toEqual([{ kind: 'tap', x: 110, y: 100, count: 2 }]);
    // too far from the first tap: a new single tap
    r.down(200, 100, 500);
    expect(r.up(200, 100, 560)).toEqual([{ kind: 'tap', x: 200, y: 100, count: 1 }]);
  });

  it('held still for 450 ms is a long-press, never a tap (C3)', () => {
    const r = createPressRecognizer();
    r.down(10, 10, 1000);
    expect(r.deadline).toBe(1000 + TOUCH.longPressMs);
    expect(r.tick(1449)).toEqual([]);
    expect(r.tick(1450)).toEqual([{ kind: 'longpress', x: 10, y: 10 }]);
    expect(r.phase).toBe('longpressed');
    expect(r.up(12, 11, 1600)).toEqual([{ kind: 'release', x: 12, y: 11 }]);
  });

  it('a press that moves past the slop first is a drag and never opens the long-press', () => {
    const r = createPressRecognizer();
    r.down(0, 0, 0, 'touch');
    expect(r.move(11, 0, 100)).toEqual([{ kind: 'dragstart', x: 11, y: 0, dx: 11, dy: 0 }]);
    expect(r.deadline).toBeNull();
    expect(r.tick(1000)).toEqual([]);
    expect(r.move(30, 5, 200)).toEqual([{ kind: 'drag', x: 30, y: 5, dx: 30, dy: 5 }]);
    expect(r.up(30, 5, 300)).toEqual([{ kind: 'dragend', x: 30, y: 5, dx: 30, dy: 5 }]);
  });

  it('the slop depends on the pointer type (§5.4): pen 4, mouse 3, touch 10', () => {
    expect([slopFor('touch'), slopFor('pen'), slopFor('mouse')]).toEqual([10, 4, 3]);
    const pen = createPressRecognizer();
    pen.down(0, 0, 0, 'pen');
    expect(pen.move(5, 0, 10)[0]?.kind).toBe('dragstart');
  });

  it('a late lift without a tick is still a long-press; cancel ends a drag without a drop', () => {
    const r = createPressRecognizer();
    r.down(0, 0, 0);
    expect(r.up(0, 0, 900).map((e) => e.kind)).toEqual(['longpress', 'release']);
    r.down(0, 0, 1000);
    r.move(40, 0, 1010);
    expect(r.cancel()).toEqual([{ kind: 'cancel' }]);
    expect(r.phase).toBe('idle');
  });
});

describe('distance scrub (§5.6)', () => {
  it('steps finer farther from the chip: ×0.1 at 80 px, ×0.01 at 160 px', () => {
    expect([scrubFactor(0), scrubFactor(79), scrubFactor(-80), scrubFactor(159), scrubFactor(200)]).toEqual([
      1, 1, 0.1, 0.1, 0.01,
    ]);
  });

  it('integrates travel, so a change of distance changes only the speed', () => {
    const s = createScrub({ value: 0.12, step: 0.01, pxPerStep: 4 });
    expect(s.move(40, 0)).toBeCloseTo(0.22, 10); // 10 steps
    expect(s.move(80, 100)).toBeCloseTo(0.23, 10); // 10 more steps at ×0.1, no jump
    expect(s.factor).toBe(0.1);
    expect(s.move(80, 0)).toBeCloseTo(0.23, 10);
  });

  it('clamps to the range, rounds to the effective step and honours the Thumb key’s Fine', () => {
    const s = createScrub({ value: 1, step: 1, min: 0, max: 3 });
    expect(s.move(400, 0)).toBe(3);
    expect(s.move(-4000, 0)).toBe(0);
    const fine = createScrub({ value: 0, step: 1 });
    expect(fine.move(4, 0, 0.1)).toBe(0.1);
  });

  it('keyboard steps: arrows ±1, Page ±10, Home / End, Shift coarse', () => {
    expect(keyStep('ArrowRight', 1, 0.5)).toBe(1.5);
    expect(keyStep('ArrowDown', 1, 0.5, 0)).toBe(0.5);
    expect(keyStep('PageUp', 0, 1, undefined, 5)).toBe(5);
    expect(keyStep('Home', 3, 1, -2)).toBe(-2);
    expect(keyStep('End', 3, 1)).toBeNull();
    expect(keyStep('ArrowUp', 0, 1, undefined, undefined, true)).toBe(10);
    expect(keyStep('a', 0, 1)).toBeNull();
  });

  it('formats Pro’s number with the step’s decimals, a true minus and the unit', () => {
    expect(decimalsOf(0.01)).toBe(2);
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.125)).toBe(3);
    expect(formatValue(0.12, 0.01, 'm')).toBe('0.12 m');
    expect(formatValue(-5, 1, '°')).toBe('−5°');
    expect(formatValue(2, 1)).toBe('2');
    expect(formatValue(-0.0001, 0.01, 'm')).toBe('0.00 m');
  });
});

describe('numpad (§5.6)', () => {
  it('evaluates expressions with + − × ÷ ( ), unary minus and decimals, without eval', () => {
    expect(evaluateExpression('0.4×2')).toBe(0.8);
    expect(evaluateExpression('(1+2)÷4')).toBe(0.75);
    expect(evaluateExpression('−3+−2')).toBe(-5);
    expect(evaluateExpression('-(2*3)')).toBe(-6);
    expect(evaluateExpression('0.1+0.2')).toBe(0.3);
    expect(evaluateExpression('1,5')).toBe(1.5);
    expect(evaluateExpression('.5')).toBe(0.5);
    for (const bad of ['', '1+', '(1', '1)', '2..3', 'alert(1)', '1/0']) expect(evaluateExpression(bad)).toBeNull();
  });

  it('a digit replaces the fresh value; operators extend it; ± negates; ⌫ and nudges edit', () => {
    const keys = (start: number, ...k: NumpadKey[]): string => k.reduce(numpadReduce, numpadInit(start)).text;
    expect(keys(0.49, '2')).toBe('2');
    expect(keys(0.49, '×', '2')).toBe('0.49×2');
    expect(keys(0.49, '×', '2', '=')).toBe('0.98');
    expect(keys(3, '±')).toBe('-3');
    expect(keys(3, '±', '±')).toBe('3');
    expect(keys(3, '+', '1', '±')).toBe('-(3+1)');
    expect(keys(12, '⌫')).toBe('');
    expect(keys(12, '4', '⌫')).toBe('');
    expect(keys(12, '+10')).toBe('22');
    expect(keys(0.5, '-1')).toBe('-0.5');
    expect(keys(1, '.')).toBe('0.');
    expect(keys(1, '3', '.', '.', '5')).toBe('3.5');
    expect(keys(1, 'clear', '(', '2')).toBe('(2');
  });
});

describe('Halo geometry (§4.1, §4.3, §6.1)', () => {
  const widths = [96, 90, 98, 104, 100, 92];

  it('places the column on the preferred side with the room, bowed away from the selection, never over it', () => {
    const target = { left: 600, top: 300, right: 700, bottom: 420 };
    const a = arcLayout({ target, widths, width: 1194, height: 834, insetTop: 60, insetBottom: 90 });
    expect(a.mode).toBe('arc');
    expect(a.side).toBe('left');
    expect(a.positions).toHaveLength(6);
    for (const [i, p] of a.positions.entries()) {
      expect(p.x + (widths[i] ?? 0)).toBeLessThanOrEqual(target.left);
      expect(p.x).toBeGreaterThanOrEqual(TOUCH.gutter);
      expect(p.y).toBeGreaterThanOrEqual(60);
      expect(p.y + TOUCH.hit).toBeLessThanOrEqual(834 - 90);
    }
    // pitch 52: petals never overlap vertically
    for (let i = 1; i < a.positions.length; i++) {
      expect((a.positions[i]?.y ?? 0) - (a.positions[i - 1]?.y ?? 0)).toBe(TOUCH.petalPitch);
    }
    // the middle petals sit nearest the selection
    const gap = (i: number): number => target.left - ((a.positions[i]?.x ?? 0) + (widths[i] ?? 0));
    expect(gap(0)).toBeGreaterThan(gap(2));
    expect(gap(5)).toBeGreaterThan(gap(3));
    expect(a.connector.from).toEqual({ x: 650, y: 360 });
  });

  it('takes the other side when the preferred one is short, and a row when both are narrower than 240 px', () => {
    const right = arcLayout({
      target: { left: 100, top: 300, right: 200, bottom: 400 },
      widths,
      width: 1194,
      height: 834,
    });
    expect(right.side).toBe('right');
    for (const p of right.positions) expect(p.x).toBeGreaterThanOrEqual(200);
    const row = arcLayout({
      target: { left: 150, top: 200, right: 650, bottom: 400 },
      widths,
      width: 834,
      height: 1194,
    });
    expect(row.mode).toBe('row');
    expect(row.side).toBe('below');
    for (const p of row.positions) expect(p.y).toBeGreaterThanOrEqual(400);
  });

  it('a row with no room below goes above, and wraps at the gutters on a narrow container', () => {
    const above = arcLayout({
      target: { left: 100, top: 500, right: 300, bottom: 800 },
      widths,
      width: 390,
      height: 844,
      insetBottom: 60,
    });
    expect(above.side).toBe('above');
    for (const p of above.positions) expect(p.y + TOUCH.hit).toBeLessThanOrEqual(500);
    const rows = new Set(above.positions.map((p) => p.y));
    expect(rows.size).toBeGreaterThan(1);
    for (const [i, p] of above.positions.entries())
      expect(p.x + (widths[i] ?? 0)).toBeLessThanOrEqual(390 - TOUCH.gutter);
  });

  it('the flick ring keeps its centre 144 px inside and every petal inside the gutters', () => {
    const r = ringLayout(
      { x: 20, y: 20 },
      (['N', 'E', 'S', 'W'] as const).map((slot) => ({ slot, width: 120 })),
      1194,
      834,
    );
    expect(r.center).toEqual({ x: TOUCH.ringEdgeMargin, y: TOUCH.ringEdgeMargin });
    for (const p of r.positions) {
      expect(p.x).toBeGreaterThanOrEqual(TOUCH.gutter);
      expect(p.y).toBeGreaterThanOrEqual(TOUCH.gutter);
    }
    // wide labels on all eight slots: the radius grows until no two petals touch
    const all = ringLayout(
      { x: 600, y: 420 },
      (['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const).map((slot) => ({ slot, width: 150 })),
      1194,
      834,
    );
    expect(all.radius).toBeGreaterThan(TOUCH.ringRadius);
    for (let i = 0; i < all.positions.length; i++) {
      for (let j = i + 1; j < all.positions.length; j++) {
        const a = all.positions[i];
        const b = all.positions[j];
        if (a === undefined || b === undefined) throw new Error('missing');
        expect(a.x + 150 <= b.x || b.x + 150 <= a.x || a.y + TOUCH.hit <= b.y || b.y + TOUCH.hit <= a.y).toBe(true);
      }
    }
    expect(ringLayout({ x: 600, y: 420 }, [{ slot: 'N', width: 90 }], 1194, 834).radius).toBe(TOUCH.ringRadius);
    expect(slotToward(0, -30)).toBe('N');
    expect(slotToward(30, 30)).toBe('SE');
    expect(slotToward(5, 5)).toBeNull();
  });

  it('ring slots: a verb keeps its marking-menu slot, the rest and ⋯ More take the free ones', () => {
    expect(ringSlots([{ slot: 'N' }, { slot: 'E' }, { slot: 'S' }, { slot: 'W' }, {}])).toEqual([
      'N',
      'E',
      'S',
      'W',
      'NE',
    ]);
    expect(ringSlots([{}, { slot: 'N' }, {}])).toEqual(['NE', 'N', 'E']);
  });

  it('a row folds what does not fit into its pinned ⋯', () => {
    expect(fitRow([80, 80, 80], 400, 60)).toBe(3);
    expect(fitRow([80, 80, 80, 80], 300, 60, 8)).toBe(2);
    expect(fitRow([500], 300, 60)).toBe(0);
  });

  it('roving focus skips disabled items and wraps', () => {
    expect(rovingIndex(0, 'ArrowRight', 4)).toBe(1);
    expect(rovingIndex(3, 'ArrowRight', 4)).toBe(0);
    expect(rovingIndex(0, 'ArrowLeft', 4, 'horizontal', (i) => i === 3)).toBe(2);
    expect(rovingIndex(1, 'End', 4)).toBe(3);
    expect(rovingIndex(2, 'Home', 4, 'horizontal', (i) => i === 0)).toBe(1);
    expect(rovingIndex(0, 'ArrowDown', 4, 'horizontal')).toBeNull();
    expect(rovingIndex(0, 'ArrowDown', 4, 'both')).toBe(1);
  });

  it('sheet detents: a flick goes one step, a slow drag snaps to the nearest; a tap steps peek → half → full → half', () => {
    expect(snapDetent(300, -0.8, 1000, 'half')).toBe('full');
    expect(snapDetent(300, 0.8, 1000, 'half')).toBe('peek');
    expect(snapDetent(880, 0, 1000, 'half')).toBe('full');
    expect(snapDetent(200, 0.1, 1000, 'full')).toBe('peek');
    expect(['peek', 'half', 'full'].map((d) => nextDetent(d as 'peek'))).toEqual(['half', 'full', 'half']);
  });

  it('finds the chip under a sliding finger, with slop', () => {
    const boxes = [
      { left: 0, top: 0, right: 50, bottom: 44 },
      { left: 60, top: 0, right: 110, bottom: 44 },
    ];
    expect(boxAt({ x: 70, y: 20 }, boxes)).toBe(1);
    expect(boxAt({ x: 55, y: 20 }, boxes)).toBe(-1);
    expect(boxAt({ x: 55, y: 20 }, boxes, 6)).toBe(0);
  });
});

describe('Thumb key (§5.5)', () => {
  const run = (...events: ThumbEvent[]) => events.reduce(thumbReduce, THUMB_INITIAL);

  it('tap = next action only; the action consumes it', () => {
    const once = run({ type: 'press', time: 0 }, { type: 'release', time: 100 });
    expect(once.latch).toBe('once');
    expect(thumbReduce(once, { type: 'consume' }).latch).toBe('off');
  });

  it('double-tap locks; a tap on a lock unlocks', () => {
    const locked = run(
      { type: 'press', time: 0 },
      { type: 'release', time: 80 },
      { type: 'press', time: 200 },
      { type: 'release', time: 260 },
    );
    expect(locked.latch).toBe('locked');
    expect(thumbReduce(locked, { type: 'consume' }).latch).toBe('locked');
    // a second tap outside the double-tap window turns the once-meaning off instead
    const slow = run(
      { type: 'press', time: 0 },
      { type: 'release', time: 80 },
      { type: 'press', time: 900 },
      { type: 'release', time: 950 },
    );
    expect(slow.latch).toBe('off');
    const unlocked = [{ type: 'press', time: 1000 } as const, { type: 'release', time: 1050 } as const].reduce(
      thumbReduce,
      locked,
    );
    expect(unlocked.latch).toBe('off');
  });

  it('hold = while held: a long hold, or one used by an action, turns off on release', () => {
    const held = run({ type: 'press', time: 0 });
    expect(held.latch).toBe('held');
    expect(thumbReduce(held, { type: 'release', time: 600 }).latch).toBe('off');
    const used = thumbReduce(thumbReduce(held, { type: 'consume' }), { type: 'release', time: 100 });
    expect(used.latch).toBe('off');
  });

  it('slide up opens the chooser; releasing there keeps the latch as it was', () => {
    const s = run({ type: 'press', time: 0 }, { type: 'slideUp' }, { type: 'release', time: 300 });
    expect(s.chooser).toBe(true);
    expect(s.latch).toBe('off');
    expect(thumbReduce(s, { type: 'closeChooser' }).chooser).toBe(false);
  });

  it('a keyboard or assistive-technology activation acts as a tap', () => {
    const once = run({ type: 'key', time: 0 });
    expect(once.latch).toBe('once');
    expect(thumbReduce(once, { type: 'key', time: 100 }).latch).toBe('locked');
  });
});

describe('toast queue', () => {
  const fakeTimers = () => {
    const pending = new Map<number, () => void>();
    let n = 0;
    return {
      pending,
      timers: {
        set: (fn: () => void) => {
          pending.set(++n, fn);
          return n;
        },
        clear: (h: unknown) => {
          pending.delete(h as number);
        },
      },
      fire: () => {
        for (const [h, fn] of Array.from(pending)) {
          pending.delete(h);
          fn();
        }
      },
    };
  };

  it('keeps at most three, replaces by key, dismisses on its timer', () => {
    const t = fakeTimers();
    const store = createToastStore({ timers: t.timers });
    const listener = vi.fn<() => void>();
    store.subscribe(listener);
    for (const text of ['a', 'b', 'c', 'd']) store.push({ text });
    expect(store.getSnapshot().map((x) => x.text)).toEqual(['b', 'c', 'd']);
    store.push({ text: 'Undid: select 2 faces', key: 'undo' });
    store.push({ text: 'Undid: Pull', key: 'undo' });
    expect(
      store
        .getSnapshot()
        .filter((x) => x.key === 'undo')
        .map((x) => x.text),
    ).toEqual(['Undid: Pull']);
    expect(listener).toHaveBeenCalled();
    t.fire();
    expect(store.getSnapshot()).toEqual([]);
  });

  it('holding pauses every timer; a toast without an end stays', () => {
    const t = fakeTimers();
    const store = createToastStore({ timers: t.timers });
    store.push({ text: 'Saved' });
    store.push({ text: 'Discard 14 strokes?', durationMs: Number.POSITIVE_INFINITY });
    expect(t.pending.size).toBe(1);
    store.hold(true);
    expect(t.pending.size).toBe(0);
    store.hold(false);
    t.fire();
    expect(store.getSnapshot().map((x) => x.text)).toEqual(['Discard 14 strokes?']);
  });
});

describe('scope helpers and the no-pan policy', () => {
  it('clamps the Text & touch size to 0.85–1.5 and writes it on the scope', () => {
    expect([
      clampUiScale(undefined),
      clampUiScale(0.5),
      clampUiScale(1.25),
      clampUiScale(3),
      clampUiScale(Number.NaN),
    ]).toEqual([1, 0.85, 1.25, 1.5, 1]);
    expect(touchScopeProps(2)).toEqual({ 'data-density': 'touch', style: { '--ui-scale': '1.5' } });
  });

  it('reduced motion is read from the media query, and assumed without one', () => {
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: true }) as MediaQueryList })).toBe(true);
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) as MediaQueryList })).toBe(false);
    expect(prefersReducedMotion(undefined)).toBe(true);
  });

  it('installs once per document, cancels gesturestart, and the last disposer removes everything', () => {
    const classes = new Set<string>();
    const listeners = new Map<string, (e: Event) => void>();
    const doc = {
      documentElement: {
        classList: {
          add: (c: string) => void classes.add(c),
          remove: (c: string) => void classes.delete(c),
        },
      },
      addEventListener: (type: string, fn: (e: Event) => void) => void listeners.set(type, fn),
      removeEventListener: (type: string) => void listeners.delete(type),
    };
    const first = installTouchPolicy(doc);
    const second = installTouchPolicy(doc);
    expect(classes.has(TOUCH_POLICY_CLASS)).toBe(true);
    const preventDefault = vi.fn<() => void>();
    listeners.get('gesturestart')?.({ preventDefault } as unknown as Event);
    expect(preventDefault).toHaveBeenCalled();
    first();
    first();
    expect(classes.has(TOUCH_POLICY_CLASS)).toBe(true);
    second();
    expect(classes.has(TOUCH_POLICY_CLASS)).toBe(false);
    expect(listeners.size).toBe(0);
  });
});
