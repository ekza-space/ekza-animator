// The Dope Sheet's touch adapter (STUDIO-TOUCH-SPEC §10.4, §20.3 item 8; T7): real pointer events on the canvas drive
// Studio Pro's own DopeSheetController — a tap is its click (a glyph selects its keys), a drag past the slop its drag
// (a marquee on empty rows), a long-press then a drag a band of frames, a long-press alone the press's menu, two
// fingers pan and zoom time without editing anything, a double-tap frames through the shell's operator, and a
// scaled canvas (36 pt rows) divides every point by its scale.
import type { Frame } from '@ekza-studio/anim-core';
import { afterEach, describe, expect, it } from 'vitest';
import { attachDopeSheetTouch, type DopeSheetTouchOptions } from '../../src';
import type { DopeSheetHit } from '../../src/types';
import {
  CONTROLS,
  dopeApp,
  keyCurve,
  type MountedSheet,
  mountSheet,
  selectControls,
  selectedKeys,
  settle,
  xOf,
} from './fixture';

let mounted: MountedSheet | null = null;
let detach: (() => void) | null = null;
afterEach(() => {
  detach?.();
  detach = null;
  mounted?.dispose();
  mounted = null;
});

async function setUp(options: DopeSheetTouchOptions = {}): Promise<MountedSheet> {
  mounted = mountSheet(await dopeApp());
  keyCurve(mounted.app, CONTROLS.lowerArmL, 'rz', []);
  keyCurve(mounted.app, CONTROLS.upperArmL, 'rz', [
    [0, 0],
    [10, 0.5],
    [20, 1],
  ]);
  selectControls(mounted.app, [CONTROLS.upperArmL]);
  mounted.sheet.redraw(true);
  detach = attachDopeSheetTouch(mounted.sheet, mounted.canvas, { longPressMs: 40, ...options });
  return mounted;
}

let nextId = 10;

function touch(
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  at: { readonly x: number; readonly y: number },
  id: number,
  scale = 1,
): void {
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType: 'touch',
      isPrimary: true,
      clientX: rect.left + at.x * scale,
      clientY: rect.top + at.y * scale,
      buttons: type === 'pointerup' ? 0 : 1,
    }),
  );
}

function drag(
  canvas: HTMLCanvasElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  id = nextId++,
): void {
  touch(canvas, 'pointerdown', from, id);
  for (let step = 1; step <= 6; step++) {
    touch(
      canvas,
      'pointermove',
      { x: from.x + ((to.x - from.x) * step) / 6, y: from.y + ((to.y - from.y) * step) / 6 },
      id,
    );
  }
  touch(canvas, 'pointerup', to, id);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('attachDopeSheetTouch', () => {
  it('a tap is the controller’s click: a glyph selects its keys and onTap gets the hit', async () => {
    const taps: DopeSheetHit[] = [];
    const m = await setUp({ onTap: (hit) => taps.push(hit) });
    const at = m.sheet.glyphPoint('summary', 10);
    if (at === null) throw new Error('no glyph');
    const id = nextId++;
    touch(m.canvas, 'pointerdown', at, id);
    touch(m.canvas, 'pointerup', at, id);
    await settle();
    expect(selectedKeys(m.app)).toHaveLength(1);
    expect(taps.at(-1)).toMatchObject({ kind: 'glyph', frame: 10 });
  });

  it('a drag past the slop on empty rows is a marquee over the keys under it', async () => {
    const m = await setUp();
    const a = m.sheet.glyphPoint('summary', 0);
    const c = m.sheet.glyphPoint('summary', 20);
    if (a === null || c === null) throw new Error('no glyphs');
    // from empty space below and right of the keys (a finger's 22 px reach would grab a key) to above the first
    drag(m.canvas, { x: c.x + 40, y: c.y + 70 }, { x: Math.max(1, a.x - 30), y: a.y - 8 });
    await settle();
    expect(selectedKeys(m.app)).toHaveLength(3);
  });

  it('a long-press then a drag draws a band of whole frames; a long-press alone is the menu of its press', async () => {
    const bands: ({ start: Frame; end: Frame } | null)[] = [];
    const presses: DopeSheetHit[] = [];
    const m = await setUp({
      onBand: (band, done) => done && bands.push(band),
      onLongPress: (hit) => presses.push(hit),
    });
    const y = (m.sheet.glyphPoint('summary', 10)?.y ?? 40) + 10;
    const id = nextId++;
    touch(m.canvas, 'pointerdown', { x: xOf(m.sheet, 4), y }, id);
    await wait(80);
    touch(m.canvas, 'pointermove', { x: xOf(m.sheet, 9), y }, id);
    touch(m.canvas, 'pointermove', { x: xOf(m.sheet, 14), y }, id);
    touch(m.canvas, 'pointerup', { x: xOf(m.sheet, 14), y }, id);
    expect(bands).toEqual([{ start: 4, end: 14 }]);
    expect(selectedKeys(m.app)).toEqual([]);

    const glyph = m.sheet.glyphPoint('summary', 20);
    if (glyph === null) throw new Error('no glyph');
    const hold = nextId++;
    touch(m.canvas, 'pointerdown', glyph, hold);
    await wait(80);
    touch(m.canvas, 'pointerup', glyph, hold);
    expect(presses.at(-1)).toMatchObject({ kind: 'glyph', frame: 20 });
  });

  it('two fingers pan and zoom time; nothing is selected or edited', async () => {
    const views: number[] = [];
    const m = await setUp({ onView: (view) => views.push(view.sx) });
    const before = m.sheet.view.sx;
    const version = m.app.store.version;
    const y = 120;
    touch(m.canvas, 'pointerdown', { x: 200, y }, 1);
    touch(m.canvas, 'pointerdown', { x: 260, y }, 2);
    for (let step = 1; step <= 5; step++) {
      touch(m.canvas, 'pointermove', { x: 200 - step * 20, y }, 1);
      touch(m.canvas, 'pointermove', { x: 260 + step * 20, y }, 2);
    }
    touch(m.canvas, 'pointerup', { x: 100, y }, 1);
    touch(m.canvas, 'pointerup', { x: 360, y }, 2);
    expect(m.sheet.view.sx).toBeGreaterThan(before * 2);
    expect(views.length).toBeGreaterThan(0);
    expect(selectedKeys(m.app)).toEqual([]);
    expect(m.app.store.version).toBe(version);
  });

  it('a double-tap frames through the shell (all on empty rows, the selection on a key)', async () => {
    const framed: string[] = [];
    const m = await setUp({ frame: (what) => framed.push(what) });
    const empty = { x: xOf(m.sheet, 30), y: 150 };
    for (let i = 0; i < 2; i++) {
      const id = nextId++;
      touch(m.canvas, 'pointerdown', empty, id);
      touch(m.canvas, 'pointerup', empty, id);
    }
    expect(framed).toEqual(['all']);
  });

  it('a scaled canvas divides every point by its scale', async () => {
    const taps: DopeSheetHit[] = [];
    mounted = mountSheet(await dopeApp(), { width: 640, height: 300 });
    keyCurve(mounted.app, CONTROLS.upperArmL, 'rz', [
      [0, 0],
      [10, 0.5],
    ]);
    selectControls(mounted.app, [CONTROLS.upperArmL]);
    mounted.canvas.style.width = `${640 * 1.8}px`;
    mounted.canvas.style.height = `${300 * 1.8}px`;
    mounted.sheet.redraw(true);
    detach = attachDopeSheetTouch(mounted.sheet, mounted.canvas, { scale: 1.8, onTap: (hit) => taps.push(hit) });
    const at = mounted.sheet.glyphPoint('summary', 10);
    if (at === null) throw new Error('no glyph');
    const id = nextId++;
    touch(mounted.canvas, 'pointerdown', at, id, 1.8);
    touch(mounted.canvas, 'pointerup', at, id, 1.8);
    expect(taps.at(-1)).toMatchObject({ kind: 'glyph', frame: 10 });
  });
});
