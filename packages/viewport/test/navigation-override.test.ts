// AUTORIG-SPEC §8.1 (D3): the ViewportManager's per-shell navigation override. It is asked first on every press with
// the pane and the press point; its gesture navigates as a profile gesture does, null falls back to the shipped order
// (the profile's Alt chords, then the tool); removing it (null) restores the profile; it never writes `navProfile`.
import { afterEach, describe, expect, it } from 'vitest';
import type { CameraSnapshot, NavigationOverride } from '../src';
import { createRig, drag, type Rig } from './helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

function centre(r: Rig, pane: string): { x: number; y: number } {
  const rect = r.panes.get(pane)?.getBoundingClientRect();
  return { x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2 };
}

function dragIn(r: Rig, pane: string, dx: number, dy: number, init: { button?: number; altKey?: boolean } = {}): void {
  const c = centre(r, pane);
  drag(r.panes.get(pane) as HTMLElement, c, { x: c.x + dx, y: c.y + dy }, init);
}

function moved(a: CameraSnapshot, b: CameraSnapshot): boolean {
  return (
    a.position.some((v, i) => Math.abs(v - (b.position[i] ?? 0)) > 1e-6) ||
    a.target.some((v, i) => Math.abs(v - (b.target[i] ?? 0)) > 1e-6)
  );
}

const distance = (s: CameraSnapshot): number =>
  Math.hypot(s.position[0] - s.target[0], s.position[1] - s.target[1], s.position[2] - s.target[2]);

describe('ViewportManager.setNavigationOverride (AUTORIG-SPEC §8.1)', () => {
  it('a plain left drag tumbles only while the override says so; removing it restores the profile', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.app.prefs.setState({ navProfile: 'maya' });
    rig.frame();
    const presses: { paneId: string; x: number; y: number; button: number }[] = [];
    const simple: NavigationOverride = {
      gesture(e, paneId, at) {
        presses.push({ paneId, x: at.x, y: at.y, button: e.button });
        if (e.altKey) return null;
        return e.button === 0 ? 'tumble' : e.button === 2 ? 'track' : null;
      },
    };
    const start = rig.vm.camera('pane-right');
    dragIn(rig, 'pane-right', 100, 0);
    expect(moved(rig.vm.camera('pane-right'), start)).toBe(false); // the Maya profile: plain LMB is the tool's

    rig.vm.setNavigationOverride(simple);
    dragIn(rig, 'pane-right', 100, 0);
    const tumbled = rig.vm.camera('pane-right');
    expect(moved(tumbled, start)).toBe(true);
    expect(distance(tumbled)).toBeCloseTo(distance(start), 9);
    // asked with the pane and the press point in pane CSS px
    const rect = rig.panes.get('pane-right')?.getBoundingClientRect() as DOMRect;
    expect(presses.at(-1)).toEqual({ paneId: 'pane-right', x: rect.width / 2, y: rect.height / 2, button: 0 });

    // a right drag tracks (pan): the target moves, the distance stays
    dragIn(rig, 'pane-right', 40, 30, { button: 2 });
    const tracked = rig.vm.camera('pane-right');
    expect(distance(tracked)).toBeCloseTo(distance(tumbled), 9);
    expect(Math.hypot(...tracked.target.map((v, i) => v - (tumbled.target[i] ?? 0)))).toBeGreaterThan(0.001);

    // null falls back to the profile: Alt+RMB is still Maya's dolly
    dragIn(rig, 'pane-right', 80, 0, { button: 2, altKey: true });
    expect(distance(rig.vm.camera('pane-right'))).toBeLessThan(distance(tracked));

    rig.vm.setNavigationOverride(null);
    const after = rig.vm.camera('pane-right');
    dragIn(rig, 'pane-right', 100, 0);
    expect(moved(rig.vm.camera('pane-right'), after)).toBe(false);
    expect(rig.app.prefs.getState().navProfile).toBe('maya');
  });

  it('a null answer leaves the press to the tool (no navigation)', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.frame();
    rig.vm.setNavigationOverride({ gesture: () => null });
    const start = rig.vm.camera('pane-right');
    dragIn(rig, 'pane-right', 100, 0);
    expect(moved(rig.vm.camera('pane-right'), start)).toBe(false);
  });
});
