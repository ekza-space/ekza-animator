// The Graph Editor's touch adapter (STUDIO-TOUCH-SPEC §10.5, §5.2.1, §20.3 item 8; T10): real pointer events on the
// canvas drive Studio Pro's own GraphEditorController — a tap is its click (a key selects), a drag past the slop its
// drag (a marquee on empty space; a key on one axis), a long-press alone the key's menu, two fingers pan and pinch
// without editing anything, a double-tap frames through the shell's operator, the finger's hit radii hold only while
// the adapter is attached, and a scaled canvas divides every point by its scale.
import { afterEach, describe, expect, it } from 'vitest';
import { attachGraphEditorTouch, GRAPH_METRICS, type GraphEditorTouchOptions } from '../src';
import type { GraphHit } from '../src/types';
import { callsOf, type Mounted, mount, settle, WAVE, waveApp } from './support/app';

let mounted: Mounted | null = null;
let detach: (() => void) | null = null;
afterEach(() => {
  detach?.();
  detach = null;
  mounted?.dispose();
  mounted = null;
});

async function setUp(options: GraphEditorTouchOptions = {}): Promise<Mounted> {
  mounted = mount(await waveApp());
  mounted.controller.redraw(true);
  detach = attachGraphEditorTouch(mounted.controller, mounted.overlay, { longPressMs: 40, ...options });
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

function drag(canvas: HTMLCanvasElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
  const id = nextId++;
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

function tap(canvas: HTMLCanvasElement, at: { x: number; y: number }, scale = 1): void {
  const id = nextId++;
  touch(canvas, 'pointerdown', at, id, scale);
  touch(canvas, 'pointerup', at, id, scale);
}

const keyAt = (m: Mounted, index: 0 | 1 | 2): { x: number; y: number } => {
  const point = m.controller.keyPoint(WAVE.keys[index]);
  if (point === null) throw new Error('key off the canvas');
  return { x: point.x, y: point.y };
};

describe('attachGraphEditorTouch', () => {
  it('a tap on a key selects it; a tap on empty space clears; the finger’s radius holds only while attached', async () => {
    const m = await setUp();
    const taps: GraphHit[] = [];
    detach?.();
    detach = attachGraphEditorTouch(m.controller, m.overlay, { longPressMs: 40, onTap: (hit) => taps.push(hit) });
    // a finger 15 px off the key still hits it (§5.4: 22 px), the mouse's 6 px would not
    const k = keyAt(m, 1);
    tap(m.overlay, { x: k.x + 15, y: k.y });
    await settle();
    expect(GRAPH_METRICS.hitKey).toBe(22);
    expect(taps[0]?.kind).toBe('key');
    expect(callsOf(m.app, 'select.keys').at(-1)).toMatchObject({ items: [{ key: WAVE.keys[1] }], mode: 'replace' });
    detach?.();
    detach = null;
    expect(GRAPH_METRICS.hitKey).toBe(6);
  });

  it('a drag on empty space is a marquee; a key drag keeps time with the default axis', async () => {
    const m = await setUp();
    // a box around the middle key from empty space above it
    const k = keyAt(m, 1);
    drag(m.overlay, { x: k.x - 30, y: 4 }, { x: k.x + 30, y: m.controller.size.height - 4 });
    await settle();
    const marquee = callsOf(m.app, 'select.keys').at(-1) as { items: { key: string }[] } | undefined;
    expect(marquee?.items.map((item) => item.key)).toEqual([WAVE.keys[1]]);
  });

  it('a long-press alone is the menu of what is under it; a double-tap frames through the shell', async () => {
    const pressed: GraphHit[] = [];
    const framed: string[] = [];
    const m = await setUp({ onLongPress: (hit) => pressed.push(hit), frame: (what) => framed.push(what) });
    const id = nextId++;
    const k = keyAt(m, 2);
    touch(m.overlay, 'pointerdown', k, id);
    await new Promise((resolve) => setTimeout(resolve, 80));
    touch(m.overlay, 'pointerup', k, id);
    expect(pressed[0]).toMatchObject({ kind: 'key', key: WAVE.keys[2] });
    tap(m.overlay, { x: 300, y: 8 });
    tap(m.overlay, { x: 301, y: 9 });
    expect(framed).toEqual(['all']);
  });

  it('two fingers pinch time and pan without editing; the view is the user’s afterwards', async () => {
    const m = await setUp();
    const before = m.controller.view;
    const calls = m.app.calls.length;
    const a = nextId++;
    const b = nextId++;
    touch(m.overlay, 'pointerdown', { x: 260, y: 150 }, a);
    touch(m.overlay, 'pointerdown', { x: 340, y: 150 }, b);
    for (let step = 1; step <= 5; step++) {
      touch(m.overlay, 'pointermove', { x: 260 - step * 20, y: 150 }, a);
      touch(m.overlay, 'pointermove', { x: 340 + step * 20, y: 150 }, b);
    }
    touch(m.overlay, 'pointerup', { x: 160, y: 150 }, a);
    touch(m.overlay, 'pointerup', { x: 440, y: 150 }, b);
    expect(m.controller.view.sx).toBeGreaterThan(before.sx * 2);
    // no finger moved vertically apart: the value axis keeps its scale
    expect(m.controller.view.sy).toBeCloseTo(before.sy, 9);
    expect(m.app.calls.length).toBe(calls);
  });

  it('a canvas shown 2× larger divides every point by its scale', async () => {
    const m = await setUp();
    detach?.();
    const taps: GraphHit[] = [];
    // the overlay is drawn at 600 × 300 and shown at 1200 × 600
    m.overlay.style.width = '1200px';
    m.overlay.style.height = '600px';
    detach = attachGraphEditorTouch(m.controller, m.overlay, { scale: 2, onTap: (hit) => taps.push(hit) });
    const k = keyAt(m, 0);
    tap(m.overlay, k, 2);
    expect(taps[0]).toMatchObject({ kind: 'key', key: WAVE.keys[0] });
    expect(GRAPH_METRICS.hitKey).toBe(11);
  });
});
