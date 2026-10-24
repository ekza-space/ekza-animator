// STUDIO-TOUCH-SPEC §20.3 item 1 (T1): Auto-Rig's touch navigation, moved into the viewport. The two-finger stage
// inside a real ViewportManager: one finger stays the pipeline's (the Simple override orbits); a second finger in the
// same pane ends the first one's orbit (kept) or cancels its tool drag, and the pair pans by the midpoint and dollies
// by the spread through `navigate`; a shot camera commits once per pair; the stage and a touch shell's arbiter share
// one slot, so they never run together (T1a risk 4); the Simple override's brush claim set has Paint Colour.
import { VIEWPORT_TOOL } from '@ekza-studio/editor-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BRUSH_TOOLS,
  type CameraSnapshot,
  createPointerArbiter,
  createTwoFingerStage,
  MESH_TOOLS,
  simpleGesture,
} from '../src';
import { addCamera, createRig, type Rig, shotCamera } from './helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

function finger(
  element: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  id: number,
  x: number,
  y: number,
): void {
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType: 'touch',
      isPrimary: id === 1,
      clientX: x,
      clientY: y,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    }),
  );
}

const moved = (a: CameraSnapshot, b: CameraSnapshot): boolean =>
  a.position.some((v, i) => Math.abs(v - (b.position[i] ?? 0)) > 1e-6);
const sameView = (a: CameraSnapshot, b: CameraSnapshot): boolean =>
  a.quaternion.every((v, i) => Math.abs(v - (b.quaternion[i] ?? 0)) < 1e-9);
const distance = (s: CameraSnapshot): number =>
  Math.hypot(s.position[0] - s.target[0], s.position[1] - s.target[1], s.position[2] - s.target[2]);

/** A single pane with the Simple override's table (left drag on empty space orbits) and the two-finger stage. */
async function setup(): Promise<{ rig: Rig; pane: HTMLElement; off: () => void }> {
  const r = await createRig();
  rig = r;
  r.layout('single');
  r.frame();
  r.vm.setNavigationOverride({
    gesture: (e) => simpleGesture(e, { ortho: false, claimed: () => false }),
  });
  const off = r.vm.setPointerArbiter(createTwoFingerStage());
  return { rig: r, pane: r.panes.get('pane-single') as HTMLElement, off };
}

describe('two-finger stage (§20.3 item 1, AUTORIG-SPEC §8.3)', () => {
  it('one finger is the pipeline’s: the Simple override orbits', async () => {
    const { rig: r, pane } = await setup();
    const start = r.vm.camera('pane-single');
    finger(pane, 'pointerdown', 1, 500, 300);
    finger(pane, 'pointermove', 1, 560, 300);
    finger(pane, 'pointerup', 1, 560, 300);
    expect(sameView(r.vm.camera('pane-single'), start)).toBe(false);
  });

  it('a second finger ends the first one’s orbit (kept); the pair pinches towards the midpoint and pans', async () => {
    const { rig: r, pane } = await setup();
    const start = r.vm.camera('pane-single');
    finger(pane, 'pointerdown', 1, 500, 300);
    finger(pane, 'pointermove', 1, 540, 300); // orbiting
    const orbited = r.vm.camera('pane-single');
    expect(sameView(orbited, start)).toBe(false);
    finger(pane, 'pointerdown', 2, 640, 300);
    finger(pane, 'pointermove', 1, 440, 300); // spread 100 → 200: a dolly in, the view direction unchanged
    const zoomed = r.vm.camera('pane-single');
    expect(sameView(zoomed, orbited)).toBe(true);
    expect(distance(zoomed)).toBeLessThan(distance(orbited) * 0.7);
    finger(pane, 'pointermove', 1, 440, 340);
    finger(pane, 'pointermove', 2, 640, 340); // both down 40: a pan
    const panned = r.vm.camera('pane-single');
    expect(sameView(panned, zoomed)).toBe(true);
    expect(moved(panned, zoomed)).toBe(true);
    finger(pane, 'pointerup', 1, 440, 340);
    finger(pane, 'pointermove', 2, 700, 400); // the remaining finger is idle until it lifts
    finger(pane, 'pointerup', 2, 700, 400);
    expect(r.vm.camera('pane-single')).toEqual(panned);
  });

  it('a second finger cancels a tool drag the first one began (never committed)', async () => {
    const { rig: r, pane } = await setup();
    const seen: string[] = [];
    r.app.tools.register({
      id: 'probe',
      panel: 'viewport',
      label: 'Probe',
      create: () => ({
        pointerDown: () => seen.push('down') > 0,
        pointerMove: () => seen.push('move') > 0,
        pointerUp: () => seen.push('up') > 0,
        cancel: () => {
          seen.push('cancel');
        },
      }),
    });
    r.app.session.setState((st) => ({ tools: { ...st.tools, viewport: 'probe' } }));
    r.vm.setNavigationOverride(null); // no Simple table: the finger is the tool's
    finger(pane, 'pointerdown', 1, 500, 300);
    finger(pane, 'pointermove', 1, 520, 300);
    finger(pane, 'pointerdown', 2, 640, 300);
    finger(pane, 'pointermove', 2, 680, 300);
    finger(pane, 'pointerup', 1, 520, 300);
    finger(pane, 'pointerup', 2, 680, 300);
    expect(seen).toEqual(['down', 'move', 'cancel']);
  });

  it('a pinch on a shot camera commits once, when the pair ends', async () => {
    const r = await createRig();
    rig = r;
    addCamera(r.app, shotCamera({ locked: false }));
    r.layout('split');
    r.frame();
    const pane = r.panes.get('pane-left') as HTMLElement;
    r.vm.setPointerArbiter(createTwoFingerStage());
    const local: number[] = [];
    r.app.store.subscribe((batch) => {
      if (batch.origin === 'local') local.push(batch.version);
    });
    finger(pane, 'pointerdown', 1, 200, 300);
    finger(pane, 'pointerdown', 2, 300, 300);
    finger(pane, 'pointermove', 2, 340, 300);
    await new Promise((resolve) => setTimeout(resolve, 200)); // a pause longer than the wheel's burst
    finger(pane, 'pointermove', 1, 160, 300);
    expect(local).toHaveLength(0);
    finger(pane, 'pointerup', 2, 340, 300);
    expect(local).toHaveLength(1);
    expect(r.app.store.preview).toBeNull();
    finger(pane, 'pointerup', 1, 160, 300);
    expect(local).toHaveLength(1);
  });

  it('shares one slot with a touch shell’s arbiter: installing one removes the other (T1a risk 4)', async () => {
    const { rig: r, pane, off } = await setup();
    const taps: string[] = [];
    const offArbiter = r.vm.setPointerArbiter(
      createPointerArbiter({
        buffered: ['touch', 'pen'],
        slopPx: { touch: 10, pen: 4 },
        longPressMs: 450,
        multiTapMs: { touch: 450, pen: 350 },
        multiTapPx: { touch: 24, pen: 8 },
        brushDelayMs: 120,
        twoFingerTapMs: 250,
        palmMs: 500,
        routing: () => 'shared',
        claims: () => 'navigate',
        onTap: () => 'consumed',
        onDoubleTap: () => {},
        onLongPress: () => undefined,
        onTwoFingerTap: (paneId) => taps.push(paneId),
      }),
    );
    off(); // the replaced stage's disposer is a no-op
    finger(pane, 'pointerdown', 1, 500, 300);
    finger(pane, 'pointerdown', 2, 600, 300);
    finger(pane, 'pointerup', 1, 500, 300);
    finger(pane, 'pointerup', 2, 600, 300);
    expect(taps).toEqual(['pane-single']); // the arbiter's two-finger tap: it is the one installed
    offArbiter();
  });
});

describe('the Simple override’s claim sets (§5.1)', () => {
  it('the brush claim set has Paint Colour; the mesh claim set adds the Quick Rig markers', () => {
    expect([...BRUSH_TOOLS].sort()).toEqual([VIEWPORT_TOOL.paint, VIEWPORT_TOOL.paintSkinWeights].sort());
    expect([...MESH_TOOLS].sort()).toEqual(
      [VIEWPORT_TOOL.paint, VIEWPORT_TOOL.paintSkinWeights, VIEWPORT_TOOL.quickRigMarker].sort(),
    );
  });
});
