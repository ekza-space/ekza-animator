// STUDIO-TOUCH-SPEC §4.7, §20.3 item 17 (T1): the display overlay. A shell's display for a pane over the pane's own,
// merged at render and pick time; the pane's own display, its memory (what Studio Pro reads after a switch) and its
// state never change; it can be set before the pane registers, survives a workspace switch and Pro's display port,
// and its x-ray opacity replaces the 0.5 constant for that pane's pass.
import { afterEach, describe, expect, it } from 'vitest';
import { XRAY_OPACITY } from '../src/theme';
import { createRig, type Rig } from './helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

/** A screen point on a visible control of the wave document, in page px, and the pane it is in. */
function controlPoint(r: Rig, paneId: string): { x: number; y: number } {
  const control = r.app.store.list('controls')[0];
  if (control === undefined) throw new Error('no control');
  const at = r.vm.controlPickPoint(paneId, control.id);
  if (at === null) throw new Error('control not visible');
  return { x: at.point.x, y: at.point.y };
}

describe('ViewportManager.setDisplayOverlay (§20.3 item 17)', () => {
  it('changes what a pane shows and picks, never its own display, memory or state; the disposer clears it', async () => {
    rig = await createRig();
    rig.layout('single');
    rig.frame();
    const id = 'pane-single';
    const at = controlPoint(rig, id);
    expect(rig.vm.pickCandidates(id, at.x, at.y).some((hit) => hit.kind === 'control')).toBe(true);
    const own = rig.vm.paneState(id)?.display;
    const remembered = rig.vm.rememberedPane(id);
    const off = rig.vm.setDisplayOverlay(id, { controls: false, xray: true });
    expect(rig.vm.pickCandidates(id, at.x, at.y).some((hit) => hit.kind === 'control')).toBe(false);
    expect(rig.vm.paneView(id)?.display.xray).toBe(true); // what mesh picking reads
    expect(rig.vm.paneState(id)?.display).toBe(own);
    expect(rig.vm.rememberedPane(id)).toEqual(remembered);
    off();
    expect(rig.vm.pickCandidates(id, at.x, at.y).some((hit) => hit.kind === 'control')).toBe(true);
    expect(rig.vm.paneView(id)?.display).toEqual(own);
    off(); // idempotent
  });

  it('applies to a pane registered later, stays over Pro’s display port and a workspace switch', async () => {
    rig = await createRig();
    const id = 'pane-single';
    const off = rig.vm.setDisplayOverlay(id, { grid: false });
    rig.layout('single');
    expect(rig.vm.paneView(id)?.display.grid).toBe(false);
    expect(rig.vm.paneState(id)?.display.grid).toBe(true);
    // the display port (Pro's View menu) writes the pane's own display; the overlay stays on top
    const own = rig.vm.paneState(id)?.display;
    if (own === undefined) throw new Error('no pane');
    rig.vm.updatePane(id, { display: { ...own, xray: true } });
    expect(rig.vm.paneState(id)?.display.xray).toBe(true);
    expect(rig.vm.paneView(id)?.display).toMatchObject({ xray: true, grid: false });
    expect(rig.vm.rememberedPane(id)?.display.grid).toBe(true);
    rig.app.session.setState({ workspace: 'model' });
    expect(rig.vm.paneView(id)?.display.grid).toBe(false);
    expect(rig.vm.rememberedPane(id)?.display.grid).not.toBe(false);
    off();
    expect(rig.vm.paneView(id)?.display.grid).toBe(rig.vm.paneState(id)?.display.grid);
  });

  it('a newer overlay wins; the older one’s disposer leaves it', async () => {
    rig = await createRig();
    rig.layout('single');
    const id = 'pane-single';
    const offOld = rig.vm.setDisplayOverlay(id, { grid: false });
    const offNew = rig.vm.setDisplayOverlay(id, { hud: false });
    offOld();
    expect(rig.vm.paneView(id)?.display).toMatchObject({ grid: true, hud: false });
    offNew();
    expect(rig.vm.paneView(id)?.display.hud).toBe(true);
  });

  it('its x-ray opacity is the one in force while its pane draws (0.5 elsewhere)', async () => {
    rig = await createRig();
    rig.layout('split', { display: { xray: true } });
    const ids = rig.vm.paneIds();
    expect(ids.length).toBe(2);
    rig.vm.setDisplayOverlay(ids[0] as string, { xrayOpacity: 0.25 });
    const drawn: number[] = [];
    const render = rig.renderer.render.bind(rig.renderer);
    rig.renderer.render = (scene, camera) => {
      if (scene === rig?.vm.scene) drawn.push(XRAY_OPACITY);
      render(scene, camera);
    };
    rig.vm.invalidate();
    rig.frame();
    expect(drawn.slice(0, 2)).toEqual([0.25, 0.5]);
  });
});
